import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { livePaneBinding, paneMessageBinding, samePaneBinding, paneTarget } from './pane-binding.js';

// Browser-only presentation bridge. Effects still use the source pane's real
// authenticated socket and the existing server browser service.
function browserSource() { return store.get('paneBrowserSource') || null; }
function focusedOrigin() {
  var focused = store.get('projectSplitViewFocusedOrigin') || store.get('projectSplitViewSingletonOrigin');
  if (focused) return focused;
  var view = (store.get('projectSplitViews') || []).find(function (item) { return item.id === store.get('projectSplitViewActiveId'); });
  return view && view.activeSessionOriginId || store.get('sessionOriginId') || null;
}
var receive = null;
var changed = null;
var fieldsByAction = {
  state_request: [], open: ['url', 'newTab', 'incognito'], view: ['browserId', 'visible'],
  control: ['browserId', 'control'], close: ['browserId'], end: ['browserId'], input: ['browserId', 'epoch', 'event'],
};
function frames() {
  return Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) .split-pane-frame'));
}
export function hasBrowserPaneHost() { return !store.get('paneMode') && frames().some(function (frame) { return !!frame.clayPane || !!paneTarget(store.snap(), store.get('paneBindingSessions') || [], Number(frame.dataset.sessionId)); }); }
function current() {
  var source = browserSource();
  if (!source || source.socket !== getWs() || source.owner !== store.get('myUserId') || source.project !== store.get('currentSlug')) return false;
  var frame = source.frame;
  return frames().includes(frame) && frame.contentWindow === source.window && frame.contentDocument === source.document &&
    !frame.dataset.requestedSessionId && livePaneBinding(frame, { paneBinding: source.binding });
}
export function browserPaneSessionId() { return current() ? browserSource().binding.sessionId : null; }
export function browserPaneStamp() { var source = browserSource(); return current() ? source.binding.requestId + ':' + source.binding.generation : null; }
export function browserPaneBound() { return !!browserSource(); }
export function selectBrowserPane(frame, binding) {
  var source = browserSource();
  if (!frame || !binding || !frames().includes(frame) || frame.dataset.requestedSessionId || !livePaneBinding(frame, { paneBinding: binding })) return false;
  if (current() && source.frame === frame && samePaneBinding(source.binding, binding)) {
    if (source.focusedOrigin !== focusedOrigin()) store.set({ paneBrowserSource: Object.assign({}, source, { focusedOrigin: focusedOrigin() }) });
    return true;
  }
  var previous = store.get('sharedBrowser');
  if (current() && previous) sendBrowserPaneCommand('view', { browserId: previous.id, visible: false });
  store.set({ paneBrowserSource: { frame: frame, window: frame.contentWindow, document: frame.contentDocument, binding: binding,
    socket: getWs(), owner: store.get('myUserId'), project: store.get('currentSlug'), focusedOrigin: focusedOrigin() }, paneBrowserTarget: binding });
  if (changed) changed(true);
  return true;
}
export function ensureBrowserPaneSource() {
  if (current() && browserSource().focusedOrigin === focusedOrigin()) return true;
  var candidates = frames();
  var origin = focusedOrigin();
  var frame = candidates.find(function (item) { return origin && item.dataset.sessionOriginId === origin; }) ||
    candidates.find(function (item) { var pane = item.closest('.split-pane'); return pane && pane.dataset.active === 'true'; }) || candidates[0];
  var live = frame && frame.clayPane && frame.clayPane.identity();
  return !!live && selectBrowserPane(frame, live.binding);
}
export function sendBrowserPaneCommand(action, fields) {
  var source = browserSource();
  if (!Object.prototype.hasOwnProperty.call(fieldsByAction, action)) return false;
  if (!source && !hasBrowserPaneHost()) return null;
  if (!current() || !source.frame.clayPane || typeof source.frame.clayPane.browserCommand !== 'function') return false;
  return source.frame.clayPane.browserCommand(action, fields || {}, source.binding);
}
export function sendBoundBrowserCommand(action, fields, binding) {
  var allowed = Object.prototype.hasOwnProperty.call(fieldsByAction, action) && fieldsByAction[action], ws = getWs();
  if (!allowed || !ws || ws.readyState !== 1 || !samePaneBinding(binding, paneMessageBinding()) ||
      !store.get('connected') || store.get('panePendingBinding') || store.get('activeSessionId') !== binding.sessionId) return false;
  var message = { type: 'shared_browser_' + action, sessionId: binding.sessionId, paneBinding: binding };
  allowed.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(fields, key)) message[key] = fields[key]; });
  ws.send(JSON.stringify(message));
  return true;
}
export function forwardBrowserPaneMessage(message) {
  var frame = window.frameElement;
  if (!store.get('paneMode') || !frame || !frame.clayPane) return false;
  if (['shared_browser_state', 'shared_browser_frame', 'shared_browser_error'].indexOf(message.type) < 0) return false;
  var binding = paneMessageBinding();
  if (binding && samePaneBinding(binding, message.paneActivation)) {
    window.parent.postMessage({ type: 'clay-pane-browser-update', paneBinding: binding, message: message }, location.origin);
  }
  return true;
}
export function initBrowserPaneTransport(onMessage, onChanged) {
  if (store.get('paneMode')) return;
  receive = onMessage; changed = onChanged;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.origin !== location.origin || !data || data.type !== 'clay-pane-browser-update' || !data.message) return;
    var frame = frames().find(function (item) { return item.contentWindow === event.source; });
    var message = data.message, source = browserSource();
    if (!frame || !livePaneBinding(frame, data) || !samePaneBinding(data.paneBinding, message.paneActivation) ||
        message.sessionId !== data.paneBinding.sessionId || ['shared_browser_state', 'shared_browser_frame', 'shared_browser_error'].indexOf(message.type) < 0) return;
    if (!current() || source.frame !== frame || !samePaneBinding(source.binding, data.paneBinding)) {
      if (message.type !== 'shared_browser_state' || !message.present || !selectBrowserPane(frame, data.paneBinding)) return;
    }
    receive(message, true);
  });
  document.addEventListener('clay-pane-ready', function () {
    queueMicrotask(function () {
      if (!current() && ensureBrowserPaneSource()) sendBrowserPaneCommand('state_request', {});
    });
  }, true);
  store.subscribe(function () {
    var source = browserSource();
    if (source && !current()) {
      store.set({ paneBrowserSource: null, paneBrowserTarget: null });
      if (changed) changed(false);
    }
  });
}
