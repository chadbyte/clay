var attachPairResultCapture = require("./project-pair-result-capture").attachPairResultCapture;
var attachPairResultDelivery = require("./project-pair-result-delivery").attachPairResultDelivery;

function attachPairResultPipeline(ctx) {
  var capture;
  var delivery = attachPairResultDelivery({ sm: ctx.sm, store: ctx.store, outbox: ctx.resultOutbox, getSdk: ctx.getSdk,
    getLinuxUserForSession: ctx.getLinuxUserForSession, acceptanceTimeoutMs: ctx.acceptanceTimeoutMs,
    blockedReason: ctx.blockedReason,
    onStateChange: ctx.onStateChange,
    finish: function (caller, partner, token, delivered) { return capture.finish(caller, partner, token, delivered); } });
  capture = attachPairResultCapture({ sm: ctx.sm, store: ctx.store, resultOutbox: ctx.resultOutbox, delivery: delivery, finishDelegation: ctx.finishDelegation, onStateChange: ctx.onStateChange,
    resumeDriverWithResult: ctx.resumeDriverWithResult, onPartnerResult: ctx.onPartnerResult, drain: ctx.drain });
  return { capture: capture, delivery: delivery };
}

module.exports = { attachPairResultPipeline: attachPairResultPipeline };
