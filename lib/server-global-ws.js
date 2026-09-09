// --- Global WebSocket handler (no project context) ---
//
// Lets a logged-in user with no projects yet (or no accessible projects)
// load the regular app shell and create / add / clone their first project,
// instead of being trapped on a static "no projects" page.
//
// Bound to the slug-less `/ws` endpoint by lib/server.js. Only handles the
// small set of messages needed to bootstrap into a project context:
//   - ping            -> pong keep-alive
//   - Home and Mate    -> the same user-scoped handlers as project sockets
//   - browse_dir      -> directory picker for the add-project modal
//   - add_project     -> register an existing directory
//   - create_project  -> make a new empty project
//   - clone_project   -> clone a git repo into a new project
//
// All four mirror the same handlers in lib/project-sessions.js, but with
// the per-project `ctx` dropped since none of them need it.

var fs = require("fs");
var path = require("path");
var config = require("./config");

// Mirrored from lib/project.js — keep in sync if entries change there.
var IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "__pycache__",
  ".cache", "dist", "build", ".clay", ".claude-relay",
]);

function sendTo(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch (e) {}
  }
}

function attachGlobalWs(opts) {
  var osUsers = opts.osUsers || false;
  var usersModule = opts.usersModule;
  var onAddProject = opts.onAddProject;
  var onCreateProject = opts.onCreateProject;
  var onCloneProject = opts.onCloneProject;
  var onHomePreferenceMessage = opts.onHomePreferenceMessage;
  var onAppMessage = opts.onAppMessage;
  var onConnection = opts.onConnection;
  var clients = new Set();

  function handleMessage(ws, msg) {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "ping") {
      sendTo(ws, { type: "pong" });
      return;
    }

    // A user does not need an ordinary project before Home becomes useful.
    // Route Mate discovery, Home chat/debates, and tools through the same
    // handlers used by project sockets. This also lets mate_list repair an
    // existing account whose built-ins were missing from its final storage.
    if (typeof onAppMessage === "function" && onAppMessage(ws, msg)) return;

    if (typeof onHomePreferenceMessage === "function" && onHomePreferenceMessage(ws, msg)) return;

    // --- Directory picker for the add-project modal ---
    if (msg.type === "browse_dir") {
      var rawPath = (msg.path || "").replace(/^~/, config.REAL_HOME);
      var absTarget = path.resolve(rawPath);
      // Multi-user mode: non-admins can only browse their home directory.
      if (osUsers && ws._clayUser && ws._clayUser.role !== "admin") {
        var browseHome = ws._clayUser.linuxUser ? "/home/" + ws._clayUser.linuxUser : null;
        if (!browseHome || (absTarget !== browseHome && (absTarget + "/").indexOf(browseHome + "/") !== 0)) {
          sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: [], error: "Access restricted to your home directory" });
          return;
        }
      }
      var parentDir, prefix;
      try {
        var stat = fs.statSync(absTarget);
        if (stat.isDirectory()) {
          // Existing directory -- list its children.
          parentDir = absTarget;
          prefix = "";
        } else {
          parentDir = path.dirname(absTarget);
          prefix = path.basename(absTarget).toLowerCase();
        }
      } catch (e) {
        // Doesn't exist -- list parent and filter by typed prefix.
        parentDir = path.dirname(absTarget);
        prefix = path.basename(absTarget).toLowerCase();
      }
      try {
        var dirItems = fs.readdirSync(parentDir, { withFileTypes: true });
        var dirEntries = [];
        for (var di = 0; di < dirItems.length; di++) {
          var d = dirItems[di];
          if (!d.isDirectory()) continue;
          if (d.name.charAt(0) === ".") continue;
          if (IGNORED_DIRS.has(d.name)) continue;
          if (prefix && !d.name.toLowerCase().startsWith(prefix)) continue;
          dirEntries.push({ name: d.name, path: path.join(parentDir, d.name) });
        }
        dirEntries.sort(function (a, b) { return a.name.localeCompare(b.name); });
        sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: dirEntries });
      } catch (e) {
        sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: [], error: e.message });
      }
      return;
    }

    // --- Register an existing directory as a project ---
    if (msg.type === "add_project") {
      var addPath = (msg.path || "").replace(/^~/, config.REAL_HOME);
      var addAbs = path.resolve(addPath);
      if (osUsers && ws._clayUser && ws._clayUser.role !== "admin") {
        if (!ws._clayUser.linuxUser) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "No Linux user assigned" });
          return;
        }
        var userHome = "/home/" + ws._clayUser.linuxUser;
        if (addAbs !== userHome && (addAbs + "/").indexOf(userHome + "/") !== 0) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "Path not allowed. You can only add directories under " + userHome });
          return;
        }
      }
      try {
        var addStat = fs.statSync(addAbs);
        if (!addStat.isDirectory()) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "Not a directory" });
          return;
        }
      } catch (e) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Directory not found" });
        return;
      }
      if (typeof onAddProject === "function") {
        var result = onAddProject(addAbs, ws._clayUser);
        sendTo(ws, { type: "add_project_result", ok: result.ok, slug: result.slug, error: result.error, existing: result.existing });
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return;
    }

    // Permission gate shared by create_project and clone_project.
    if (msg.type === "create_project" || msg.type === "clone_project") {
      if (ws._clayUser && usersModule) {
        var cpPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!cpPerms.createProject) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "You do not have permission to create projects" });
          return;
        }
      }
    }

    if (msg.type === "create_project") {
      var createName = (msg.name || "").trim();
      if (!createName || !/^[a-zA-Z0-9_-]+$/.test(createName)) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Invalid name. Use only letters, numbers, dashes, and underscores." });
        return;
      }
      if (typeof onCreateProject === "function") {
        var createResult = onCreateProject(createName, ws._clayUser);
        sendTo(ws, { type: "add_project_result", ok: createResult.ok, slug: createResult.slug, error: createResult.error });
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return;
    }

    if (msg.type === "clone_project") {
      var cloneUrl = (msg.url || "").trim();
      if (!cloneUrl || (!/^https?:\/\//.test(cloneUrl) && !/^git@/.test(cloneUrl))) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Invalid URL. Use https:// or git@ format." });
        return;
      }
      sendTo(ws, { type: "clone_project_progress", status: "cloning" });
      if (typeof onCloneProject === "function") {
        onCloneProject(cloneUrl, ws._clayUser, function (cloneResult) {
          sendTo(ws, { type: "add_project_result", ok: cloneResult.ok, slug: cloneResult.slug, error: cloneResult.error });
        });
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return;
    }
  }

  function handleConnection(ws, wsUser) {
    ws._clayUser = wsUser || null;
    clients.add(ws);
    ws.on("close", function () { clients.delete(ws); });
    ws.on("message", function (data) {
      var msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      handleMessage(ws, msg);
    });
    if (typeof onConnection === "function") onConnection(ws);
  }

  function forEachClient(visitor) {
    clients.forEach(function (ws) { visitor(ws); });
  }

  return {
    handleConnection: handleConnection,
    handleMessage: handleMessage,
    forEachClient: forEachClient,
  };
}

module.exports = { attachGlobalWs: attachGlobalWs };
