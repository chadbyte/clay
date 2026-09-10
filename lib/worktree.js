var fs = require("fs");
var path = require("path");
var { runGitSync } = require("./git-cli");

// Parse `git worktree list --porcelain` output into structured objects
function parseWorktreeOutput(output) {
  var worktrees = [];
  var current = null;
  var lines = output.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf("worktree ") === 0) {
      if (current) worktrees.push(current);
      current = { path: line.slice(9), branch: null, bare: false, detached: false };
    } else if (line.indexOf("branch ") === 0 && current) {
      // refs/heads/feat/login -> feat/login
      var ref = line.slice(7);
      var headsIdx = ref.indexOf("refs/heads/");
      current.branch = headsIdx === 0 ? ref.slice(11) : ref;
    } else if (line === "bare" && current) {
      current.bare = true;
    } else if (line === "detached" && current) {
      current.detached = true;
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

// Check if a given path is itself a worktree (not the main working tree)
function isWorktree(projectPath, osUserInfo) {
  try {
    var gitDir = runGitSync(projectPath, ["rev-parse", "--git-dir"], null, osUserInfo).trim();
    var commonDir = runGitSync(projectPath, ["rev-parse", "--git-common-dir"], null, osUserInfo).trim();
    var absGit = path.resolve(projectPath, gitDir);
    var absCommon = path.resolve(projectPath, commonDir);
    return absGit !== absCommon;
  } catch (e) {
    return false;
  }
}

function isPathInside(parentPath, candidatePath) {
  var relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative !== "" && relative !== ".." && relative.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(relative);
}

function worktreePath(projectPath, dirName) {
  if (typeof dirName !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(dirName)) return null;
  var resolvedParent = path.resolve(projectPath);
  var resolvedWorktree = path.resolve(resolvedParent, dirName);
  return isPathInside(resolvedParent, resolvedWorktree) ? resolvedWorktree : null;
}

// Scan worktrees for a given project path
// Returns array of { path, branch, bare, detached, external }
// external = true when Git registered the worktree outside the main project folder
function scanWorktreesResult(projectPath, osUserInfo) {
  var resolvedParent = path.resolve(projectPath);
  try { resolvedParent = fs.realpathSync(resolvedParent); } catch (e) {}
  try {
    var output = runGitSync(resolvedParent, ["worktree", "list", "--porcelain"], null, osUserInfo);
    var all = parseWorktreeOutput(output);
    // Filter out bare worktrees and the main worktree itself
    var results = [];
    for (var i = 0; i < all.length; i++) {
      var wt = all[i];
      if (wt.bare) continue;
      var resolvedWt = path.resolve(wt.path);
      // Git retains removed worktrees until `git worktree prune` runs. Do not
      // register those stale paths as Clay projects.
      if (!fs.existsSync(resolvedWt)) continue;
      try { resolvedWt = fs.realpathSync(resolvedWt); } catch (e) {}
      if (resolvedWt === resolvedParent) continue;
      wt.external = !isPathInside(resolvedParent, resolvedWt);
      wt.dirName = path.basename(wt.path);
      results.push(wt);
    }
    return { ok: true, worktrees: results };
  } catch (e) {
    return { ok: false, worktrees: [], error: e.message || "Failed to scan worktrees" };
  }
}

function scanWorktrees(projectPath, osUserInfo) {
  return scanWorktreesResult(projectPath, osUserInfo).worktrees;
}

// Create a new worktree inside the parent project directory
// Returns { ok, path, error }
function createWorktree(projectPath, branchName, dirName, baseBranch, osUserInfo) {
  var resolvedParent = path.resolve(projectPath);
  var wtPath = worktreePath(resolvedParent, dirName || branchName);
  if (!wtPath) return { ok: false, error: "Invalid worktree directory name" };
  var base = baseBranch || "main";
  // Try creating with -b (new branch)
  try {
    runGitSync(resolvedParent, ["worktree", "add", wtPath, "-b", branchName, base], { timeout: 15000 }, osUserInfo);
    return { ok: true, path: wtPath };
  } catch (e) {
    // Branch may already exist, try without -b
    try {
      runGitSync(resolvedParent, ["worktree", "add", wtPath, branchName], { timeout: 15000 }, osUserInfo);
      return { ok: true, path: wtPath };
    } catch (e2) {
      return { ok: false, error: e2.message || "Failed to create worktree" };
    }
  }
}

// Remove a worktree
// Returns { ok, error }
function removeWorktree(projectPath, worktreeDirName, osUserInfo) {
  var resolvedParent = path.resolve(projectPath);
  var wtPath = worktreePath(resolvedParent, worktreeDirName);
  if (!wtPath) return { ok: false, error: "Invalid worktree directory name" };
  // Try normal remove first
  try {
    runGitSync(resolvedParent, ["worktree", "remove", wtPath], { timeout: 15000 }, osUserInfo);
    return { ok: true };
  } catch (e) {
    var errMsg = (e.stderr || e.message || "").toString();
    // If dirty, report to user
    if (errMsg.indexOf("modified") !== -1 || errMsg.indexOf("untracked") !== -1) {
      return { ok: false, error: "Worktree has uncommitted changes. Commit or discard them first." };
    }
    if (errMsg.indexOf("locked") !== -1) {
      return { ok: false, error: "Worktree is locked. Unlock it first with: git worktree unlock" };
    }
    return { ok: false, error: errMsg || "Failed to remove worktree" };
  }
}

module.exports = { scanWorktrees: scanWorktrees, scanWorktreesResult: scanWorktreesResult, createWorktree: createWorktree, removeWorktree: removeWorktree, isWorktree: isWorktree, isPathInside: isPathInside };
