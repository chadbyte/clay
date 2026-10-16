import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { activateContextualMate } from './project-mate-navigation.js';
import { contextualMate, contextualMateStamp, contextualFrame } from './contextual-mate-identity.js';
import { showContextualAsk, enterComposer } from './contextual-clay.js';
import { showToast } from './utils.js';

function current() { return store.get('contextualSearchAsk'); }
function view() { return JSON.stringify([store.get('myUserId'), store.get('currentSlug'), store.get('activeSessionId'), store.get('homeShellVisible'), store.get('homeSubSurface'), store.get('dmMode'), store.get('rightWorkbenchOwner'), store.get('rightWorkbenchRevision')]); }
function patch(change) { store.set({ contextualSearchAsk: Object.assign({}, current(), change) }); }
function live(request) {
  var mate = contextualMate(request.mateId);
  return request.ownerId === store.get('myUserId') && mate && mate.builtinKey === 'clay' && contextualMateStamp(mate) === request.stamp;
}
function sendCreation() {
  var request = current(), ws = getWs();
  if (!request || !live(request)) { patch({ status: 'error', error: 'Clay is unavailable. Your question is retained.' }); return; }
  if (!store.get('connected') || !ws || ws.readyState !== 1) { patch({ status: 'error', error: 'Reconnect, then retry. Your question is retained.' }); return; }
  patch({ status: 'creating', socket: ws, view: view(), error: null });
  try { ws.send(JSON.stringify({ type: 'home_clay_ask', presentation: 'contextual', requestId: request.requestId, text: request.text, sessionOriginId: request.sessionOriginId || null })); }
  catch (error) { patch({ status: 'error', error: 'Creation is unconfirmed. Retry checks the same request.' }); }
  setTimeout(function () { if (current() && current().requestId === request.requestId && current().status === 'creating') patch({ status: 'error', error: 'Conversation creation is unconfirmed. Retry checks the same request.' }); }, 15000);
}
export function pauseContextualSearchForSelection() {
  if (current() && /^(creating|opening)$/.test(current().status)) stop();
}
function stop(execution) {
  var request = current(), frame = request && request.sessionId && contextualFrame(request.mateId, request.sessionId);
  if (frame && frame.conversation) { if (execution === true) frame.conversation.stopAsk(); else frame.conversation.pauseAsk(); }
  patch({ status: 'stopped', error: request && request.clientMessageId ? 'Automatic delivery is paused. Inspect the conversation to confirm whether work stopped.' : 'Stopped before submission. Your question is retained; it will not be submitted automatically.' });
}
function resume() {
  var request = current();
  if (!request || !live(request)) return;
  if (request.clientMessageId) { showToast('Inspect this conversation before retrying an uncertain message.', 'warn'); return; }
  showContextualAsk(contextualMate(request.mateId), request.requestId, request.sessionId);
  sendCreation();
}
function submit() {
  var request = current();
  if (!request || request.status !== 'opening') return;
  if (!live(request) || request.view !== view()) { patch({ status: 'error', error: 'The view changed. Retry explicitly from the current view.' }); return; }
  var frame = contextualFrame(request.mateId, request.sessionId);
  if (!frame || frame.hidden || !frame.conversation || !frame.conversation.identity().ready) return;
  var identity = frame.conversation.identity();
  if (identity.ownerId !== request.ownerId || identity.sessionId !== request.sessionId || identity.sessionOriginId !== request.sessionOriginId || identity.mateId !== request.mateId) { patch({ status: 'error', error: 'The exact conversation identity changed. Nothing was submitted.' }); return; }
  patch({ status: 'sending' });
  var receipt = frame.conversation.submitAsk({ requestId: request.requestId, text: request.text, ownerId: request.ownerId, sessionId: request.sessionId, sessionOriginId: request.sessionOriginId });
  if (!receipt || !receipt.clientMessageId) { patch({ status: 'error', error: 'Submission is unconfirmed. Inspect the retained question before retrying.' }); return; }
  patch({ status: 'sent', clientMessageId: receipt.clientMessageId });
}
function render() {
  var host = document.getElementById('contextual-clay');
  if (!host) return;
  var status = host.querySelector('[data-contextual-ask-status]');
  if (!status) {
    status = document.createElement('section'); status.dataset.contextualAskStatus = ''; status.setAttribute('role', 'region'); status.setAttribute('aria-label', 'Pending question');
    status.innerHTML = '<div class="contextual-pending-question"><span>Pending question</span><blockquote data-ask-question></blockquote></div><div class="contextual-pending-progress"><p role="status" aria-live="polite" aria-atomic="true"></p><div><button type="button" data-ask-retry>Retry</button><button type="button" data-ask-stop>Stop</button><button type="button" data-ask-inspect>Open conversation</button></div></div>';
    host.querySelector('.contextual-clay-body').appendChild(status);
    status.querySelector('[data-ask-inspect]').addEventListener('click', function () { var request = current(); if (request && live(request)) activateContextualMate(request.mateId); });
    status.querySelector('[data-ask-retry]').addEventListener('click', resume);
    status.querySelector('[data-ask-stop]').addEventListener('click', function () { stop(true); });
    host.addEventListener('contextual-clay-ready', submit);
    host.addEventListener('contextual-clay-availability', function () {
      var request = current(), frame = request && contextualFrame(request.mateId, request.sessionId);
      if (request && request.status === 'opening' && frame && frame.conversation && frame.conversation.identity().available === false) patch({ status: 'error', error: 'This new conversation is unavailable. Your question is retained.' });
    });
    host.addEventListener('contextual-context-submitted', function (event) {
      var request = current(), frame = request && contextualFrame(request.mateId, request.sessionId);
      if (request && frame && frame.contentWindow === event.detail.source && request.clientMessageId && request.clientMessageId === event.detail.message.clientMessageId) patch({ status: 'acknowledged', acknowledged: true });
    });
    host.addEventListener('contextual-ask-stopped', function (event) { var request = current(), frame = request && contextualFrame(request.mateId, request.sessionId); if (frame && frame.contentWindow === event.detail.source) stop(); });
  }
  var focused = document.activeElement, ownedFocus = status.contains(focused);
  var request = current(), selected = store.get('contextualClay') || {};
  status.hidden = !request || selected.mateId !== request.mateId || request.acknowledged || request.status === 'acknowledged' || selected.sessionId && selected.sessionId !== request.sessionId;
  if (request) {
    status.querySelector('[data-ask-question]').textContent = request.text;
    status.querySelector('p').textContent = request.error || (request.status === 'creating' ? 'Starting a new conversation. Your question is waiting.' : request.status === 'opening' ? 'Preparing this conversation. Nothing submitted yet.' : 'Waiting for confirmation. Delivery is not confirmed yet.');
    status.querySelector('[data-ask-inspect]').hidden = !request.clientMessageId;
    status.querySelector('[data-ask-retry]').hidden = request.status !== 'error' && request.status !== 'stopped' || !!request.clientMessageId;
    status.querySelector('[data-ask-stop]').hidden = request.status === 'stopped';
  }
  host.dataset.askPending = String(!status.hidden);
  var selectedFrame = contextualFrame();
  host.querySelector('[data-clay-loading]').hidden = !status.hidden || !!(selectedFrame && selectedFrame.conversation && selectedFrame.conversation.identity().ready);
  host.querySelectorAll('iframe').forEach(function (frame) { frame.inert = !status.hidden && frame.dataset.mateId === request.mateId && String(frame.dataset.sessionId) === String(request.sessionId); });
  if (status.hidden) {
    enterComposer();
    if (ownedFocus && selectedFrame && selectedFrame.conversation && selectedFrame.conversation.identity().ready) selectedFrame.contentDocument.getElementById('input').focus({ preventScroll: true });
  } else if (ownedFocus && focused.hidden) {
    var nextControl = status.querySelector('[data-ask-retry]:not([hidden]), [data-ask-inspect]:not([hidden]), [data-ask-stop]:not([hidden])');
    if (nextControl) nextControl.focus({ preventScroll: true });
  }

}

export function startContextualSearch(text) {
  text = typeof text === 'string' ? text.trim().slice(0, 12000) : '';
  var mate = (store.get('cachedMatesList') || []).find(function (item) { return item.builtinKey === 'clay' && contextualMate(item.id); });
  if (!text || !mate) { showToast('Clay is unavailable. Your question remains in Search.', 'warn'); return false; }
  var request = current();
  if (request && /^(creating|opening|sending|sent)$/.test(request.status)) { showToast('Clay is still starting the previous question. This question remains in Search.', 'warn'); return false; }
  var requestId = 'contextual-search-' + crypto.randomUUID();
  if (!showContextualAsk(mate, requestId, null)) return false;
  store.set({ contextualSearchAsk: { requestId: requestId, text: text, mateId: mate.id, ownerId: store.get('myUserId'), stamp: contextualMateStamp(mate), status: 'creating', view: view() } });
  render(); sendCreation(); return true;
}
export function retryContextualSearch() {
  var request = current();
  if (!request || !live(request) || request.clientMessageId || !/^(error|stopped)$/.test(request.status)) return false;
  resume(); return true;
}
export function handleContextualSearchMessage(msg) {
  var request = current();
  if (!request || request.requestId !== msg.requestId) return false;
  if (msg.type === 'home_mate_error') { patch({ status: 'error', error: msg.text || 'The conversation could not be started. Your question is retained.' }); return true; }
  if (msg.type !== 'home_clay_contextual_session') return false;
  if (request.status !== 'creating' || request.socket !== getWs() || !live(request) || request.mateId !== msg.mateId || !Number.isSafeInteger(msg.sessionId) || msg.sessionId <= 0 || typeof msg.sessionOriginId !== 'string' || request.sessionOriginId && request.sessionOriginId !== msg.sessionOriginId) return true;
  if (request.view !== view()) { patch({ sessionId: msg.sessionId, sessionOriginId: msg.sessionOriginId, status: 'error', error: 'The view changed. Retry explicitly from the current view.' }); return true; }
  patch({ sessionId: msg.sessionId, sessionOriginId: msg.sessionOriginId, status: 'opening' });
  showContextualAsk(contextualMate(request.mateId), request.requestId, msg.sessionId);
  var frame = contextualFrame(request.mateId, msg.sessionId);
  if (frame) frame.dataset.contextualTitle = request.text.slice(0, 80);
  setTimeout(function () { if (current() && current().requestId === request.requestId && current().status === 'opening') patch({ status: 'error', error: 'The conversation is not ready. Retry checks this same conversation.' }); }, 15000);
  submit(); return true;
}
store.subscribe(function (value, previous) {
  if (current() && current().ownerId !== value.myUserId) { store.set({ contextualSearchAsk: null }); return; }
  if (current() && !live(current()) && /^(creating|opening)$/.test(current().status)) patch({ status: 'error', error: 'Clay is no longer available. Your question is retained.' });
  if (current() && previous.connected && !value.connected && /^(creating|opening)$/.test(current().status)) patch({ status: 'error', error: 'Disconnected. Retry checks the same new conversation; your question is retained.' });
  render();
});
document.addEventListener('click', function (event) {
  var request = current();
  if (request && store.get('currentSlug') === 'mate-' + request.mateId && store.get('activeSessionId') === request.sessionId && event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) stop();
}, true);
