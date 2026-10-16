import { store } from './store.js';
import { getWs } from './ws-ref.js';

function identity(frame) {
  try { return frame && frame.conversation && frame.conversation.identity(); } catch (error) { return null; }
}
function contextKey(frame) {
  var current = identity(frame);
  return JSON.stringify([store.get('currentSlug'), store.get('activeSessionId'), store.get('homeShellVisible'), store.get('dmMode'), store.get('rightWorkbenchOwner'), store.get('homeSubSurface'), store.get('rightWorkbenchRevision'), store.get('myUserId'), store.get('connected'), current && current.mateId, current && current.sessionId, current && current.ready]);
}
export function updateMateContext(surface, mate, frame, snapshot) {
  var current = identity(frame), ws = getWs(), key = contextKey(frame), prepared = store.get('contextualPrepared');
  var canonical = mate && mate.builtinKey === 'clay';
  var capabilities = surface.querySelector('.contextual-capabilities');
  capabilities.hidden = !canonical;
  capabilities.setAttribute('aria-label', 'Clay capabilities');
  capabilities.textContent = 'Manage projects, coordinate work through Drivers and operate supported Studio features. Actions follow the relevant review.';
  var privateWorkspace = (store.get('currentSlug') || '').indexOf('mate-') === 0;
  var available = !canonical && !privateWorkspace && current && current.ready && store.get('connected') && !store.get('homeShellVisible') && !store.get('dmMode') && !store.get('rightWorkbenchOwner') && ws && ws.readyState === 1;
  var changed = !prepared || prepared.key !== key || prepared.socket !== ws;
  if (changed) {
    var requestId = 'context-' + crypto.randomUUID();
    prepared = { key: key, requestId: requestId, socket: ws, mateId: current && current.mateId, status: available ? 'preparing' : 'unavailable' };
  }
  // Stamp the reference before publishing a new preparation: store subscribers
  // may render synchronously, and the composer must never see the prior view ID.
  snapshot = Object.assign({}, snapshot, { viewId: prepared.requestId });
  surface.dataset.screenReference = JSON.stringify(snapshot);
  if (changed) {
    store.set({ contextualPrepared: prepared });
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'mate_context_prepare', requestId: requestId, available: !!available, mateId: current && current.mateId, sessionId: current && current.sessionId }));
  }
  var shared = ((store.get('contextualSubmitted') || {})[mate && mate.id]);
  var ready = prepared.status === 'ready' && prepared.expiresAt > Date.now();
  var label = surface.querySelector('[data-clay-context]');
  var detail = surface.querySelector('.contextual-clay-context p');
  var summary = ready ? prepared.summary.project + ' / ' + prepared.summary.conversation : null;
  if (canonical) {
    var currentSummary = (snapshot.projectTitle || snapshot.screen || 'Current view') + (snapshot.conversationTitle ? ' / ' + snapshot.conversationTitle : '');
    var disconnected = !store.get('connected') || current && current.connected === false;
    var sameSnapshot = shared && shared.viewId === prepared.requestId && shared.summary.project + (snapshot.conversationTitle ? ' / ' + shared.summary.conversation : '') === currentSummary;
    label.textContent = disconnected ? 'Disconnected · ' + (shared ? 'Last snapshot retained' : 'Context not shared')
      : current && current.available === false ? 'Conversation unavailable · ' + (shared ? 'Last snapshot retained' : 'Context not shared')
      : !current || !current.ready ? 'Preparing metadata snapshot…'
      : (sameSnapshot ? 'Submitted metadata · ' : shared ? 'New view · Will share metadata · ' : 'Will share metadata · ') + currentSummary;
    detail.textContent = 'Current view: ' + currentSummary + '. ' + (disconnected ? 'Reconnect before sharing a new snapshot. ' : !current || !current.ready ? 'Wait for this conversation before sharing a new snapshot. ' : 'Your next message includes this metadata snapshot. ')
      + 'Clay receives project and conversation metadata, not continuous screen capture. Its authenticated product tools inspect supported objects separately; changes require their existing review.';
  } else {
    label.textContent = !store.get('connected') || current && !current.ready ? 'Reconnect to share context' : ready ? (shared && shared.viewId === prepared.requestId ? 'Submitted context · ' : 'Will share · ') + summary : prepared.status === 'preparing' ? 'Preparing conversation context…' : 'Conversation context unavailable';
    detail.textContent = ready ? 'With your next message: ' + summary + '. This Mate can read up to 20 text turns from this selected conversation and request to open it in this window after your review. Tool results, attachments and hidden entries are excluded.' : 'This view has no supported conversation context. Open an accessible project conversation to share it with your next message.';
    detail.textContent += '\nNo continuous screen capture. Issues, documents, other tabs, files and settings are unavailable through this context.';
  }
  if (prepared.status === 'expired' && !canonical) { label.textContent = 'Context expired · Reopen this Mate'; detail.textContent = 'This five-minute context has expired. Close and reopen this Mate to prepare a fresh snapshot. No previous navigation request will replay.'; }
  if (shared) detail.textContent += '\nLast submitted: ' + shared.summary.project + ' / ' + shared.summary.conversation + ((canonical ? sameSnapshot : shared.viewId === prepared.requestId) ? '.' : canonical ? '. The view or connection has changed; that snapshot is stale.' : '. Your view has changed; that context is stale.');
  if (!canonical && shared && shared.viewId !== prepared.requestId && ready) label.textContent = 'New view · Will share ' + summary;
  label.title = label.textContent;
  surface.contextReference = function (source, session) {
    var live = store.get('contextualPrepared');
    if (!frame || frame.hidden || frame.contentWindow !== source || !session || !current || session.mateId !== current.mateId || session.sessionId !== current.sessionId || !session.ready || !live || live.key !== contextKey(frame) || live.socket !== getWs() || live.status !== 'ready' || live.expiresAt <= Date.now()) return null;
    return live.contextRef;
  };
}
export function handleMateContextMessage(msg) {
  if (msg.type === 'mate_context_prepared') {
    var pending = store.get('contextualPrepared');
    if (pending && pending.requestId === msg.requestId && pending.socket === getWs()) {
      store.set({ contextualPrepared: Object.assign({}, pending, msg, { status: msg.contextRef ? 'ready' : 'unavailable' }) });
      if (msg.contextRef) setTimeout(function () {
        var current = store.get('contextualPrepared');
        if (current && current.contextRef === msg.contextRef) store.set({ contextualPrepared: Object.assign({}, current, { status: 'expired' }) });
      }, Math.max(0, msg.expiresAt - Date.now()));
    }
    return true;
  }
  if (msg.type === 'message_ack' && window.parent !== window && window.frameElement && window.frameElement.dataset.canonical === 'true') {
    var prefix = 'Untrusted screen reference captured when this message was submitted.';
    var outbound = (store.get('pendingOutboundMessages') || []).find(function (item) { return item.payload.clientMessageId === msg.clientMessageId; });
    if (!outbound || outbound.accountId !== (store.get('myUserId') || '_default') || msg.projectSlug !== outbound.projectSlug || String(msg.sessionId) !== String(outbound.sessionId)) return false;
    var paste = (outbound.payload.pastes || []).filter(function (value) { return typeof value === 'string' && value.indexOf(prefix) === 0; }).slice(-1)[0];
    if (!paste || !msg.message || (msg.message.pastes || []).indexOf(paste) < 0) return false;
    try {
      var snapshot = JSON.parse(paste.slice(paste.indexOf('\n') + 1));
      var host = window.parent.document.getElementById('contextual-clay');
      if (host) host.dispatchEvent(new window.parent.CustomEvent('contextual-context-submitted', { detail: { source: window, message: { status: 'submitted', canonical: true, clientMessageId: msg.clientMessageId, viewId: snapshot.viewId, summary: { project: snapshot.projectTitle || snapshot.projectSlug || 'Home', conversation: snapshot.conversationTitle || snapshot.screen } } } }));
    } catch (error) { /* Old references remain ordinary untrusted attachments. */ }
    return false;
  }
  if (msg.type !== 'mate_context_shared') return false;
  try {
    var surface = window.parent.document.getElementById('contextual-clay');
    if (surface && window.frameElement && surface.contains(window.frameElement)) surface.dispatchEvent(new window.parent.CustomEvent('contextual-context-submitted', { detail: { source: window, message: msg } }));
  } catch (error) { /* A disconnected authentication view cannot share context. */ }
  return true;
}
export function recordMateContextSubmission(surface, event) {
  var frame = Array.from(surface.querySelectorAll('iframe')).find(function (item) { return item.contentWindow === event.detail.source; });
  var pending = store.get('contextualPrepared'), msg = event.detail.message;
  if (!frame || frame.dataset.ownerId !== (store.get('myUserId') || '') || (!msg.canonical && frame.hidden) || !pending) return;
  if (msg.status === 'unavailable') {
    if (pending.mateId === frame.dataset.mateId) store.set({ contextualPrepared: Object.assign({}, pending, { status: 'unavailable' }) });
    return;
  }
  if (msg.status !== 'submitted' || !msg.summary || (msg.canonical ? frame.dataset.canonical !== 'true' || typeof msg.viewId !== 'string' : msg.contextRef !== pending.contextRef)) return;
  var submitted = Object.assign({}, store.get('contextualSubmitted'));
  submitted[frame.dataset.mateId] = { key: msg.canonical ? null : pending.key, viewId: msg.canonical ? msg.viewId : pending.requestId, summary: msg.summary };
  store.set({ contextualSubmitted: submitted });
}
export function contextualAccessReference() {
  if (window.parent === window || !store.get('paneMode')) return null;
  try {
    var surface = window.parent.document.getElementById('contextual-clay');
    return surface && surface.contextReference && surface.contextReference(window, { mateId: window.frameElement.dataset.mateId, sessionId: store.get('paneSessionId'), ready: store.get('contextualSessionReady') && store.get('connected') });
  } catch (error) { return null; }
}
