// message-delivery-ui.js - receipt recovery notices

import { store } from './store.js';
import { retryPendingMessage } from './message-delivery.js';

var initialized = false;
var rendered = {};
var unsubscribe = null;

function currentContext(receipt) {
  var currentOriginId = store.get('sessionOriginId') || null;
  return receipt && receipt.projectSlug === store.get('currentSlug') && String(receipt.sessionId) === String(store.get('activeSessionId')) && receipt.accountId === (store.get('myUserId') || "_default") && (!receipt.sessionOriginId || !currentOriginId || receipt.sessionOriginId === currentOriginId);
}

function renderReceipt(receipt) {
  var messages = document.getElementById("messages");
  if (!messages || !currentContext(receipt) || rendered[receipt.clientMessageId]) return;
  var notice = document.createElement("div");
  notice.className = "sys-msg error";
  notice.dataset.deliveryReceipt = receipt.clientMessageId;
  var text = document.createElement("span");
  text.className = "sys-text";
  text.textContent = "Receipt unconfirmed. Retry this message.";
  notice.appendChild(text);
  var retry = document.createElement("button");
  retry.type = "button";
  retry.className = "sys-retry";
  retry.textContent = "Retry";
  retry.addEventListener("click", function () { retryPendingMessage(receipt.clientMessageId); });
  notice.appendChild(retry);
  messages.appendChild(notice);
  rendered[receipt.clientMessageId] = notice;
}

function sync(state) {
  var receipts = state.deliveryReceipts || {};
  Object.keys(rendered).forEach(function (id) {
    if (!rendered[id].parentNode || !receipts[id] || !currentContext(receipts[id])) {
      if (rendered[id] && rendered[id].parentNode) rendered[id].parentNode.removeChild(rendered[id]);
      delete rendered[id];
    }
  });
  Object.keys(receipts).forEach(function (id) { renderReceipt(receipts[id]); });
}

export function initMessageDeliveryUi() {
  if (initialized) return;
  initialized = true;
  unsubscribe = store.subscribe(function (state, previous) {
    if (state.deliveryReceipts !== previous.deliveryReceipts || state.currentSlug !== previous.currentSlug || state.activeSessionId !== previous.activeSessionId || state.sessionOriginId !== previous.sessionOriginId || state.myUserId !== previous.myUserId || state.replayingHistory !== previous.replayingHistory) sync(state);
  });
  sync(store.snap());
}

export function disposeMessageDeliveryUi() {
  Object.keys(rendered).forEach(function (id) {
    if (rendered[id] && rendered[id].parentNode) rendered[id].parentNode.removeChild(rendered[id]);
  });
  rendered = {};
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  initialized = false;
}
