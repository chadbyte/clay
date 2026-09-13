// Git CLI integration for project status, safe common actions, and file diffs.

var fs = require("fs");
var path = require("path");
var { execFile, execFileSync } = require("child_process");
var { wrapSpawnAsUser } = require("./os-users");

var MAX_DIFF_BYTES = 2 * 1024 * 1024;
var MAX_REMOTE_LABEL = 64;

function gitEnvironment(osUserInfo) {
  var overrides = { GIT_TERMINAL_PROMPT: "0" };
  if (osUserInfo && osUserInfo.home) overrides.HOME = osUserInfo.home;
  if (osUserInfo && osUserInfo.user) {
    overrides.USER = osUserInfo.user;
    overrides.LOGNAME = osUserInfo.user;
  }
  return Object.assign({}, process.env, overrides);
}

function runGitSync(cwd, args, options, osUserInfo) {
  var opts = Object.assign({
    cwd: cwd,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: "pipe",
    env: gitEnvironment(osUserInfo),
  }, options || {});
  if (osUserInfo) {
    opts.uid = osUserInfo.uid;
    opts.gid = osUserInfo.gid;
  }
  var wrapped = wrapSpawnAsUser("git", args, opts);
  return execFileSync(wrapped.command, wrapped.args, wrapped.options);
}

function runGit(cwd, args, timeout, osUserInfo) {
  return new Promise(function (resolve, reject) {
    var opts = {
      cwd: cwd,
      encoding: "utf8",
      timeout: timeout || 30000,
      maxBuffer: 8 * 1024 * 1024,
      env: gitEnvironment(osUserInfo),
    };
    if (osUserInfo) {
      opts.uid = osUserInfo.uid;
      opts.gid = osUserInfo.gid;
    }
    var wrapped = wrapSpawnAsUser("git", args, opts);
    execFile(wrapped.command, wrapped.args, wrapped.options, function (err, stdout, stderr) {
      if (err) {
        var detail = String(stderr || stdout || err.message || "Git command failed").trim();
        err.userMessage = detail;
        reject(err);
        return;
      }
      resolve(String(stdout || stderr || "").trim());
    });
  });
}

function parseBranchHeader(record, result) {
  var space = record.indexOf(" ", 2);
  if (space === -1) return;
  var key = record.slice(2, space);
  var value = record.slice(space + 1);
  if (key === "branch.oid") result.oid = value;
  else if (key === "branch.head") result.branch = value;
  else if (key === "branch.upstream") result.upstream = value;
  else if (key === "branch.ab") {
    var match = value.match(/^\+(\d+) -(\d+)$/);
    if (match) {
      result.ahead = parseInt(match[1], 10);
      result.behind = parseInt(match[2], 10);
    }
  }
}

function parseTrackedRecord(record, kind) {
  var pattern = kind === "2"
    ? /^2 ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/
    : /^1 ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/;
  var match = record.match(pattern);
  if (!match) return null;
  var xy = match[1];
  return {
    path: match[match.length - 1],
    originalPath: null,
    code: xy,
    staged: xy.charAt(0) !== ".",
    unstaged: xy.charAt(1) !== ".",
    untracked: false,
    conflicted: false,
    kind: kind === "2" ? "renamed" : "changed",
  };
}

function parseUnmergedRecord(record) {
  var match = record.match(/^u ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/);
  if (!match) return null;
  return {
    path: match[match.length - 1],
    originalPath: null,
    code: match[1],
    staged: true,
    unstaged: true,
    untracked: false,
    conflicted: true,
    kind: "conflicted",
  };
}

function parsePorcelainV2(raw) {
  var result = {
    oid: null,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
  };
  var records = String(raw || "").split("\0");
  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    if (!record) continue;
    if (record.indexOf("# ") === 0) {
      parseBranchHeader(record, result);
      continue;
    }
    if (record.indexOf("? ") === 0) {
      result.files.push({
        path: record.slice(2), originalPath: null, code: "??",
        staged: false, unstaged: true, untracked: true,
        conflicted: false, kind: "untracked",
      });
      continue;
    }
    if (record.indexOf("u ") === 0) {
      var conflict = parseUnmergedRecord(record);
      if (conflict) result.files.push(conflict);
      continue;
    }
    if (record.indexOf("1 ") === 0 || record.indexOf("2 ") === 0) {
      var kind = record.charAt(0);
      var file = parseTrackedRecord(record, kind);
      if (file && kind === "2" && i + 1 < records.length) {
        file.originalPath = records[++i] || null;
      }
      if (file) result.files.push(file);
    }
  }
  return result;
}

function normalizeGitPath(cwd, value) {
  return path.normalize(path.isAbsolute(value) ? value : path.resolve(cwd, value));
}

// Whether this checkout is a linked worktree. The two directories have to be
// compared through realpath: git answers --absolute-git-dir already resolved
// but --git-common-dir relative to cwd, so on any platform where the working
// directory sits behind a symlink (macOS /var -> /private/var, for one) a
// plain string compare reports every ordinary repository as a worktree.
function isLinkedWorktree(gitDir, commonDir) {
  if (!gitDir || !commonDir) return false;
  return realGitPath(gitDir) !== realGitPath(commonDir);
}

function realGitPath(value) {
  try {
    return fs.realpathSync(value);
  } catch (e) {
    return value;
  }
}

function parseWorktrees(raw) {
  var blocks = String(raw || "").trim().split(/\n\n+/);
  var result = [];
  for (var i = 0; i < blocks.length; i++) {
    if (!blocks[i]) continue;
    var lines = blocks[i].split("\n");
    var item = { path: null, branch: null, head: null, bare: false, detached: false };
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (line.indexOf("worktree ") === 0) item.path = line.slice(9);
      else if (line.indexOf("HEAD ") === 0) item.head = line.slice(5);
      else if (line.indexOf("branch ") === 0) item.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "bare") item.bare = true;
      else if (line === "detached") item.detached = true;
    }
    if (item.path) result.push(item);
  }
  return result;
}

function getStatus(cwd, osUserInfo) {
  try {
    var inside = runGitSync(cwd, ["rev-parse", "--is-inside-work-tree"], null, osUserInfo).trim();
    if (inside !== "true") return { isRepository: false };
  } catch (e) {
    return { isRepository: false };
  }

  var root = runGitSync(cwd, ["rev-parse", "--show-toplevel"], null, osUserInfo).trim();
  var raw = runGitSync(root, ["status", "--porcelain=v2", "--branch", "-z"], null, osUserInfo);
  var parsed = parsePorcelainV2(raw);
  var origin = null;
  var gitDir = null;
  var commonDir = null;
  var worktrees = [];
  try { origin = runGitSync(cwd, ["remote", "get-url", "origin"], null, osUserInfo).trim() || null; } catch (e) {}
  try { gitDir = normalizeGitPath(cwd, runGitSync(cwd, ["rev-parse", "--absolute-git-dir"], null, osUserInfo).trim()); } catch (e) {}
  try { commonDir = normalizeGitPath(cwd, runGitSync(cwd, ["rev-parse", "--git-common-dir"], null, osUserInfo).trim()); } catch (e) {}
  try { worktrees = parseWorktrees(runGitSync(cwd, ["worktree", "list", "--porcelain"], null, osUserInfo)); } catch (e) {}

  var normalizedRoot = path.normalize(root);
  var currentWorktree = null;
  for (var i = 0; i < worktrees.length; i++) {
    if (path.normalize(worktrees[i].path) === normalizedRoot) {
      currentWorktree = worktrees[i];
      break;
    }
  }
  var detached = parsed.branch === "(detached)" || !!(currentWorktree && currentWorktree.detached);
  return {
    isRepository: true,
    name: path.basename(root),
    root: root,
    branch: detached ? null : parsed.branch,
    detached: detached,
    oid: parsed.oid === "(initial)" ? null : parsed.oid,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    origin: origin,
    gitDir: gitDir,
    commonDir: commonDir,
    isWorktree: isLinkedWorktree(gitDir, commonDir),
    mainWorktree: worktrees.length > 0 ? worktrees[0].path : root,
    worktrees: worktrees,
    files: parsed.files,
    dirty: parsed.files.length > 0,
  };
}

// A bounded, credential-free remote label. The raw remote URL can carry an
// embedded token, so the userinfo segment is dropped before the label is
// built rather than after.
function shortRemoteLabel(origin) {
  if (!origin) return null;
  var label = String(origin).trim()
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^[^@/]*@/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (label.length > MAX_REMOTE_LABEL) label = label.slice(0, MAX_REMOTE_LABEL - 1) + "…";
  return label || null;
}

function countChangedFiles(files) {
  var counts = { changed: files.length, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (file.conflicted) counts.conflicted++;
    if (file.untracked) counts.untracked++;
    if (file.staged) counts.staged++;
    if (file.unstaged && !file.untracked) counts.unstaged++;
  }
  return counts;
}

// Cheap always-visible repository placard data. Deliberately narrower than
// getStatus: three git invocations instead of six, no per-file payload, no
// session attribution, and no filesystem path in the result. Identity is
// derived here so the client never resolves or renders a repository path.
function getSummary(cwd, osUserInfo) {
  var probe;
  try {
    probe = runGitSync(cwd, [
      "rev-parse", "--is-inside-work-tree", "--show-toplevel",
      "--absolute-git-dir", "--git-common-dir",
    ], null, osUserInfo);
  } catch (e) {
    return { isRepository: false };
  }
  var lines = String(probe || "").trim().split("\n");
  if (String(lines[0] || "").trim() !== "true" || !lines[1]) return { isRepository: false };

  var root = String(lines[1]).trim();
  var gitDir = lines[2] ? normalizeGitPath(cwd, String(lines[2]).trim()) : null;
  var commonDir = lines[3] ? normalizeGitPath(cwd, String(lines[3]).trim()) : null;
  var parsed = parsePorcelainV2(runGitSync(root, ["status", "--porcelain=v2", "--branch", "-z"], null, osUserInfo));
  var origin = null;
  try { origin = runGitSync(cwd, ["remote", "get-url", "origin"], null, osUserInfo).trim() || null; } catch (e) {}

  var detached = parsed.branch === "(detached)";
  var counts = countChangedFiles(parsed.files);
  return {
    isRepository: true,
    name: path.basename(root),
    branch: detached ? null : parsed.branch,
    detached: detached,
    shortOid: parsed.oid && parsed.oid !== "(initial)" ? String(parsed.oid).slice(0, 8) : null,
    isWorktree: isLinkedWorktree(gitDir, commonDir),
    hasUpstream: !!parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    changed: counts.changed,
    staged: counts.staged,
    unstaged: counts.unstaged,
    untracked: counts.untracked,
    conflicted: counts.conflicted,
    remote: shortRemoteLabel(origin),
  };
}

function resolveChangedPaths(status, requestedPaths) {
  if (!Array.isArray(requestedPaths) || requestedPaths.length === 0 || requestedPaths.length > 200) {
    throw new Error("Select at least one changed file");
  }
  var byPath = {};
  for (var i = 0; i < status.files.length; i++) byPath[status.files[i].path] = status.files[i];
  var result = [];
  var seen = {};
  for (var j = 0; j < requestedPaths.length; j++) {
    var requested = requestedPaths[j];
    var entry = typeof requested === "string" ? byPath[requested] : null;
    if (!entry) throw new Error("File is no longer changed: " + String(requested));
    if (!seen[entry.path]) { result.push(entry.path); seen[entry.path] = true; }
    if (entry.originalPath && !seen[entry.originalPath]) {
      result.push(entry.originalPath);
      seen[entry.originalPath] = true;
    }
  }
  return result;
}

function runAction(cwd, body, osUserInfo) {
  var action = body && body.action;
  var status = getStatus(cwd, osUserInfo);
  if (!status.isRepository) return Promise.reject(new Error("This project is not a Git repository"));

  if (action === "stage" || action === "unstage") {
    var paths = resolveChangedPaths(status, body.paths);
    if (action === "stage") return runGit(status.root, ["add", "-A", "--"].concat(paths), null, osUserInfo);
    if (status.oid) return runGit(status.root, ["restore", "--staged", "--"].concat(paths), null, osUserInfo);
    return runGit(status.root, ["rm", "--cached", "-r", "--"].concat(paths), null, osUserInfo);
  }
  if (action === "stage_all") return runGit(status.root, ["add", "-A"], null, osUserInfo);
  if (action === "unstage_all") {
    if (status.oid) return runGit(status.root, ["reset"], null, osUserInfo);
    return runGit(status.root, ["rm", "--cached", "-r", "."], null, osUserInfo);
  }
  if (action === "pull") {
    if (!status.upstream) return Promise.reject(new Error("The current branch has no upstream"));
    return runGit(status.root, ["pull", "--ff-only"], 60000, osUserInfo);
  }
  if (action === "push") {
    if (status.upstream) return runGit(status.root, ["push"], 60000, osUserInfo);
    if (!status.origin || !status.branch) return Promise.reject(new Error("Set an origin and check out a branch before pushing"));
    return runGit(status.root, ["push", "--set-upstream", "origin", status.branch], 60000, osUserInfo);
  }
  return Promise.reject(new Error("Unsupported Git action"));
}

function bufferIsBinary(buffer) {
  var limit = Math.min(buffer.length, 8000);
  for (var i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function getHeadFile(cwd, filePath, osUserInfo) {
  try {
    return runGitSync(cwd, ["show", "HEAD:" + filePath], { encoding: null, maxBuffer: MAX_DIFF_BYTES }, osUserInfo);
  } catch (e) {
    return Buffer.alloc(0);
  }
}

function fileBufferResult(buffer) {
  var binary = bufferIsBinary(buffer);
  return { content: binary ? "" : buffer.toString("utf8"), binary: binary };
}

function readWorkingTreeFile(cwd, filePath) {
  var root = path.resolve(cwd);
  var absolutePath = path.resolve(root, filePath);
  if (absolutePath !== root && absolutePath.indexOf(root + path.sep) !== 0) throw new Error("Invalid file path");
  try {
    var stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return fileBufferResult(Buffer.from(fs.readlinkSync(absolutePath), "utf8"));
    if (!stat.isFile()) return { content: "", binary: false };
    if (stat.size > MAX_DIFF_BYTES) throw new Error("File is too large to preview");
    return fileBufferResult(fs.readFileSync(absolutePath));
  } catch (e) {
    if (e.code === "ENOENT") return { content: "", binary: false };
    throw e;
  }
}

function getFileAtCommit(cwd, commit, filePath, osUserInfo) {
  if (!commit) return { content: "", binary: false };
  try {
    var buffer = runGitSync(cwd, ["show", commit + ":" + filePath], { encoding: null, maxBuffer: MAX_DIFF_BYTES }, osUserInfo);
    return fileBufferResult(buffer);
  } catch (e) {
    return { content: "", binary: false };
  }
}

function getFileDiff(cwd, requestedPath, osUserInfo) {
  var status = getStatus(cwd, osUserInfo);
  if (!status.isRepository) throw new Error("This project is not a Git repository");
  var entry = null;
  for (var i = 0; i < status.files.length; i++) {
    if (status.files[i].path === requestedPath) { entry = status.files[i]; break; }
  }
  if (!entry) throw new Error("File is no longer changed");

  var oldPath = entry.originalPath || entry.path;
  var oldBuffer = getHeadFile(status.root, oldPath, osUserInfo);
  var newBuffer = Buffer.alloc(0);
  var absolutePath = path.resolve(status.root, entry.path);
  var rootPrefix = path.resolve(status.root) + path.sep;
  if (absolutePath.indexOf(rootPrefix) !== 0) throw new Error("Invalid changed file path");
  try {
    var stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      newBuffer = Buffer.from(fs.readlinkSync(absolutePath), "utf8");
    } else if (stat.isFile()) {
      if (stat.size > MAX_DIFF_BYTES) throw new Error("File is too large to preview");
      newBuffer = fs.readFileSync(absolutePath);
    }
  } catch (e) {
    if (e.message === "File is too large to preview") throw e;
  }
  var binary = bufferIsBinary(oldBuffer) || bufferIsBinary(newBuffer);
  return {
    path: entry.path,
    oldPath: oldPath,
    oldContent: binary ? "" : oldBuffer.toString("utf8"),
    newContent: binary ? "" : newBuffer.toString("utf8"),
    binary: binary,
  };
}

module.exports = {
  getFileAtCommit: getFileAtCommit,
  getFileDiff: getFileDiff,
  getStatus: getStatus,
  getSummary: getSummary,
  parsePorcelainV2: parsePorcelainV2,
  parseWorktrees: parseWorktrees,
  readWorkingTreeFile: readWorkingTreeFile,
  runGitSync: runGitSync,
  runGit: runGit,
  runAction: runAction,
  shortRemoteLabel: shortRemoteLabel,
};
