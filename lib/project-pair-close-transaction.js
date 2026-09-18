var structuralClose = require("./project-pair-structural-close");

function attachPairCloseTransaction(ctx) {
  function close(args, caller) {
    var resolved = ctx.resolvePair(caller, args);
    var partner = resolved.partner;
    var token = partner._pairDelegation || null;
    var interrupted = !!(partner.isProcessing || partner._queryStarting);
    var interruption = token && interrupted ? {
      source: "driver",
      reason: "The Driver closed the Split Worker pair.",
      targetTaskId: token.taskId,
      requestedAt: Date.now(),
    } : null;
    var response = token ? ctx.responseText(partner.history || [], token.startIndex) : "";
    var failure = token ? ctx.errorSince(partner.history || [], token.startIndex) : null;
    var outcome = token ? ctx.taskControl.prepareCompletion(partner, caller, token,
      interrupted ? "interrupted" : "completed", response, failure, interruption) : null;
    var prepared = token ? ctx.resultCapture.prepare(caller, partner, token, outcome) : { ok: true, prepared: false };
    if (!prepared.ok) throw new Error(prepared.error || "could not durably capture the Worker outcome");
    var postCommitError = null;
    var result = structuralClose.removeSelectedWorker(ctx.store, resolved.group, caller, partner,
      ctx.multiWorkerFeature, { afterPersist: function () {
        try {
          if (token) {
            var finalized = ctx.resultCapture.finalizePrepared(token, outcome);
            if (!finalized.ok) throw new Error(finalized.error || "prepared close outcome could not be committed");
            partner._pairClosing = true;
            token.response = response;
            token.failure = failure;
            token.interrupted = interrupted && !failure;
            ctx.taskControl.commitCompletion(partner, caller, token, outcome);
            ctx.resultCapture.acceptPrepared(caller, partner, token);
          }
        } catch (error) { postCommitError = error; }
        finally { delete partner._pairClosing; }
        return { ok: true };
      } });
    if (!result.ok) {
      if (token && prepared.prepared && !prepared.duplicate) {
        var rolledBack = ctx.resultCapture.rollbackPrepared(token, outcome);
        if (!rolledBack.ok) throw new Error((result.error || "could not close the Worker pair") +
          "; prepared result rollback failed: " + (rolledBack.error || "unknown error"));
      }
      throw new Error(result.error || "could not close the Worker pair");
    }
    if (interrupted) {
      partner.taskStopRequested = true;
      if (partner.abortController) partner.abortController.abort();
    }
    ctx.workerPermission.cancelForSession(partner, "The Driver closed the Split Worker pair.");
    if (postCommitError) partner._pairCloseFinalizationError = postCommitError.message || String(postCommitError);
    return { status: "closed", partnerId: partner.localId, interrupted: interrupted,
      historyPreserved: true };
  }
  return { close: close };
}

module.exports = { attachPairCloseTransaction: attachPairCloseTransaction };
