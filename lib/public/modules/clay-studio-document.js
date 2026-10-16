import { showToast } from './utils.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';

function live(view) { var state = store.snap(); return view && state.connected && view.socket === getWs() && view.ownerId === (state.myUserId || null) && view.slug === state.currentSlug && view.sessionId === state.activeSessionId && view.origin === state.sessionOriginId && view.runtime === state.controlRuntimeId; }
export function forwardDocumentSource(message) {
  var old = store.get('studioDocumentSource');
  if (old) clearTimeout(old.timer);
  if (old && live(old)) old.socket.send(JSON.stringify({ type: 'fs_unwatch' }));
  var state = store.snap(), view = { token: crypto.randomUUID(), socket: getWs(), ownerId: state.myUserId || null, slug: state.currentSlug, sessionId: state.activeSessionId, origin: state.sessionOriginId, runtime: state.controlRuntimeId, path: message.path, expires: Date.now() + 300000 };
  view.timer = setTimeout(function () { if (store.get('studioDocumentSource') === view) { if (live(view)) view.socket.send(JSON.stringify({ type: 'fs_unwatch' })); store.set({ studioDocumentSource: null }); } }, 300000);
  store.set({ studioDocumentSource: view });
  if (live(view)) view.socket.send(JSON.stringify({ type: 'fs_watch', path: view.path }));
  return Object.assign({}, message, { studioDocument: { token: view.token, sourceSlug: view.slug, sourceSessionId: view.sessionId, sourceOrigin: view.origin, runtimeId: view.runtime, expires: view.expires, path: view.path } });
}
export function adoptDocumentSource(event, data, frame) {
  var document = data.message && data.message.studioDocument;
  if (!frame || !document || document.path !== data.message.path || document.sourceSlug !== data.studioSource.slug || document.sourceSessionId !== data.studioSource.sessionId || document.sourceOrigin !== data.studioSource.origin || document.runtimeId !== data.studioSource.runtime) return;
  closePresentedDocument();
  var socket = getWs(); if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'fs_unwatch' }));
  store.set({ fileReadRequest: null, pendingFileNavigation: null });
  var view = { descriptor: document, frame: frame, document: frame.contentDocument, source: event.source, owner: store.get('myUserId'), context: store.get('currentSlug') };
  view.timer = setTimeout(function () { if (store.get('studioDocumentView') === view) store.set({ studioDocumentView: { descriptor: view.descriptor, invalidated: true } }); }, Math.max(0, document.expires - Date.now()));
  store.set({ studioDocumentView: view });
}
export function presentedDocument(path) {
  var view = store.get('studioDocumentView');
  if (!view || view.invalidated || !view.frame || Date.now() > view.descriptor.expires || view.descriptor.path !== path) return null;
  var bridge = view.frame.clayStudioSource, identity = bridge && bridge.document === view.frame.contentDocument && bridge.window === view.source && bridge.identity();
  return identity && identity.connected && identity.ownerId === view.owner && identity.slug === view.descriptor.sourceSlug && identity.sessionId === view.descriptor.sourceSessionId && identity.origin === view.descriptor.sourceOrigin && identity.runtime === view.descriptor.runtimeId && view.document === view.frame.contentDocument && view.source === view.frame.contentWindow && view.owner === store.get('myUserId') && view.context === store.get('currentSlug') ? view : null;
}
export function refreshPresentedDocument(path) {
  var stored = store.get('studioDocumentView');
  if (!stored || stored.descriptor.path !== path) return false;
  var view = presentedDocument(path);
  if (!view) { showToast('The source connection changed. Reopen this document from its conversation.'); return true; }
  view.source.postMessage({ type: 'clay-studio-document-refresh', token: view.descriptor.token }, location.origin);
  return true;
}
export function closePresentedDocument() {
  var view = store.get('studioDocumentView');
  if (view) clearTimeout(view.timer);
  if (view && view.frame && view.source === view.frame.contentWindow && view.document === view.frame.contentDocument) view.source.postMessage({ type: 'clay-studio-document-close', token: view.descriptor.token }, location.origin);
  store.set({ studioDocumentView: null });
}
export function handleStudioDocumentMessage(message) {
  var view = store.get('studioDocumentSource');
  if (!live(view) || Date.now() > view.expires || message.path !== view.path) return false;
  if (message.type !== 'fs_file_changed' && !(message.type === 'fs_read_result' && message.requestId === view.requestId)) return false;
  window.parent.postMessage({ type: 'clay-studio-document-update', token: view.token, message: message }, location.origin);
  return true;
}
export function initDocumentSource() {
  window.addEventListener('message', function (event) {
    var data = event.data, view = store.get('studioDocumentSource');
    if (event.origin !== location.origin || event.source !== window.parent || !data || !view || data.token !== view.token || !live(view)) return;
    if (data.type === 'clay-studio-document-close') { clearTimeout(view.timer); view.socket.send(JSON.stringify({ type: 'fs_unwatch' })); store.set({ studioDocumentSource: null }); }
    if (data.type === 'clay-studio-document-refresh' && Date.now() <= view.expires) {
      view.requestId = 'studio-document-' + crypto.randomUUID();
      view.socket.send(JSON.stringify({ type: 'fs_read', path: view.path, requestId: view.requestId, projectSlug: view.slug, sessionId: String(view.sessionId), accountId: view.ownerId }));
    }
  });
  function stop() { var view = store.get('studioDocumentSource'); if (view) clearTimeout(view.timer); if (live(view)) view.socket.send(JSON.stringify({ type: 'fs_unwatch' })); store.set({ studioDocumentSource: null }); var presented = store.get('studioDocumentView'); closePresentedDocument(); if (presented) store.set({ studioDocumentView: { descriptor: presented.descriptor, invalidated: true } }); }
  store.subscribe(function (state, old) { if (!state.connected && old.connected || state.currentSlug !== old.currentSlug || state.activeSessionId !== old.activeSessionId || state.myUserId !== old.myUserId) stop(); });
  document.addEventListener('contextual-ask-stopped', stop, true);
  document.addEventListener('click', function (event) { if (event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) stop(); }, true);
}
