var splitRoles = require("./session-split-group-roles");
var durableAnchors = require("./session-split-group-anchors");

// Session deletion is irreversible, so its split-group effect is applied to
// live membership before persistence and is never rolled back. A failed
// write leaves the durable record pending: a bounded-backoff retry, or the
// next successful save of any group, writes the authoritative live state.
var DEFAULT_RETRY_DELAYS_MS = [1000, 5000, 15000, 60000];

function refreshLiveAnchors(group, sessions) {
  var member = durableAnchors.versionedMemberAnchors(group, sessions);
  var pair = durableAnchors.versionedPairAnchors(group, sessions);
  if (member) group.memberAnchors = member; else delete group.memberAnchors;
  if (pair) group.pairAnchors = pair; else delete group.pairAnchors;
}

function removeDeletedMember(groups, localId, sessions) {
  var index = -1;
  for (var i = 0; i < groups.length; i++) {
    if (groups[i].members.indexOf(localId) !== -1) { index = i; break; }
  }
  if (index === -1) return null;
  var group = groups[index];
  var normalized = splitRoles.normalizePair(group.pair, group.members);
  if (normalized.ok && normalized.kind === "versioned" && normalized.driverId !== localId &&
      normalized.workerIds.length > 1) {
    var remaining = normalized.workerIds.filter(function (id) { return id !== localId; });
    group.members = [normalized.driverId].concat(remaining);
    group.pair = { version: 2, driverId: normalized.driverId, workerIds: remaining };
    // Clients address Workers through these anchors by index, so they must
    // match the reduced roles even while the durable write is pending.
    refreshLiveAnchors(group, sessions);
    return { group: group, dissolved: false };
  }
  groups.splice(index, 1);
  return { group: group, dissolved: true };
}

function attachDeletionCleanup(opts) {
  var delays = Array.isArray(opts.retryDelaysMs) && opts.retryDelaysMs.length ?
    opts.retryDelaysMs.slice() : DEFAULT_RETRY_DELAYS_MS;
  var setTimer = opts.setTimer || setTimeout;
  var clearTimer = opts.clearTimer || clearTimeout;
  var logger = opts.logger || console;
  var pending = null;
  var timer = null;
  var stopped = false;

  function cancelTimer() {
    if (timer) clearTimer(timer);
    timer = null;
  }
  function schedule() {
    cancelTimer();
    if (stopped || !pending) return;
    timer = setTimer(retry, delays[Math.min(pending.attempts - 1, delays.length - 1)]);
    if (timer && typeof timer.unref === "function") timer.unref();
  }
  function recordFailure(reason, error) {
    var message = error && error.message || String(error);
    if (!pending) pending = { reason: reason, attempts: 0, since: Date.now(), lastError: null };
    pending.attempts++;
    pending.lastError = message;
    logger.error("[split-groups] Durable split group state is pending after " + pending.reason +
      " (attempt " + pending.attempts + "): " + message);
    schedule();
  }
  function saved() {
    if (!pending) return;
    logger.log("[split-groups] Durable split group state recovered after " + pending.reason);
    pending = null;
    cancelTimer();
  }
  function persist(reason) {
    try { opts.save(); return true; }
    catch (error) { recordFailure(reason, error); return false; }
  }
  function retry() {
    timer = null;
    if (stopped || !pending) return;
    persist(pending.reason);
  }
  function sessionDeleted(localId) {
    var change = removeDeletedMember(opts.groups(), localId, opts.sessions);
    if (!change) return false;
    persist("session deletion");
    opts.broadcast();
    opts.onPairChanged(change.group);
    return true;
  }
  function retryNow() {
    if (!pending) return true;
    return persist(pending.reason);
  }
  function status() {
    if (!pending) return { pending: false };
    return { pending: true, reason: pending.reason, attempts: pending.attempts,
      since: pending.since, lastError: pending.lastError, retryScheduled: !!timer };
  }
  function shutdown() {
    stopped = true;
    cancelTimer();
  }

  return { sessionDeleted: sessionDeleted, recordFailure: recordFailure, saved: saved,
    retryNow: retryNow, status: status, shutdown: shutdown };
}

module.exports = {
  attachDeletionCleanup: attachDeletionCleanup,
  removeDeletedMember: removeDeletedMember,
  DEFAULT_RETRY_DELAYS_MS: DEFAULT_RETRY_DELAYS_MS,
};
