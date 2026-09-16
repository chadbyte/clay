/**
 * Daemon project helpers -- Worktree tracking, project filtering, config handlers.
 *
 * Extracted from daemon.js to keep module sizes manageable.
 */

var fs = require("fs");
var { scanWorktreesResult, isWorktree } = require("./worktree");
var { daemonSync } = require("./daemon-sync");
var logContext = require("./project-log-context");
var daemonProjectAccess = require("./daemon-project-access");
var saveConfig = require("./config").saveConfig;

// --- Worktree tracking state ---
var worktreeRegistry = {}; // parentSlug -> [wtSlug, ...]
var worktreeScanning = {}; // parentSlug -> boolean (mutex)

function getWorktreeSyncKey(parentSlug) {
  return "worktrees:" + parentSlug;
}

function isWorktreeSlug(slug) {
  return slug.indexOf("--") !== -1;
}

/**
 * Scan a parent project for worktrees and register them with the relay server.
 * @param {object} relay - the relay server instance (has addProject, removeProject, etc.)
 * @param {string} parentPath - absolute path to parent project
 * @param {string} parentSlug - slug of parent project
 * @param {string} parentIcon - icon of parent project
 * @param {string} parentOwnerId - owner user ID
 */
function scanAndRegisterWorktrees(relay, parentPath, parentSlug, parentIcon, parentOwnerId, projectKnowledgeId, osUserInfo, config) {
  if (isWorktree(parentPath, osUserInfo)) return;
  var scan = scanWorktreesResult(parentPath, osUserInfo);
  if (!scan.ok) return;
  var worktrees = scan.worktrees;
  var currentSlugs = worktrees.map(function (worktree) { return parentSlug + "--" + worktree.dirName; });
  if (config && daemonProjectAccess.reconcileWorktreeGrants(config, parentSlug, currentSlugs)) saveConfig(config);
  if (worktrees.length === 0) return;
  if (!worktreeRegistry[parentSlug]) worktreeRegistry[parentSlug] = [];
  for (var i = 0; i < worktrees.length; i++) {
    var wt = worktrees[i];
    var wtSlug = parentSlug + "--" + wt.dirName;
    var alreadyRegistered = false;
    for (var j = 0; j < worktreeRegistry[parentSlug].length; j++) {
      if (worktreeRegistry[parentSlug][j] === wtSlug) { alreadyRegistered = true; break; }
    }
    if (alreadyRegistered) continue;
    var context = logContext.resolveWorktreeContext(wt.path, projectKnowledgeId, { branch: wt.branch || wt.dirName }, osUserInfo);
    var wtMeta = Object.assign({ parentSlug: parentSlug, external: wt.external, projectKnowledgeId: projectKnowledgeId }, context);
    relay.addProject(wt.path, wtSlug, wt.branch || wt.dirName, parentIcon, parentOwnerId, wtMeta);
    worktreeRegistry[parentSlug].push(wtSlug);
    console.log("[daemon] Registered worktree:", wtSlug, "->", wt.path, wt.external ? "(external)" : "(inside project folder)");
  }
  daemonSync.register(getWorktreeSyncKey(parentSlug), function () {
    rescanWorktrees(relay, parentPath, parentSlug, parentIcon, parentOwnerId, config, projectKnowledgeId, osUserInfo);
  });
}

/**
 * Rescan worktrees for a parent project, adding new and removing stale ones.
 * @param {object} relay - the relay server instance
 * @param {string} parentPath - absolute path to parent project
 * @param {string} parentSlug - slug of parent project
 * @param {string} parentIcon - icon of parent project
 * @param {string} parentOwnerId - owner user ID
 * @param {object} [config] - daemon config (optional, for broadcasting project count)
 */
function rescanWorktrees(relay, parentPath, parentSlug, parentIcon, parentOwnerId, config, projectKnowledgeId, osUserInfo) {
  if (worktreeScanning[parentSlug]) return;
  worktreeScanning[parentSlug] = true;
  try {
    var scan = scanWorktreesResult(parentPath, osUserInfo);
    if (!scan.ok) return;
    var discovered = scan.worktrees;
    var changed = false;
    var discoveredSlugs = discovered.map(function (worktree) { return parentSlug + "--" + worktree.dirName; });
    if (config && daemonProjectAccess.reconcileWorktreeGrants(config, parentSlug, discoveredSlugs)) {
      saveConfig(config);
      changed = true;
    }
    var existingSlugs = worktreeRegistry[parentSlug] || [];
    var discoveredNames = {};
    for (var i = 0; i < discovered.length; i++) {
      discoveredNames[discovered[i].dirName] = discovered[i];
    }
    for (var di = 0; di < discovered.length; di++) {
      var wt = discovered[di];
      var wtSlug = parentSlug + "--" + wt.dirName;
      var found = false;
      for (var ei = 0; ei < existingSlugs.length; ei++) {
        if (existingSlugs[ei] === wtSlug) { found = true; break; }
      }
      if (!found) {
        var context = logContext.resolveWorktreeContext(wt.path, projectKnowledgeId, { branch: wt.branch || wt.dirName }, osUserInfo);
        var wtMeta = Object.assign({ parentSlug: parentSlug, external: wt.external, projectKnowledgeId: projectKnowledgeId }, context);
        relay.addProject(wt.path, wtSlug, wt.branch || wt.dirName, parentIcon, parentOwnerId, wtMeta);
        if (!worktreeRegistry[parentSlug]) worktreeRegistry[parentSlug] = [];
        worktreeRegistry[parentSlug].push(wtSlug);
        console.log("[daemon] Rescan: added worktree:", wtSlug);
        changed = true;
      }
    }
    for (var si = existingSlugs.length - 1; si >= 0; si--) {
      var sSlug = existingSlugs[si];
      var dirName = sSlug.split("--").slice(1).join("--");
      if (!discoveredNames[dirName]) {
        if (relay.setProjectLogContextState) relay.setProjectLogContextState(sSlug, "archived");
        relay.removeProject(sSlug);
        if (config && daemonProjectAccess.clearWorktreeGrant(config, sSlug)) saveConfig(config);
        existingSlugs.splice(si, 1);
        console.log("[daemon] Rescan: removed stale worktree:", sSlug);
        changed = true;
      }
    }
    if (changed) {
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config ? config.projects.length : 0,
      });
    }
  } finally {
    worktreeScanning[parentSlug] = false;
  }
}

function cleanupWorktreesForParent(relay, parentSlug) {
  var wtSlugs = worktreeRegistry[parentSlug] || [];
  for (var i = 0; i < wtSlugs.length; i++) {
    if (relay.setProjectLogContextState) relay.setProjectLogContextState(wtSlugs[i], "archived");
    relay.removeProject(wtSlugs[i]);
    console.log("[daemon] Cascade removed worktree:", wtSlugs[i]);
  }
  delete worktreeRegistry[parentSlug];
  daemonSync.unregister(getWorktreeSyncKey(parentSlug));
}

/**
 * Filter removed projects by userId and existence.
 * @param {object} config - daemon config with removedProjects array
 * @param {string|null} userId - user ID to filter by (null for single-user mode)
 */
function getFilteredRemovedProjects(config, userId) {
  if (!config.removedProjects || config.removedProjects.length === 0) return [];
  return config.removedProjects.filter(function (rp) {
    if (userId && rp.userId && rp.userId !== userId) return false;
    if (!userId && rp.userId) return false;
    return fs.existsSync(rp.path);
  });
}

/**
 * Register a worktree slug under a parent slug.
 * Used by daemon.js when creating worktrees directly.
 */
function registerWorktreeSlug(parentSlug, wtSlug) {
  if (!worktreeRegistry[parentSlug]) worktreeRegistry[parentSlug] = [];
  worktreeRegistry[parentSlug].push(wtSlug);
}

/**
 * Unregister a worktree slug from its parent.
 * Used by daemon.js when removing worktree projects directly.
 */
function unregisterWorktreeSlug(parentSlug, wtSlug) {
  if (worktreeRegistry[parentSlug]) {
    worktreeRegistry[parentSlug] = worktreeRegistry[parentSlug].filter(function (s) { return s !== wtSlug; });
  }
}

module.exports = {
  isWorktreeSlug: isWorktreeSlug,
  scanAndRegisterWorktrees: scanAndRegisterWorktrees,
  rescanWorktrees: rescanWorktrees,
  cleanupWorktreesForParent: cleanupWorktreesForParent,
  getFilteredRemovedProjects: getFilteredRemovedProjects,
  registerWorktreeSlug: registerWorktreeSlug,
  unregisterWorktreeSlug: unregisterWorktreeSlug,
};
