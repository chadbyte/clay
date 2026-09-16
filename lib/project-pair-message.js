var crypto = require("crypto");

function toolResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function requestId(value) {
  if (typeof value !== "string") return "pmsg_" + crypto.randomUUID();
  var clean = value.trim();
  if (!clean || clean.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(clean)) return null;
  return clean;
}

function attachPairMessage(ctx) {
  function send(args, caller) {
    var id = requestId(args.requestId);
    if (!id) return toolResult({ status: "rejected", requestId: null, reason: "requestId is invalid" });
    try {
      ctx.turnControl.assertWorkerAction(caller);
      var resolved = ctx.resolvePair(caller);
      var worker = resolved.partner;
      var message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) return toolResult({ status: "rejected", requestId: id, partnerId: worker.localId, reason: "message is required" });
      if (!worker.isProcessing && !worker._queryStarting) {
        return toolResult({ status: "rejected", requestId: id, partnerId: worker.localId, reason: "the Split Worker has no active turn" });
      }
      var sdk = ctx.getSdk();
      if (!sdk || !sdk.pushMessage(worker, message)) {
        return toolResult({ status: "rejected", requestId: id, partnerId: worker.localId, reason: "the active Worker runtime did not accept the message" });
      }
      ctx.sm.sendAndRecord(worker, {
        type: "partner_message",
        text: message,
        requestId: id,
        delegatedBy: caller.localId,
      });
      worker.lastActivity = Date.now();
      return toolResult({ status: "queued", requestId: id, partnerId: worker.localId, acknowledgement: "input_queue", runtimeState: worker._queryStarting ? "starting" : "active" });
    } catch (err) {
      return toolResult({ status: "rejected", requestId: id, reason: err.message || String(err) });
    }
  }

  function fingerprint(args) {
    return typeof args.message === "string" ? args.message.trim() : "";
  }
  return { fingerprint: fingerprint, send: send };
}

module.exports = { attachPairMessage: attachPairMessage };
