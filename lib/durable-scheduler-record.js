var STATES = ["queued", "claimed", "running", "completed", "failed", "cancelled", "interrupted"];

function boundedString(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new Error("invalid " + name);
}

function timestamp(value, name) {
  if (typeof value !== "number" || !isFinite(value) || value < 0) throw new Error("invalid " + name);
}

function jsonSize(value, name, maximum) {
  var serialized;
  try { serialized = JSON.stringify(value); } catch (error) { throw new Error("invalid " + name); }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maximum) throw new Error("invalid " + name);
}

function validateExecution(job) {
  if (job.state === "queued" || job.state === "cancelled") {
    if (job.execution !== null) throw new Error("invalid execution for " + job.state + " job");
    return;
  }
  if (!job.execution || typeof job.execution !== "object" || Array.isArray(job.execution)) {
    throw new Error("missing saved execution");
  }
  boundedString(job.execution.claimId, "saved claim id");
  timestamp(job.execution.claimedAt, "saved claimedAt");
  if (job.execution.startedAt !== undefined) timestamp(job.execution.startedAt, "saved startedAt");
  if (job.execution.completedAt !== undefined) timestamp(job.execution.completedAt, "saved completedAt");
  if (job.execution.failedAt !== undefined) timestamp(job.execution.failedAt, "saved failedAt");
  if (job.execution.interruptedAt !== undefined) timestamp(job.execution.interruptedAt, "saved interruptedAt");
  jsonSize(job.execution, "saved execution", 256 * 1024);
}

function validateSavedJobs(jobs) {
  var ids = Object.create(null);
  var keys = Object.create(null);
  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error("invalid saved job");
    boundedString(job.id, "saved job id");
    boundedString(job.idempotencyKey, "saved idempotencyKey");
    boundedString(job.type, "saved job type");
    boundedString(job.ownerId, "saved ownerId");
    boundedString(job.projectId, "saved projectId");
    if (ids[job.id] || keys[job.idempotencyKey]) throw new Error("duplicate saved job identity");
    if (STATES.indexOf(job.state) === -1) throw new Error("invalid saved state");
    timestamp(job.runAt, "saved runAt");
    timestamp(job.createdAt, "saved createdAt");
    timestamp(job.updatedAt, "saved updatedAt");
    if (!job.target || typeof job.target !== "object" || Array.isArray(job.target)) throw new Error("invalid saved target");
    boundedString(job.target.kind, "saved target kind");
    boundedString(job.target.id, "saved target id");
    jsonSize(job.target, "saved target", 4096);
    jsonSize(job.payload, "saved payload", 256 * 1024);
    validateExecution(job);
    ids[job.id] = true;
    keys[job.idempotencyKey] = true;
  }
}

module.exports = { validateSavedJobs: validateSavedJobs };
