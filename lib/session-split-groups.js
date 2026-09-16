var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function truncateTitle(title) {
  var value = String(title || "New Session");
  return value.length > 20 ? value.slice(0, 19) + "…" : value;
}

function autoGroupName(leftTitle, rightTitle) {
  return truncateTitle(leftTitle) + " | " + truncateTitle(rightTitle);
}

function createSplitGroupStore(opts) {
  var sessions = opts.sessions;
  var groupsFile = path.join(opts.sessionsDir, "split-groups.json");
  var usersModule = opts.usersModule;
  var broadcast = opts.broadcast || function () {};
  var onPairChanged = opts.onPairChanged || function () {};
  var groups = [];

  // localIds are reassigned on every daemon restart (loadSessions renumbers
  // by createdAt), so persisted member localIds go stale as soon as the
  // session set changes. cliSessionIds are the durable anchor: keep them on
  // every record and remap members from them at load.
  function currentCliIds(group) {
    var left = sessions.get(group.members[0]);
    var right = sessions.get(group.members[1]);
    var prev = Array.isArray(group.memberCliIds) ? group.memberCliIds : [null, null];
    return [
      (left && left.cliSessionId) || prev[0] || null,
      (right && right.cliSessionId) || prev[1] || null,
    ];
  }

  function refreshPairAnchors(group) {
    if (!group.pair) return;
    var driver = sessions.get(group.pair.driverId);
    var worker = sessions.get(group.pair.workerId);
    group.pairCliIds = [
      (driver && driver.cliSessionId) || (group.pairCliIds && group.pairCliIds[0]) || null,
      (worker && worker.cliSessionId) || (group.pairCliIds && group.pairCliIds[1]) || null,
    ];
  }

  function sessionByCliId(cliId) {
    if (!cliId) return null;
    var found = null;
    sessions.forEach(function (s) {
      if (s.cliSessionId === cliId) found = s;
    });
    return found;
  }

  function save() {
    for (var gi = 0; gi < groups.length; gi++) {
      groups[gi].memberCliIds = currentCliIds(groups[gi]);
      refreshPairAnchors(groups[gi]);
    }
    var tmp = groupsFile + ".tmp." + process.pid;
    fs.mkdirSync(opts.sessionsDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(groups, null, 2) + "\n");
    if (process.platform !== "win32") {
      try { fs.chmodSync(tmp, 0o600); } catch (e) {}
    }
    fs.renameSync(tmp, groupsFile);
  }

  function validRecord(group) {
    return group && typeof group.id === "string" && Array.isArray(group.members) &&
      group.members.length === 2 && group.members[0] !== group.members[1] &&
      Number.isInteger(group.members[0]) && Number.isInteger(group.members[1]) &&
      sessions.has(group.members[0]) && sessions.has(group.members[1]);
  }

  function load() {
    var loaded = [];
    var shouldRewrite = false;
    try {
      loaded = JSON.parse(fs.readFileSync(groupsFile, "utf8"));
      if (!Array.isArray(loaded)) loaded = [];
    } catch (e) {
      if (e.code !== "ENOENT") shouldRewrite = true;
    }
    var claimed = {};
    groups = loaded.filter(function (group) {
      // Remap members from the durable cliSessionIds; the stored localIds
      // are only trusted for legacy records that predate memberCliIds.
      if (group && Array.isArray(group.memberCliIds)) {
        var left = sessionByCliId(group.memberCliIds[0]);
        var right = sessionByCliId(group.memberCliIds[1]);
        if (!left || !right || left === right) return false;
        if (group.members[0] !== left.localId || group.members[1] !== right.localId) {
          group.members = [left.localId, right.localId];
          shouldRewrite = true;
        }
      }
      if (group && group.pair && Array.isArray(group.pairCliIds)) {
        var driver = sessionByCliId(group.pairCliIds[0]);
        var worker = sessionByCliId(group.pairCliIds[1]);
        if (driver && worker) {
          group.pair.driverId = driver.localId;
          group.pair.workerId = worker.localId;
        }
      }
      if (group && group.pair) {
        var pairValid = Array.isArray(group.members) && group.pair.driverId !== group.pair.workerId &&
          group.members.indexOf(group.pair.driverId) !== -1 &&
          group.members.indexOf(group.pair.workerId) !== -1;
        if (!pairValid) return false;
      }
      if (!validRecord(group) || claimed[group.members[0]] || claimed[group.members[1]]) return false;
      claimed[group.members[0]] = true;
      claimed[group.members[1]] = true;
      return true;
    });
    if (groups.length !== loaded.length) shouldRewrite = true;
    if (shouldRewrite) save();
  }

  function isMultiUser() {
    return !!(usersModule && usersModule.isMultiUser && usersModule.isMultiUser());
  }

  function listFor(ws) {
    if (!isMultiUser()) return groups.slice();
    if (!ws || !ws._clayUser) return [];
    return groups.filter(function (group) { return group.ownerId === ws._clayUser.id; });
  }

  function groupForMember(localId) {
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].members.indexOf(localId) !== -1) return groups[i];
    }
    return null;
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
    if (groupForMember(members[0]) || groupForMember(members[1])) return { ok: false, error: "A session can belong to only one split group" };
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
    if (groupForMember(left.localId) || groupForMember(right.localId)) return { ok: false, error: "A session can belong to only one split group" };
    var pair = msg && msg.pair;
    if (!pair || pair.driverId !== left.localId || pair.workerId !== right.localId) return { ok: false, error: "Pair roles must reference both split group members" };
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
      save();
      broadcast();
      onPairChanged(group);
      return { ok: true, group: group };
    }
    if (!Number.isInteger(msg.driverId) || group.members.indexOf(msg.driverId) === -1) {
      return { ok: false, error: "Driver must be a member of the split group" };
    }
    var workerId = group.members[0] === msg.driverId ? group.members[1] : group.members[0];
    group.pair = { driverId: msg.driverId, workerId: workerId };
    save();
    broadcast();
    onPairChanged(group);
    return { ok: true, group: group };
  }

  function dissolve(ws, msg) {
    var index = groups.findIndex(function (item) { return item.id === (msg && msg.id); });
    if (index === -1) return { ok: false, error: "Split group not found" };
    if (!canOwn(ws, groups[index])) return { ok: false, error: "Only the group owner can separate it" };
    var removed = groups.splice(index, 1)[0];
    save();
    broadcast();
    return { ok: true, group: removed };
  }

  function dissolveBySession(localId) {
    var before = groups.length;
    groups = groups.filter(function (group) { return group.members.indexOf(localId) === -1; });
    if (groups.length === before) return false;
    save();
    broadcast();
    return true;
  }

  function refreshAnchors(localId) {
    var group = groupForMember(localId);
    if (!group) return false;
    var fresh = currentCliIds(group);
    var prev = Array.isArray(group.memberCliIds) ? group.memberCliIds : [null, null];
    if (fresh[0] === prev[0] && fresh[1] === prev[1]) return false;
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

  load();
  return { create: create, createOwned: createOwned, dissolveOwned: dissolveOwned, rename: rename, setPair: setPair, dissolve: dissolve, dissolveBySession: dissolveBySession,
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
  });

  function sendState(ws) {
    if (!ws) return;
    // Pane clients need the same owner-scoped pair roles as the parent shell.
    // The Worker composer lock resolves its role from this projection; hiding
    // the projection from panes leaves a configured Worker looking editable.
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

module.exports = { attachSplitGroups: attachSplitGroups, createSplitGroupStore: createSplitGroupStore,
  autoGroupName: autoGroupName };
