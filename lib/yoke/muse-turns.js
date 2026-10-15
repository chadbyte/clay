// Foreground completion is a non-terminal SDK fact. Continue following every
// turn to its real outcome while releasing only the next submission boundary.
function create(options) {
  var state = options.state;
  var turns = new Map();
  function foreground(entry, params) {
    if (entry.yielded || !params || !Array.isArray(params.blockingAgents) || !params.blockingAgents.length) return;
    entry.yielded = true;
    entry.release({ kind: 'foreground' });
  }
  function onFrame(frame) {
    if (frame.method !== 'turn/foregroundCompleted') return;
    var entry = turns.get(frame.params.turnId);
    var folded = state.session.fold.turn(frame.params.turnId);
    if (entry && folded && folded.state === 'running') foreground(entry, folded.foregroundCompleted);
  }
  function follow(turn, report, sequence) {
    var entry = { turn: turn, yielded: false };
    var boundary = new Promise(function (resolve) { entry.release = resolve; });
    turns.set(turn.turnId, entry);
    state.liveTurnIds.add(turn.turnId);
    var terminal = (async function () {
      try {
        for await (var item of turn.items()) {
          if (state.stopped) return { kind: 'stopped' };
          if (!options.renderer.hasItem(item.itemId)) options.renderer.emitItem(item);
          await options.emitArtifact(item);
        }
        var outcome = await options.runtime().wait(turn.completed);
        if (state.stopped) return { kind: 'stopped' };
        options.renderer.closeBlocks(turn.turnId);
        var event = options.outcomeEvent(outcome);
        // A retired foreground turn cannot settle a newer turn's reviews or
        // user-work completion callbacks when its reminder checks finish late.
        if (event.yokeType === 'result' && entry.yielded && sequence < state.messageSequence) event.backgroundOnly = true;
        if (report || event.yokeType !== 'result') options.push(event);
        if (event.yokeType !== 'result') await options.close();
        return { kind: 'terminal', outcome: outcome, event: event };
      } catch (error) {
        options.fail(error);
        return { kind: 'failed' };
      } finally {
        turns.delete(turn.turnId);
        state.liveTurnIds.delete(turn.turnId);
        if (!state.stopped && !state.active && state.inputEnded && !turns.size) options.close().catch(options.fail);
      }
    })();
    // Session.apply can receive this event before turn/start's acknowledgement.
    var folded = state.session.fold.turn(turn.turnId);
    if (folded && folded.state === 'running') foreground(entry, folded.foregroundCompleted);
    return Promise.race([terminal, boundary]);
  }
  return { follow: follow, onFrame: onFrame, pending: function () { return turns.size > 0; },
    background: function () { return Array.from(turns.values()).some(function (entry) { return entry.yielded; }); } };
}
module.exports = { create: create };
