// Claude delivery watchdog. Only an unanswered foreground turn is replayable.
function attachResponseRecovery(ctx) {
  var states = new Map();
  var schedule = ctx.setTimeout || setTimeout;
  var unschedule = ctx.clearTimeout || clearTimeout;
  var waitMs = ctx.waitMs || 180000;
  var stopMs = ctx.stopMs || 10000;

  function live(session, state) {
    return states.get(session) === state && !session.destroying && !session.taskStopRequested
      && state.ownerId === session.ownerId && state.vendor === session.vendor
      && (!ctx.sessions || ctx.sessions.get(session.localId) === session);
  }
  function clearTimer(state) {
    if (state.timer) unschedule(state.timer);
    state.timer = null;
  }
  function cancel(session, expected) {
    var state = states.get(session);
    if (expected && state !== expected) return;
    if (state) clearTimer(state);
    states.delete(session);
  }
  function protectedWait(session) {
    return [session.pendingPermissions, session.pendingAskUser, session.pendingElicitations,
      session.pendingUserDialogs, session.activeTaskToolIds].some(function(map) {
      return map && Object.keys(map).length > 0;
    }) || (session.activeBackgroundTasks && session.activeBackgroundTasks.length > 0);
  }
  function arm(session, state) {
    clearTimer(state);
    if (!state.turns.length || state.turns[0].progress || state.stopping) return;
    state.timer = schedule(function() { expire(session, state); }, waitMs);
    if (state.timer && state.timer.unref) state.timer.unref();
  }
  function snapshot(payload) {
    return Object.assign({}, payload, { images: payload.images ? JSON.parse(JSON.stringify(payload.images)) : payload.images });
  }
  function begin(session, payload, retryState) {
    if (retryState) return retryState;
    cancel(session);
    var state = { turns: [snapshot(payload)], timer: null, stopping: false, retried: false, ownerId: session.ownerId, vendor: session.vendor };
    states.set(session, state);
    arm(session, state);
    return state;
  }
  function enqueue(session, payload) {
    var state = states.get(session);
    if (!state) return begin(session, payload);
    state.turns.push(snapshot(payload));
    return state;
  }
  function progress(session) {
    var state = states.get(session);
    if (!state || state.stopping || !state.turns.length) return;
    state.turns[0].progress = true;
    clearTimer(state);
  }
  function event(session, msg) {
    var state = states.get(session);
    if (!state || state.stopping || !msg) return;
    var type = msg.yokeType;
    if (type === 'error' || type === 'interrupted') { cancel(session); return; }
    if (type === 'result') {
      if (msg.subtype === 'success' && !msg.is_error && msg.numTurns === 0
          && msg.origin && msg.origin.kind === 'task-notification'
          && !msg.localCommand && msg.resultText === '') return;
      var remaining = require('./sdk-turn-queue').pendingSends(session, msg);
      state.turns = remaining ? state.turns.slice(-remaining) : [];
      state.retried = false;
      arm(session, state);
      if (!state.turns.length) cancel(session);
    } else if ((type === 'text_delta' || type === 'thinking_delta') && (msg.text || msg.delta)
        || type === 'tool_start' || type === 'tool_input_delta' || type === 'tool_progress'
        || type === 'task_started' || type === 'task_progress' || type === 'subagent_message'
        || type === 'message' && msg.messageRole === 'assistant' && msg.content && msg.content.length) {
      progress(session);
    }
  }
  function finish(session, state, text) {
    if (!live(session, state)) { cancel(session, state); return; }
    cancel(session);
    // Fence late output when a transport cannot confirm termination.
    session._sdkQueryGeneration = Number(session._sdkQueryGeneration || 0) + 1;
    session.isProcessing = false;
    session._awaitingTurnResult = false;
    session._queuedTurnCount = 0;
    ctx.changed();
    ctx.record(session, { type: 'thinking_stop' });
    ctx.record(session, { type: 'error', text: text });
    ctx.record(session, { type: 'done', code: 1 });
    ctx.broadcast();
  }
  async function expire(session, state) {
    clearTimer(state);
    if (!live(session, state)) { cancel(session, state); return; }
    // Never stop a known tool or a human decision because prose is absent.
    if (protectedWait(session)) { progress(session); return; }
    state.stopping = true;
    ctx.record(session, { type: 'info', text: 'Claude has not responded for three minutes. Stopping this attempt safely before retrying.' });
    var timeout;
    var stopped = false;
    try {
      var stopAttempt = (async function() {
        var handle = session.queryInstance || state.handle;
        if (!handle && session.abortController) session.abortController.abort();
        if (!handle && state.starting) await state.starting;
        handle = handle || session.queryInstance || state.handle;
        if (handle) {
          if (typeof handle.stopAndWait !== 'function') return false;
          await handle.stopAndWait();
          if (session.streamPromise) await session.streamPromise;
        }
        return true;
      })();
      session._responseRecoveryStopPending = stopAttempt;
      stopAttempt.then(function(confirmed) {
        if (confirmed && session._responseRecoveryStopPending === stopAttempt) session._responseRecoveryStopPending = null;
      }, function() {});
      stopped = await Promise.race([
        stopAttempt,
        new Promise(function(resolve) { timeout = schedule(function() { resolve(false); }, stopMs); }),
      ]);
    } catch (e) { stopped = false; }
    if (timeout) unschedule(timeout);
    if (!live(session, state)) { cancel(session, state); return; }
    if (!stopped) {
      finish(session, state, 'Claude could not be confirmed stopped. Automatic retry was cancelled to avoid running your request twice. Check your Claude connection before trying again.');
      return;
    }
    if (state.retried || state.turns.length !== 1) {
      finish(session, state, state.retried
        ? 'Claude still has not responded after one automatic retry. Please send your message again or check your Claude connection.'
        : 'Claude did not respond. Several messages were queued, so automatic replay was cancelled to avoid duplicating work. Please send the unanswered messages again.');
      return;
    }
    state.retried = true;
    state.stopping = false;
    session.isProcessing = true;
    ctx.changed();
    ctx.record(session, { type: 'info', text: 'The previous attempt has stopped. Retrying your original message once.' });
    ctx.send(session, { type: 'status', status: 'processing' });
    arm(session, state);
    var payload = state.turns[0];
    await ctx.restart(session, payload, state);
  }
  return {
    begin: begin, enqueue: enqueue, event: event, progress: progress, cancel: cancel,
    current: function(session) { return states.get(session); },
    valid: live,
    stopping: function(session) { var state = states.get(session); return !!(state && state.stopping); },
    dispose: function() { states.forEach(function(state) { clearTimer(state); }); states.clear(); },
  };
}
module.exports = { attachResponseRecovery: attachResponseRecovery };
