import { paneHeaderRuntime, initPaneHeaderRuntime } from './pane-header-runtime.js';
import { sendBoundBrowserCommand } from './pane-browser-transport.js';
import { disarmStickyBottom } from './chat-render-runtime.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { takeComposerDraft, restoreComposerDraft } from './input.js';
import { resetHistoryReplayBatch } from './history-replay-batch.js';
import { updateContextPanel } from './app-panels.js';
import { paneTarget, samePaneBinding, samePaneTarget } from './pane-binding.js';

function enabled() {
  return store.get('paneMode') && !store.get('paneActivationUnsupported') && !store.get('activeProjectMateId') && !/^\/p\/mate-/.test(location.pathname) && !new URLSearchParams(location.search).has('contextual') && window.parent !== window;
}
function block(value) {
  var app = document.getElementById('app');
  if (app) app.inert = value;
  document.documentElement.dataset.paneReady = value ? 'false' : 'true';
}
function draftKey() { return String(store.get('myUserId')) + ':' + store.get('sessionOriginId'); }
function rememberPanePosition() {
  var messages = document.getElementById('messages'), key = draftKey();
  if (!messages || !store.get('sessionOriginId') || store.get('panePendingBinding')) return;
  var positions = Object.assign({}, store.get('paneRetainedPositions') || {});
  delete positions[key];
  positions[key] = { top: messages.scrollTop, height: messages.scrollHeight, viewport: messages.clientHeight };
  var keys = Object.keys(positions);
  while (keys.length > 8) delete positions[keys.shift()];
  store.set({ paneRetainedPositions: positions });
}
function suspendPane() {
  if (!store.get('paneSuspended')) rememberPanePosition();
  clearDeadline();
  store.set({ paneSuspended: true, paneReady: false, panePendingBinding: null });
  block(true);
}
function clearDeadline() {
  if (store.get('paneActivationTimer')) clearTimeout(store.get('paneActivationTimer'));
  store.set({ paneActivationTimer: null });
}
function failed(requestId, reason) {
  var pending = store.get('panePendingBinding');
  if (!pending || requestId !== pending.requestId) return;
  clearDeadline();
  store.set({ paneReady: false, panePendingBinding: null });
  block(true);
  var frame = window.frameElement;
  if (frame) {
    if (reason) frame.dataset.paneActivationFailure = reason;
    frame.dispatchEvent(new window.parent.CustomEvent('clay-pane-activation-failed'));
  }
}

// Claim ordinary initial pins before the legacy session-list handler runs.
// Authentication, list and group metadata can arrive in either order; the
// subscription retries when those authoritative prerequisites become ready.
export function primePaneSession() {
  if (store.get('paneSuspended') || !enabled() || !window.frameElement || !window.frameElement.clayPane) return false;
  var frame = window.frameElement;
  var id = Number(frame.dataset.requestedSessionId || frame.dataset.sessionId || store.get('paneSessionId'));
  if (!Number.isSafeInteger(id) || id < 1) return false;
  var session = (getCachedSessions() || []).find(function (item) { return item.id === id; });
  if (!session || session.isMate || (session.runtimeMode || session.mode || 'gui') !== 'gui' || session.tuiSuspended) return false;
  var target = paneTarget(store.snap(), getCachedSessions(), id);
  var existing = store.get('panePendingBinding') || store.get('paneCommittedBinding');
  activatePaneSession(id, store.get('paneSessionId') !== id || !samePaneTarget(existing, target), target);
  return true;
}

export function activatePaneSession(id, force, expectedTarget) {
  var state = store.snap(), ws = getWs();
  if (window.frameElement && window.frameElement.closest && window.frameElement.closest('.split-pane-cached')) return false;
  if (state.authIdentityLoaded === false) return false;
  if (state.isMultiUserMode && !state.myUserId) return false;
  if (!enabled() || !state.connected || !ws || ws.readyState !== 1 || state.splitGroupsProjectSlug !== state.currentSlug) return false;
  var target = paneTarget(state, getCachedSessions(), id);
  if (!target) return false;
  if (expectedTarget && !samePaneTarget(target, expectedTarget)) return false;
  var sourceFrame = window.frameElement;
  if (!expectedTarget && sourceFrame && Number(sourceFrame.dataset && sourceFrame.dataset.sessionId) === id && sourceFrame.dataset.sessionOriginId && sourceFrame.dataset.sessionOriginId !== target.sessionOriginId) return false;
  var old = state.paneCommittedBinding, pending = state.panePendingBinding;
  if (!force && !state.paneSuspended && samePaneTarget(pending || old, target)) return true;
  if (!pending && state.sessionOriginId) {
    if (!state.paneSuspended) rememberPanePosition();
    var draft;
    try { draft = takeComposerDraft(); } catch (error) { return false; }
    var drafts = Object.assign({}, state.paneRichDrafts || {});
    drafts[draftKey()] = draft;
    store.set({ paneRichDrafts: drafts });
  }
  clearDeadline();
  resetHistoryReplayBatch();
  var generation = (store.get('paneActivationGeneration') || 0) + 1;
  target = Object.assign({}, target, { generation: generation, requestId: 'pane-' + generation + '-' + Math.random().toString(36).slice(2, 12) });
  var path = new URL(store.get('wsPath'), location.origin);
  path.searchParams.set('session', String(id));
  store.set({ paneActivationGeneration: generation, panePendingBinding: target, paneReady: false, paneSuspended: false,
    paneLayoutScrollLock: null, paneLastUserScrollTop: null, paneUserScrollIntent: null, paneUserScrollRevision: 0,
    paneSessionId: id, panePinPending: false, wsPath: path.pathname + path.search });
  block(true);
  store.set({ paneActivationTimer: setTimeout(function () { failed(target.requestId); }, 12000) });
  if (typeof performance !== 'undefined' && performance.mark) { performance.clearMarks('clay:activation-request'); performance.mark('clay:activation-request'); }
  ws.send(JSON.stringify({ type: 'switch_session', id: id, paneActivation: target }));
  return true;
}

// Runs before replay batching, so an obsolete history_meta cannot open a batch
// that later consumes destination messages.
export function filterPaneActivation(message) {
  if (!enabled()) return false;
  var pending = store.get('panePendingBinding'), committed = store.get('paneCommittedBinding');
  if (message.type === 'pane_activation_rejected') { failed(message.requestId); return true; }
  if (!pending && !committed) return !!message.paneActivation;
  if (['session_list', 'split_groups', 'session_presence', 'pong', 'account_auth_required', 'project_removed', 'project_access_revoked'].indexOf(message.type) >= 0 && !message.paneActivation) return false;
  var expected = pending || committed;
  if (!samePaneBinding(expected, message.paneActivation)) return true;
  if (message.type === 'pane_activation_started') return true;
  if (message.type === 'pane_activation_snapshot_done') {
    if (!pending) return true;
    if (typeof performance !== 'undefined' && performance.mark) { performance.clearMarks('clay:snapshot-received'); performance.mark('clay:snapshot-received'); }
    var draft = (store.get('paneRichDrafts') || {})[String(store.get('myUserId')) + ':' + expected.sessionOriginId];
    restoreComposerDraft(draft || { text: '', start: 0, end: 0 });
    function paint() {
      if (store.get('panePendingBinding') !== expected || !store.get('connected') || store.get('paneSuspended')) return;
      var current = paneTarget(store.snap(), getCachedSessions(), expected.sessionId);
      var messages = document.getElementById('messages');
      if (!samePaneTarget(current, expected) ||
        store.get('activeSessionId') !== expected.sessionId || store.get('sessionOriginId') !== expected.sessionOriginId || store.get('replayingHistory') ||
        !messages || messages.dataset.controlSessionId !== String(expected.sessionId) || messages.dataset.controlSessionOrigin !== expected.sessionOriginId) {
        failed(expected.requestId, 'snapshot-state-mismatch: active=' + store.get('activeSessionId') + ', origin=' + store.get('sessionOriginId') + ', messages=' + (messages && messages.dataset.controlSessionId) + ', messageOrigin=' + (messages && messages.dataset.controlSessionOrigin));
        return;
      }
      var position = (store.get('paneRetainedPositions') || {})[String(store.get('myUserId')) + ':' + expected.sessionOriginId];
      if (position && Number.isFinite(position.top)) {
        disarmStickyBottom();
        messages.scrollTop = position.top;
        store.set({ paneLastUserScrollTop: position.top });
      }
      clearDeadline();
      store.set({ paneCommittedBinding: expected, panePendingBinding: null, paneReady: true });
      block(false);
      if (typeof performance !== 'undefined' && performance.mark) { performance.clearMarks('clay:pane-ready'); performance.mark('clay:pane-ready'); }
      var frame = window.frameElement;
      if (frame) frame.dispatchEvent(new window.parent.CustomEvent('clay-pane-ready'));
      updateContextPanel();
    }
    requestAnimationFrame(function () { requestAnimationFrame(paint); });
    return true;
  }
  return false;
}

export function paneOutgoing(data) {
  var message;
  try { message = JSON.parse(data); } catch (error) { return null; }
  if (['ping', 'pong', 'clay_ui_ready'].indexOf(message.type) >= 0) return data;
  if (store.get('deferredSessionSwitch') && store.get('deferredSessionSwitch').draining) return null;
  if (message.type === 'switch_session') {
    var entry = store.get('pendingSessionEntryNavigation');
    if (entry && entry.projectSlug === store.get('currentSlug') && String(entry.sessionId) !== String(message.id)) store.set({ pendingSessionEntryNavigation: null });
    if (enabled() && (store.get('panePendingBinding') || store.get('paneCommittedBinding')) && !message.paneActivation) return null;
    return data;
  }
  if (store.get('deferredSessionSwitch')) {
    var source = store.get('deferredSessionSwitch');
    if (source.draining) return null;
    if (message.type === 'stop') return JSON.stringify(Object.assign({}, message, { sessionId: source.sessionId, sessionOriginId: source.origin }));
    return null;
  }
  if (!enabled()) return data;
  var binding = store.get('paneCommittedBinding');
  if (store.get('panePendingBinding') || store.get('paneSuspended') || binding && !store.get('paneReady')) return null;
  if (!binding) return ['stop', 'user_message', 'permission_response', 'ask_user_response', 'elicitation_response', 'user_dialog_response', 'input_sync'].indexOf(message.type) >= 0 ? null : data;
  if (message.paneBinding && !samePaneBinding(binding, message.paneBinding)) return null;
  var gesture = (store.get('paneActionEvents') || []).find(function (entry) { return entry.event.isTrusted && entry.event.eventPhase && samePaneBinding(entry.binding, binding); });
  var action = store.get('paneCallbackBinding') || gesture && gesture.binding;
  var read = /^(get_|list_)|(_get|_list|_options)$/.test(message.type) || message.type === 'load_more_history';
  if (!message.paneBinding && !read && !samePaneBinding(action, binding)) return null;
  return JSON.stringify(Object.assign({}, message, { paneBinding: message.paneBinding || action || binding }));
}

export function refreshPaneActivation() {
  if (!enabled()) return;
  var binding = store.get('panePendingBinding') || store.get('paneCommittedBinding');
  if (!binding) return;
  var current = paneTarget(store.snap(), getCachedSessions(), binding.sessionId);
  if (samePaneTarget(current, binding)) return;
  if (store.get('panePendingBinding')) failed(binding.requestId);
  else { store.set({ paneReady: false }); block(true); }
}

export function initPaneActivation() {
  if (!enabled() || !window.frameElement) return;
  var frame = window.frameElement;
  var latestId = Number(frame.dataset && (frame.dataset.requestedSessionId || frame.dataset.sessionId));
  if (Number.isSafeInteger(latestId) && latestId > 0 && frame.dataset.projectSlug === store.get('currentSlug')) {
    var latestPath = new URL(store.get('wsPath'), location.origin);
    latestPath.searchParams.set('session', String(latestId));
    store.set({ paneSessionId: latestId, panePinPending: true, wsPath: latestPath.pathname + latestPath.search });
  }
  block(true);
  frame.clayPane = {
    source: window, document: document,
    identity: function () {
      var binding = store.get('paneCommittedBinding');
      return binding && { ownerId: binding.viewerId, projectSlug: binding.projectSlug, sessionId: binding.sessionId,
        binding: binding, ready: store.get('connected') && store.get('paneReady') && !store.get('paneSuspended') };
    },
    headerRuntime: paneHeaderRuntime,
    browserCommand: sendBoundBrowserCommand,
    activate: activatePaneSession,
    checkDraft: function () { if (!store.get('panePendingBinding')) { var draft = takeComposerDraft(); restoreComposerDraft(draft); } },
    suspend: suspendPane,
  };
  initPaneHeaderRuntime(frame);
  // A pointer that began on the previous conversation cannot become a Stop or
  // approval click on the replacement conversation after hydration.
  document.addEventListener('pointerdown', function () { store.set({ panePointerBinding: store.get('paneCommittedBinding') }); }, true);
  document.addEventListener('click', function (event) {
    if (store.get('paneSuspended') || !store.get('paneReady') && store.get('panePendingBinding') || event.detail && store.get('panePointerBinding') !== store.get('paneCommittedBinding')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  ['click', 'input', 'change', 'keydown', 'keyup', 'submit', 'blur'].forEach(function (name) {
    document.addEventListener(name, function (event) {
      var keys = store.get('paneHeldKeys') || {};
      var binding = store.get('paneCommittedBinding');
      var previousKey = keys[event.code || event.key];
      var staleKey = (name === 'keyup' || name === 'keydown' && event.repeat) && previousKey && !samePaneBinding(previousKey, binding);
      if (name === 'keydown' && !event.repeat) keys[event.code || event.key] = binding;
      if (name === 'keyup') delete keys[event.code || event.key];
      if (staleKey || store.get('panePendingBinding') || store.get('paneSuspended') || !store.get('paneReady')) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      var events = (store.get('paneActionEvents') || []).filter(function (entry) { return entry.event.eventPhase; });
      events.push({ event: event, binding: binding });
      store.set({ paneHeldKeys: keys, paneActionEvents: events });
    }, true);
  });
  store.subscribe(function (state, previous) {
    if (state.activeSessionMode === 'tui' && previous.activeSessionMode !== 'tui') {
      delete frame.clayPane; store.set({ paneActivationUnsupported: true }); block(false); return;
    }
    if (!state.connected && previous.connected) {
      clearDeadline();
      store.set({ paneReady: false, panePendingBinding: null, paneCommittedBinding: null }); block(true);
    }
    if (state.connected && (state.splitGroups !== previous.splitGroups || state.splitGroupsProjectSlug !== previous.splitGroupsProjectSlug || state.paneBindingSessions !== previous.paneBindingSessions || state.authIdentityLoaded !== previous.authIdentityLoaded || state.myUserId !== previous.myUserId || state.activeSessionId !== previous.activeSessionId || state.connected !== previous.connected)) {
      queueMicrotask(function () {
        refreshPaneActivation();
        if (!store.get('panePendingBinding') && !store.get('paneSuspended')) {
          if (store.get('panePinPending')) primePaneSession();
          else if (store.get('activeSessionId') === store.get('paneSessionId')) activatePaneSession(store.get('paneSessionId'));
        }
      });
    }
  });
}
