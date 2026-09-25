var roles = require("./session-split-group-roles");

// Restart repair for a Version 2 record whose deletion cleanup never reached
// disk. Only anchors that no live session carries at all are treated as
// deleted. Any ambiguous or partially matching identity, owner mismatch, or
// disagreement between member and pair anchors leaves the record untouched so
// the ordinary preserve-on-failure path still applies.

function value(input) {
  return typeof input === "string" && input ? input : null;
}

function sameAnchor(left, right) {
  return !!(left && right && value(left.cli) === value(right.cli) && value(left.origin) === value(right.origin));
}

function classify(sessions, anchor) {
  var cli = value(anchor && anchor.cli);
  var origin = value(anchor && anchor.origin);
  if (!cli && !origin) return { state: "invalid" };
  var matches = [];
  sessions.forEach(function (session) {
    if ((cli && session.cliSessionId === cli) || (origin && session.sessionOriginId === origin)) matches.push(session);
  });
  if (matches.length === 0) return { state: "absent" };
  var only = matches[0];
  if (matches.length === 1 && (!cli || only.cliSessionId === cli) && (!origin || only.sessionOriginId === origin)) {
    return { state: "exact", session: only };
  }
  return { state: "conflict" };
}

function agreedAnchors(group, normalized) {
  var members = group.memberAnchors;
  var pair = group.pairAnchors;
  if (!members || members.version !== 2 || !Array.isArray(members.members)) return null;
  if (!pair || pair.version !== 2 || !pair.driver || !Array.isArray(pair.workers)) return null;
  if (pair.workers.length !== normalized.workerIds.length || members.members.length !== group.members.length) return null;
  if (members.members.length !== pair.workers.length + 1 || !sameAnchor(members.members[0], pair.driver)) return null;
  for (var i = 0; i < pair.workers.length; i++) {
    if (!sameAnchor(members.members[i + 1], pair.workers[i])) return null;
  }
  return { driver: pair.driver, workers: pair.workers };
}

// Returns null when no safe repair applies, { drop: true } when the stored
// Driver or every Worker was deleted, or { changed: true } after reducing the
// record to its exact surviving Driver and Workers. An absent anchor is
// evidence of deletion only when every session record was read; after any
// unreadable or unparseable record the stored group is preserved unchanged.
function repairDeletedMembers(group, normalized, sessions, options) {
  if (typeof group.id !== "string" || !group.id || !normalized.ok || normalized.kind !== "versioned") return null;
  var agreed = agreedAnchors(group, normalized);
  if (!agreed) return null;
  var ownerId = group.ownerId || null;
  var driver = classify(sessions, agreed.driver);
  var workers = agreed.workers.map(function (anchor) { return classify(sessions, anchor); });
  var all = [driver].concat(workers);
  var absent = 0;
  var seen = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i].state === "absent") { absent++; continue; }
    if (all[i].state !== "exact") return null;
    if ((all[i].session.ownerId || null) !== ownerId || seen.indexOf(all[i].session) !== -1) return null;
    seen.push(all[i].session);
  }
  if (absent === 0 || (options && options.loadUncertain)) return null;
  var survivors = [];
  var survivorAnchors = [];
  for (var j = 0; j < workers.length; j++) {
    if (workers[j].state !== "exact") continue;
    survivors.push(workers[j].session);
    survivorAnchors.push(agreed.workers[j]);
  }
  if (driver.state !== "exact" || survivors.length === 0) return { drop: true };
  var memberIds = [driver.session.localId].concat(survivors.map(function (session) { return session.localId; }));
  var nextPair = { version: 2, driverId: driver.session.localId, workerIds: memberIds.slice(1) };
  var checked = roles.normalizePair(nextPair, memberIds);
  if (!checked.ok || checked.kind !== "versioned") return null;
  group.members = memberIds;
  group.pair = nextPair;
  group.memberAnchors = { version: 2, members: [agreed.driver].concat(survivorAnchors) };
  group.pairAnchors = { version: 2, driver: agreed.driver, workers: survivorAnchors };
  return { changed: true };
}

module.exports = { repairDeletedMembers: repairDeletedMembers, classifyAnchor: classify };
