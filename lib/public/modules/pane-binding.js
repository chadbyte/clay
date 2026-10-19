import { store } from './store.js';
import { getWs } from './ws-ref.js';

export function captureSessionAction() {
  var state = store.snap();
  return { projectSlug: state.currentSlug, ownerId: state.myUserId, sessionId: state.activeSessionId,
    origin: state.sessionOriginId, socket: getWs(), binding: state.paneCommittedBinding || null,
    epoch: state.sessionActionEpoch || 0 };
}

export function sessionActionCurrent(action, draftCompletion) {
  var state = store.snap();
  return !!action && action.socket === getWs() && state.connected &&
    action.projectSlug === state.currentSlug && action.ownerId === state.myUserId &&
    action.sessionId === state.activeSessionId && action.origin === state.sessionOriginId &&
    action.epoch === (state.sessionActionEpoch || 0) &&
    (draftCompletion || !state.deferredSessionSwitch) && !state.panePendingBinding && !state.paneSuspended &&
    (action.binding ? state.paneReady && samePaneBinding(action.binding, state.paneCommittedBinding) : !state.paneCommittedBinding);
}

// Capture at callback creation, never when an old callback eventually sends.
export function sessionCallback(callback, draftCompletion) {
  var action = captureSessionAction();
  return function () {
    if (!sessionActionCurrent(action, draftCompletion)) return;
    var previous = store.get('paneCallbackBinding');
    store.set({ paneCallbackBinding: action.binding });
    try { return callback.apply(this, arguments); }
    finally { store.set({ paneCallbackBinding: previous }); }
  };
}

export function samePaneBinding(a, b) {
  return !!a && !!b && ['requestId', 'generation', 'projectSlug', 'viewerId', 'ownerId', 'sessionId', 'sessionOriginId', 'role', 'workerGeneration', 'groupStamp', 'parentSessionOriginId'].every(function (key) { return a[key] === b[key]; });
}

export function samePaneTarget(a, b) {
  return !!a && !!b && ['projectSlug', 'viewerId', 'ownerId', 'sessionId', 'sessionOriginId', 'role', 'workerGeneration', 'groupStamp', 'parentSessionOriginId'].every(function (key) { return a[key] === b[key]; });
}

export function paneTarget(state, sessions, id) {
  var session = (sessions || []).find(function (item) { return item.id === id; });
  if (!session || session.isMate || !session.sessionOriginId || (session.runtimeMode || session.mode || 'gui') !== 'gui' || session.tuiSuspended) return null;
  var group = (state.splitGroups || []).find(function (item) { return item.members.indexOf(id) >= 0; });
  var parent = session.sessionRole === 'worker' && sessions.find(function (item) { return item.id === session.parentSessionId; });
  if (session.sessionRole === 'worker' && (!parent || !session.parentAvailable || !Number.isSafeInteger(session.workerGeneration) || !parent.sessionOriginId || parent.ownerId !== session.ownerId || !group || !group.pair || group.pair.driverId !== parent.id)) return null;
  return {
    projectSlug: state.currentSlug, viewerId: state.myUserId || null, ownerId: session.ownerId || null,
    sessionId: session.id, sessionOriginId: session.sessionOriginId,
    role: session.sessionRole === 'worker' ? 'worker' : 'driver', workerGeneration: session.workerGeneration || null,
    parentSessionOriginId: parent ? parent.sessionOriginId : null,
    groupStamp: group ? JSON.stringify({ id: group.id, members: group.members, pair: group.pair || null }) : null,
  };
}

// Ordinary reusable panes have a live document binding; legacy/canonical frames
// retain their existing URL and receipt checks in their own bridge paths.
export function livePaneBinding(frame, message) {
  if (!frame || !frame.clayPane) return false;
  var api = frame.clayPane, live = api.identity();
  var state = store.snap(), split = state.splitPanes;
  var target = live && paneTarget(state, state.paneBindingSessions || [], live.sessionId);
  var inLegacySplit = !!(live && split && split.panes.some(function (pane) { return pane.slug === live.projectSlug && pane.sessionId === live.sessionId; }));
  var activePresentation = (state.projectSplitViews || []).find(function (view) { return view.id === state.projectSplitViewActiveId; });
  var inPresentation = !!(live && live.binding && !split && activePresentation && activePresentation.sessions.some(function (session) {
    return session.id === live.sessionId && session.sessionOriginId === live.binding.sessionOriginId;
  }));
  var inSingletonPresentation = !!(live && live.binding && !split && !activePresentation &&
    state.projectSplitViewSingletonOrigin === live.binding.sessionOriginId &&
    live.sessionId === Number(frame.dataset.sessionId) && live.binding.sessionOriginId === frame.dataset.sessionOriginId);
  return api.source === frame.contentWindow && api.document === frame.contentDocument && live && live.ready &&
    samePaneTarget(target, live.binding) &&
    live.ownerId === (state.myUserId || null) && live.projectSlug === state.currentSlug &&
    (inLegacySplit || inPresentation || inSingletonPresentation) &&
    (!message || samePaneBinding(live.binding, message.paneBinding));
}

export function paneMessageBinding() {
  return store.get('paneReady') && !store.get('paneSuspended') ? store.get('paneCommittedBinding') : null;
}

export function currentPaneReview(container) {
  if (!container || !container.paneBinding) return true;
  return container.isConnected !== false && store.get('paneReady') && !store.get('paneSuspended') && samePaneBinding(container.paneBinding, store.get('paneCommittedBinding'));
}

export function paneCallbackCurrent(binding) {
  var current = store.get('panePendingBinding') || store.get('paneCommittedBinding');
  return current ? samePaneBinding(current, binding) : !binding;
}
