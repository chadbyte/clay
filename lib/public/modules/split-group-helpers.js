export function groupedSessionIds(groups) {
  var ids = new Set();
  var list = groups || [];
  for (var i = 0; i < list.length; i++) {
    var members = list[i].members || [];
    for (var j = 0; j < members.length; j++) ids.add(members[j]);
  }
  return ids;
}

export function findSplitGroup(groups, memberIds) {
  var list = groups || [];
  for (var i = 0; i < list.length; i++) {
    var members = list[i].members || [];
    if (members.length !== memberIds.length) continue;
    var matches = true;
    for (var j = 0; j < memberIds.length; j++) {
      if (members.indexOf(memberIds[j]) === -1) { matches = false; break; }
    }
    if (matches) return list[i];
  }
  return null;
}

// Resolve the visible order from the explicit role contract. Member array
// order is persistence detail and must never decide who is the Driver.
export function splitGroupRoles(group) {
  if (!group || !Array.isArray(group.members)) return null;
  var pair = group.pair;
  if (!pair || typeof pair !== "object" || Array.isArray(pair)) return null;
  var hasVersion = Object.prototype.hasOwnProperty.call(pair, "version");
  var hasLegacyWorker = Object.prototype.hasOwnProperty.call(pair, "workerId");
  var hasWorkerIds = Object.prototype.hasOwnProperty.call(pair, "workerIds");
  if (hasVersion && pair.version !== 2) return null;
  if (hasVersion && hasLegacyWorker) return null;
  if (hasVersion && !hasWorkerIds) return null;
  if (!hasVersion && hasWorkerIds) return null;
  if (!hasVersion && !hasLegacyWorker) return null;
  var driverId = pair.driverId;
  var workerIds = hasWorkerIds ? (Array.isArray(pair.workerIds) ? pair.workerIds.slice() : []) :
    (pair.workerId !== undefined ? [pair.workerId] : []);
  if (!Number.isInteger(driverId) || workerIds.length < 1 || workerIds.length > 2) return null;
  if (group.members.indexOf(driverId) === -1) return null;
  var ordered = [driverId];
  for (var i = 0; i < workerIds.length; i++) {
    if (!Number.isInteger(workerIds[i]) || workerIds[i] === driverId || group.members.indexOf(workerIds[i]) === -1 || ordered.indexOf(workerIds[i]) !== -1) return null;
    ordered.push(workerIds[i]);
  }
  if (group.members.length !== ordered.length) return null;
  for (var mi = 0; mi < group.members.length; mi++) if (ordered.indexOf(group.members[mi]) === -1) return null;
  return { driverId: driverId, workerIds: workerIds, orderedIds: ordered, version: pair.version || null };
}

export function splitGroupMemberIds(group) {
  var roles = splitGroupRoles(group);
  return roles ? roles.orderedIds : (group && Array.isArray(group.members) ? group.members.slice() : []);
}

export function splitGroupActiveAnchor(group, activeId) {
  var roles = splitGroupRoles(group);
  if (roles) return roles.driverId;
  var members = group && Array.isArray(group.members) ? group.members : [];
  return members.indexOf(activeId) !== -1 ? activeId : (members[0] || null);
}

export function isConfiguredWorker(groups, sessionId) {
  var list = groups || [];
  for (var i = 0; i < list.length; i++) {
    var roles = splitGroupRoles(list[i]);
    if (roles && roles.workerIds.indexOf(sessionId) !== -1) return true;
  }
  return false;
}

export function splitWorkerCloseRequest(group, sessions, projectSlug, workerId, requestId) {
  var roles = splitGroupRoles(group);
  if (!roles || roles.version !== 2 || roles.workerIds.indexOf(workerId) === -1) return null;
  var anchors = group && group.pairAnchors;
  if (!anchors || anchors.version !== 2 || !anchors.driver || !Array.isArray(anchors.workers)) return null;
  var workerIndex = roles.workerIds.indexOf(workerId);
  var workerAnchor = anchors.workers[workerIndex];
  var worker = null;
  var list = sessions || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === workerId) worker = list[i];
  if (!workerAnchor || !anchors.driver.origin || !workerAnchor.origin || !worker || !Number.isInteger(worker.workerGeneration)) return null;
  return {
    type: "split_worker_close",
    requestId: requestId,
    projectSlug: projectSlug,
    groupId: group.id,
    driverId: roles.driverId,
    driverOriginId: anchors.driver.origin,
    workerId: workerId,
    workerOriginId: workerAnchor.origin,
    generation: worker.workerGeneration,
    expectedWorkerIds: roles.workerIds.slice(),
  };
}
