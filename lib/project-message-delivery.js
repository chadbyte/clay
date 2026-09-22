// Idempotent acknowledgement support for ordinary project chat messages.

var CLIENT_MESSAGE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function normalizeClientMessageId(value) {
  if (typeof value !== "string" || !CLIENT_MESSAGE_ID_RE.test(value)) return null;
  return value;
}

function ownerKey(ws) {
  return ws && ws._clayUser && ws._clayUser.id ? String(ws._clayUser.id) : "_default";
}

function deliveryKey(ownerId, clientMessageId) {
  return ownerId + ":" + clientMessageId;
}

function validateContext(ws, session, msg, projectSlug) {
  if (!msg || !msg.clientMessageId) return { ok: true };
  if (msg.projectSlug == null && msg.sessionId == null && msg.accountId == null && msg.cliSessionId == null && msg.sessionOriginId == null) return { ok: true };
  var expectedCliSessionId = session && session.cliSessionId ? String(session.cliSessionId) : null;
  var actualCliSessionId = msg.cliSessionId ? String(msg.cliSessionId) : null;
  var expectedSessionId = session && session.localId != null ? String(session.localId) : null;
  var expectedOriginId = session && session.sessionOriginId ? String(session.sessionOriginId) : null;
  var actualOriginId = msg.sessionOriginId ? String(msg.sessionOriginId) : null;
  if (msg.projectSlug !== projectSlug) return { ok: false, reason: "Project changed" };
  if (msg.accountId !== ownerKey(ws)) return { ok: false, reason: "Account changed" };
  if (expectedOriginId || actualOriginId) {
    if (!expectedOriginId || actualOriginId !== expectedOriginId) return { ok: false, reason: "Session identity changed" };
  } else {
    if (msg.sessionId == null || String(msg.sessionId) !== expectedSessionId) return { ok: false, reason: "Session changed" };
    if (actualCliSessionId && expectedCliSessionId && actualCliSessionId !== expectedCliSessionId) return { ok: false, reason: "Session identity changed" };
  }
  return { ok: true };
}

function ensureRecordedMessages(session) {
  if (session._recordedClientMessages) return session._recordedClientMessages;
  var recorded = new Map();
  var history = Array.isArray(session.history) ? session.history : [];
  for (var i = 0; i < history.length; i++) {
    var item = history[i];
    var clientMessageId = normalizeClientMessageId(item && item.clientMessageId);
    if (!clientMessageId) continue;
    recorded.set(deliveryKey(item.from ? String(item.from) : "_default", clientMessageId), item);
  }
  session._recordedClientMessages = recorded;
  return recorded;
}

function createProjectMessageDelivery(sendTo, projectSlug) {
  function inspect(ws, session, msg) {
    var clientMessageId = normalizeClientMessageId(msg && msg.clientMessageId);
    if (!clientMessageId) return { clientMessageId: null, ownerId: ownerKey(ws), duplicate: false };
    var ownerId = ownerKey(ws);
    var recordedMessage = ensureRecordedMessages(session).get(deliveryKey(ownerId, clientMessageId)) || null;
    return {
      clientMessageId: clientMessageId,
      ownerId: ownerId,
      duplicate: !!recordedMessage,
      recordedMessage: recordedMessage,
    };
  }

  function markRecorded(session, receipt, message) {
    if (!receipt || !receipt.clientMessageId) return;
    ensureRecordedMessages(session).set(deliveryKey(receipt.ownerId, receipt.clientMessageId), message);
  }

  function acknowledge(ws, receipt, message, session) {
    if (!receipt || !receipt.clientMessageId) return;
    sendTo(ws, {
      type: "message_ack",
      clientMessageId: receipt.clientMessageId,
      projectSlug: projectSlug || null,
      sessionId: session ? session.localId : null,
      message: message || receipt.recordedMessage || null,
    });
  }

  return {
    validateContext: function (ws, session, msg) { return validateContext(ws, session, msg, projectSlug); },
    inspect: inspect,
    markRecorded: markRecorded,
    acknowledge: acknowledge,
  };
}

module.exports = {
  createProjectMessageDelivery: createProjectMessageDelivery,
  normalizeClientMessageId: normalizeClientMessageId,
};
