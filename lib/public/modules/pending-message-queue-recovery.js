// Queue recovery keeps an authorized queue scope distinct from WebSocket transport.

function sameId(a, b) { return String(a) === String(b); }

export function emptyQueue() { return { projectSlug: null, sessionId: null, revision: 0, paused: false, items: [], loading: false, error: "" }; }

export function queueContext(state) {
  state = state || {};
  var available = !!state.currentSlug && !!state.activeSessionId && state.activeSessionMode !== "tui" && !state.dmMode && !state.mateProjectSlug;
  return {
    connected: !!state.connected,
    projectSlug: state.currentSlug || null,
    sessionId: state.activeSessionId || null,
    accountId: state.myUserId || "default",
    available: available,
    enabled: available && !!state.connected,
  };
}

export function sameQueueContext(a, b) {
  return !!a && !!b && a.projectSlug === b.projectSlug && sameId(a.sessionId, b.sessionId) && a.accountId === b.accountId;
}

export function queueScopeChanged(state, previous) {
  var next = queueContext(state);
  var prior = queueContext(previous);
  return !sameQueueContext(next, prior) || next.available !== prior.available || !!state.isMultiUserMode !== !!previous.isMultiUserMode;
}

export function queueReconnected(state, previous) {
  return !!state.connected && !previous.connected && !queueScopeChanged(state, previous);
}

export function queueCanRender(queue, target) {
  return !!target && target.available && !!queue && queue.projectSlug === target.projectSlug && sameId(queue.sessionId, target.sessionId);
}

export function createQueueHydrationRecovery() {
  var timer = null;
  var requestId = null;
  function clear(id) {
    if (id && requestId !== id) return;
    if (timer) clearTimeout(timer);
    timer = null;
    requestId = null;
  }
  return {
    schedule: function (id, retry) {
      clear();
      requestId = id;
      timer = setTimeout(function () {
        timer = null;
        requestId = null;
        retry();
      }, 10000);
      if (timer && timer.unref) timer.unref();
    },
    clear: clear,
  };
}

export function canonicalQueue(queue, result) {
  if (queue && queue.projectSlug === result.projectSlug && sameId(queue.sessionId, result.sessionId) && Number(result.revision) < Number(queue.revision)) return null;
  return {
    projectSlug: result.projectSlug,
    sessionId: result.sessionId,
    revision: Number(result.revision) || 0,
    paused: result.paused === true,
    items: Array.isArray(result.items) ? result.items : queue.items || [],
    loading: false,
    error: "",
  };
}
