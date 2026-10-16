// Session identity remains pinned across transport recovery and presentation.
import { autoResize, takeComposerDraft, restoreComposerDraft } from './input.js';
import { store } from './store.js';
import { withdrawPaneControlActivity } from './clay-control-activity.js';
import { initContextualComposer } from './contextual-composer.js';
import { submitContextualAsk, pauseContextualAsk, stopContextualAsk } from './contextual-ask-session.js';

// Session replay and authenticated account bootstrap complete independently.
function submissionReady() { var expected = window.frameElement && window.frameElement.dataset.expectedSessionOrigin; return (!expected || expected === store.get('sessionOriginId')) && !!(store.get('contextualSessionReady') && store.get('connected') && store.get('myUserId') && store.get('sessionOriginId') && store.get('activeSessionId') === store.get('paneSessionId')); }
function enabled() { return store.get('paneMode') && new URLSearchParams(location.search).get('contextual') === '1'; }
function renderSessionAvailability() {
  var input = document.getElementById('input');
  var frame = window.frameElement;
  var mate = frame && (store.get('cachedMatesList') || []).find(function (item) { return item.id === frame.dataset.mateId; });
  var name = mate && ((mate.profile || {}).displayName || mate.displayName || mate.name);
  if (input && name) { input.setAttribute('aria-label', 'Message ' + name); if (name.length > 32) input.placeholder = 'Message this Mate…'; }
  var wrapper = document.getElementById('input-wrapper');
  if (wrapper) wrapper.inert = !submissionReady();
  try {
    var surface = window.parent.document.getElementById('contextual-clay');
    var anchor = window.parent.document.querySelector('[aria-describedby="contextual-mate-hint"]') || window.parent.document.querySelector('.icon-strip-brand');
    if (submissionReady() && surface && surface.dataset.focusEntry === 'true' && !window.frameElement.hidden && !window.frameElement.inert) {
      delete surface.dataset.focusEntry;
      if (surface.dataset.mode === 'popover' && window.parent.document.activeElement === anchor) document.getElementById('input').focus({ preventScroll: true });
    }
  } catch (error) { /* Cross-origin authentication owns focus. */ }
  if (store.get('contextualSessionReady') && window.frameElement && !window.frameElement.hidden) {
    window.frameElement.dataset.sessionId = String(store.get('paneSessionId'));
    var parentSurface = window.parent.document.getElementById('contextual-clay');
    if (parentSurface) parentSurface.dispatchEvent(new window.parent.CustomEvent('contextual-clay-ready'));
  }
  var warning = document.getElementById('contextual-session-warning');
  if (!warning && store.get('contextualSessionUnavailable')) {
    warning = document.createElement('p');
    warning.id = 'contextual-session-warning'; warning.setAttribute('role', 'status');
    warning.textContent = 'This Mate conversation is no longer available. Your draft is still here.';
    document.getElementById('input-area').prepend(warning);
  }
  if (warning) warning.hidden = !store.get('contextualSessionUnavailable');
}
export function handleContextualSessionMessage(msg) {
  if (!enabled()) return;
  if (msg.type === 'session_list' && store.get('paneSessionId') && !(msg.sessions || []).some(function (session) { return session.id === store.get('paneSessionId'); })) {
    store.set({ contextualSessionReady: false, contextualSessionUnavailable: true });
  }
  if (msg.type === 'session_switched') {
    var pin = store.get('paneSessionId');
    if (pin && msg.id !== pin) return true;
    var path = store.get('wsPath').replace(/&session=\d+/g, '');
    store.set({ contextualSessionReady: false, contextualSessionReceived: true, contextualSessionUnavailable: false, paneSessionId: msg.id, wsPath: path + '&session=' + msg.id });
  }
  if (msg.type === 'history_done' && store.get('contextualSessionReceived')) store.set({ contextualSessionReady: true });
  renderSessionAvailability();
  return false;
}
export function initContextualSession() {
  if (!enabled()) return;
  document.body.classList.add('contextual-chat-pane');
  initContextualComposer();
  // Bind at app readiness rather than iframe load: slow assets must not leave
  // an already usable composer without its presentation keyboard handling.
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    try {
      var surface = window.parent.document.getElementById('contextual-clay');
      if (surface && window.frameElement && surface.contains(window.frameElement)) surface.dispatchEvent(new window.parent.CustomEvent('contextual-clay-keydown', { detail: { source: window, keyboardEvent: event } }));
    } catch (error) { /* Authentication navigation owns its document. */ }
  });
  var surfaceBridge = window.parent.document.getElementById('contextual-clay');
  if (surfaceBridge && window.frameElement && surfaceBridge.contains(window.frameElement)) window.frameElement.conversation = {
    source: window, document: document,
    submitAsk: submitContextualAsk,
    pauseAsk: pauseContextualAsk,
    stopAsk: stopContextualAsk,
    identity: function () { return { mateId: store.get('activeProjectMateId'), viewerRef: store.get('clayControlViewerRef'), sessionId: store.get('paneSessionId'), sessionOriginId: store.get('sessionOriginId'), ownerId: store.get('myUserId'), connected: store.get('connected'), available: !store.get('contextualSessionUnavailable'), ready: submissionReady() }; },
    suspend: function (value) { store.set({ contextualWriterSuspended: value }); document.getElementById('input').readOnly = value; },
    checkDraft: function () { var draft = takeComposerDraft(); restoreComposerDraft(draft); },
    take: function () { var draft = takeComposerDraft(); var drafts = Object.assign({}, store.get('sessionDrafts')); delete drafts[store.get('paneSessionId')]; store.set({ sessionDrafts: drafts }); return draft; },
    restore: restoreComposerDraft
  };
  document.addEventListener('click', function (event) {
    if (event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) {
      pauseContextualAsk();
      var askHost = window.parent.document.getElementById('contextual-clay');
      if (askHost) askHost.dispatchEvent(new window.parent.CustomEvent('contextual-ask-stopped', { detail: { source: window } }));
    }
    if (store.get('contextualWriterSuspended') && event.target.closest('#send-btn, #attach-wrap, #contextual-attach-btn, #config-chip-wrap, .ask-user-container')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  store.set({ contextualSessionReady: false, contextualSessionUnavailable: false });
  var width = 0;
  new ResizeObserver(function (entries) {
    var next = entries[0].contentRect.width;
    if (next === width || next === 0) return;
    width = next;
    autoResize();
  }).observe(document.getElementById('input-textarea-wrap'));
  function guardPendingReview(event) {
    if ((!store.get('contextualSessionReady') || store.get('contextualWriterSuspended')) && event.target.closest('.ask-user-submit, .ask-user-other input') && (event.type === 'click' || event.key === 'Enter')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  document.addEventListener('click', guardPendingReview, true);
  document.addEventListener('keydown', guardPendingReview, true);
  store.subscribe(function (value, previous) {
    if (value.connected !== previous.connected || value.contextualSessionReady !== previous.contextualSessionReady || value.contextualSessionUnavailable !== previous.contextualSessionUnavailable) {
      var parentSurface = window.parent.document.getElementById('contextual-clay');
      if (parentSurface && window.frameElement && !window.frameElement.hidden && parentSurface.contains(window.frameElement)) parentSurface.dispatchEvent(new window.parent.CustomEvent('contextual-clay-availability'));
    }
    if (!value.connected && previous.connected) {
      withdrawPaneControlActivity();
      var input = document.getElementById('input');
      var drafts = Object.assign({}, value.sessionDrafts);
      if (value.paneSessionId && input) drafts[value.paneSessionId] = input.value;
      store.set({ contextualSessionReady: false, contextualSessionReceived: false, sessionDrafts: drafts });
    }
    renderSessionAvailability();
  });
  renderSessionAvailability();
}

// Capture bounded metadata separately from user attachments. This is
// untrusted reference data, never approval or a target for an existing action.
export function contextualScreenReference() {
  if (!enabled() || window.parent === window) return null;
  try {
    var surface = window.parent.document.getElementById('contextual-clay');
    if (!surface || !window.frameElement || window.frameElement.hidden || window.frameElement.dataset.canonical !== 'true' || !surface.contains(window.frameElement)) return null;
    var reference = JSON.parse(surface.dataset.screenReference || 'null');
    if (!reference || reference.ownerId !== (store.get('myUserId') || null)) return null;
    return { version: 1, viewId: typeof reference.viewId === 'string' ? reference.viewId.slice(0, 100) : null, projectTitle: typeof reference.projectTitle === 'string' ? reference.projectTitle.slice(0, 160) : null, conversationTitle: typeof reference.conversationTitle === 'string' ? reference.conversationTitle.slice(0, 160) : null, projectSlug: typeof reference.projectSlug === 'string' ? reference.projectSlug.slice(0, 160) : null, sessionId: Number.isSafeInteger(reference.sessionId) ? reference.sessionId : null, screen: String(reference.screen || '').slice(0, 40) };
  } catch (error) { return null; }
}
