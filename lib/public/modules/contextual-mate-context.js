import { contextualViewMetadata } from './contextual-view-metadata.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { contextualFrame } from './contextual-mate-identity.js';

function identity(frame) {
  try { return frame && frame.conversation && frame.conversation.identity(); } catch (error) { return null; }
}
function contextKey(frame, canonical) {
  var current = identity(frame);
  return JSON.stringify([store.get('currentSlug'), store.get('activeSessionId'), store.get('sessionOriginId'), store.get('activeProjectSlug'), store.get('sessionActivatedProjectSlug'), store.get('replayingHistory'), (store.get('contextualClay') || {}).mode, store.get('homeShellVisible'), store.get('projectsHubVisible'), store.get('dmMode'), store.get('rightWorkbenchOwner'), store.get('homeSubSurface'), store.get('rightWorkbenchRevision'), store.get('projectSplitViewActiveId'), JSON.stringify(contextualViewMetadata()), store.get('myUserId'), store.get('connected'), current && current.mateId, current && current.sessionId, current && (canonical ? current.connected : current.ready), canonical && current && current.sessionOriginId]);
}
export function updateMateContext(surface, mate, frame, snapshot) {
  var current = identity(frame), ws = getWs(), key = contextKey(frame, mate && mate.builtinKey === 'clay'), prepared = store.get('contextualPrepared');
  var canonical = mate && mate.builtinKey === 'clay';
  var capabilities = surface.querySelector('.contextual-capabilities');
  capabilities.hidden = !canonical;
  capabilities.setAttribute('aria-label', 'Clay capabilities');
  capabilities.textContent = "I can control Clay Studio for you—manage projects, coordinate work, set up schedules, and navigate your workspace. Just tell me what you’d like done.";
  var privateWorkspace = (store.get('currentSlug') || '').indexOf('mate-') === 0;
  var parentReady = store.get('activeProjectSlug') === store.get('currentSlug') && store.get('sessionActivatedProjectSlug') === store.get('currentSlug') && !store.get('replayingHistory');
  var available = (store.get('contextualClay') || {}).mode === 'popover' && parentReady && !canonical && !privateWorkspace && current && current.ready && store.get('connected') && !store.get('homeShellVisible') && !store.get('projectsHubVisible') && !store.get('dmMode') && ws && ws.readyState === 1;
  var changed = !prepared || prepared.key !== key || prepared.socket !== ws;
  if (changed) {
    var requestId = 'context-' + crypto.randomUUID();
    prepared = { key: key, requestId: requestId, socket: ws, mateId: current && current.mateId, canonical: !!canonical, status: available ? 'preparing' : 'unavailable' };
  }
  // Stamp the reference before publishing a new preparation: store subscribers
  // may render synchronously, and the composer must never see the prior view ID.
  snapshot = Object.assign({}, snapshot, { viewId: prepared.requestId, workspace: contextualViewMetadata() });
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
  var viewName = snapshot.workspace && snapshot.workspace.name;
  var projectName = (ready && prepared.summary.project) || snapshot.projectTitle || snapshot.screen || 'Current view';
  if (canonical) {
    var currentSummary = (snapshot.projectTitle || snapshot.screen || 'Current view') + (snapshot.conversationTitle ? ' / ' + snapshot.conversationTitle : '');
    var disconnected = !store.get('connected') || current && current.connected === false;
    var sameSnapshot = shared && shared.viewId === prepared.requestId && shared.summary.project + (snapshot.conversationTitle ? ' / ' + shared.summary.conversation : '') === currentSummary;
    var contextStatus = disconnected ? 'Disconnected' : current && current.available === false ? 'Unavailable' : !current || !current.ready ? 'Preparing' : sameSnapshot ? 'Shared' : shared ? 'New view' : 'Next message';
    detail.textContent = "I can help manage your projects, coordinate work with Drivers, and use Studio’s tools. I’ll ask you to review actions when needed.\n"
      + 'Current view: ' + currentSummary + '. ' + (disconnected ? 'Reconnect before sharing a new snapshot. ' : !current || !current.ready ? 'Wait for this conversation before sharing a new snapshot. ' : sameSnapshot ? 'This metadata snapshot was shared with your last message. Your next message captures the current view again. ' : 'Your next message includes this metadata snapshot. ')
      + 'Clay receives project and conversation metadata, not continuous screen capture. Its authenticated product tools inspect supported objects separately; changes require their existing review.';
  } else {
    contextStatus = !store.get('connected') || current && current.connected === false ? 'Disconnected' : current && current.available === false ? 'Unavailable' : current && !current.ready || prepared.status === 'preparing' ? 'Preparing' : ready ? (shared && shared.viewId === prepared.requestId ? 'Shared' : shared ? 'New view' : 'Next message') : 'Unavailable';
    detail.textContent = ready ? (shared && shared.viewId === prepared.requestId ? 'Shared with your last message: ' : 'With your next message: ') + summary + '. This Mate can read up to 20 text turns from this selected conversation and request to open it in this window after your review. Tool results, attachments and hidden entries are excluded.' : 'Current view: ' + projectName + '. This view has no supported conversation context. Open an accessible project conversation to share it with your next message.';
    detail.textContent += '\nNo continuous screen capture. Issues, documents, other tabs, files and settings are unavailable through this context.';
  }
  if (viewName) detail.textContent += '\nView: ' + viewName + '.';
  detail.textContent += '\nEach message also includes current View, session titles and open workbench names as display metadata. Workbench contents are not included.';
  if (prepared.status === 'expired' && !canonical) { contextStatus = 'Expired'; detail.textContent = 'This five-minute context has expired. Close and reopen this Mate to prepare a fresh snapshot. No previous navigation request will replay.'; }
  if (shared) detail.textContent += '\nLast submitted: ' + shared.summary.project + ' / ' + shared.summary.conversation + ((canonical ? sameSnapshot : shared.viewId === prepared.requestId) ? '.' : canonical ? '. The view or connection has changed; that snapshot is stale.' : '. Your view has changed; that context is stale.');
  var projectLabel = label.querySelector('[data-context-project]');
  if (!projectLabel) { projectLabel = document.createElement('span'); projectLabel.dataset.contextProject = ''; var statusLabel = document.createElement('span'); statusLabel.dataset.contextStatus = ''; label.replaceChildren(projectLabel, statusLabel); }
  projectLabel.textContent = projectName;
  label.querySelector('[data-context-status]').textContent = ' · ' + contextStatus;
  label.title = label.textContent;
  surface.contextReference = function (source, session) {
    var live = store.get('contextualPrepared');
    if (!frame || frame.hidden || frame.contentWindow !== source || !session || !current || session.mateId !== current.mateId || session.sessionId !== current.sessionId || !session.ready || !live || live.key !== contextKey(frame, canonical) || live.socket !== getWs() || live.status !== 'ready' || live.expiresAt <= Date.now()) return null;
    return live.contextRef;
  };
}
export function handleMateContextMessage(msg) {
  if (msg.type === 'mate_context_prepared') {
    var pending = store.get('contextualPrepared');
    if (pending && pending.requestId === msg.requestId && pending.socket === getWs() && pending.key === contextKey(contextualFrame(), pending.canonical)) {
      store.set({ contextualPrepared: Object.assign({}, pending, msg, { status: msg.contextRef ? 'ready' : 'unavailable' }) });
      if (msg.contextRef) setTimeout(function () {
        var current = store.get('contextualPrepared');
        if (current && current.contextRef === msg.contextRef) store.set({ contextualPrepared: Object.assign({}, current, { status: 'expired' }) });
      }, Math.max(0, msg.expiresAt - Date.now()));
    }
    return true;
  }
  if ((msg.type === 'message_ack' || msg.type === 'user_message') && window.parent !== window && window.frameElement && window.frameElement.dataset.canonical === 'true') {
    var recorded = msg.type === 'message_ack' ? msg.message : msg;
    var outbound = (store.get('contextualSnapshotSubmissions') || []).find(function (item) { return item.clientMessageId === msg.clientMessageId; });
    if (!outbound || outbound.confirmed || outbound.accountId !== (store.get('myUserId') || '_default') || !recorded || recorded.clientMessageId !== outbound.clientMessageId || !recorded.contextualSnapshot || msg.type === 'message_ack' && (msg.projectSlug !== outbound.projectSlug || String(msg.sessionId) !== String(outbound.sessionId)) || recorded.projectSlug !== outbound.projectSlug || String(recorded.sessionId) !== String(outbound.sessionId) || recorded.sessionOriginId !== outbound.sessionOriginId || recorded.from && recorded.from !== outbound.accountId || JSON.stringify(recorded.contextualSnapshot) !== JSON.stringify(outbound.snapshot)) return false;
    var snapshot = recorded.contextualSnapshot;
    store.set({ contextualSnapshotSubmissions: store.get('contextualSnapshotSubmissions').map(function (item) { return item === outbound ? Object.assign({}, item, { confirmed: true }) : item; }) });
    try {
      var host = window.parent.document.getElementById('contextual-clay');
      if (host) host.dispatchEvent(new window.parent.CustomEvent('contextual-context-submitted', { detail: { source: window, message: { status: 'submitted', canonical: true, clientMessageId: msg.clientMessageId, viewId: snapshot.viewId, summary: { project: snapshot.projectTitle || snapshot.projectSlug || 'Home', conversation: snapshot.conversationTitle || snapshot.screen } } } }));
    } catch (error) { /* A disconnected authentication view cannot share metadata. */ }
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
