// Reliable delivery for ordinary project chat messages within a page lifetime.

import { store } from './store.js';
import { getWs } from './ws-ref.js';

var ACK_TIMEOUT_MS = 5000;
var ACK_RETRY_LIMIT = 3;
var ackTimers = {};
var socketRefs = {};
var activatedContext = null;

function createClientMessageId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return "cm-" + window.crypto.randomUUID();
  }
  return "cm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function pendingMessages() {
  return store.get('pendingOutboundMessages') || [];
}

function replacePending(messages) {
  store.set({ pendingOutboundMessages: messages });
}

function receipts() {
  return store.get('deliveryReceipts') || {};
}

function setReceipt(entry) {
  var next = Object.assign({}, receipts());
  next[entry.payload.clientMessageId] = {
    clientMessageId: entry.payload.clientMessageId,
    projectSlug: entry.projectSlug,
    sessionId: entry.sessionId,
    accountId: entry.accountId,
    sessionOriginId: entry.sessionOriginId || null,
    attempts: entry.attempts
  };
  store.set({ deliveryReceipts: next });
}

function clearReceipt(clientMessageId) {
  var current = receipts();
  if (!current[clientMessageId]) return;
  var next = Object.assign({}, current);
  delete next[clientMessageId];
  store.set({ deliveryReceipts: next });
}

function markUnconfirmed(entry) {
  var unconfirmed = Object.assign({}, entry, { status: "unconfirmed" });
  replacePending(pendingMessages().map(function (candidate) {
    return candidate.payload.clientMessageId === entry.payload.clientMessageId ? unconfirmed : candidate;
  }));
  setReceipt(unconfirmed);
}

function clearAckTimer(clientMessageId) {
  if (!ackTimers[clientMessageId]) return;
  clearTimeout(ackTimers[clientMessageId]);
  delete ackTimers[clientMessageId];
}

function isPending(clientMessageId) {
  var pending = pendingMessages();
  for (var i = 0; i < pending.length; i++) {
    if (pending[i].payload.clientMessageId === clientMessageId) return true;
  }
  return false;
}

function pendingEntry(clientMessageId) {
  var pending = pendingMessages();
  for (var i = 0; i < pending.length; i++) {
    if (pending[i].payload.clientMessageId === clientMessageId) return pending[i];
  }
  return null;
}

function matchesCurrentContext(entry) {
  return entry && entry.projectSlug === store.get('currentSlug') && String(entry.sessionId) === String(store.get('activeSessionId')) && entry.accountId === (store.get('myUserId') || "_default");
}

function hasAutomaticReplayIdentity(entry, socket) {
  if (!activatedContext || activatedContext.socket !== socket) return false;
  if (entry.sessionOriginId && activatedContext.sessionOriginId && entry.sessionOriginId !== activatedContext.sessionOriginId) return false;
  if (entry.sessionOriginId && activatedContext.sessionOriginId && entry.sessionOriginId === activatedContext.sessionOriginId) return true;
  if (entry.cliSessionId && activatedContext.cliSessionId) return entry.cliSessionId === activatedContext.cliSessionId;
  return socketRefs[entry.payload.clientMessageId] === socket;
}

function hasKnownCliMismatch(entry) {
  if (entry.sessionOriginId && activatedContext && activatedContext.sessionOriginId && entry.sessionOriginId === activatedContext.sessionOriginId) return false;
  return !!entry.cliSessionId && !!activatedContext && !!activatedContext.cliSessionId && entry.cliSessionId !== activatedContext.cliSessionId;
}

function matchesActivatedContext(entry) {
  var currentCliSessionId = store.get('cliSessionId') || null;
  var sameOrigin = !!(entry.sessionOriginId && activatedContext && activatedContext.sessionOriginId && entry.sessionOriginId === activatedContext.sessionOriginId);
  return !!activatedContext && activatedContext.socket === getWs() && matchesCurrentContext(entry) &&
    activatedContext.projectSlug === store.get('currentSlug') && String(activatedContext.sessionId) === String(store.get('activeSessionId')) &&
    activatedContext.accountId === (store.get('myUserId') || "_default") && (activatedContext.sessionOriginId || activatedContext.cliSessionId === currentCliSessionId) &&
    (!entry.sessionOriginId || !activatedContext.sessionOriginId || entry.sessionOriginId === activatedContext.sessionOriginId) &&
    (sameOrigin || !entry.cliSessionId || !activatedContext.cliSessionId || entry.cliSessionId === activatedContext.cliSessionId);
}

function armAckTimer(clientMessageId, socket) {
  clearAckTimer(clientMessageId);
  ackTimers[clientMessageId] = setTimeout(function () {
    delete ackTimers[clientMessageId];
    if (!isPending(clientMessageId) || getWs() !== socket) return;
    var entry = pendingEntry(clientMessageId);
    if (!matchesActivatedContext(entry)) return;
    window.dispatchEvent(new CustomEvent("clay-message-delivery-timeout", {
      detail: { socket: socket, clientMessageId: clientMessageId },
    }));
    var attempts = entry.attempts || 0;
    if (attempts < ACK_RETRY_LIMIT && entry && socket.readyState === 1) {
      var nextEntry = Object.assign({}, entry, { attempts: attempts + 1 });
      replacePending(pendingMessages().map(function (candidate) {
        return candidate.payload.clientMessageId === clientMessageId ? nextEntry : candidate;
      }));
      transmit(nextEntry, false);
      return;
    }
    if (attempts >= ACK_RETRY_LIMIT) {
      markUnconfirmed(entry);
      return;
    }
  }, ACK_TIMEOUT_MS);
}

function transmit(entry, automatic) {
  var socket = getWs();
  if (!matchesCurrentContext(entry) || !socket || socket.readyState !== 1) return false;
  if (automatic && entry.status === "unconfirmed") return false;
  if (automatic && !hasAutomaticReplayIdentity(entry, socket)) {
    markUnconfirmed(entry);
    return false;
  }
  if (automatic) {
    if ((entry.attempts || 0) >= ACK_RETRY_LIMIT) {
      markUnconfirmed(entry);
      return false;
    }
    entry = Object.assign({}, entry, { attempts: (entry.attempts || 0) + 1 });
    replacePending(pendingMessages().map(function (candidate) {
      return candidate.payload.clientMessageId === entry.payload.clientMessageId ? entry : candidate;
    }));
  }
  socketRefs[entry.payload.clientMessageId] = socket;
  try {
    socket.send(JSON.stringify(entry.payload));
    armAckTimer(entry.payload.clientMessageId, socket);
    return true;
  } catch (e) {
    markUnconfirmed(entry);
    return false;
  }
}

export function sendAcknowledgedMessage(payload) {
  var nextPayload = Object.assign({}, payload, { clientMessageId: createClientMessageId() });
  var entry = {
    projectSlug: store.get('currentSlug'),
    sessionId: store.get('activeSessionId'),
    accountId: store.get('myUserId') || "_default",
    cliSessionId: store.get('cliSessionId') || null,
    sessionOriginId: store.get('sessionOriginId') || null,
    attempts: 0,
    status: "pending",
    payload: nextPayload,
  };
  nextPayload.projectSlug = entry.projectSlug;
  nextPayload.sessionId = entry.sessionId;
  nextPayload.accountId = entry.accountId;
  nextPayload.cliSessionId = entry.cliSessionId;
  nextPayload.sessionOriginId = entry.sessionOriginId;
  entry.payload = nextPayload;
  replacePending(pendingMessages().concat([entry]));
  if (!transmit(entry, false)) {
    if (!getWs() || getWs().readyState !== 1) markUnconfirmed(entry);
    window.dispatchEvent(new CustomEvent("clay-message-delivery-timeout", {
      detail: { socket: getWs(), clientMessageId: nextPayload.clientMessageId },
    }));
  }
  return nextPayload.clientMessageId;
}

export function retryPendingMessage(clientMessageId) {
  var entry = pendingEntry(clientMessageId);
  if (!matchesActivatedContext(entry) || hasKnownCliMismatch(entry)) return false;
  var retryEntry = Object.assign({}, entry, { attempts: 0, status: "pending" });
  replacePending(pendingMessages().map(function (candidate) {
    return candidate.payload.clientMessageId === clientMessageId ? retryEntry : candidate;
  }));
  if (transmit(retryEntry, false)) {
    clearReceipt(clientMessageId);
    return true;
  }
  markUnconfirmed(retryEntry);
  return false;
}

export function acknowledgeMessage(clientMessageId) {
  if (typeof clientMessageId !== "string") return null;
  var pending = pendingMessages();
  var acknowledged = null;
  var next = pending.filter(function (entry) {
    if (entry.payload.clientMessageId === clientMessageId) acknowledged = entry;
    return entry.payload.clientMessageId !== clientMessageId;
  });
  if (next.length === pending.length) {
    clearReceipt(clientMessageId);
    return null;
  }
  clearAckTimer(clientMessageId);
  replacePending(next);
  delete socketRefs[clientMessageId];
  clearReceipt(clientMessageId);
  return acknowledged;
}

export function replayPendingMessages(sessionId) {
  var pending = pendingMessages();
  var projectSlug = store.get('currentSlug');
  for (var i = 0; i < pending.length; i++) {
    if (pending[i].projectSlug === projectSlug && String(pending[i].sessionId) === String(sessionId) && matchesCurrentContext(pending[i])) {
      transmit(pending[i], true);
    }
  }
}

export function activateDeliverySession(sessionId, cliSessionId, sessionOriginId) {
  var socket = getWs();
  activatedContext = {
    socket: socket,
    projectSlug: store.get('currentSlug'),
    sessionId: sessionId,
    accountId: store.get('myUserId') || "_default",
    cliSessionId: cliSessionId || null,
    sessionOriginId: sessionOriginId || null
  };
  replayPendingMessages(sessionId);
}

export function refreshDeliverySessionIdentity(cliSessionId, sessionOriginId) {
  if (!activatedContext || activatedContext.socket !== getWs()) return false;
  if (activatedContext.projectSlug !== store.get('currentSlug') || String(activatedContext.sessionId) !== String(store.get('activeSessionId')) || activatedContext.accountId !== (store.get('myUserId') || "_default")) return false;
  if (activatedContext.sessionOriginId && sessionOriginId && activatedContext.sessionOriginId !== sessionOriginId) return false;
  activatedContext.cliSessionId = cliSessionId || null;
  if (!activatedContext.sessionOriginId && sessionOriginId) activatedContext.sessionOriginId = sessionOriginId;
  return true;
}
