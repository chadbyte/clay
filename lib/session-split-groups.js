var crypto = require("crypto");
var durableAnchors = require("./session-split-group-anchors");
var splitRoles = require("./session-split-group-roles");
var versionedStore = require("./session-split-group-v2-store");
var multiWorkerFeature = require("./multi-worker-feature");
var groupPersistence = require("./session-split-group-persistence");
function truncateTitle(title) {
  var value = String(title || "New Session");
  return value.length > 20 ? value.slice(0, 19) + "…" : value;
}
function autoGroupName(leftTitle, rightTitle) {
  return truncateTitle(leftTitle) + " | " + truncateTitle(rightTitle);
}
function createSplitGroupStore(opts) {
  var sessions = opts.sessions;
  var usersModule = opts.usersModule;
  var broadcast = opts.broadcast || function () {};
  var onPairChanged = opts.onPairChanged || function () {};
  var groups = [];
  var stagedTransfers = [];
  var versionedEnabled = multiWorkerFeature.isEnabled(opts.multiWorkerFeature);
  var persistence = groupPersistence.attachPersistence(Object.assign({}, opts, { versionedEnabled: versionedEnabled }));
  function save() { return persistence.save(groups); }
  function isMultiUser() {
    return !!(usersModule && usersModule.isMultiUser && usersModule.isMultiUser());
  }
  function listFor(ws) {
    if (!isMultiUser()) return groups.slice();
    if (!ws || !ws._clayUser) return [];
    return groups.filter(function (group) { return group.ownerId === ws._clayUser.id; });
  }
  function groupForMember(localId) {
    for (var si = 0; si < stagedTransfers.length; si++) {
      var transfer = stagedTransfers[si];
      if (!exactTransfer(transfer)) continue;
      if (transfer.source.localId === localId) return null;
      if (transfer.target.localId === localId || transfer.worker.localId === localId) return transfer.runtimeGroup;
    }
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].members.indexOf(localId) !== -1) return groups[i];
    }
    return null;
  }
  function membershipGroup(localId) {
    for (var si = 0; si < stagedTransfers.length; si++) {
      var transfer = stagedTransfers[si];
      if (transfer.source.localId === localId || transfer.target.localId === localId ||
          transfer.worker.localId === localId) return transfer.group;
    }
    for (var i = 0; i < groups.length; i++) if (groups[i].members.indexOf(localId) !== -1) return groups[i];
    return null;
  }
  function groupCountForMember(localId) {
    var count = 0;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].members.indexOf(localId) !== -1) count++;
    }
    return count;
  }
  function canAccess(ws, session) {
    if (!isMultiUser()) return true;
    return !!(ws && ws._clayUser && usersModule.canAccessSession(
      ws._clayUser.id, session, { visibility: "public" }
    ));
  }
  function canOwn(ws, group) {
    return !isMultiUser() || !!(ws && ws._clayUser && group.ownerId === ws._clayUser.id);
  }
  function create(ws, msg) {
    var members = msg && msg.members;
    if (!Array.isArray(members) || members.length !== 2) return { ok: false, error: "A split group requires exactly two sessions" };
    if (!Number.isInteger(members[0]) || !Number.isInteger(members[1]) || members[0] === members[1]) {
      return { ok: false, error: "Split group members must be two distinct session ids" };
    }
    var left = sessions.get(members[0]);
    var right = sessions.get(members[1]);
    if (!left || !right) return { ok: false, error: "Session not found" };
    if (!canAccess(ws, left) || !canAccess(ws, right)) return { ok: false, error: "Session access denied" };
    if (membershipGroup(members[0]) || membershipGroup(members[1])) return { ok: false, error: "A session can belong to only one split group" };
    var roleCheck = splitRoles.validateStorePair(msg.pair, members);
    if (!roleCheck.ok) return { ok: false, error: roleCheck.error };
    var requestedName = typeof msg.name === "string" ? msg.name.trim().slice(0, 80) : "";
    var group = {
      id: "sg_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex"),
      name: requestedName || autoGroupName(left.title, right.title),
      nameCustomized: !!requestedName,
      ownerId: isMultiUser() && ws && ws._clayUser ? ws._clayUser.id : null,
      members: members.slice(),
      createdAt: Date.now(),
    };
    if (msg.pair) {
      if (msg.pair.driverId === msg.pair.workerId || members.indexOf(msg.pair.driverId) === -1 || members.indexOf(msg.pair.workerId) === -1) {
        return { ok: false, error: "Pair roles must reference both split group members" };
      }
      group.pair = { driverId: msg.pair.driverId, workerId: msg.pair.workerId };
    }
    groups.push(group);
    save();
    broadcast();
    if (group.pair) onPairChanged(group);
    return { ok: true, group: group };
  }
  function createOwned(ownerId, msg) {
    var members = msg && msg.members;
    if (!Array.isArray(members) || members.length !== 2) return { ok: false, error: "A split group requires exactly two sessions" };
    var left = sessions.get(members[0]);
    var right = sessions.get(members[1]);
    if (!left || !right || left === right) return { ok: false, error: "Session not found" };
    if ((left.ownerId || null) !== (ownerId || null) || (right.ownerId || null) !== (ownerId || null)) return { ok: false, error: "Session owner does not match the scheduled task owner" };
    if (membershipGroup(left.localId) || membershipGroup(right.localId)) return { ok: false, error: "A session can belong to only one split group" };
    var pair = msg && msg.pair;
    var roleCheck = splitRoles.validateStorePair(pair, members);
    if (!roleCheck.ok || !pair || pair.driverId !== left.localId || pair.workerId !== right.localId) return { ok: false, error: roleCheck.error || "Pair roles must reference both split group members" };
    var requestedName = typeof msg.name === "string" ? msg.name.trim().slice(0, 80) : "";
    var group = {
      id: "sg_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex"),
      name: requestedName || autoGroupName(left.title, right.title), nameCustomized: !!requestedName,
      ownerId: ownerId || null, members: members.slice(),
      pair: { driverId: pair.driverId, workerId: pair.workerId }, createdAt: Date.now(),
    };
    groups.push(group);
    try { save(); } catch (error) { groups.pop(); return { ok: false, error: error.message || String(error) }; }
    broadcast();
    onPairChanged(group);
    return { ok: true, group: group };
  }
  function dissolveOwned(ownerId, id) {
    var index = groups.findIndex(function (item) { return item.id === id && (item.ownerId || null) === (ownerId || null); });
    if (index === -1) return false;
    var removed = groups.splice(index, 1)[0];
    try { save(); } catch (error) { groups.splice(index, 0, removed); return false; }
    broadcast();
    onPairChanged(removed);
    return true;
  }
  function beginOwnedDriverTransfer(ownerId, msg) {
    var group = groups.find(function (item) { return item.id === (msg && msg.id); });
    if (!group || (group.ownerId || null) !== (ownerId || null)) return { ok: false, error: "Split group not found" };
    var transferRoles = splitRoles.normalizePair(group.pair, group.members);
    if (transferRoles.ok && transferRoles.kind === "versioned") {
      return { ok: false, error: "Version 2 Driver transfer is not enabled" };
    }
    if (!group.pair || group.pair.driverId !== msg.sourceDriverId || group.pair.workerId !== msg.workerId) {
      return { ok: false, error: "The split pair changed before Driver transfer" };
    }
    var source = sessions.get(msg.sourceDriverId);
    var target = sessions.get(msg.targetDriverId);
    var worker = sessions.get(msg.workerId);
    if (!source || !target || !worker || source === target || target === worker) return { ok: false, error: "Session not found" };
    if ((source.ownerId || null) !== (ownerId || null) || (target.ownerId || null) !== (ownerId || null) ||
        (worker.ownerId || null) !== (ownerId || null)) return { ok: false, error: "Split pair owner changed" };
    if (membershipGroup(target.localId)) return { ok: false, error: "The successor already belongs to a split group" };
    var sourceIndex = group.members.indexOf(source.localId);
    if (sourceIndex === -1 || group.members.indexOf(worker.localId) === -1) return { ok: false, error: "Split group members changed" };
    var before = {
      members: group.members.slice(),
      memberCliIds: Array.isArray(group.memberCliIds) ? group.memberCliIds.slice() : null,
      memberOriginIds: Array.isArray(group.memberOriginIds) ? group.memberOriginIds.slice() : null,
      pair: Object.assign({}, group.pair),
      pairCliIds: Array.isArray(group.pairCliIds) ? group.pairCliIds.slice() : null,
      pairOriginIds: Array.isArray(group.pairOriginIds) ? group.pairOriginIds.slice() : null,
    };
    var runtimeMembers = group.members.slice();
    runtimeMembers[sourceIndex] = target.localId;
    var runtimeGroup = Object.assign({}, group, { members: runtimeMembers,
      pair: { driverId: target.localId, workerId: worker.localId } });
    var transaction = { group: group, before: before, source: source, target: target, worker: worker,
      runtimeGroup: runtimeGroup,
      ownerId: ownerId || null, sourceOriginId: source.sessionOriginId || null,
      targetOriginId: target.sessionOriginId || null, workerOriginId: worker.sessionOriginId || null,
      workerCliSessionId: worker.cliSessionId || null, staged: true, committed: false };
    stagedTransfers.push(transaction);
    return { ok: true, group: runtimeGroup, transaction: transaction };
  }
  function removeStaged(transaction) {
    var index = stagedTransfers.indexOf(transaction);
    if (index !== -1) stagedTransfers.splice(index, 1);
  }
  function restoreTransfer(transaction) {
    var group = transaction.group;
    group.members = transaction.before.members.slice();
    group.pair = Object.assign({}, transaction.before.pair);
    if (transaction.before.memberCliIds) group.memberCliIds = transaction.before.memberCliIds.slice();
    else delete group.memberCliIds;
    if (transaction.before.memberOriginIds) group.memberOriginIds = transaction.before.memberOriginIds.slice();
    else delete group.memberOriginIds;
    if (transaction.before.pairCliIds) group.pairCliIds = transaction.before.pairCliIds.slice();
    else delete group.pairCliIds;
    if (transaction.before.pairOriginIds) group.pairOriginIds = transaction.before.pairOriginIds.slice();
    else delete group.pairOriginIds;
  }
  function stagedTransfer(transaction) {
    return transaction && transaction.staged && !transaction.committed &&
      stagedTransfers.indexOf(transaction) !== -1 && groups.indexOf(transaction.group) !== -1 &&
      transaction.runtimeGroup.pair && transaction.runtimeGroup.pair.driverId === transaction.target.localId &&
      transaction.runtimeGroup.pair.workerId === transaction.worker.localId &&
      transaction.runtimeGroup.members.length === 2 && transaction.runtimeGroup.members.indexOf(transaction.target.localId) !== -1 &&
      transaction.runtimeGroup.members.indexOf(transaction.worker.localId) !== -1;
  }
  function exactTransfer(transaction) {
    return stagedTransfer(transaction) &&
      sessions.get(transaction.source.localId) === transaction.source &&
      sessions.get(transaction.target.localId) === transaction.target &&
      sessions.get(transaction.worker.localId) === transaction.worker &&
      (transaction.group.ownerId || null) === transaction.ownerId &&
      (transaction.source.ownerId || null) === transaction.ownerId &&
      (transaction.target.ownerId || null) === transaction.ownerId &&
      (transaction.worker.ownerId || null) === transaction.ownerId &&
      (transaction.source.sessionOriginId || null) === transaction.sourceOriginId &&
      (transaction.target.sessionOriginId || null) === transaction.targetOriginId &&
      (transaction.worker.sessionOriginId || null) === transaction.workerOriginId &&
      (transaction.worker.cliSessionId || null) === transaction.workerCliSessionId &&
      transaction.group.pair && transaction.group.pair.driverId === transaction.source.localId &&
      transaction.group.pair.workerId === transaction.worker.localId &&
      transaction.group.members.length === 2 && transaction.group.members.indexOf(transaction.source.localId) !== -1 &&
      transaction.group.members.indexOf(transaction.worker.localId) !== -1 &&
      groupCountForMember(transaction.target.localId) === 0 && groupCountForMember(transaction.worker.localId) === 1 &&
      groupCountForMember(transaction.source.localId) === 1;
  }
  function commitOwnedDriverTransfer(transaction) {
    if (!exactTransfer(transaction)) {
      removeStaged(transaction);
      transaction.staged = false;
      return { ok: false, error: "The staged Driver transfer is no longer exact" };
    }
    if (!transaction.target.cliSessionId ||
        (!transaction.worker.cliSessionId && !transaction.worker.sessionOriginId)) {
      return { ok: false, error: "The transferred pair does not have durable session anchors" };
    }
    transaction.group.members = transaction.runtimeGroup.members.slice();
    transaction.group.pair = Object.assign({}, transaction.runtimeGroup.pair);
    try { save(); }
    catch (error) {
      restoreTransfer(transaction);
      removeStaged(transaction);
      transaction.staged = false;
      return { ok: false, error: error.message || String(error) };
    }
    removeStaged(transaction);
    transaction.committed = true;
    broadcast();
    onPairChanged(transaction.group);
    return { ok: true, group: transaction.group };
  }
  function rollbackOwnedDriverTransfer(transaction) {
    if (stagedTransfer(transaction)) {
      removeStaged(transaction);
      transaction.staged = false;
      return { ok: true, group: transaction.group };
    }
    if (!transaction || !transaction.committed || groups.indexOf(transaction.group) === -1 ||
        transaction.group.pair.driverId !== transaction.target.localId ||
        transaction.group.pair.workerId !== transaction.worker.localId) {
      return { ok: false, error: "The staged Driver transfer is no longer exact" };
    }
    var wasCommitted = transaction.committed;
    var committedState = {
      members: transaction.group.members.slice(),
      memberCliIds: Array.isArray(transaction.group.memberCliIds) ? transaction.group.memberCliIds.slice() : null,
      memberOriginIds: Array.isArray(transaction.group.memberOriginIds) ? transaction.group.memberOriginIds.slice() : null,
      pair: Object.assign({}, transaction.group.pair),
      pairCliIds: Array.isArray(transaction.group.pairCliIds) ? transaction.group.pairCliIds.slice() : null,
      pairOriginIds: Array.isArray(transaction.group.pairOriginIds) ? transaction.group.pairOriginIds.slice() : null,
    };
    restoreTransfer(transaction);
    if (wasCommitted) {
      try { save(); }
      catch (error) {
        transaction.group.members = committedState.members;
        transaction.group.pair = committedState.pair;
        if (committedState.memberCliIds) transaction.group.memberCliIds = committedState.memberCliIds;
        else delete transaction.group.memberCliIds;
        if (committedState.memberOriginIds) transaction.group.memberOriginIds = committedState.memberOriginIds;
        else delete transaction.group.memberOriginIds;
        if (committedState.pairCliIds) transaction.group.pairCliIds = committedState.pairCliIds;
        else delete transaction.group.pairCliIds;
        if (committedState.pairOriginIds) transaction.group.pairOriginIds = committedState.pairOriginIds;
        else delete transaction.group.pairOriginIds;
        return { ok: false, error: error.message || String(error) };
      }
      broadcast();
      onPairChanged(transaction.group);
    }
    transaction.staged = false;
    transaction.committed = false;
    return { ok: true, group: transaction.group };
  }
  function rename(ws, msg) {
    var group = groups.find(function (item) { return item.id === (msg && msg.id); });
    if (!group) return { ok: false, error: "Split group not found" };
    if (!canOwn(ws, group)) return { ok: false, error: "Only the group owner can rename it" };
    var name = typeof msg.name === "string" ? msg.name.trim().slice(0, 80) : "";
    if (!name) return { ok: false, error: "Group name is required" };
    group.name = name;
    group.nameCustomized = true;
    save();
    broadcast();
    return { ok: true, group: group };
  }

  // Assign or clear Driver/Worker roles on an existing group. driverId null
  // clears the pair (back to ad-hoc: both members get the partner tools).
  // Role changes apply to tool mounting on the next query start; the runtime
  // guard in project-session-pair enforces them immediately for live queries.
  function setPair(ws, msg) {
    var group = groups.find(function (item) { return item.id === (msg && msg.id); });
    if (!group) return { ok: false, error: "Split group not found" };
    if (!canOwn(ws, group)) return { ok: false, error: "Only the group owner can change pair roles" };
    if (msg.driverId == null) {
      delete group.pair;
      delete group.pairCliIds;
      delete group.pairOriginIds;
      save();
      broadcast();
      onPairChanged(group);
      return { ok: true, group: group };
    }
    if (!Number.isInteger(msg.driverId) || group.members.indexOf(msg.driverId) === -1) {
      return { ok: false, error: "Driver must be a member of the split group" };
    }
    var workerId = group.members[0] === msg.driverId ? group.members[1] : group.members[0];
    var roleCheck = splitRoles.validateStorePair({ driverId: msg.driverId, workerId: workerId }, group.members);
    if (!roleCheck.ok) return { ok: false, error: roleCheck.error };
    group.pair = { driverId: msg.driverId, workerId: workerId };
    save();
    broadcast();
    onPairChanged(group);
    return { ok: true, group: group };
  }

  function dissolve(ws, msg, hooks) {
    var index = groups.findIndex(function (item) { return item.id === (msg && msg.id); });
    if (index === -1) return { ok: false, error: "Split group not found" };
    if (!canOwn(ws, groups[index])) return { ok: false, error: "Only the group owner can separate it" };
    var removed = groups.splice(index, 1)[0];
    try { save(); }
    catch (error) { groups.splice(index, 0, removed); return { ok: false, error: error.message || String(error) }; }
    if (hooks && typeof hooks.afterPersist === "function") {
      groups.splice(index, 0, removed);
      var accepted;
      try { accepted = hooks.afterPersist(); }
      catch (error) { accepted = { ok: false, error: error.message || String(error) }; }
      if (!accepted || accepted.ok === false) {
        try { save(); }
        catch (rollbackError) {
          return { ok: false, error: (accepted && accepted.error || "close transaction rejected") +
            "; persistence rollback failed: " + (rollbackError.message || String(rollbackError)) };
        }
        return { ok: false, error: accepted && accepted.error || "close transaction rejected" };
      }
      groups.splice(index, 1);
    }
    broadcast();
    return { ok: true, group: removed };
  }

  function dissolveBySession(localId) {
    var index = groups.findIndex(function (group) { return group.members.indexOf(localId) !== -1; });
    if (index === -1) return false;
    var group = groups[index];
    var normalized = splitRoles.normalizePair(group.pair, group.members);
    var beforeMembers = group.members.slice();
    var beforePair = group.pair && Object.assign({}, group.pair);
    if (beforePair && Array.isArray(beforePair.workerIds)) beforePair.workerIds = beforePair.workerIds.slice();
    var removed = null;
    if (normalized.ok && normalized.kind === "versioned" && normalized.driverId !== localId &&
        normalized.workerIds.length > 1) {
      var remaining = normalized.workerIds.filter(function (id) { return id !== localId; });
      group.members = [normalized.driverId].concat(remaining);
      group.pair = { version: 2, driverId: normalized.driverId, workerIds: remaining };
    } else {
      removed = groups.splice(index, 1)[0];
    }
    try { save(); }
    catch (error) {
      if (removed) groups.splice(index, 0, removed);
      else { group.members = beforeMembers; group.pair = beforePair; }
      return false;
    }
    broadcast();
    onPairChanged(group);
    return true;
  }

  function refreshAnchors(localId) {
    var group = groupForMember(localId);
    if (!group) return false;
    var fresh = durableAnchors.memberAnchors(group, sessions);
    if (fresh && fresh.version === 2) {
      if (JSON.stringify(fresh) === JSON.stringify(group.memberAnchors || null)) return false;
      save();
      return true;
    }
    var prevCli = Array.isArray(group.memberCliIds) ? group.memberCliIds : [null, null];
    var prevOrigin = Array.isArray(group.memberOriginIds) ? group.memberOriginIds : [null, null];
    if (fresh.cli[0] === prevCli[0] && fresh.cli[1] === prevCli[1] &&
        fresh.origin[0] === prevOrigin[0] && fresh.origin[1] === prevOrigin[1]) return false;
    save();
    return true;
  }

  function refreshAutoName(localId) {
    var group = groupForMember(localId);
    if (!group) return false;
    if (group.nameCustomized) {
      // Auto-title fires on a member's first message, which is also when a
      // blank member gains its cliSessionId. Re-save so the durable anchor
      // is captured even when the name itself stays untouched.
      refreshAnchors(localId);
      return false;
    }
    group.name = autoGroupName(sessions.get(group.members[0]).title, sessions.get(group.members[1]).title);
    save();
    broadcast();
    return true;
  }

  function removeVersionedGroup(group, hooks) {
    var index = groups.indexOf(group);
    if (index === -1) return { ok: false, error: "Split group not found" };
    groups.splice(index, 1);
    try { save(); }
    catch (error) {
      groups.splice(index, 0, group);
      return { ok: false, error: error.message || String(error) };
    }
    if (hooks && typeof hooks.afterPersist === "function") {
      groups.splice(index, 0, group);
      var accepted;
      try { accepted = hooks.afterPersist(); }
      catch (error) { accepted = { ok: false, error: error.message || String(error) }; }
      if (!accepted || accepted.ok === false) {
        try { save(); }
        catch (rollbackError) {
          return { ok: false, error: (accepted && accepted.error || "close transaction rejected") +
            "; persistence rollback failed: " + (rollbackError.message || String(rollbackError)) };
        }
        return { ok: false, error: accepted && accepted.error || "close transaction rejected" };
      }
      groups.splice(index, 1);
    }
    broadcast();
    onPairChanged(group);
    return { ok: true, group: group };
  }
  function versionedChanged(group) {
    broadcast();
    onPairChanged(group);
  }
  var versionedMutations = versionedStore.attachVersionedMutations({
    sessions: sessions,
    enabled: versionedEnabled,
    groups: function () { return groups; },
    membershipGroup: membershipGroup,
    save: save,
    remove: removeVersionedGroup,
    changed: versionedChanged,
  });
  groups = persistence.load();
  return { create: create, createOwned: createOwned, dissolveOwned: dissolveOwned,
    beginOwnedDriverTransfer: beginOwnedDriverTransfer, commitOwnedDriverTransfer: commitOwnedDriverTransfer,
    rollbackOwnedDriverTransfer: rollbackOwnedDriverTransfer,
    rename: rename, setPair: setPair, dissolve: dissolve, dissolveBySession: dissolveBySession,
    addWorker: versionedMutations.addWorker, replaceWorker: versionedMutations.replaceWorker,
    removeWorker: versionedMutations.removeWorker,
    refreshAutoName: refreshAutoName, refreshAnchors: refreshAnchors,
    listFor: listFor, groupForMember: groupForMember, get groups() { return groups; } };
}

function attachSplitGroups(ctx) {
  var store = createSplitGroupStore({
    sessions: ctx.sm.sessions,
    sessionsDir: ctx.sm.sessionsDir,
    usersModule: ctx.usersModule,
    broadcast: broadcast,
    onPairChanged: ctx.onPairChanged,
    multiWorkerFeature: ctx.multiWorkerFeature,
  });

  function sendState(ws) {
    if (!ws) return;
    ctx.sendTo(ws, { type: "split_groups", groups: store.listFor(ws) });
  }

  function broadcast() {
    for (var ws of ctx.clients) {
      if (ws.readyState === 1) sendState(ws);
    }
  }

  function handleMessage(ws, msg) {
    var action = null;
    var result = null;
    if (msg.type === "split_group_create") { action = "create"; result = store.create(ws, msg); }
    else if (msg.type === "split_group_rename") { action = "rename"; result = store.rename(ws, msg); }
    else if (msg.type === "split_group_dissolve") { action = "dissolve"; result = store.dissolve(ws, msg); }
    else if (msg.type === "split_group_set_pair") { action = "set_pair"; result = store.setPair(ws, msg); }
    else return false;
    ctx.sendTo(ws, { type: "split_group_result", action: action, ok: result.ok, error: result.error || null, group: result.group || null });
    return true;
  }

  ctx.sm.setOnSessionDeleted(store.dissolveBySession);
  ctx.sm.setOnSessionRenamed(store.refreshAutoName);
  ctx.sm.setOnSessionIdentityAssigned(store.refreshAnchors);
  return { handleMessage: handleMessage, sendConnectionState: sendState, store: store };
}

module.exports = { attachSplitGroups: attachSplitGroups, createSplitGroupStore: createSplitGroupStore, autoGroupName: autoGroupName };
