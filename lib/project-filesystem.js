var fs = require("fs");
var path = require("path");
var attachRequestAccess = require("./project-request-access").attachRequestAccess;
var attachFileHistory = require("./project-file-history").attachFileHistory;
var resolveFilePath = require("./project-file-path").resolveFilePath;
var fileError = require("./project-file-path").fileError;

/**
 * Attach filesystem-related message handlers to a project context.
 *
 * ctx fields:
 *   cwd, slug, osUsers
 *   sm (session manager)
 *   send, sendTo
 *   getOsUserInfoForWs (function)
 *   startFileWatch, stopFileWatch, startDirWatch (from _fileWatch)
 *   usersModule, fsAsUser
 *   validateEnvString, onEnvironmentChanged (functions)
 *   opts (for onGetProjectEnv, onSetProjectEnv, onGetSharedEnv, onSetSharedEnv callbacks)
 *   IGNORED_DIRS, BINARY_EXTS, IMAGE_EXTS, FS_MAX_SIZE (constants)
 */
function attachFilesystem(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var sendTo = ctx.sendTo;
  var startFileWatch = ctx.startFileWatch;
  var stopFileWatch = ctx.stopFileWatch;
  var startDirWatch = ctx.startDirWatch;
  var fsAsUser = ctx.fsAsUser;
  var validateEnvString = ctx.validateEnvString;
  var onEnvironmentChanged = ctx.onEnvironmentChanged || function () {};
  var opts = ctx.opts;
  var IGNORED_DIRS = ctx.IGNORED_DIRS;
  var BINARY_EXTS = ctx.BINARY_EXTS;
  var IMAGE_EXTS = ctx.IMAGE_EXTS;
  var FS_MAX_SIZE = ctx.FS_MAX_SIZE;

  var access = ctx.requestAccess || attachRequestAccess(ctx);
  var fileHistory = attachFileHistory(ctx, access);

  function handleFilesystemMessage(ws, msg) {
    var fileScope;
    var fileTarget;
    // Resolve live authority before every operation; never trust message roles.
    if (/^fs_/.test(msg.type) && msg.type !== "fs_unwatch") {
      try {
        fileScope = access.fileScope(ws);
        if (/^fs_(list|read|write|watch)$/.test(msg.type)) {
          fileTarget = resolveFilePath(cwd, msg.type === "fs_list" ? msg.path || "." : msg.path, fileScope);
        }
      } catch (e) {
        var denied = fileError(e);
        sendTo(ws, { type: msg.type + "_result", path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId, ok: false, error: denied.message, errorCode: denied.code });
        return true;
      }
    }

    // --- fs_list ---
    if (msg.type === "fs_list") {
      var fsListIdentity = fileScope.identity;
      var fsDir = fileTarget;
      try {
        var fsListUserInfo = fsListIdentity;
        var entries = [];
        if (fsListUserInfo) {
          // Run as target OS user to respect Linux file permissions
          var rawEntries = fsAsUser("list", { dir: fsDir }, fsListUserInfo);
          for (var fi = 0; fi < rawEntries.length; fi++) {
            var re = rawEntries[fi];
            if (re.isDir && IGNORED_DIRS.has(re.name)) continue;
            entries.push({
              name: re.name,
              type: re.isDir ? "dir" : "file",
              path: path.relative(cwd, path.join(fsDir, re.name)).split(path.sep).join("/"),
            });
          }
        } else {
          var items = fs.readdirSync(fsDir, { withFileTypes: true });
          for (var fi = 0; fi < items.length; fi++) {
            var item = items[fi];
            if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
            entries.push({
              name: item.name,
              type: item.isDirectory() ? "dir" : "file",
              path: path.relative(cwd, path.join(fsDir, item.name)).split(path.sep).join("/"),
            });
          }
        }
        sendTo(ws, { type: "fs_list_result", path: msg.path || ".", entries: entries });
        // Auto-watch the directory for changes
        startDirWatch(ws, msg.path || ".");
      } catch (e) {
        sendTo(ws, { type: "fs_list_result", path: msg.path, entries: [], error: fileError(e).message, errorCode: fileError(e).code });
      }
      return true;
    }

    // --- fs_search ---
    if (msg.type === "fs_search") {
      var query = (msg.query || "").trim().toLowerCase();
      if (!query) {
        sendTo(ws, { type: "fs_search_result", query: msg.query, entries: [] });
        return true;
      }
      try {
        var searchResults = [];
        var MAX_RESULTS = 50;
        var searchUserInfo = access.osIdentity(ws);

        function walkDir(dir, relPrefix) {
          if (searchResults.length >= MAX_RESULTS) return;
          var items;
          try {
            if (searchUserInfo) {
              items = fsAsUser("list", { dir: dir }, searchUserInfo);
            } else {
              items = fs.readdirSync(dir, { withFileTypes: true }).map(function (d) {
                return { name: d.name, isDir: d.isDirectory() };
              });
            }
          } catch (e) { return; }
          for (var i = 0; i < items.length; i++) {
            if (searchResults.length >= MAX_RESULTS) return;
            var it = items[i];
            if (it.isDir && IGNORED_DIRS.has(it.name)) continue;
            var rel = relPrefix ? relPrefix + "/" + it.name : it.name;
            if (it.name.toLowerCase().indexOf(query) !== -1) {
              searchResults.push({ name: it.name, type: it.isDir ? "dir" : "file", path: rel });
            }
            if (it.isDir) {
              walkDir(path.join(dir, it.name), rel);
            }
          }
        }

        walkDir(cwd, "");
        sendTo(ws, { type: "fs_search_result", query: msg.query, entries: searchResults });
      } catch (e) {
        sendTo(ws, { type: "fs_search_result", query: msg.query, entries: [], error: fileError(e).message, errorCode: fileError(e).code });
      }
      return true;
    }

    // --- fs_read ---
    if (msg.type === "fs_read") {
      var fsReadIdentity = fileScope.identity;
      var fsFile = fileTarget;
      try {
        var fsReadUserInfo = fsReadIdentity;
        var ext = path.extname(fsFile).toLowerCase();
        if (fsReadUserInfo) {
          // Run stat and read as target OS user
          var statResult = fsAsUser("stat", { file: fsFile }, fsReadUserInfo);
          if (statResult.size > FS_MAX_SIZE) {
            sendTo(ws, { type: "fs_read_result", path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId, binary: true, size: statResult.size, error: "File too large (" + (statResult.size / 1024 / 1024).toFixed(1) + " MB)" });
            return true;
          }
          if (BINARY_EXTS.has(ext)) {
            var result = { type: "fs_read_result", path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId, binary: true, size: statResult.size };
            if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
            sendTo(ws, result);
            return true;
          }
          var readResult = fsAsUser("read", { file: fsFile, readContent: true }, fsReadUserInfo);
          sendTo(ws, { type: "fs_read_result", path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId, content: readResult.content, size: statResult.size });
        } else {
          var stat = fs.statSync(fsFile);
          if (stat.size > FS_MAX_SIZE) {
            sendTo(ws, { type: "fs_read_result", path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId, binary: true, size: stat.size, error: "File too large (" + (stat.size / 1024 / 1024).toFixed(1) + " MB)" });
            return true;
          }
          if (BINARY_EXTS.has(ext)) {
            var result = { type: "fs_read_result", path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId, binary: true, size: stat.size };
            if (IMAGE_EXTS.has(ext)) result.imageUrl = "api/file?path=" + encodeURIComponent(msg.path);
            sendTo(ws, result);
            return true;
          }
          var content = fs.readFileSync(fsFile, "utf8");
          sendTo(ws, { type: "fs_read_result", path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId, content: content, size: stat.size });
        }
      } catch (e) {
        sendTo(ws, { type: "fs_read_result", path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId, error: fileError(e).message, errorCode: fileError(e).code });
      }
      return true;
    }

    // --- fs_write ---
    if (msg.type === "fs_write") {
      var fsWriteIdentity = fileScope.identity;
      var fsWriteFile = fileTarget;
      try {
        var fsWriteUserInfo = fsWriteIdentity;
        if (fsWriteUserInfo) {
          fsAsUser("write", { file: fsWriteFile, content: msg.content || "" }, fsWriteUserInfo);
        } else {
          fs.writeFileSync(fsWriteFile, msg.content || "", "utf8");
        }
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: true });
      } catch (e) {
        sendTo(ws, { type: "fs_write_result", path: msg.path, ok: false, error: fileError(e).message, errorCode: fileError(e).code });
      }
      return true;
    }

    // --- Project settings permission gate ---
    if (msg.type === "get_project_env" || msg.type === "set_project_env" ||
        msg.type === "read_global_claude_md" || msg.type === "write_global_claude_md" ||
        msg.type === "get_shared_env" || msg.type === "set_shared_env" ||
        msg.type === "transfer_project_owner") {
      var globalSetting = /^(read_global_claude_md|write_global_claude_md|get_shared_env|set_shared_env)$/.test(msg.type);
      var targetSlug = msg.slug || slug;
      if (!access.hasPermission(ws, "projectSettings") ||
          (globalSetting ? !access.isAdmin(ws) : !access.canAccessProject(ws, targetSlug))) {
        sendTo(ws, { type: "error", text: "Project settings access is not permitted" });
        return true;
      }
    }

    // --- Project environment variables ---
    if (msg.type === "get_project_env") {
      var envrc = "";
      if (typeof opts.onGetProjectEnv === "function") {
        var envResult = opts.onGetProjectEnv(targetSlug);
        envrc = envResult.envrc || "";
      }
      sendTo(ws, { type: "project_env_result", slug: msg.slug, envrc: envrc });
      return true;
    }

    if (msg.type === "set_project_env") {
      if (typeof opts.onSetProjectEnv === "function") {
        var envError = validateEnvString(msg.envrc || "");
        if (envError) {
          sendTo(ws, { type: "set_project_env_result", ok: false, slug: msg.slug, error: envError });
          return true;
        }
        var setResult = opts.onSetProjectEnv(targetSlug, msg.envrc || "");
        if (setResult.ok) onEnvironmentChanged();
        sendTo(ws, { type: "set_project_env_result", ok: setResult.ok, slug: msg.slug, error: setResult.error, timing: setResult.ok ? "Applies to newly created coding-agent processes. Active processes keep their current environment." : undefined });
      } else {
        sendTo(ws, { type: "set_project_env_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Global CLAUDE.md ---
    if (msg.type === "read_global_claude_md") {
      var globalMdPath = path.join(require("./config").REAL_HOME, ".claude", "CLAUDE.md");
      try {
        var globalMdContent = fs.readFileSync(globalMdPath, "utf8");
        sendTo(ws, { type: "global_claude_md_result", content: globalMdContent });
      } catch (e) {
        sendTo(ws, { type: "global_claude_md_result", error: e.message });
      }
      return true;
    }

    if (msg.type === "write_global_claude_md") {
      var globalMdDir = path.join(require("./config").REAL_HOME, ".claude");
      var globalMdWritePath = path.join(globalMdDir, "CLAUDE.md");
      try {
        if (!fs.existsSync(globalMdDir)) {
          fs.mkdirSync(globalMdDir, { recursive: true });
        }
        fs.writeFileSync(globalMdWritePath, msg.content || "", "utf8");
        sendTo(ws, { type: "write_global_claude_md_result", ok: true });
      } catch (e) {
        sendTo(ws, { type: "write_global_claude_md_result", ok: false, error: e.message });
      }
      return true;
    }

    // --- Shared environment variables ---
    if (msg.type === "get_shared_env") {
      var sharedEnvrc = "";
      if (typeof opts.onGetSharedEnv === "function") {
        var sharedResult = opts.onGetSharedEnv();
        sharedEnvrc = sharedResult.envrc || "";
      }
      sendTo(ws, { type: "shared_env_result", envrc: sharedEnvrc });
      return true;
    }

    if (msg.type === "set_shared_env") {
      if (typeof opts.onSetSharedEnv === "function") {
        var sharedEnvError = validateEnvString(msg.envrc || "");
        if (sharedEnvError) {
          sendTo(ws, { type: "set_shared_env_result", ok: false, error: sharedEnvError });
          return true;
        }
        var sharedSetResult = opts.onSetSharedEnv(msg.envrc || "");
        if (sharedSetResult.ok) onEnvironmentChanged();
        sendTo(ws, { type: "set_shared_env_result", ok: sharedSetResult.ok, error: sharedSetResult.error, timing: sharedSetResult.ok ? "Applies to newly created coding-agent processes. Active processes keep their current environment." : undefined });
      } else {
        sendTo(ws, { type: "set_shared_env_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- File watcher ---
    if (msg.type === "fs_watch") {
      if (msg.path) startFileWatch(ws, msg.path);
      return true;
    }

    if (msg.type === "fs_unwatch") {
      stopFileWatch(ws);
      return true;
    }

    if (fileHistory.handleFileHistory(ws, msg)) return true;

    return false;
  }

  return {
    handleFilesystemMessage: handleFilesystemMessage,
  };
}

module.exports = { attachFilesystem: attachFilesystem };
