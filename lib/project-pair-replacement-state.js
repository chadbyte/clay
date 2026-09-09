var crypto = require("crypto");

function storeFor(driver) {
  if (!driver._pairReplacementTransactions) driver._pairReplacementTransactions = Object.create(null);
  return driver._pairReplacementTransactions;
}

function begin(driver, requestedId, worker, fingerprint) {
  var id = typeof requestedId === "string" && requestedId.trim() ? requestedId.trim() : "replace_" + crypto.randomUUID();
  var existing = storeFor(driver)[id];
  if (existing) {
    if (existing.fingerprint !== (fingerprint || "")) throw new Error("replacement transaction id was already used with different input");
    return { transaction: existing, replay: true };
  }
  var transaction = {
    transactionId: id,
    status: "active",
    stage: "preflight",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    sourceWorkerId: worker.localId,
    sourceGeneration: worker._pairGeneration || worker.sessionProvenance && worker.sessionProvenance.generation || null,
    sourceTurnState: worker.isProcessing || worker._queryStarting ? "running" : "idle",
    sourceStopped: false,
    sourcePairRestored: null,
    filesPreserved: true,
    fingerprint: fingerprint || "",
    targetWorkerId: null,
    targetGeneration: null,
    failure: null,
    result: null,
  };
  storeFor(driver)[id] = transaction;
  driver._lastPairReplacement = transaction;
  return { transaction: transaction, replay: false };
}

function stage(transaction, value) {
  transaction.stage = value;
  transaction.updatedAt = Date.now();
  return transaction;
}

function fail(transaction, stageName, error, rollback) {
  transaction.status = "failed";
  transaction.stage = stageName;
  transaction.updatedAt = Date.now();
  transaction.completedAt = transaction.updatedAt;
  transaction.failure = { message: error && (error.message || String(error)) || "Unknown replacement failure", rollback: rollback || "not_required" };
  transaction.sourcePairRestored = rollback === "source_pair_restored" ? true : (rollback === "source_pair_restore_failed" ? false : null);
  return transaction;
}

function complete(transaction, result) {
  transaction.status = "completed";
  transaction.stage = "committed";
  transaction.updatedAt = Date.now();
  transaction.completedAt = transaction.updatedAt;
  transaction.targetWorkerId = result.workerSessionId;
  transaction.targetGeneration = result.generation;
  transaction.result = result;
  return transaction;
}

function replayValue(entry) {
  if (!entry.replay) return null;
  if (entry.transaction.status === "completed") return entry.transaction.result;
  if (entry.transaction.status === "failed") throw new Error(entry.transaction.failure.message);
  throw new Error("replacement transaction is already active at stage " + entry.transaction.stage);
}

module.exports = { begin: begin, complete: complete, fail: fail, replayValue: replayValue, stage: stage };
