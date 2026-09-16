// Reliable delivery for ordinary project chat messages within a page lifetime.

import { store } from './store.js';
import { getWs } from './ws-ref.js';

var ACK_TIMEOUT_MS = 5000;
var ackTimers = {};

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

function armAckTimer(clientMessageId, socket) {
  clearAckTimer(clientMessageId);
  ackTimers[clientMessageId] = setTimeout(function () {
    delete ackTimers[clientMessageId];
    if (!isPending(clientMessageId) || getWs() !== socket) return;
    window.dispatchEvent(new CustomEvent("clay-message-delivery-timeout", {
      detail: { socket: socket, clientMessageId: clientMessageId },
    }));
  }, ACK_TIMEOUT_MS);
}

function transmit(entry) {
  var socket = getWs();
  if (!socket || socket.readyState !== 1) return false;
  try {
    socket.send(JSON.stringify(entry.payload));
    armAckTimer(entry.payload.clientMessageId, socket);
    return true;
  } catch (e) {
    return false;
  }
}

export function sendAcknowledgedMessage(payload) {
  var nextPayload = Object.assign({}, payload, { clientMessageId: createClientMessageId() });
  var entry = {
    projectSlug: store.get('currentSlug'),
    sessionId: store.get('activeSessionId'),
    payload: nextPayload,
  };
  replacePending(pendingMessages().concat([entry]));
  if (!transmit(entry)) {
    window.dispatchEvent(new CustomEvent("clay-message-delivery-timeout", {
      detail: { socket: getWs(), clientMessageId: nextPayload.clientMessageId },
    }));
  }
  return nextPayload.clientMessageId;
}

export function acknowledgeMessage(clientMessageId) {
  if (typeof clientMessageId !== "string") return null;
  var pending = pendingMessages();
  var acknowledged = null;
  var next = pending.filter(function (entry) {
    if (entry.payload.clientMessageId === clientMessageId) acknowledged = entry;
    return entry.payload.clientMessageId !== clientMessageId;
  });
  if (next.length === pending.length) return null;
  clearAckTimer(clientMessageId);
  replacePending(next);
  return acknowledged;
}

export function replayPendingMessages(sessionId) {
  var pending = pendingMessages();
  var projectSlug = store.get('currentSlug');
  for (var i = 0; i < pending.length; i++) {
    if (pending[i].projectSlug === projectSlug && pending[i].sessionId === sessionId) {
      transmit(pending[i]);
    }
  }
}
