function value(input) {
  return typeof input === "string" && input ? input : null;
}

var splitRoles = require("./session-split-group-roles");

function pairFor(session, previousCli, previousOrigin) {
  return {
    cli: value(session && session.cliSessionId) || value(previousCli),
    origin: value(session && session.sessionOriginId) || value(previousOrigin),
  };
}

function versionedAnchor(session) {
  var cli = value(session && session.cliSessionId);
  var origin = value(session && session.sessionOriginId);
  if (!cli && !origin) return null;
  return { cli: cli, origin: origin };
}

function versionedPairAnchors(group, sessions) {
  var normalized = splitRoles.normalizePair(group && group.pair, group && group.members);
  if (!normalized.ok || normalized.kind !== "versioned") return null;
  var driver = versionedAnchor(sessions.get(group.pair.driverId));
  if (!driver) return null;
  var workers = [];
  for (var i = 0; i < normalized.workerIds.length; i++) {
    var worker = versionedAnchor(sessions.get(normalized.workerIds[i]));
    if (!worker) return null;
    workers.push(worker);
  }
  return { version: 2, driver: driver, workers: workers };
}

function versionedMemberAnchors(group, sessions) {
  var normalized = splitRoles.normalizePair(group && group.pair, group && group.members);
  if (!normalized.ok || normalized.kind !== "versioned") return null;
  var members = [];
  for (var i = 0; i < group.members.length; i++) {
    var anchor = versionedAnchor(sessions.get(group.members[i]));
    if (!anchor) return null;
    members.push(anchor);
  }
  return { version: 2, members: members };
}

function resolveVersionedPair(sessions, anchors) {
  if (!anchors || anchors.version !== 2 || !anchors.driver || !Array.isArray(anchors.workers) ||
      (anchors.workers.length !== 1 && anchors.workers.length !== 2)) return null;
  var driver = findSession(sessions, anchors.driver.cli, anchors.driver.origin);
  if (!driver) return null;
  var workers = [];
  for (var i = 0; i < anchors.workers.length; i++) {
    var workerAnchor = anchors.workers[i];
    if (!workerAnchor || (!value(workerAnchor.cli) && !value(workerAnchor.origin))) return null;
    var worker = workerAnchor && findSession(sessions, workerAnchor.cli, workerAnchor.origin);
    if (!worker || workers.indexOf(worker) !== -1 || worker === driver) return null;
    workers.push(worker);
  }
  return { driver: driver, workers: workers };
}

function resolveVersionedMembers(sessions, anchors) {
  if (!anchors || anchors.version !== 2 || !Array.isArray(anchors.members) ||
      (anchors.members.length !== 2 && anchors.members.length !== 3)) return null;
  var resolved = [];
  for (var i = 0; i < anchors.members.length; i++) {
    var anchor = anchors.members[i];
    if (!anchor || (!value(anchor.cli) && !value(anchor.origin))) return null;
    var session = anchor && findSession(sessions, anchor.cli, anchor.origin);
    if (!session || resolved.indexOf(session) !== -1) return null;
    resolved.push(session);
  }
  return resolved;
}

function memberAnchors(group, sessions) {
  var normalized = splitRoles.normalizePair(group && group.pair, group && group.members);
  if (!normalized.ok) return null;
  if (normalized.kind === "versioned") return versionedMemberAnchors(group, sessions);
  var previousCli = Array.isArray(group.memberCliIds) ? group.memberCliIds : [];
  var previousOrigin = Array.isArray(group.memberOriginIds) ? group.memberOriginIds : [];
  var cli = [], origin = [];
  for (var i = 0; i < group.members.length; i++) {
    var anchor = pairFor(sessions.get(group.members[i]), previousCli[i], previousOrigin[i]);
    cli.push(anchor.cli); origin.push(anchor.origin);
  }
  return { cli: cli, origin: origin };
}

function pairAnchors(group, sessions) {
  var normalized = splitRoles.normalizePair(group && group.pair, group && group.members);
  if (!normalized.ok || normalized.kind === "adhoc") return null;
  if (normalized.kind === "versioned") return versionedPairAnchors(group, sessions);
  var previousCli = Array.isArray(group.pairCliIds) ? group.pairCliIds : [null, null];
  var previousOrigin = Array.isArray(group.pairOriginIds) ? group.pairOriginIds : [null, null];
  var driver = pairFor(sessions.get(group.pair.driverId), previousCli[0], previousOrigin[0]);
  var worker = pairFor(sessions.get(group.pair.workerId), previousCli[1], previousOrigin[1]);
  return { cli: [driver.cli, worker.cli], origin: [driver.origin, worker.origin] };
}

function findSession(sessions, cliId, originId) {
  var cli = value(cliId);
  var origin = value(originId);
  if (!cli && !origin) return null;
  var found = null;
  var ambiguous = false;
  sessions.forEach(function (session) {
    if (cli && session.cliSessionId !== cli) return;
    if (origin && session.sessionOriginId !== origin) return;
    if (found && found !== session) ambiguous = true;
    else found = session;
  });
  return ambiguous ? null : found;
}

module.exports = {
  findSession: findSession,
  memberAnchors: memberAnchors,
  pairAnchors: pairAnchors,
  resolveVersionedMembers: resolveVersionedMembers,
  resolveVersionedPair: resolveVersionedPair,
  versionedAnchor: versionedAnchor,
  versionedMemberAnchors: versionedMemberAnchors,
  versionedPairAnchors: versionedPairAnchors,
};
