var provenance = require('./session-provenance');

// This opt-in protocol only describes an authenticated ordinary pane snapshot.
// It grants no action authority and is never a visible-render acknowledgement.
function begin(ctx, ws, msg) {
  if (!Object.prototype.hasOwnProperty.call(msg, 'paneActivation')) {
    ws._clayPaneActivation = null;
    return null;
  }
  var request = msg.paneActivation;
  var session = ctx.sm.sessions.get(msg.id);
  var userId = ws._clayUser && ws._clayUser.id || null;
  var worker = provenance.isWorker(session);
  var parentSession = worker && Array.from(ctx.sm.sessions.values()).find(function (parent) { return parent.sessionOriginId === session.sessionProvenance.parentSessionOriginId && !provenance.isWorker(parent); });
  var identity = session && {
    requestId: request && request.requestId,
    generation: request && request.generation,
    projectSlug: ctx.slug,
    viewerId: userId,
    ownerId: session.ownerId || null,
    sessionId: session.localId,
    sessionOriginId: session.sessionOriginId,
    role: worker ? 'worker' : 'driver',
    workerGeneration: worker ? session.sessionProvenance.generation : null,
    parentSessionOriginId: worker ? session.sessionProvenance.parentSessionOriginId : null,
    groupStamp: groupStamp(),
  };
  function groupStamp() {
    var group = ctx.splitStore && ctx.splitStore.groupForMember(msg.id);
    return group ? JSON.stringify({ id: group.id, members: group.members, pair: group.pair || null }) : null;
  }
  function allowed() {
    if (typeof ws._clayAuthCheck === 'function' && !ws._clayAuthCheck()) return false;
    var access = ctx.getProjectAccess ? ctx.getProjectAccess() : { visibility: 'public' };
    if (!ctx.usersModule.isMultiUser()) return !session.ownerId;
    return !!userId &&
      !!ctx.usersModule.findUserById(userId) &&
      ctx.usersModule.canAccessProject(userId, access) &&
      ctx.usersModule.canAccessSession(userId, session, access);
  }
  var valid = request && typeof request === 'object' &&
    typeof request.requestId === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(request.requestId) &&
    Number.isSafeInteger(request.generation) && request.generation > (ws._clayPaneActivationGeneration || 0) &&
    ws._clayPane === true && !ws._clayContextual && !ctx.isMate && ws.readyState === 1 &&
    session && session.sessionOriginId && !session.isMate &&
    (session.runtimeMode || session.mode || 'gui') === 'gui' && !session.tuiSuspended &&
    request.projectSlug === identity.projectSlug && request.viewerId === identity.viewerId &&
    request.ownerId === identity.ownerId && request.sessionOriginId === identity.sessionOriginId &&
    request.role === identity.role && request.workerGeneration === identity.workerGeneration &&
    (!ctx.splitStore || request.groupStamp === identity.groupStamp && request.parentSessionOriginId === identity.parentSessionOriginId) &&
    (!worker || Number.isSafeInteger(identity.workerGeneration) && identity.workerGeneration > 0) && allowed();
  if (!valid) {
    // Do not disclose whether a foreign or removed session exists.
    ctx.sendTo(ws, { type: 'pane_activation_rejected', requestId: request && typeof request.requestId === 'string' ? request.requestId.slice(0, 96) : null });
    return false;
  }
  ws._clayPaneActivationGeneration = identity.generation;
  ws._clayPaneActivation = identity;
  function current() {
    return ws.readyState === 1 && ws._clayPane === true && !ws._clayContextual && !ctx.isMate && !session.isMate &&
      ws._clayPaneActivation === identity &&
      ctx.sm.sessions.get(msg.id) === session && session.sessionOriginId === identity.sessionOriginId &&
      (ws._clayUser && ws._clayUser.id || null) === userId &&
      (session.ownerId || null) === identity.ownerId &&
      (session.runtimeMode || session.mode || 'gui') === 'gui' && !session.tuiSuspended &&
      (provenance.isWorker(session) ? 'worker' : 'driver') === identity.role &&
      (provenance.isWorker(session) ? session.sessionProvenance.generation : null) === identity.workerGeneration &&
      groupStamp() === identity.groupStamp &&
      (!worker || parentSession && ctx.sm.sessions.get(parentSession.localId) === parentSession &&
        session.sessionProvenance.parentSessionOriginId === identity.parentSessionOriginId && parentSession.sessionOriginId === identity.parentSessionOriginId &&
        !provenance.isWorker(parentSession) && (parentSession.ownerId || null) === identity.ownerId) &&
      allowed();
  }
  function send(message) {
    if (current() && ws._clayActiveSession === session.localId) ctx.sendTo(ws, Object.assign({}, message, { paneActivation: identity }));
  }
  var historyItems = [], historyText = 0;
  // Only synchronous replay uses this bounded envelope. Each actual disclosure
  // rechecks live authorization; nothing is cached across a send or async work.
  send.history = function (message) {
    if (message.type === 'history_done') {
      flushHistory();
      send(message);
      return;
    }
    historyItems.push(message);
    historyText += typeof message.text === 'string' ? message.text.length : 0;
    if (historyItems.length >= 100 || historyText >= 65536) flushHistory();
  };
  function flushHistory() {
    if (!historyItems.length) return;
    var items = historyItems;
    historyItems = []; historyText = 0;
    send({ type: 'pane_history_batch', items: items });
  }
  if (current()) ctx.sendTo(ws, { type: 'pane_activation_started', paneActivation: identity });
  ws._clayPaneActivationValid = function () { return current() && ws._clayActiveSession === identity.sessionId; };
  return {
    validate: function () {
      if (current()) return true;
      ctx.sendTo(ws, { type: 'pane_activation_rejected', requestId: identity.requestId });
      ws._clayPaneActivation = null;
      return false;
    },
    send: send,
    finish: function () {
      // Includes history listeners, status, permissions and context sources.
      // Consumers still need to observe their own DOM/composer readiness.
      if (ws._clayActiveSession === session.localId) send({ type: 'pane_activation_snapshot_done' });
    },
  };
}

module.exports = { begin: begin };
