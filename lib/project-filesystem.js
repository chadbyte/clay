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
  var operations = require("./project-file-operations").attachFileOperations(ctx);

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
      try {
        sendTo(ws, { type: 'fs_list_result', path: msg.path || '.', entries: operations.list(fileScope, msg.path || '.') });
        startDirWatch(ws, msg.path || '.');
      } catch (e) {
        sendTo(ws, { type: 'fs_list_result', path: msg.path, entries: [], error: fileError(e).message, errorCode: fileError(e).code });
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
      var metadata = { type: 'fs_read_result', path: msg.path, requestId: msg.requestId, projectSlug: msg.projectSlug, sessionId: msg.sessionId, accountId: msg.accountId };
      try { sendTo(ws, Object.assign(metadata, operations.read(fileScope, msg.path))); }
      catch (e) { sendTo(ws, Object.assign(metadata, { error: fileError(e).message, errorCode: fileError(e).code })); }
      return true;
    }

    if (msg.type === 'fs_write') {
      try { sendTo(ws, Object.assign({ type: 'fs_write_result', path: msg.path }, operations.write(fileScope, msg.path, msg.content || ''))); }
      catch (e) { sendTo(ws, { type: 'fs_write_result', path: msg.path, ok: false, error: fileError(e).message, errorCode: fileError(e).code }); }
      return true;
    }

    // --- Project settings permission gate ---
    if (msg.type === "get_project_env" || msg.type === "set_project_env" ||
        msg.type === "get_shared_env" || msg.type === "set_shared_env" ||
        msg.type === "transfer_project_owner") {
      var globalSetting = /^(get_shared_env|set_shared_env)$/.test(msg.type);
      var targetSlug = msg.slug || slug;
      if (!access.hasPermission(ws, "projectSettings") ||
          (globalSetting ? !access.isAdmin(ws) : !access.canAccessProject(ws, targetSlug))) {
        sendTo(ws, { type: globalSetting ? (msg.type === 'get_shared_env' ? 'shared_env_result' : 'set_shared_env_result') : (msg.type === 'get_project_env' ? 'project_env_result' : msg.type === 'set_project_env' ? 'set_project_env_result' : 'error'), slug: targetSlug, requestId: msg.requestId, ok: false, error: 'Project settings access is not permitted', text: "Project settings access is not permitted" });
        return true;
      }
    }

    // --- Project environment variables ---
    if (msg.type === "get_project_env") {
      if (typeof opts.onGetProjectEnv !== "function") { sendTo(ws, { type: "project_env_result", slug: targetSlug, requestId: msg.requestId, error: "Project environment is unavailable in this runtime." }); return true; }
      var envrc = "";
      if (typeof opts.onGetProjectEnv === "function") {
        var envResult;
        try { envResult = opts.onGetProjectEnv(targetSlug); }
        catch (error) { sendTo(ws, { type: "project_env_result", slug: targetSlug, requestId: msg.requestId, error: error.message }); return true; }
        envrc = envResult.envrc || "";
      }
      sendTo(ws, { type: "project_env_result", slug: targetSlug, requestId: msg.requestId, envrc: envrc });
      return true;
    }

    if (msg.type === "set_project_env") {
      if (typeof opts.onSetProjectEnv === "function") {
        var envError = validateEnvString(msg.envrc || "");
        if (envError) {
          sendTo(ws, { type: "set_project_env_result", ok: false, slug: targetSlug, requestId: msg.requestId, error: envError });
          return true;
        }
        var setResult;
        try { setResult = opts.onSetProjectEnv(targetSlug, msg.envrc || ""); }
        catch (error) { sendTo(ws, { type: "set_project_env_result", slug: targetSlug, requestId: msg.requestId, ok: false, error: error.message }); return true; }
        if (setResult.ok && !setResult.runtimeRefreshed) onEnvironmentChanged();
        sendTo(ws, Object.assign({}, setResult, { type: "set_project_env_result", slug: targetSlug, requestId: msg.requestId, timing: setResult.ok ? "Applies to newly created coding-agent processes. Active processes keep their current environment." : undefined }));
      } else {
        sendTo(ws, { type: "set_project_env_result", slug: targetSlug, requestId: msg.requestId, ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Shared environment variables ---
    if (msg.type === "get_shared_env") {
      var sharedEnvrc = "";
      if (typeof opts.onGetSharedEnv === "function") {
        try {
          var sharedResult = opts.onGetSharedEnv();
          sharedEnvrc = sharedResult.envrc || "";
        } catch (error) { sendTo(ws, { type: "shared_env_result", error: error.message }); return true; }
      }
      if (typeof opts.onGetSharedEnv !== "function") { sendTo(ws, { type: "shared_env_result", error: "Shared environment is unavailable in this runtime." }); return true; }
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
        var sharedSetResult;
        try { sharedSetResult = opts.onSetSharedEnv(msg.envrc || ""); }
        catch (error) { sendTo(ws, { type: "set_shared_env_result", ok: false, error: error.message }); return true; }
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
    productOperations: operations,
  };
}

module.exports = { attachFilesystem: attachFilesystem };
