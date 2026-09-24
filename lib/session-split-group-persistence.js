var fs = require("fs");
var path = require("path");
var anchors = require("./session-split-group-anchors");
var roles = require("./session-split-group-roles");
var recovery = require("./session-split-group-recovery");

var ANCHOR_KEYS = ["memberCliIds", "memberOriginIds", "pairCliIds", "pairOriginIds", "memberAnchors", "pairAnchors"];

function attachPersistence(opts) {
  var sessions = opts.sessions;
  var groupsFile = path.join(opts.sessionsDir, "split-groups.json");
  var preserved = [];
  var loadRewriteError = null;

  function anchorPair(group) {
    if (!group.pair) return;
    var pair = anchors.pairAnchors(group, sessions);
    if (!pair) return;
    if (pair.version === 2) {
      group.pairAnchors = pair;
      delete group.pairCliIds; delete group.pairOriginIds;
    } else {
      group.pairCliIds = pair.cli; group.pairOriginIds = pair.origin;
    }
  }

  function anchoredClone(group) {
    var clone = Object.assign({}, group, { members: group.members.slice(),
      pair: group.pair ? Object.assign({}, group.pair) : undefined });
    if (clone.pair && Array.isArray(clone.pair.workerIds)) clone.pair.workerIds = clone.pair.workerIds.slice();
    var member = anchors.memberAnchors(clone, sessions);
    if (!member) throw new Error("Split group does not have durable session anchors");
    if (member.version === 2) {
      clone.memberAnchors = member;
      delete clone.memberCliIds; delete clone.memberOriginIds;
    } else {
      clone.memberCliIds = member.cli; clone.memberOriginIds = member.origin;
    }
    anchorPair(clone);
    return clone;
  }

  function save(groups) {
    var saved = groups.map(anchoredClone);
    var serialized = JSON.stringify(saved.concat(preserved), null, 2) + "\n";
    if (typeof opts.persistGroups === "function") {
      if (opts.persistGroups(groupsFile, serialized) === false) throw new Error("Split group persistence returned false");
    } else {
      var tmp = groupsFile + ".tmp." + process.pid;
      fs.mkdirSync(opts.sessionsDir, { recursive: true });
      fs.writeFileSync(tmp, serialized);
      if (process.platform !== "win32") try { fs.chmodSync(tmp, 0o600); } catch (e) {}
      fs.renameSync(tmp, groupsFile);
    }
    for (var i = 0; i < groups.length; i++) {
      (function (live, stored) {
        ANCHOR_KEYS.forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(stored, key)) live[key] = stored[key];
          else delete live[key];
        });
      })(groups[i], saved[i]);
    }
  }

  function resolveVersioned(group, normalized) {
    if (typeof group.id !== "string" || !group.id) return false;
    var members = anchors.resolveVersionedMembers(sessions, group.memberAnchors);
    var pair = anchors.resolveVersionedPair(sessions, group.pairAnchors);
    if (!members || !pair) return false;
    var memberIds = members.map(function (session) { return session.localId; });
    var workerIds = pair.workers.map(function (session) { return session.localId; });
    if (memberIds.length !== group.members.length || workerIds.length !== normalized.workerIds.length) return false;
    var nextPair = { version: 2, driverId: pair.driver.localId, workerIds: workerIds };
    var nextRoles = roles.normalizePair(nextPair, memberIds);
    if (!nextRoles.ok || nextRoles.kind !== "versioned") return false;
    var changed = group.members.join(",") !== memberIds.join(",") ||
      group.pair.driverId !== pair.driver.localId || group.pair.workerIds.join(",") !== workerIds.join(",");
    group.members = memberIds;
    group.pair = nextPair;
    return { changed: changed };
  }

  function resolveLegacy(group) {
    var changed = false;
    if (Array.isArray(group.memberCliIds) || Array.isArray(group.memberOriginIds)) {
      var cli = Array.isArray(group.memberCliIds) ? group.memberCliIds : [null, null];
      var origin = Array.isArray(group.memberOriginIds) ? group.memberOriginIds : [null, null];
      var left = anchors.findSession(sessions, cli[0], origin[0]);
      var right = anchors.findSession(sessions, cli[1], origin[1]);
      if (!left || !right || left === right) return false;
      if (group.members[0] !== left.localId || group.members[1] !== right.localId) {
        group.members = [left.localId, right.localId]; changed = true;
      }
    }
    if (group.pair && (Array.isArray(group.pairCliIds) || Array.isArray(group.pairOriginIds))) {
      var pairCli = Array.isArray(group.pairCliIds) ? group.pairCliIds : [null, null];
      var pairOrigin = Array.isArray(group.pairOriginIds) ? group.pairOriginIds : [null, null];
      var driver = anchors.findSession(sessions, pairCli[0], pairOrigin[0]);
      var worker = anchors.findSession(sessions, pairCli[1], pairOrigin[1]);
      if (driver && worker && (group.pair.driverId !== driver.localId || group.pair.workerId !== worker.localId)) {
        group.pair.driverId = driver.localId; group.pair.workerId = worker.localId; changed = true;
      }
    }
    return roles.validateStoredGroup(group, sessions) ? { changed: changed } : false;
  }

  function load() {
    var loaded = [], rewrite = false, claimed = {};
    preserved = [];
    try { loaded = JSON.parse(fs.readFileSync(groupsFile, "utf8")); if (!Array.isArray(loaded)) loaded = []; }
    catch (error) { if (error.code !== "ENOENT") rewrite = true; }
    var groups = loaded.filter(function (group) {
      var normalized = group && roles.normalizePair(group.pair, group.members);
      if (!normalized || !normalized.ok) {
        if (group && roles.isUnsupportedPair(group.pair)) preserved.push(group);
        return false;
      }
      var versioned = !!(normalized && normalized.ok && normalized.kind === "versioned");
      if (versioned && !opts.versionedEnabled) { preserved.push(group); return false; }
      var resolved = versioned ? resolveVersioned(group, normalized) : resolveLegacy(group);
      if (!resolved && versioned) {
        resolved = recovery.repairDeletedMembers(group, normalized, sessions, {
          loadUncertain: typeof opts.sessionLoadUncertain === "function" && opts.sessionLoadUncertain() === true,
        });
      }
      if (resolved && resolved.drop) return false;
      if (!resolved) {
        if (versioned || group && roles.isUnsupportedPair(group.pair)) preserved.push(group);
        return false;
      }
      if (resolved.changed) rewrite = true;
      for (var i = 0; i < group.members.length; i++) if (claimed[group.members[i]]) return false;
      for (var j = 0; j < group.members.length; j++) claimed[group.members[j]] = true;
      return true;
    });
    if (groups.length + preserved.length !== loaded.length) rewrite = true;
    loadRewriteError = null;
    // A storage outage must not discard groups that resolved or were
    // repaired in memory; the store retries the rewrite.
    if (rewrite) {
      try { save(groups); } catch (error) { loadRewriteError = error; }
    }
    return groups;
  }

  return { load: load, save: save, loadRewriteError: function () { return loadRewriteError; } };
}

module.exports = { attachPersistence: attachPersistence };
