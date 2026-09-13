var crypto = require("crypto");
var ACTIVE_STATES = ["armed", "running", "reviewing", "waiting-worker", "waiting-user", "paused"];
var TERMINAL_STATES = ["completed", "stopped", "limit", "error"];
function clean(value, max) { return typeof value === "string" ? value.trim().substring(0, max) : ""; }
function integer(value, fallback, max) { var number = Number(value); return Number.isFinite(number) ? Math.max(1, Math.min(max, Math.floor(number))) : fallback; }
function criteria(value) { return (Array.isArray(value) ? value : []).slice(0, 10).map(function (item) { return clean(item, 1000); }).filter(Boolean); }
function project(run) {
  if (!run) return null;
  return { id: run.id, state: run.state, objective: run.objective || "", successCriteria: run.successCriteria || [], continuationCount: run.continuationCount || 0,
    maxContinuations: run.maxContinuations, startedAt: run.startedAt || null, deadlineAt: run.deadlineAt || null, maxMinutes: run.maxMinutes,
    waitingReason: run.waitingReason || "", terminalReason: run.terminalReason || "", outcome: run.outcome || null, pausedAfterRestart: !!run.pausedAfterRestart,
    armToken: run.state === "armed" ? run.armToken : undefined };
}
function restore(value) {
  if (!value || typeof value !== "object" || ACTIVE_STATES.concat(TERMINAL_STATES).indexOf(value.state) === -1) return null;
  var evidence = value.outcome && Array.isArray(value.outcome.evidence) ? value.outcome.evidence.slice(0, 20).map(function (item) { return clean(item, 2000); }).filter(Boolean) : [];
  var assessments = value.outcome && Array.isArray(value.outcome.criteria) ? value.outcome.criteria.slice(0, 10).map(function (item) {
    return item && { criterion: clean(item.criterion, 1000), met: item.met === true, evidence: clean(item.evidence, 2000) };
  }).filter(function (item) { return item && item.criterion && item.evidence; }) : [];
  var snapshot = value.permissionSnapshot && typeof value.permissionSnapshot === "object" ? value.permissionSnapshot : {};
  var run = { version: 1, id: clean(value.id, 200) || crypto.randomUUID(), state: value.state, objective: clean(value.objective, 20000), successCriteria: criteria(value.successCriteria),
    continuationCount: Math.max(0, Math.min(100, Math.floor(Number(value.continuationCount) || 0))), maxContinuations: integer(value.maxContinuations, 10, 100), maxMinutes: integer(value.maxMinutes, 60, 1440),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(), startedAt: Number.isFinite(value.startedAt) ? value.startedAt : null, deadlineAt: Number.isFinite(value.deadlineAt) ? value.deadlineAt : null,
    finishedAt: Number.isFinite(value.finishedAt) ? value.finishedAt : null, waitingReason: clean(value.waitingReason, 2000), terminalReason: clean(value.terminalReason, 2000), pausedAfterRestart: !!value.pausedAfterRestart,
    cancellationEpoch: Math.max(0, Math.floor(Number(value.cancellationEpoch) || 0)), rateLimitUntil: Number.isFinite(value.rateLimitUntil) ? value.rateLimitUntil : null, continuationPending: false,
    wakeSequence: Math.max(0, Math.floor(Number(value.wakeSequence) || 0)), completionRequested: !!value.completionRequested,
    permissionSnapshot: { permissionMode: clean(snapshot.permissionMode, 100) || null, permissionModeBeforeFullAccess: clean(snapshot.permissionModeBeforeFullAccess, 100) || null, enabled: snapshot.enabled === true } };
  if (value.state === "armed") run.armToken = clean(value.armToken, 200) || crypto.randomUUID();
  if (value.outcome && typeof value.outcome === "object") run.outcome = { assessment: clean(value.outcome.assessment, 40), summary: clean(value.outcome.summary, 4000), evidence: evidence, criteria: assessments, reportedAt: Number.isFinite(value.outcome.reportedAt) ? value.outcome.reportedAt : null };
  return run;
}
module.exports = { project: project, restore: restore };
