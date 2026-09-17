var continuationPair = require("./driver-continuation-pair");

function attachContinuationPairTransfer(settings) {
  var ctx = settings.ctx;

  function commit(lease) {
    var transfer = lease && lease.pairTransfer;
    if (!transfer || transfer.committed) return { ok: true };
    var result = ctx.splitStore.commitOwnedDriverTransfer(transfer);
    if (!result.ok) return { ok: false, error: "The Split Worker ownership transfer could not be persisted: " + result.error };
    return { ok: true };
  }

  function rollback(lease) {
    var transfer = lease && lease.pairTransfer;
    if (!transfer || !transfer.staged) return { ok: true };
    return ctx.splitStore.rollbackOwnedDriverTransfer(transfer);
  }

  function begin(source, target, proposal, lease) {
    var staged = continuationPair.stage(source, target, ctx);
    if (!staged.ok) return staged;
    lease.pairTransfer = staged.transaction || null;
    lease.onCancel = function (cancelError) {
      var rolledBack = rollback(lease);
      if (!rolledBack.ok) {
        lease.cleanupError = "The Split Worker ownership transfer could not be rolled back: " + rolledBack.error;
        return false;
      }
      var persisted = settings.update(source, proposal, { status: "superseded", targetSessionId: null,
        targetOriginId: null, error: cancelError });
      if (!persisted) {
        lease.cleanupError = "The cancelled continuation state could not be persisted; the successor was retained for recovery.";
        return false;
      }
      lease.cleanupComplete = true;
      ctx.sm.deleteSessionQuiet(target.localId);
      settings.releaseLease(source, lease);
      return true;
    };
    return staged;
  }

  function validationError(source, target, lease, validateSource) {
    var sourceError = validateSource();
    if (sourceError) return sourceError;
    if (!lease.pairTransfer) return "";
    var transferred = continuationPair.inspect(target, ctx);
    if (!transferred.ok) return transferred.error;
    if (!transferred.group || transferred.group !== lease.pairTransfer.runtimeGroup ||
        transferred.worker !== lease.pairTransfer.worker) {
      return "The staged Split Worker ownership changed during successor startup.";
    }
    return "";
  }

  function retryError(source, target, lease, validateSource) {
    if (!lease || !lease.pairTransfer || lease.pairTransfer.committed) return "";
    return validationError(source, target, lease, validateSource);
  }

  function commitOrCancel(lease) {
    var result = commit(lease);
    if (result.ok) return result;
    lease.cancel(result.error);
    return { ok: false, error: lease.cleanupError || result.error };
  }

  function recoverIfNeeded(source, target, proposal) {
    var current = continuationPair.inspect(source, ctx);
    if (!current.group) return { ok: true, lease: null };
    var lease = settings.beginLease(source, target, proposal.proposalId);
    var recovered = begin(source, target, proposal, lease);
    if (!recovered.ok) {
      settings.releaseLease(source, lease);
      return recovered;
    }
    lease.waitingCommit = true;
    return { ok: true, lease: lease };
  }

  return { begin: begin, commit: commit, commitOrCancel: commitOrCancel, recoverIfNeeded: recoverIfNeeded,
    retryError: retryError, rollback: rollback, validationError: validationError };
}

module.exports = { attachContinuationPairTransfer: attachContinuationPairTransfer };
