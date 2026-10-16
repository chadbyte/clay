import { store } from './store.js';
import { sendTextMessage } from './input.js';
import { pausePendingMessage } from './message-delivery.js';
import { stopGeneration } from './generation-stop.js';

export function submitContextualAsk(request) {
  if (!request || typeof request.requestId !== 'string' || typeof request.text !== 'string') return null;
  var current = store.get('contextualAskSubmission');
  if (current && current.requestId === request.requestId) return current;
  if (!request || request.ownerId !== store.get('myUserId') || request.sessionId !== store.get('paneSessionId') || request.sessionOriginId !== store.get('sessionOriginId') || !store.get('contextualSessionReady') || !store.get('connected') || store.get('contextualWriterSuspended') || !window.frameElement || window.frameElement.dataset.canonical !== 'true') return null;
  // A fresh session has no user draft to replace. Refuse any ambiguous target.
  if (document.getElementById('input').value || (store.get('pendingOutboundMessages') || []).length) return null;
  store.set({ contextualAskSubmission: { requestId: request.requestId, status: 'sending' } });
  sendTextMessage(request.text);
  var outbound = (store.get('pendingOutboundMessages') || []).find(function (item) { return item.payload.text === request.text && item.sessionId === request.sessionId; });
  var submission = { requestId: request.requestId, status: outbound ? 'sent' : 'unconfirmed', clientMessageId: outbound && outbound.payload.clientMessageId };
  store.set({ contextualAskSubmission: submission });
  return submission;
}

export function pauseContextualAsk() {
  var current = store.get('contextualAskSubmission');
  if (current && current.clientMessageId) pausePendingMessage(current.clientMessageId);
  if (current) store.set({ contextualAskSubmission: Object.assign({}, current, { status: 'stopped' }) });
}
export function stopContextualAsk() { pauseContextualAsk(); return stopGeneration(); }
