var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var { createSessionManager } = require("./sessions");
var { attachGitSessionAttribution } = require("./git-session-attribution");
var { createSDKBridge, createMessageQueue } = require("./sdk-bridge");
var runtimeEnv = require("./runtime-env");
var { createTerminalManager } = require("./terminal-manager");
var { createNotesManager } = require("./notes");
var { fetchLatestVersion, fetchVersion, isNewer } = require("./updater");
var updateSnooze = require("./update-snooze");
var { execFileSync, spawn } = require("child_process");
var usersModule = require("./users");
var { resolveOsUserInfo, fsAsUser, grantProjectAccess } = require("./os-users");
var { buildUserEnv } = require("./build-user-env");
var crisisSafety = require("./crisis-safety");
var matesModule = require("./mates");
var sessionSearch = require("./session-search");
var userPresence = require("./user-presence");
var { attachDebate } = require("./project-debate");
var { attachDebateProposal } = require("./project-debate-proposal");
var { attachMateCreationProposal } = require("./project-mate-creation-proposal");
var { attachAskUser } = require("./project-ask-user");
var { attachMemory } = require("./project-memory");
var { attachMateInteraction } = require("./project-mate-interaction");
var { attachUserMention } = require("./project-user-mention");
var { attachLoop } = require("./project-loop");
var { attachFileWatch } = require("./project-file-watch");
var { attachHTTP } = require("./project-http");
var { attachImage } = require("./project-image");
var { attachKnowledge } = require("./project-knowledge");
var { attachFilesystem } = require("./project-filesystem");
var { attachSessions } = require("./project-sessions");
var { attachModels } = require("./project-models");
var { attachUserMessage } = require("./project-user-message");
var { attachShellCommand } = require("./project-shell-command");
var { attachVendorLogin } = require("./project-vendor-login");
var { attachConnection } = require("./project-connection");
var { attachMcp } = require("./project-mcp");
var { createLocalMcp } = require("./mcp-local");
var { attachEmail: attachEmailModule } = require("./project-email");
var { attachSessionSpawn } = require("./project-session-spawn");
var { attachDelegatedSession } = require("./project-delegated-session");
var { attachDelegatedFollowUp } = require("./project-delegated-follow-up");
var { attachCapsuleTurn } = require("./project-capsule-turn");
var workspaceSessionRef = require("./workspace-query-service").sessionRef;
var { attachSessionPair } = require("./project-session-pair");
var { attachSessionHandoff } = require("./project-session-handoff");
var { attachSessionNotes, composeSystemPrompts } = require("./project-session-notes");
var { attachSessionDocument } = require("./project-session-document");
var { attachCapsuleCatalog } = require("./project-capsule-catalog");
var { attachProjectWorkspaceQuery } = require("./project-workspace-query");
var { attachProjectLogs } = require("./project-logs");
var { attachProjectLogFeedbackDelivery } = require("./project-log-feedback-delivery");
var { attachProjectMateKnowledge } = require("./project-mate-knowledge");
var { attachSplitGroups } = require("./session-split-groups");
var toolControlMcp = require("./tool-control-mcp-server");
var capsuleFloor = require("./capsule-display-floor");
var toolLlm = require("./tool-llm");
// project-notifications is attached globally in server.js, passed via opts.notificationsModule

function createMateToolControlMcp(adapter, config) {
  if (!adapter || typeof adapter.createToolServer !== "function") return null;
  var handlers = {
    list: function () {
      var manifests = config.list(config.userId) || [];
      var tools = [];
      for (var i = 0; i < manifests.length; i++) {
        // Skills go dark when the declarative Display floor does, so a Capsule
        // the human cannot operate is never listed to a Mate either. The guard
        // validates the Capsule's own Display tree, not a claim about it.
        if (!capsuleFloor.hasUsableFloor(manifests[i])) continue;
        tools.push({
          id: manifests[i].id,
          name: manifests[i].name,
          description: manifests[i].description || "",
          useWhen: manifests[i].useWhen || "",
          runtime: manifests[i].runtime || "worker",
          permissions: manifests[i].permissions || [],
          skills: manifests[i].skills || "",
        });
      }
      return tools;
    },
    snapshot: function (toolId) {
      return config.control(config.userId, config.mateId, toolId, "snapshot", {});
    },
    act: function (toolId, actionId, args) {
      return config.control(config.userId, config.mateId, toolId, "act", { actionId: actionId, args: args });
    },
    set: function (toolId, controlId, value) {
      return config.control(config.userId, config.mateId, toolId, "set", { controlId: controlId, value: value });
    },
    source: function (toolId) {
      return config.source(config.userId, toolId);
    },
    install: function (input) {
      return config.install(config.userId, input);
    },
    update: function (toolId, input) {
      return config.update(config.userId, toolId, input);
    },
    uninstall: function (toolId) {
      return config.remove(config.userId, toolId);
    },
  };
  return adapter.createToolServer({
    name: "clay-tools",
    version: "1.0.0",
    tools: toolControlMcp.getToolDefs(handlers),
  });
}

// --- Context Sources persistence ---
var _ctxSrcConfig = require("./config");
var _ctxSrcDir = path.join(_ctxSrcConfig.CONFIG_DIR, "context-sources");

function loadContextSources(slug, sessionId) {
  try {
    var key = sessionId ? slug + "--" + sessionId : slug;
    var filePath = path.join(_ctxSrcDir, key + ".json");
    var data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data.active || [];
  } catch (e) {
    return [];
  }
}

function saveContextSources(slug, sessionId, activeIds) {
  try {
    if (!fs.existsSync(_ctxSrcDir)) {
      fs.mkdirSync(_ctxSrcDir, { recursive: true });
    }
    var key = sessionId ? slug + "--" + sessionId : slug;
    var filePath = path.join(_ctxSrcDir, key + ".json");
    fs.writeFileSync(filePath, JSON.stringify({ active: activeIds }), "utf8");
  } catch (e) {
    console.error("[context-sources] Failed to save:", e.message);
  }
}

// Validate environment variable string (KEY=VALUE per line)
// Returns null if valid, or an error string if invalid
function validateEnvString(str) {
  return runtimeEnv.validateEnvString(str);
}

// YOKE adapter (replaces direct SDK access)
var yoke = require("./yoke");

// --- Shared constants ---
var IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "__pycache__", ".cache", "dist", "build", ".clay", ".claude-relay"]);
var BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".pyc", ".o", ".a", ".class",
]);
var IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
var FS_MAX_SIZE = 512 * 1024;
var FS_VIEWER_MAX_SIZE = 5 * 1024 * 1024;
function safePath(base, requested) {
  var resolved = path.resolve(base, requested);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  try {
    var real = fs.realpathSync(resolved);
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    return real;
  } catch (e) {
    return null;
  }
}

// Resolve an absolute path without requiring it to be within cwd.
// Used as fallback in OS user mode where ACL enforces access at the OS level.
function safeAbsPath(requested) {
  if (!requested) return null;
  var resolved = path.resolve(requested);
  try {
    return fs.realpathSync(resolved);
  } catch (e) {
    return null;
  }
}

/**
 * Create a project context — per-project state and handlers.
 * opts: { cwd, slug, title, pushModule, debug, dangerouslySkipPermissions, currentVersion }
 */
function createProjectContext(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug;
  var project = path.basename(cwd);
  var title = opts.title || null;
  var icon = opts.icon || null;
  var pushModule = opts.pushModule || null;
  var debug = opts.debug || false;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var currentVersion = opts.currentVersion;
  var lanHost = opts.lanHost || null;
  var getProjectCount = opts.getProjectCount || function () { return 1; };
  var getProjectList = opts.getProjectList || function () { return []; };
  var isHostAgent = !!opts.isHostAgent;
  var getHubSchedules = opts.getHubSchedules || function () { return []; };
  var moveScheduleToProject = opts.moveScheduleToProject || function () { return { ok: false, error: "Not supported" }; };
  var moveAllSchedulesToProject = opts.moveAllSchedulesToProject || function () { return { ok: false, error: "Not supported" }; };
  var getScheduleCount = opts.getScheduleCount || function () { return 0; };
  var onProcessingChanged = opts.onProcessingChanged || function () {};
  var onSessionDone = opts.onSessionDone || function () {};
  var onPresenceChange = opts.onPresenceChange || function () {};
  var updateChannel = opts.updateChannel || "stable";
  var osUsers = opts.osUsers || false;
  var projectOwnerId = opts.projectOwnerId || null;
  var projectKnowledgeId = opts.projectKnowledgeId || null;
  var worktreeMeta = opts.worktreeMeta || null; // { parentSlug, branch, external }
  var isMate = opts.isMate || false;
  var mateId = opts.mateId || (isMate ? path.basename(cwd) : null);
  var listControllableTools = opts.listControllableTools || function () { return []; };
  var controlToolForMate = opts.controlToolForMate || function () {
    return Promise.reject(new Error("Tool control is unavailable."));
  };
  var installToolForMate = opts.installToolForMate || function () {
    return Promise.reject(new Error("Tool installation is unavailable."));
  };
  var sourceToolForMate = opts.sourceToolForMate || function () {
    return Promise.reject(new Error("Capsule source access is unavailable."));
  };
  var updateToolForMate = opts.updateToolForMate || function () {
    return Promise.reject(new Error("Capsule source updates are unavailable."));
  };
  var removeToolForMate = opts.removeToolForMate || function () {
    return Promise.reject(new Error("Tool removal is unavailable."));
  };
  var onCreateWorktree = opts.onCreateWorktree || null;
  var serverPort = opts.port || 2633;
  var serverTls = opts.tls || false;
  var serverAuthToken = opts.authToken || null;
  var latestVersion = null;
  var sessionTitleMigrationScheduled = false;

  // --- YOKE adapters (multi-vendor, lazy init) ---
  var _yokeState = yoke.createAdapters({ cwd: cwd, slug: slug, osUsers: osUsers });
  var adapters = _yokeState.adapters;
  // A new project has no remembered vendor. Select the first installed
  // provider by the shared Claude -> Codex -> Kiro preference order.
  var defaultVendor = yoke.resolveDefaultVendor(adapters);
  var adapter = adapters[defaultVendor] || null;

  // Browser MCP server runs in-process via createSdkMcpServer (no child process spawn).
  // Do NOT write to .claude-local/settings.json -- the SDK reads that too, causing duplicate spawns.

  // --- Image engine (delegated to project-image.js) ---
  var _image = attachImage({ cwd: cwd, slug: slug, fsAsUser: fsAsUser });
  var imagesDir = _image.imagesDir;
  var hydrateImageRefs = _image.hydrateImageRefs;
  var saveImageFile = _image.saveImageFile;

  // --- OS-level user isolation helper ---
  // Returns the Linux username for the session owner.
  // Each session uses its own owner's Claude account and credits.
  function getLinuxUserForSession(session) {
    if (!osUsers) return null;
    if (!session.ownerId) return null;
    var user = usersModule.findUserById(session.ownerId);
    if (!user || !user.linuxUser) return null;
    return user.linuxUser;
  }

  function ensureProjectAccessForSession(session) {
    var linuxUser = getLinuxUserForSession(session);
    if (linuxUser) {
      grantProjectAccess(cwd, linuxUser);
    }
    return linuxUser;
  }

  function getLinuxUserForWs(ws) {
    if (!osUsers) return null;
    if (!ws._clayUser || !ws._clayUser.linuxUser) return null;
    return ws._clayUser.linuxUser;
  }

  // Cache resolved OS user info to avoid repeated getent calls
  var osUserInfoCache = {};
  function getOsUserInfoForLinuxUser(linuxUser) {
    if (!linuxUser) return null;
    if (osUserInfoCache[linuxUser]) return osUserInfoCache[linuxUser];
    try {
      var info = resolveOsUserInfo(linuxUser);
      osUserInfoCache[linuxUser] = info;
      return info;
    } catch (e) {
      console.error("[project] Failed to resolve OS user info for " + linuxUser + ":", e.message);
      return null;
    }
  }

  function getOsUserInfoForWs(ws) {
    var linuxUser = getLinuxUserForWs(ws);
    return getOsUserInfoForLinuxUser(linuxUser);
  }

  function getOsUserInfoForReq(req) {
    if (!osUsers) return null;
    if (!req._clayUser || !req._clayUser.linuxUser) return null;
    var linuxUser = req._clayUser.linuxUser;
    return getOsUserInfoForLinuxUser(linuxUser);
  }

  function getRuntimeEnvForSession(session) {
    var linuxUser = (session && session.linuxUser) || getLinuxUserForSession(session);
    var osUserInfo = getOsUserInfoForLinuxUser(linuxUser);
    var baseEnv = osUserInfo ? buildUserEnv(osUserInfo) : process.env;
    var shared = typeof opts.onGetSharedEnv === "function" ? opts.onGetSharedEnv() : null;
    var projectEnv = typeof opts.onGetProjectEnv === "function" ? opts.onGetProjectEnv(slug) : null;
    return runtimeEnv.resolveRuntimeEnv({
      baseEnv: baseEnv,
      sharedEnvrc: shared && shared.envrc,
      projectEnvrc: projectEnv && projectEnv.envrc,
    });
  }

  // --- Per-project clients ---
  var clients = new Set();
  var homeDebateClients = new Set();

  // --- Browser extension state (shared mutable object) ---
  var _extToken = crypto.randomUUID(); // Auth token for MCP server bridge
  var browserState = {
    _browserTabList: {},
    _extensionWs: null,
    pendingExtensionRequests: {}
  };

  function sendExtensionCommand(ws, command, args, timeout) {
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      var ms = timeout || 3000;
      var timer = setTimeout(function() {
        delete browserState.pendingExtensionRequests[requestId];
        resolve(null);
      }, ms);
      browserState.pendingExtensionRequests[requestId] = { resolve: resolve, timer: timer };
      sendTo(ws, {
        type: "extension_command",
        command: command,
        args: args,
        requestId: requestId
      });
    });
  }

  // Send extension command via the tracked extension client (for MCP bridge)
  function sendExtensionCommandAny(command, args, timeout) {
    if (!browserState._extensionWs || browserState._extensionWs.readyState !== 1) {
      return Promise.reject(new Error("Browser extension not connected"));
    }
    return sendExtensionCommand(browserState._extensionWs, command, args, timeout);
  }

  function requestTabContext(tabId) {
    if (!browserState._extensionWs || browserState._extensionWs.readyState !== 1) {
      return Promise.resolve(null);
    }
    var extWs = browserState._extensionWs;
    // Try inject first (best-effort), then request all data in parallel.
    // Even if inject fails (CSP etc.), page text and screenshot still work.
    return sendExtensionCommand(extWs, "tab_inject", { tabId: tabId }).then(function() {}, function() {}).then(function() {
      return Promise.all([
        sendExtensionCommand(extWs, "tab_console", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_network", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_page_text", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_screenshot", { tabId: tabId })
      ]);
    }).then(function(results) {
      return {
        console: results[0],
        network: results[1],
        pageText: results[2],
        screenshot: results[3]
      };
    }).catch(function() {
      return null;
    });
  }

  function send(obj) {
    for (var ws of clients) {
      if (ws.readyState !== 1) continue;
      var payload = obj;
      if (obj && obj.type === "info") {
        var infoUserId = ws._clayUser ? ws._clayUser.id : null;
        var visibleProjects = getProjectList(infoUserId);
        payload = Object.assign({}, obj, { projects: visibleProjects, projectCount: visibleProjects.length });
      } else if (obj && obj.type === "loop_registry_updated") {
        var userId = ws._clayUser ? ws._clayUser.id : null;
        payload = Object.assign({}, obj, { records: getHubSchedules(userId) });
      }
      ws.send(JSON.stringify(payload));
    }
  }

  function sendTo(ws, obj) {
    if (ws.readyState !== 1) return;
    var payload = obj;
    if (obj && (obj.type === "loop_registry_updated" || obj.type === "hub_schedules")) {
      var userId = ws._clayUser ? ws._clayUser.id : null;
      payload = Object.assign({}, obj);
      if (obj.type === "loop_registry_updated") payload.records = getHubSchedules(userId);
      else payload.schedules = getHubSchedules(userId);
    }
    ws.send(JSON.stringify(payload));
  }

  function sendToAdmins(obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1 && ws._clayUser && ws._clayUser.role === "admin") ws.send(data);
    }
  }

  // Update version metadata goes only to admin-grade connections, and only to
  // those not currently snoozing this exact version. Both decisions come from
  // update-snooze.js; this loop owns nothing but the client set.
  function broadcastUpdateAvailable(version) {
    if (!version) return;
    var now = Date.now();
    var payload = JSON.stringify({ type: "update_available", version: version });
    for (var ws of clients) {
      if (ws.readyState !== 1) continue;
      if (!updateSnooze.isUpdateAdmin(ws, usersModule)) continue;
      var key = updateSnooze.userKeyFor(ws, usersModule);
      if (updateSnooze.isSnoozed(key, version, now)) continue;
      ws.send(payload);
    }
  }

  // The install lifecycle frame. Every client needs it, because the daemon is
  // about to restart and the UI blocks the screen — but only admin-grade
  // connections get the version with it. Non-admins get the same frame minus
  // the metadata, so behaviour is unchanged for them and nothing leaks.
  function broadcastUpdateStarted(version) {
    var withVersion = JSON.stringify({ type: "update_started", version: version || "" });
    var withoutVersion = JSON.stringify({ type: "update_started" });
    for (var ws of clients) {
      if (ws.readyState !== 1) continue;
      ws.send(updateSnooze.isUpdateAdmin(ws, usersModule) ? withVersion : withoutVersion);
    }
  }

  // Tell every live connection of one user that a snooze took effect, so the
  // banner clears on their other devices too rather than only where it was
  // dismissed. Scoped by the same server-derived key the snooze was stored
  // under, never by anything in a payload.
  function sendToUpdateUser(userKey, obj) {
    if (!userKey) return;
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState !== 1) continue;
      if (updateSnooze.userKeyFor(ws, usersModule) !== userKey) continue;
      ws.send(data);
    }
  }

  function broadcastClientCount() {
    var msg = { type: "client_count", count: clients.size };
    if (usersModule.isMultiUser()) {
      var seen = {};
      var userList = [];
      for (var c of clients) {
        if (!c._clayUser) continue;
        var u = c._clayUser;
        if (seen[u.id]) continue;
        seen[u.id] = true;
        var p = u.profile || {};
        userList.push({
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          avatarStyle: p.avatarStyle || "imprint",
          avatarSeed: p.avatarSeed || u.username,
          avatarCustom: p.avatarCustom || "",
        });
      }
      msg.users = userList;
    }
    send(msg);
    onPresenceChange();
  }

  function sendToOthers(sender, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws !== sender && ws.readyState === 1) ws.send(data);
    }
  }

  function sendToSession(sessionId, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws.readyState === 1 && ws._clayActiveSession === sessionId) {
        ws.send(data);
      }
    }
    homeDebateClients.forEach(function (ws) {
      if (ws.readyState !== 1) { homeDebateClients.delete(ws); return; }
      if (!clients.has(ws) && ws._clayHomeDebateSlug === slug && ws._clayActiveSession === sessionId) ws.send(data);
    });
  }

  function sendToSessionOthers(sender, sessionId, obj) {
    var data = JSON.stringify(obj);
    for (var ws of clients) {
      if (ws !== sender && ws.readyState === 1 && ws._clayActiveSession === sessionId) {
        ws.send(data);
      }
    }
  }

  // --- Knowledge engine (delegated to project-knowledge.js) ---
  var _knowledge = attachKnowledge({
    cwd: cwd,
    isMate: isMate,
    sendTo: sendTo,
    matesModule: matesModule,
    getProjectOwnerId: function () { return projectOwnerId; },
  });

  // --- File/directory watcher engine (delegated to project-file-watch.js) ---
  var _fileWatch = attachFileWatch({
    cwd: cwd,
    send: send,
    sendTo: sendTo,
    safePath: safePath,
    BINARY_EXTS: BINARY_EXTS,
    FS_MAX_SIZE: FS_MAX_SIZE,
    IGNORED_DIRS: IGNORED_DIRS,
  });
  var startFileWatch = _fileWatch.startFileWatch;
  var stopFileWatch = _fileWatch.stopFileWatch;
  var startDirWatch = _fileWatch.startDirWatch;
  var stopDirWatch = _fileWatch.stopDirWatch;
  var stopAllDirWatches = _fileWatch.stopAllDirWatches;

  // --- Session manager ---
  var _gitAttribution = null;
  var sm = createSessionManager({
    cwd: cwd,
    send: send,
    sendTo: sendTo,
    sendEach: function (fn) {
      for (var ws of clients) {
        var user = ws._clayUser;
        var filterFn = null;
        if (usersModule.isMultiUser() && user) {
          filterFn = (function (u) {
            return function (s) {
              return usersModule.canAccessSession(u.id, s, { visibility: "public" });
            };
          })(user);
        }
        fn(ws, filterFn);
      }
    },
    onSessionDone: function (session) {
      if (_gitAttribution) _gitAttribution.finishTurn(session);
      onSessionDone();
    },
  });
  _gitAttribution = attachGitSessionAttribution({
    cwd: cwd,
    getOsUserInfoForSession: function (session) {
      var linuxUser = getLinuxUserForSession(session);
      return linuxUser ? resolveOsUserInfo(linuxUser) : null;
    },
  });
  sm.availableVendors = Object.keys(adapters);
  sm.defaultVendor = defaultVendor;

  var sdk = null;
  var _splitGroups = attachSplitGroups({
    sm: sm,
    clients: clients,
    sendTo: sendTo,
    usersModule: usersModule,
    onPairChanged: function (group) {
      if (!sdk || !group || !Array.isArray(group.members)) return;
      for (var i = 0; i < group.members.length; i++) {
        sdk.refreshSessionRuntime(sm.sessions.get(group.members[i]));
      }
    },
  });

  var _projMode = typeof opts.onGetProjectDefaultMode === "function" ? opts.onGetProjectDefaultMode(slug) : null;
  var _srvMode = typeof opts.onGetServerDefaultMode === "function" ? opts.onGetServerDefaultMode() : null;
  sm._savedDefaultMode = (_projMode && _projMode.mode) || (_srvMode && _srvMode.mode) || "default";
  // Immediately apply the saved default so config_state on connect reflects it
  // before the SDK has warmed up and fired system/init.
  if (sm._savedDefaultMode) sm.currentPermissionMode = sm._savedDefaultMode;

  var _projEffort = typeof opts.onGetProjectDefaultEffort === "function" ? opts.onGetProjectDefaultEffort(slug) : null;
  var _srvEffort = typeof opts.onGetServerDefaultEffort === "function" ? opts.onGetServerDefaultEffort() : null;
  sm.currentEffort = (_projEffort && _projEffort.effort) || (_srvEffort && _srvEffort.effort) || "medium";

  // Last vendor the user started a session with in this project. Seeds the
  // sidebar's "New session" button so it defaults to whatever they used last
  // instead of always launching Claude.
  var _projLastVendor = typeof opts.onGetProjectLastVendor === "function" ? opts.onGetProjectLastVendor(slug) : null;
  sm.lastVendor = (_projLastVendor && _projLastVendor.vendor) || null;

  var _projModel = typeof opts.onGetProjectDefaultModel === "function" ? opts.onGetProjectDefaultModel(slug) : null;
  var _srvModel = typeof opts.onGetServerDefaultModel === "function" ? opts.onGetServerDefaultModel() : null;
  var savedDefaultModel = (_projModel && _projModel.model) || (_srvModel && _srvModel.model) || null;
  sm.defaultModelByVendor = sm.defaultModelByVendor || {};
  if (savedDefaultModel) sm.defaultModelByVendor[sm.defaultVendor || "claude"] = savedDefaultModel;

  // --- Local MCP (direct process management for localhost clients) ---
  var _localMcp = createLocalMcp();

  // --- MCP bridge (remote MCP servers via Chrome Extension) ---
  var _mcp = attachMcp({
    send: send,
    sendTo: sendTo,
    slug: slug,
    isMate: isMate,
    getExtensionWs: function () { return browserState._extensionWs; },
    getExtensionId: function () { return browserState._extensionId || null; },
    getEnabledMcpServers: function () {
      return typeof opts.onGetProjectMcpServers === "function"
        ? opts.onGetProjectMcpServers(slug) : [];
    },
    setEnabledMcpServers: function (servers) {
      if (typeof opts.onSetProjectMcpServers === "function") {
        opts.onSetProjectMcpServers(slug, servers);
      }
    },
    localMcp: _localMcp,
  });

  // --- Email module (delegated to project-email.js) ---
  var _email = attachEmailModule({
    slug: slug,
    send: send,
    sendTo: sendTo,
    clients: clients,
    loadContextSources: loadContextSources,
    getUserIdForWs: function (ws) {
      return (ws._clayUser && ws._clayUser.id) || "default";
    },
  });

  // Sticky-note storage is initialized before session tool wiring so every
  // vendor receives the same handlers and prompt snapshot at query start.
  var nm = createNotesManager({ cwd: cwd, send: send, sendTo: sendTo });
  var _sessionNotes = attachSessionNotes({
    nm: nm,
    send: send,
    isMate: isMate,
    broadcastWritten: function (message) {
      for (var noteWs of clients) {
        if (noteWs.readyState !== 1 || noteWs._clayPane) continue;
        sendTo(noteWs, message);
      }
    },
  });
  var _sessionDocument = attachSessionDocument({
    cwd: cwd,
    isMate: isMate,
    sendToSession: sendToSession,
    FS_MAX_SIZE: FS_MAX_SIZE,
    getOsUserInfoForSession: function (session) {
      var linuxUser = getLinuxUserForSession(session);
      return linuxUser ? resolveOsUserInfo(linuxUser) : null;
    },
    fsAsUser: fsAsUser,
  });
  var _capsuleCatalog = attachCapsuleCatalog({
    isMate: isMate,
    listManifests: listControllableTools,
    getUserId: function (session) {
      return (session && session.ownerId) || projectOwnerId || "default";
    },
    getSdk: function () { return sdk; },
    getSessions: function () { return sm.sessions; },
  });
  var _workspaceQuery = attachProjectWorkspaceQuery({
    service: opts.workspaceQueryService || null,
    sm: sm,
    projectSlug: slug,
    getProjectOwnerId: function () { return projectOwnerId; },
    isMate: isMate,
    mateId: mateId,
  });
  var _logFeedbackDelivery = attachProjectLogFeedbackDelivery({
    sm: sm,
    getSdk: function () { return sdk; },
    onProcessingChanged: onProcessingChanged,
    getLinuxUserForSession: getLinuxUserForSession,
  });
  var _projectLogs = attachProjectLogs({
    service: opts.projectLogsService || null,
    sm: sm,
    projectSlug: slug,
    getProjectOwnerId: function () { return projectOwnerId; },
    isMate: isMate,
    mateId: mateId,
    sendTo: sendTo,
    getClients: function () { return clients; },
    onFeedback: _logFeedbackDelivery.deliver,
  });
  var _mateKnowledge = attachProjectMateKnowledge({
    service: opts.mateKnowledgeService || null,
    sm: sm,
    projectSlug: slug,
    getProjectOwnerId: function () { return projectOwnerId; },
    isMate: isMate,
    mateId: mateId,
  });

  // The SDK bridge is created after local MCP servers. Session spawning uses
  // a getter so tool handlers see the initialized bridge when they run.
  var _sessionPair = attachSessionPair({
    sm: sm,
    isMate: isMate,
    splitStore: _splitGroups.store,
    getSdk: function () { return sdk; },
    send: send,
    sendTo: sendTo,
    broadcastDelegation: function (group, message) {
      for (var pairWs of clients) {
        if (pairWs.readyState !== 1) continue;
        var visibleGroups = _splitGroups.store.listFor(pairWs);
        var canSee = visibleGroups.some(function (visibleGroup) { return visibleGroup.id === group.id; });
        if (canSee) sendTo(pairWs, message);
      }
    },
    usersModule: usersModule,
    getLinuxUserForSession: getLinuxUserForSession,
    onProcessingChanged: onProcessingChanged,
    adapters: adapters,
  });
  var _sessionSpawn = attachSessionSpawn({
    cwd: cwd,
    sm: sm,
    getSdk: function () { return sdk; },
    send: send,
    isMate: isMate,
    usersModule: usersModule,
    adapters: adapters,
    getLinuxUserForSession: getLinuxUserForSession,
    getPairToolDefs: function (boundSession) { return _sessionPair.getToolDefs(boundSession); },
  });
  var _sessionHandoff = attachSessionHandoff({
    cwd: cwd,
    sm: sm,
    isMate: isMate,
    splitStore: _splitGroups.store,
    getSdk: function () { return sdk; },
    sendTo: sendTo,
    usersModule: usersModule,
    adapters: adapters,
    getLinuxUserForSession: getLinuxUserForSession,
    onProcessingChanged: onProcessingChanged,
  });
  var _debate = null;
  var _debateProposal = attachDebateProposal({
    cwd: cwd,
    isMate: isMate,
    isHostAgent: isHostAgent,
    sendTo: sendTo,
    buildMateCtx: matesModule.buildMateCtx,
    getMate: matesModule.getMate,
    getProjectOwnerId: function () { return projectOwnerId; },
    getVendorModelCatalog: function (ws, vendor) { return _models.getVendorCatalog(ws, vendor); },
    getVendorModelCatalogForSession: function (session, vendor) {
      var user = session && session.ownerId ? usersModule.findUserById(session.ownerId) : null;
      return _models.getVendorCatalog({ _clayUser: user || null }, vendor);
    },
    startDebate: function (session, briefData, moderatorId, ws) {
      if (!_debate) return { error: "The debate engine is unavailable." };
      return _debate.handleMcpDebateApproval(session, briefData, moderatorId, ws);
    },
    recordSessionEvent: function (session, event) { sm.sendAndRecord(session, event); },
  });
  var _mateCreationProposal = attachMateCreationProposal({
    isMate: isMate,
    isHostAgent: isHostAgent,
    isMultiUser: usersModule.isMultiUser,
    getProjectOwnerId: function () { return projectOwnerId; },
    recordSessionEvent: function (session, event) { sm.sendAndRecord(session, event); },
    getVendorModelCatalog: function (ws, vendor) { return _models.getVendorCatalog(ws, vendor); },
    createReadyMate: opts.createReadyMate,
  });
  var _askUser = attachAskUser({ record: function (session, event) { sm.sendAndRecord(session, event); } });

  function createToolControlMcpServer() {
    if (!isMate || !adapter || typeof adapter.createToolServer !== "function") return null;
    return createMateToolControlMcp(adapter, {
      userId: projectOwnerId || "default",
      mateId: path.basename(cwd),
      list: listControllableTools,
      control: controlToolForMate,
      source: sourceToolForMate,
      install: installToolForMate,
      update: updateToolForMate,
      remove: removeToolForMate,
    });
  }

  // --- MCP tool servers (created via YOKE adapter) ---
  var mcpServers = (function () {
    var servers = {};

    // Agent-driven sibling session fan-out (main projects only).
    if (!isMate) {
      try {
        var sessionSpawnMcpConfig = _sessionSpawn.createMcpServer(adapter);
        if (sessionSpawnMcpConfig) servers[sessionSpawnMcpConfig.name || "clay-sessions"] = sessionSpawnMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create session spawn MCP server:", e.message);
      }
    }

    // Shared sticky-note memory (main projects only).
    if (!isMate) {
      try {
        var sessionNotesMcpConfig = _sessionNotes.createMcpServer(adapter);
        if (sessionNotesMcpConfig) servers[sessionNotesMcpConfig.name || "clay-notes"] = sessionNotesMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create session notes MCP server:", e.message);
      }
    }

    // Project Logs. Project sessions get the project-scoped set; Mate projects
    // get the read-only cross-project set only when the Mate registry confirms
    // authoritative builtin Clay.
    try {
      var projectLogsMcpConfig = _projectLogs.createMcpServer(adapter, null);
      if (projectLogsMcpConfig) servers[projectLogsMcpConfig.name || "clay-logs"] = projectLogsMcpConfig;
    } catch (e) {
      console.error("[project] Failed to create clay-logs MCP server:", e.message);
    }

    // Mate Knowledge. Mate projects only; the registry decides whether this is
    // one Mate's own scope or authoritative Clay's cross-Mate read view.
    if (isMate) {
      try {
        var mateKnowledgeMcpConfig = _mateKnowledge.createMcpServer(adapter, null);
        if (mateKnowledgeMcpConfig) servers[mateKnowledgeMcpConfig.name || "clay-knowledge"] = mateKnowledgeMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create clay-knowledge MCP server:", e.message);
      }
    }

    // Session-bound access to the source of a handoff (main projects only).
    if (!isMate) {
      try {
        var sessionHandoffMcpConfig = _sessionHandoff.createMcpServer(adapter);
        if (sessionHandoffMcpConfig) servers[sessionHandoffMcpConfig.name || "clay-handoff"] = sessionHandoffMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create session handoff MCP server:", e.message);
      }
    }

    // Explicit agent signal for user-requested Markdown presentation.
    if (!isMate) {
      try {
        var sessionDocumentMcpConfig = _sessionDocument.createMcpServer(adapter);
        if (sessionDocumentMcpConfig) servers[sessionDocumentMcpConfig.name || "clay-documents"] = sessionDocumentMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create session document MCP server:", e.message);
      }
    }

    // Debate MCP server (available to both mates and main project)
    try {
      var debateMcpConfig = _debateProposal.createMcpServer(adapter, null);
      if (debateMcpConfig) servers[debateMcpConfig.name || "clay-debate"] = debateMcpConfig;
    } catch (e) {
      console.error("[project] Failed to create debate MCP server:", e.message);
    }

    if (isMate && isHostAgent) {
      try {
        var mateCreationMcpConfig = _mateCreationProposal.createMcpServer(adapter, null);
        if (mateCreationMcpConfig) servers[mateCreationMcpConfig.name || "clay-mate-creation"] = mateCreationMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create Mate creation MCP server:", e.message);
      }
    }

    // Owner-bound workspace inspection is available only inside Mate
    // projects. The server-side Mate registry decides whether the wider
    // builtin Clay tools are present; project flags and tool arguments do not.
    if (isMate) {
      try {
        var workspaceMcpConfig = _workspaceQuery.createMcpServer(adapter, null);
        if (workspaceMcpConfig) servers[workspaceMcpConfig.name || "clay-workspace"] = workspaceMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create clay-workspace MCP server:", e.message);
      }
      try {
        var clayHistoryMcpConfig = _workspaceQuery.createHistoryMcpServer(adapter, null);
        if (clayHistoryMcpConfig) servers[clayHistoryMcpConfig.name || "clay-history"] = clayHistoryMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create Clay history compatibility server:", e.message);
      }
    }

    if (isMate) {
      try {
        var toolControlMcpConfig = createToolControlMcpServer();
        if (toolControlMcpConfig) servers[toolControlMcpConfig.name || "clay-tools"] = toolControlMcpConfig;
      } catch (e) {
        console.error("[project] Failed to create clay-tools MCP server:", e.message);
      }
    }

    // Browser MCP server (main project only, not mates)
    if (!isMate) {
      try {
        var browserMcp = require("./browser-mcp-server");
        var browserToolDefs = browserMcp.getToolDefs(sendExtensionCommandAny, function () {
          return Object.values(browserState._browserTabList || {});
        }, {
          watchTab: function (tabId) {
            var key = "tab:" + tabId;
            // Apply to all connected clients' active sessions
            for (var c of clients) {
              if (c.readyState !== 1) continue;
              var sid = c._clayActiveSession || null;
              var active = loadContextSources(slug, sid);
              if (active.indexOf(key) === -1) {
                active.push(key);
                saveContextSources(slug, sid, active);
                c.send(JSON.stringify({ type: "context_sources_state", active: active }));
              }
            }
            return [];
          },
          unwatchTab: function (tabId) {
            var key = "tab:" + tabId;
            for (var c of clients) {
              if (c.readyState !== 1) continue;
              var sid = c._clayActiveSession || null;
              var active = loadContextSources(slug, sid);
              var idx = active.indexOf(key);
              if (idx !== -1) {
                active.splice(idx, 1);
                saveContextSources(slug, sid, active);
                c.send(JSON.stringify({ type: "context_sources_state", active: active }));
              }
            }
            return active;
          },
        });
        var mcpConfig = adapter.createToolServer({ name: "clay-browser", version: "1.0.0", tools: browserToolDefs });
        if (mcpConfig) servers[mcpConfig.name || "clay-browser"] = mcpConfig;
      } catch (e) {
        console.error("[project] Failed to create browser MCP server:", e.message);
      }
    }

    // Email MCP server (available to both mates and main project)
    // Note: email-mcp-server still uses the legacy create() pattern (not yet converted to getToolDefs).
    try {
      var emailMcp = require("./email-mcp-server");
      var emailMcpConfig = emailMcp.create(_email.createMcpDeps());
      if (emailMcpConfig) servers[emailMcpConfig.name || "clay-email"] = emailMcpConfig;
    } catch (e) {
      console.error("[project] Failed to create email MCP server:", e.message);
    }

    return Object.keys(servers).length > 0 ? servers : undefined;
  })();

  // Gate in-app MCP servers on the underlying capability actually being
  // available. Without this, tools show up in every session's tool list
  // even when the user can't use them, which wastes context and can cause
  // the model to pick the wrong MCP when the user has another one
  // configured (see issue #325).
  //
  //   clay-browser -> only when the Chrome extension is connected
  //   clay-email   -> only when the user has an account or server SMTP
  //
  // forSession (optional): the session whose query these servers are mounted
  // into. Session, notes, handoff, and document tools must know their caller, so they
  // are re-instantiated bound to that session; static instances only serve
  // descriptor listing and fail closed on calls.
  function getLocalMcpServers(forSession) {
    var extWs = browserState._extensionWs;
    var extConnected = !!(extWs && extWs.readyState === 1);
    var emailAvailable = !!(_email && typeof _email.hasEmailCapability === "function" && _email.hasEmailCapability());
    var keys = Object.keys(mcpServers || {});
    var filtered = {};
    var hasAny = false;
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      if (name === "clay-browser" && !extConnected) continue;
      if (name === "clay-email" && !emailAvailable) continue;
      if (name === "clay-workspace" && forSession) {
        try {
          var boundWorkspace = _workspaceQuery.createMcpServer(adapter, forSession);
          if (boundWorkspace) { filtered[name] = boundWorkspace; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind clay-workspace MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-history" && forSession) {
        try {
          var boundHistory = _workspaceQuery.createHistoryMcpServer(adapter, forSession);
          if (boundHistory) { filtered[name] = boundHistory; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind Clay history compatibility server:", e.message);
        }
        continue;
      }
      if (name === "clay-logs" && forSession) {
        try {
          var boundLogs = _projectLogs.createMcpServer(adapter, forSession);
          if (boundLogs) { filtered[name] = boundLogs; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind clay-logs MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-knowledge" && forSession) {
        try {
          var boundKnowledge = _mateKnowledge.createMcpServer(adapter, forSession);
          if (boundKnowledge) { filtered[name] = boundKnowledge; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind clay-knowledge MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-tools" && forSession) {
        try {
          var boundToolControl = createToolControlMcpServer();
          if (boundToolControl) { filtered[name] = boundToolControl; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind clay-tools MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-sessions" && forSession) {
        try {
          var boundSpawn = _sessionSpawn.createMcpServer(adapter, forSession);
          if (boundSpawn) { filtered[name] = boundSpawn; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind session spawn MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-notes" && forSession) {
        try {
          var boundNotes = _sessionNotes.createMcpServer(adapter, forSession);
          if (boundNotes) { filtered[name] = boundNotes; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind session notes MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-handoff" && forSession) {
        try {
          var boundHandoff = _sessionHandoff.createMcpServer(adapter, forSession);
          if (boundHandoff) { filtered[name] = boundHandoff; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind session handoff MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-documents" && forSession) {
        try {
          var boundDocuments = _sessionDocument.createMcpServer(adapter, forSession);
          if (boundDocuments) { filtered[name] = boundDocuments; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind session document MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-debate" && forSession) {
        try {
          var boundDebate = _debateProposal.createMcpServer(adapter, forSession);
          if (boundDebate) { filtered[name] = boundDebate; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind debate MCP server:", e.message);
        }
        continue;
      }
      if (name === "clay-mate-creation" && forSession) {
        try {
          var boundMateCreation = _mateCreationProposal.createMcpServer(adapter, forSession);
          if (boundMateCreation) { filtered[name] = boundMateCreation; hasAny = true; }
        } catch (e) {
          console.error("[project] Failed to bind Mate creation MCP server:", e.message);
        }
        continue;
      }
      filtered[name] = mcpServers[name];
      hasAny = true;
    }
    return hasAny ? filtered : undefined;
  }

  // --- SDK bridge ---
  sdk = createSDKBridge({
    cwd: cwd,
    slug: slug,
    sessionManager: sm,
    send: send,
    pushModule: pushModule,
    adapter: adapter,
    adapters: adapters,
    getNotificationsModule: function () { return _notifications; },
    shouldSuppressResponseNotification: opts.shouldSuppressResponseNotification,
    mateDisplayName: opts.mateDisplayName || "",
    isMate: isMate,
    osUsers: osUsers,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    mcpServers: getLocalMcpServers,
    getRemoteMcpServers: function () { return _mcp.getMcpServers(); },
    clayPort: serverPort,
    clayTls: serverTls,
    clayAuthToken: serverAuthToken,
    getWorkerPermissionRouter: function () {
      return isMate ? null : _sessionPair.workerPermission;
    },
    onProcessingChanged: onProcessingChanged,
    onTurnDone: function (session, preview) {
      if (isMate) digestDmTurn(session, preview);
      else _sessionPair.handleTurnDone(session);
      if (session && typeof session.onTurnDone === "function") session.onTurnDone(session, preview);
    },
    scheduleMessage: function (session, text, resetsAt) {
      scheduleMessage(session, text, resetsAt);
    },
    saveImageFile: saveImageFile,
    getAutoContinueSetting: function (session) {
      // Per-user setting in multi-user mode
      if (usersModule.isMultiUser() && session && session.ownerId) {
        return usersModule.getAutoContinue(session.ownerId);
      }
      // Single-user: fall back to daemon config
      if (typeof opts.onGetDaemonConfig === "function") {
        var dc = opts.onGetDaemonConfig();
        return !!dc.autoContinueOnRateLimit;
      }
      return false;
    },
    getSessionSystemPrompt: function (session) {
      return composeSystemPrompts([
        _sessionPair.getSystemPrompt(session),
        _sessionNotes.getSystemPrompt(session),
        _sessionHandoff.getSystemPrompt(session),
        _sessionDocument.getSystemPrompt(session),
        _capsuleCatalog.getSystemPrompt(session),
        _projectLogs.getSystemPrompt(session),
        _mateKnowledge.getSystemPrompt(session),
      ]);
    },
    getRuntimeEnv: getRuntimeEnvForSession,
    onUserInputRequest: function (session, request, respond) {
      return _askUser.createHandler(session)(request, respond);
    },
    getSessionToolDefs: function (session) {
      return _sessionPair.getToolDefs(session)
        .concat(_sessionNotes.getToolDefs(session))
        .concat(_sessionHandoff.getToolDefs(session))
        .concat(_sessionDocument.getToolDefs(session))
        .concat(_debateProposal.getToolDefs(session))
        .concat(_mateCreationProposal.getToolDefs(session))
        .concat(_workspaceQuery.getDynamicToolDefs(session))
        .concat(_workspaceQuery.getHistoryDynamicToolDefs(session))
        .concat(_projectLogs.getDynamicToolDefs(session))
        .concat(_mateKnowledge.getDynamicToolDefs(session));
    },
  });

  // --- Loop engine (delegated to project-loop.js) ---
  // --- Notification center (global singleton from server.js) ---
  var _notifications = opts.notificationsModule || null;

  var _loop = attachLoop({
    cwd: cwd,
    slug: slug,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    pushModule: pushModule,
    notificationsModule: _notifications,
    getHubSchedules: getHubSchedules,
    getLinuxUserForSession: getLinuxUserForSession,
    onProcessingChanged: onProcessingChanged,
    hydrateImageRefs: hydrateImageRefs,
  });
  var loopState = _loop.loopState;
  var loopRegistry = _loop.loopRegistry;
  var loopDir = _loop.loopDir;
  var startLoop = _loop.startLoop;
  var stopLoop = _loop.stopLoop;
  var resumeLoop = _loop.resumeLoop;

  // Mate CLAUDE.md crisis safety watcher
  var crisisWatcher = null;
  var crisisDebounce = null;



  // --- Terminal manager ---
  var tm = createTerminalManager({ cwd: cwd, send: send, sendTo: sendTo });

  // Check for updates in background (admin only). The result is stored in
  // latestVersion; broadcast is handled by the hourly scheduler below, so
  // page refreshes don't re-trigger the banner.
  function runVersionCheck(broadcast) {
    fetchVersion(updateChannel).then(function (v) {
      if (v && isNewer(v, currentVersion)) {
        latestVersion = v;
        if (broadcast) broadcastUpdateAvailable(v);
      }
    }).catch(function (e) {
      console.error("[project] Background version check failed:", e.message || e);
    });
  }
  runVersionCheck(false);

  // Push update_available on every hour boundary. Clients can dismiss the
  // banner; the next hourly push acts as a fresh ping. This avoids needing
  // any dismissed-state persistence.
  function scheduleNextHourlyBroadcast() {
    var now = Date.now();
    var msUntilNextHour = 60 * 60 * 1000 - (now % (60 * 60 * 1000));
    setTimeout(function tick() {
      runVersionCheck(true);
      setTimeout(tick, 60 * 60 * 1000);
    }, msUntilNextHour);
  }
  scheduleNextHourlyBroadcast();

  // --- WS connection handler (delegated to project-connection.js) ---
  function handleConnection(ws, wsUser) {
    _connection.handleConnection(ws, wsUser, handleMessage, handleDisconnection);

    // Initialize local MCP when a localhost client connects
    if (ws._clayLocal && _localMcp && !_localMcp.isReady()) {
      _localMcp.initialize(function () {
        // Rebuild proxy servers and broadcast state when local servers are ready
        _mcp.rebuildAndBroadcast();
      });
    }
  }

  // --- WS message handler ---
  function getSessionForWs(ws) {
    return sm.sessions.get(ws._clayActiveSession) || null;
  }

  // --- Schedule / cancel a message (used by WS handler and auto-continue) ---
  function scheduleMessage(session, text, resetsAt) {
    if (!session || !text || !resetsAt) return;
    // Cancel any existing scheduled message
    if (session.scheduledMessage && session.scheduledMessage.timer) {
      clearTimeout(session.scheduledMessage.timer);
    }
    var isPastReset = resetsAt <= Date.now();
    var schedDelay = isPastReset ? 5000 : Math.max(0, resetsAt - Date.now()) + 60000; // +1min buffer after reset, or 5s for immediate
    var sendsAt = Date.now() + schedDelay;
    var schedEntry = {
      type: "scheduled_message_queued",
      text: text,
      resetsAt: sendsAt,
      scheduledAt: Date.now(),
    };
    sm.sendAndRecord(session, schedEntry);
    session.scheduledMessage = {
      text: text,
      resetsAt: resetsAt,
      timer: setTimeout(function () {
        session.scheduledMessage = null;
        if (session.destroying) return;
        console.log("[project] Scheduled message firing for session " + session.localId);
        sm.sendAndRecord(session, { type: "scheduled_message_sent" });
        var schedUserMsg = { type: "user_message", text: text, _ts: Date.now() };
        session.history.push(schedUserMsg);
        sm.appendToSessionFile(session, schedUserMsg);
        sendToSession(session.localId, schedUserMsg);
        session.isProcessing = true;
        onProcessingChanged();
        sendToSession(session.localId, { type: "status", status: "processing" });
        sdk.startQuery(session, text, null, ensureProjectAccessForSession(session));
        sm.broadcastSessionList();
      }, schedDelay),
    };
  }

  function cancelScheduledMessage(session) {
    if (!session) return;
    if (session.scheduledMessage && session.scheduledMessage.timer) {
      clearTimeout(session.scheduledMessage.timer);
      session.scheduledMessage = null;
      session.rateLimitAutoContinuePending = false;
      sm.sendAndRecord(session, { type: "scheduled_message_cancelled" });
    }
  }

  function handleMessage(ws, msg) {
    // --- Keep-alive (delegated to project-connection.js) ---
    // Answered before any routing so a ping can never be forwarded elsewhere.
    // _connection is assigned later in this factory than the other modules, so
    // the reference is guarded rather than assumed.
    if (_connection && _connection.handleKeepaliveMessage(ws, msg)) return;

    if (ws._clayHomeDebateSlug && ws._clayHomeDebateSlug !== slug && /^debate_(hand_raise|comment|stop|conclude_response|user_floor_response)$/.test(msg.type || "") && opts.getProject) {
      var homeDebateCtx = opts.getProject(ws._clayHomeDebateSlug);
      if (homeDebateCtx) homeDebateCtx.handleMessage(ws, msg);
      return;
    }
    // --- Cross-project routing (e.g. permission_response from notification banner) ---
    if (msg.targetSlug && msg.targetSlug !== slug && opts.getProject) {
      var targetCtx = opts.getProject(msg.targetSlug);
      if (targetCtx) {
        targetCtx.handleMessage(ws, msg);
        return;
      }
    }

    // --- DM messages (delegated to server-level handler) ---
    if (msg.type === "home_debate_question_response" || msg.type === "home_debate_control" || msg.type === "home_mate_creation_question_response") {
      if (typeof opts.onDmMessage === "function") opts.onDmMessage(ws, msg);
      return;
    }
    if (msg.type === "home_clay_ask" || msg.type === "home_clay_session_resolve" || msg.type === "home_clay_log_resolve") {
      if (typeof opts.onDmMessage === "function") opts.onDmMessage(ws, msg, slug);
      return;
    }
    if (msg.type === "project_assignment_response" || msg.type === "dm_open" || msg.type === "dm_send" || msg.type === "dm_list" || msg.type === "dm_typing" || msg.type === "dm_add_favorite" || msg.type === "dm_remove_favorite" || msg.type === "mate_create" || msg.type === "mate_list" || msg.type === "mate_delete" || msg.type === "mate_update" || msg.type === "mate_readd_builtin" || msg.type === "mate_list_available_builtins" || msg.type === "email_accounts_list" || msg.type === "email_account_add" || msg.type === "email_account_remove" || msg.type === "email_account_test" || msg.type === "home_debates_list" || msg.type === "home_mate_present" || msg.type === "home_mate_open" || msg.type === "home_mate_sessions_list" || msg.type === "home_mate_session_open" || msg.type === "home_mate_send" || msg.type === "home_mate_new_session" || msg.type === "home_mate_debate_plan" || msg.type === "home_debate_proposal_response" || msg.type === "home_mate_creation_plan" || msg.type === "home_mate_creation_proposal_response" || msg.type === "home_mate_close" || msg.type === "home_mate_memory_list" || msg.type === "home_mate_knowledge_list" || msg.type === "home_mate_models_get" || msg.type === "home_mate_model_set" || msg.type === "home_dock_get" || msg.type === "home_dock_set" || msg.type === "home_surface_get" || msg.type === "home_surface_set" || msg.type === "tools_list" || msg.type === "tool_get" || msg.type === "tool_install" || msg.type === "tool_remove" || msg.type === "tool_storage_op" || msg.type === "tool_llm_op" || msg.type === "tool_llm_config_get" || msg.type === "tool_control_response" || msg.type === "tool_source_get" || msg.type === "tool_mate_access_set" || msg.type === "tool_server_control" || msg.type === "tool_frame_url") {
      if (typeof opts.onDmMessage === "function") {
        opts.onDmMessage(ws, msg, slug);
      }
      return;
    }

    // --- @Mention: invoke another Mate inline ---
    if (msg.type === "mention") {
      handleMention(ws, msg);
      return;
    }

    // --- @Mention: user-to-user side conversation in this session ---
    if (msg.type === "user_mention") {
      handleUserMention(ws, msg);
      return;
    }

    if (msg.type === "mention_stop") {
      var session = getSessionForWs(ws);
      if (session && session._mentionInProgress) {
        // Abort the active mention session for this mate
        var mateId = msg.mateId;
        if (mateId && session._mentionSessions && session._mentionSessions[mateId]) {
          session._mentionSessions[mateId].abort();
          session._mentionSessions[mateId].close();
          delete session._mentionSessions[mateId];
        }
        session._mentionInProgress = false;
        session._mentionActiveMateId = null;
        sendToSession(session.localId, { type: "mention_done", mateId: mateId, stopped: true });
        send({ type: "mention_processing", mateId: mateId, active: false });
      }
      return;
    }

    // --- Debate ---
    if (msg.type === "debate_start") {
      handleDebateStart(ws, msg);
      return;
    }
    if (msg.type === "debate_hand_raise") {
      handleDebateHandRaise(ws);
      return;
    }
    if (msg.type === "debate_comment") {
      handleDebateComment(ws, msg);
      return;
    }
    if (msg.type === "debate_stop") {
      handleDebateStop(ws);
      return;
    }
    if (msg.type === "debate_conclude_response") {
      handleDebateConcludeResponse(ws, msg);
      return;
    }
    if (msg.type === "debate_confirm_brief") {
      handleDebateConfirmBrief(ws);
      return;
    }
    if (_debateProposal.handleMessage(ws, msg)) return;
    if (msg.type === "debate_user_floor_response") {
      handleDebateUserFloorResponse(ws, msg);
      return;
    }

    // --- MCP bridge (remote MCP servers via extension) ---
    if (_mcp.handleMcpMessage(ws, msg)) return;

    // --- Knowledge file management (delegated to project-knowledge.js) ---
    if (_knowledge.handleKnowledgeMessage(ws, msg)) return;

    // --- Project Logs (delegated to project-logs.js) ---
    if (_projectLogs.handleLogsMessage(ws, msg)) return;

    // --- Notifications (delegated to project-notifications.js) ---
    if (_notifications.handleNotificationMessage(ws, msg)) return;

    // --- Memory (session digests) management (delegated to project-memory.js) ---
    if (msg.type === "memory_list") { _memory.handleMemoryList(ws); return; }
    if (msg.type === "memory_search") { _memory.handleMemorySearch(ws, msg); return; }
    if (msg.type === "memory_delete") { _memory.handleMemoryDelete(ws, msg); return; }

    // --- Sessions, config, project mgmt (delegated to project-sessions.js) ---
    if (_sessionPair.handleMessage(ws, msg)) return;
    if (_sessionHandoff.handleMessage(ws, msg)) return;
    if (_splitGroups.handleMessage(ws, msg)) return;
    if (_models.handleMessage(ws, msg)) return;
    if (_sessions.handleSessionsMessage(ws, msg)) return;

    // --- Filesystem, settings, env (delegated to project-filesystem.js) ---
    if (_filesystem.handleFilesystemMessage(ws, msg)) return;

    // --- Shell command context ---
    if (_shellCommand.handleShellCommand(ws, msg)) return;

    // --- Vendor login flow (delegated to project-vendor-login.js) ---
    if (_vendorLogin.handleVendorLoginMessage(ws, msg)) return;

    // --- Notes, terminals, context, user message (delegated to project-user-message.js) ---
    if (_userMessage.handleUserMessage(ws, msg)) return;
  }

  // --- Shared helpers ---

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // --- Memory engine (delegated to project-memory.js) ---
  var _memory = attachMemory({
    cwd: cwd,
    sm: sm,
    sdk: sdk,
    sendTo: sendTo,
    matesModule: matesModule,
    sessionSearch: sessionSearch,
    getWorkspaceMemorySessions: function () { return _workspaceQuery.getMemorySessions(true); },
    getOwnedCurrentSessions: function () {
      return _workspaceQuery.getMemorySessions(false).filter(function (session) {
        return session._projectSlug === slug;
      });
    },
    projectOwnerId: projectOwnerId,
    handleMessage: handleMessage,
  });
  var loadMateDigests = _memory.loadMateDigests;
  var gateMemory = _memory.gateMemory;
  var updateMemorySummary = _memory.updateMemorySummary;
  var initMemorySummary = _memory.initMemorySummary;

  // --- Mate interaction engine (delegated to project-mate-interaction.js) ---
  // Note: checkForDmDebateBrief comes from _debate (initialized below),
  // so we use a lazy getter that resolves at call time.
  var _mateInteraction = attachMateInteraction({
    cwd: cwd,
    slug: slug,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    sendToSessionOthers: sendToSessionOthers,
    matesModule: matesModule,
    isMate: isMate,
    projectOwnerId: projectOwnerId,
    getSessionForWs: getSessionForWs,
    getLinuxUserForSession: getLinuxUserForSession,
    saveImageFile: saveImageFile,
    hydrateImageRefs: hydrateImageRefs,
    onProcessingChanged: onProcessingChanged,
    loadMateDigests: loadMateDigests,
    updateMemorySummary: updateMemorySummary,
    initMemorySummary: initMemorySummary,
    getNotificationsModule: function () { return _notifications; },
    get checkForDmDebateBrief() { return checkForDmDebateBrief; },
  });
  var handleMention = _mateInteraction.handleMention;
  var getMateProfile = _mateInteraction.getMateProfile;
  var loadMateClaudeMd = _mateInteraction.loadMateClaudeMd;
  var digestDmTurn = _mateInteraction.digestDmTurn;
  var enqueueDigest = _mateInteraction.enqueueDigest;

  // --- User-to-user mention engine (delegated to project-user-mention.js) ---
  var _userMention = attachUserMention({
    slug: slug,
    sm: sm,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    sendToSessionOthers: sendToSessionOthers,
    getSessionForWs: getSessionForWs,
    getLinuxUserForSession: getLinuxUserForSession,
    saveImageFile: saveImageFile,
    hydrateImageRefs: hydrateImageRefs,
    usersModule: usersModule,
    pushModule: pushModule,
    isUserOnline: opts.isUserOnline || function () { return false; },
    getNotificationsModule: function () { return _notifications; },
    getProjectTitle: function () { return title || slug; },
  });
  var handleUserMention = _userMention.handleUserMention;

  // --- Debate engine (delegated to project-debate.js) ---
  _debate = attachDebate({
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    projectOwnerId: projectOwnerId,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    sm: sm,
    sdk: sdk,
    getMateProfile: getMateProfile,
    loadMateClaudeMd: loadMateClaudeMd,
    loadMateDigests: loadMateDigests,
    hydrateImageRefs: hydrateImageRefs,
    onProcessingChanged: onProcessingChanged,
    getLinuxUserForSession: getLinuxUserForSession,
    getSessionForWs: getSessionForWs,
    updateMemorySummary: updateMemorySummary,
    initMemorySummary: initMemorySummary,
    registerHomeDebateClient: function (ws) { if (ws) homeDebateClients.add(ws); },
    unregisterHomeDebateClient: function (ws) { homeDebateClients.delete(ws); },
  });
  var handleDebateStart = _debate.handleDebateStart;
  var handleDebateHandRaise = _debate.handleDebateHandRaise;
  var handleDebateComment = _debate.handleDebateComment;
  var handleDebateStop = _debate.handleDebateStop;
  var handleDebateConcludeResponse = _debate.handleDebateConcludeResponse;
  var handleDebateConfirmBrief = _debate.handleDebateConfirmBrief;
  var handleDebateUserFloorResponse = _debate.handleDebateUserFloorResponse;
  var restoreDebateState = _debate.restoreDebateState;
  var checkForDmDebateBrief = _debate.checkForDmDebateBrief;

  // --- Session presence (who is viewing which session) ---
  function broadcastPresence() {
    if (!usersModule.isMultiUser()) return;
    var presence = {};
    for (var c of clients) {
      if (!c._clayUser || !c._clayActiveSession) continue;
      var sid = c._clayActiveSession;
      if (!presence[sid]) presence[sid] = [];
      var u = c._clayUser;
      var p = u.profile || {};
      // Deduplicate: skip if this user is already listed for this session
      var dominated = false;
      for (var di = 0; di < presence[sid].length; di++) {
        if (presence[sid][di].id === u.id) { dominated = true; break; }
      }
      if (dominated) continue;
      presence[sid].push({
        id: u.id,
        displayName: p.name || u.displayName || u.username,
        username: u.username,
        avatarStyle: p.avatarStyle || "imprint",
        avatarSeed: p.avatarSeed || u.username,
        avatarColor: p.avatarColor || "#5857fc",
        avatarCustom: p.avatarCustom || "",
      });
    }
    send({ type: "session_presence", presence: presence });
  }

  // --- WS disconnection handler (delegated to project-connection.js) ---
  function handleDisconnection(ws) {
    // Clean up extension WS reference if this was the extension client
    if (browserState._extensionWs === ws) {
      browserState._extensionWs = null;
      browserState._extensionId = null;
      if (_mcp) _mcp.handleExtensionDisconnect();
    }
    homeDebateClients.delete(ws);
    if (ws._clayHomeDebateSlug && ws._clayHomeDebateSlug !== slug && opts.getProject) {
      var debateProject = opts.getProject(ws._clayHomeDebateSlug);
      if (debateProject && typeof debateProject.unregisterHomeDebateClient === "function") debateProject.unregisterHomeDebateClient(ws);
    }
    _connection.handleDisconnection(ws);
  }

  // --- Sessions/config/project handler (delegated to project-sessions.js) ---
  var _sessions = attachSessions({
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    osUsers: osUsers,
    debug: debug,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    currentVersion: currentVersion,
    sm: sm,
    sdk: sdk,
    tm: tm,
    clients: clients,
    send: send,
    sendTo: sendTo,
    sendToAdmins: sendToAdmins,
    broadcastUpdateAvailable: broadcastUpdateAvailable,
    broadcastUpdateStarted: broadcastUpdateStarted,
    sendToUpdateUser: sendToUpdateUser,
    sendToSession: sendToSession,
    sendToSessionOthers: sendToSessionOthers,
    opts: opts,
    usersModule: usersModule,
    getProjectAccess: opts.getProjectAccess || function () { return { visibility: "public", ownerId: projectOwnerId || null }; },
    userPresence: userPresence,
    matesModule: matesModule,
    pushModule: pushModule,
    getSessionForWs: getSessionForWs,
    onHumanPairStop: function (session) { return _sessionPair.handleHumanStop(session); },
    getLinuxUserForSession: getLinuxUserForSession,
    ensureProjectAccessForSession: ensureProjectAccessForSession,
    getOsUserInfoForWs: getOsUserInfoForWs,
    hydrateImageRefs: hydrateImageRefs,
    onProcessingChanged: onProcessingChanged,
    broadcastPresence: broadcastPresence,
    adapter: adapter,
    getProjectList: getProjectList,
    getProjectCount: getProjectCount,
    getScheduleCount: getScheduleCount,
    moveScheduleToProject: moveScheduleToProject,
    moveAllSchedulesToProject: moveAllSchedulesToProject,
    getHubSchedules: getHubSchedules,
    fetchVersion: fetchVersion,
    isNewer: isNewer,
    scheduleMessage: scheduleMessage,
    cancelScheduledMessage: cancelScheduledMessage,
    getProjectOwnerId: function () { return projectOwnerId; },
    setProjectOwnerId: function (id) { projectOwnerId = id; },
    getUpdateChannel: function () { return updateChannel; },
    setUpdateChannel: function (ch) { updateChannel = ch; },
    getLatestVersion: function () { return latestVersion; },
    setLatestVersion: function (v) { latestVersion = v; },
    onCreateWorktree: onCreateWorktree,
    IGNORED_DIRS: IGNORED_DIRS,
    loadContextSources: loadContextSources,
    saveContextSources: saveContextSources,
    _email: _email,
    _notifications: _notifications,
  });

  var _models = attachModels({
    cwd: cwd,
    slug: slug,
    sm: sm,
    sdk: sdk,
    adapters: adapters,
    sendTo: sendTo,
    getSessionForWs: getSessionForWs,
    getLinuxUserForWs: getLinuxUserForWs,
    serverPort: serverPort,
    serverTls: serverTls,
    serverAuthToken: serverAuthToken,
  });
  var _delegatedSession = attachDelegatedSession({
    sm: sm,
    getSdk: function () { return sdk; },
    getLinuxUserForSession: getLinuxUserForSession,
    resolveModel: function (principal) {
      var user = principal && principal.userId ? usersModule.findUserById(principal.userId) : null;
      return _models.resolveConfiguredModel({ _clayUser: user || null }, "standard");
    },
  });
  var _capsuleTurn = attachCapsuleTurn({
    sm: sm,
    getSdk: function () { return sdk; },
    getLinuxUserForSession: getLinuxUserForSession,
    isMultiUser: function () { return usersModule.isMultiUser(); },
    resolveModel: function (principal) {
      var user = principal && principal.userId ? usersModule.findUserById(principal.userId) : null;
      return _models.resolveConfiguredModel({ _clayUser: user || null }, "standard");
    },
  });
  var _delegatedFollowUp = attachDelegatedFollowUp({
    sm: sm,
    getSdk: function () { return sdk; },
    getLinuxUserForSession: getLinuxUserForSession,
    onProcessingChanged: onProcessingChanged,
    isMultiUser: function () { return usersModule.isMultiUser(); },
    sessionRef: function (session) { return workspaceSessionRef(slug, session); },
    isPairedSession: function (session) { return !!_splitGroups.store.groupForMember(session.localId); },
    canResumeVendor: function (vendor) {
      var capabilities = sm.capabilitiesByVendor && sm.capabilitiesByVendor[vendor];
      return !!(capabilities && capabilities.sessionResume === true);
    },
  });

  // --- User message handler (delegated to project-user-message.js) ---
  var _userMessage = attachUserMessage({
    // Exact live pair state decides whether a session is Driver-operated; the
    // handler never infers the role from the message.
    isDriverOperatedSession: function (session) {
      if (isMate || !_sessionPair.workerPermission) return false;
      return _sessionPair.workerPermission.isDriverOperated(session);
    },
    beginHumanPairTurn: function (session) { return _sessionPair.beginHumanTurn(session); },
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    osUsers: osUsers,
    sm: sm,
    sdk: sdk,
    nm: nm,
    tm: tm,
    clients: clients,
    send: send,
    sendTo: sendTo,
    sendToSession: sendToSession,
    sendToSessionOthers: sendToSessionOthers,
    opts: opts,
    usersModule: usersModule,
    matesModule: matesModule,
    getSessionForWs: getSessionForWs,
    getLinuxUserForSession: getLinuxUserForSession,
    ensureProjectAccessForSession: ensureProjectAccessForSession,
    getOsUserInfoForWs: getOsUserInfoForWs,
    hydrateImageRefs: hydrateImageRefs,
    saveImageFile: saveImageFile,
    imagesDir: imagesDir,
    onProcessingChanged: onProcessingChanged,
    gitAttribution: _gitAttribution,
    _loop: _loop,
    browserState: browserState,
    sendExtensionCommandAny: sendExtensionCommandAny,
    requestTabContext: requestTabContext,
    scheduleMessage: scheduleMessage,
    cancelScheduledMessage: cancelScheduledMessage,
    loadContextSources: loadContextSources,
    saveContextSources: saveContextSources,
    digestDmTurn: digestDmTurn,
    gateMemory: gateMemory,
    escapeRegex: escapeRegex,
    adapter: adapter,
    getHubSchedules: getHubSchedules,
    getProjectOwnerId: function () { return projectOwnerId; },
    _email: _email,
  });

  var _shellCommand = attachShellCommand({
    cwd: cwd,
    osUsers: osUsers,
    usersModule: usersModule,
    sendTo: sendTo,
    getSessionForWs: getSessionForWs,
    getOsUserInfoForWs: getOsUserInfoForWs,
  });

  // --- Vendor login flow (delegated to project-vendor-login.js) ---
  var _vendorLogin = attachVendorLogin({
    slug: slug,
    osUsers: osUsers,
    sm: sm,
    tm: tm,
    adapters: adapters,
    send: send,
    sendTo: sendTo,
    usersModule: usersModule,
    getOsUserInfoForWs: getOsUserInfoForWs,
    getOsUserInfoForLinuxUser: getOsUserInfoForLinuxUser,
    getLinuxUserForSession: getLinuxUserForSession,
    refreshVendorAuthEverywhere: opts.refreshVendorAuthEverywhere,
  });

  // --- Filesystem handler (delegated to project-filesystem.js) ---
  var _filesystem = attachFilesystem({
    cwd: cwd,
    slug: slug,
    osUsers: osUsers,
    sm: sm,
    send: send,
    sendTo: sendTo,
    safePath: safePath,
    safeAbsPath: safeAbsPath,
    getOsUserInfoForWs: getOsUserInfoForWs,
    startFileWatch: startFileWatch,
    stopFileWatch: stopFileWatch,
    startDirWatch: startDirWatch,
    usersModule: usersModule,
    fsAsUser: fsAsUser,
    validateEnvString: validateEnvString,
    onEnvironmentChanged: function () { return sdk.refreshEnvironmentRuntime(); },
    opts: opts,
    IGNORED_DIRS: IGNORED_DIRS,
    BINARY_EXTS: BINARY_EXTS,
    IMAGE_EXTS: IMAGE_EXTS,
    FS_MAX_SIZE: FS_VIEWER_MAX_SIZE,
  });

  // --- MCP bridge handler for Codex and session-bound Kiro tools ---
  // Provides list_tools and call_tool operations over HTTP for mcp-bridge-server.js.
  // The normal Codex bridge excludes local MCP servers it manages natively;
  // Kiro's session-only bridge exposes only tools bound to its Clay session.
  function getMcpBridgeHandler(sessionId, sessionOnly) {
    var boundSession = Number.isInteger(sessionId) ? sm.sessions.get(sessionId) : null;
    // Build set of local MCP server names to exclude (Codex handles these natively)
    var localMcpNames = {};
    try {
      var mcpLocalModule = require("./mcp-local");
      var localConfig = mcpLocalModule.readMergedServers();
      var lcNames = Object.keys(localConfig);
      for (var li = 0; li < lcNames.length; li++) {
        localMcpNames[lcNames[li]] = true;
      }
    } catch (e) { /* no local MCP config */ }

    return {
      listTools: function () {
        var tools = [];
        var toJSONSchema;
        var zod;
        try { zod = require("zod"); toJSONSchema = zod.toJSONSchema; } catch (e) { /* fallback */ }

        function normalizeToolSchema(inputSchema) {
          if (inputSchema && typeof inputSchema.type === "string") return inputSchema;
          try {
            if (toJSONSchema && inputSchema) {
              var schema = inputSchema.safeParse ? inputSchema : zod.object(inputSchema);
              return toJSONSchema(schema);
            }
          } catch (e) { /* fallback */ }
          return { type: "object", properties: {} };
        }

        // Helper to extract tools from an SDK MCP server object
        function extractServerTools(serverName, server) {
          if (!server || !server.instance || !server.instance._registeredTools) return;
          var toolNames = Object.keys(server.instance._registeredTools);
          for (var j = 0; j < toolNames.length; j++) {
            var toolDef = server.instance._registeredTools[toolNames[j]];
            var inputSchema = normalizeToolSchema(toolDef.inputSchema);
            tools.push({
              server: serverName,
              name: toolNames[j],
              description: toolDef.description || toolNames[j],
              inputSchema: inputSchema,
            });
          }
        }

        if (boundSession) {
          var pairTools = _sessionPair.getToolDefs(boundSession);
          for (var pti = 0; pti < pairTools.length; pti++) {
            tools.push({
              server: "clay-sessions",
              name: pairTools[pti].name,
              description: pairTools[pti].description || pairTools[pti].name,
              inputSchema: normalizeToolSchema(pairTools[pti].inputSchema),
            });
          }
          var noteTools = _sessionNotes.getToolDefs(boundSession);
          for (var nti = 0; nti < noteTools.length; nti++) {
            tools.push({
              server: "clay-notes",
              name: noteTools[nti].name,
              description: noteTools[nti].description || noteTools[nti].name,
              inputSchema: normalizeToolSchema(noteTools[nti].inputSchema),
            });
          }
          var handoffTools = _sessionHandoff.getToolDefs(boundSession);
          for (var hti = 0; hti < handoffTools.length; hti++) {
            tools.push({
              server: "clay-handoff",
              name: handoffTools[hti].name,
              description: handoffTools[hti].description || handoffTools[hti].name,
              inputSchema: normalizeToolSchema(handoffTools[hti].inputSchema),
            });
          }
          var documentTools = _sessionDocument.getToolDefs(boundSession);
          for (var dti = 0; dti < documentTools.length; dti++) {
            tools.push({
              server: "clay-documents",
              name: documentTools[dti].name,
              description: documentTools[dti].description || documentTools[dti].name,
              inputSchema: normalizeToolSchema(documentTools[dti].inputSchema),
            });
          }
          var debateTools = _debateProposal.getBridgeTools(boundSession, normalizeToolSchema);
          for (var dbti = 0; dbti < debateTools.length; dbti++) tools.push(debateTools[dbti]);
          var mateCreationTools = _mateCreationProposal.getBridgeTools(boundSession, normalizeToolSchema);
          for (var mcti = 0; mcti < mateCreationTools.length; mcti++) tools.push(mateCreationTools[mcti]);
          var workspaceTools = _workspaceQuery.getBridgeTools(boundSession, normalizeToolSchema);
          for (var wqti = 0; wqti < workspaceTools.length; wqti++) tools.push(workspaceTools[wqti]);
          var historyTools = _workspaceQuery.getHistoryBridgeTools(boundSession, normalizeToolSchema);
          for (var cht = 0; cht < historyTools.length; cht++) tools.push(historyTools[cht]);
          var logsTools = _projectLogs.getBridgeTools(boundSession, normalizeToolSchema);
          for (var plti = 0; plti < logsTools.length; plti++) tools.push(logsTools[plti]);
          var knowledgeTools = _mateKnowledge.getBridgeTools(boundSession, normalizeToolSchema);
          for (var mkti = 0; mkti < knowledgeTools.length; mkti++) tools.push(knowledgeTools[mkti]);
        }

        if (sessionOnly) return Promise.resolve(tools);

        // In-app MCP servers (debate, browser, email).
        // Use getLocalMcpServers() so clay-browser is hidden unless the
        // Chrome extension is currently connected (see issue #325).
        var localMcp = getLocalMcpServers(boundSession);
        if (localMcp) {
          var inAppNames = Object.keys(localMcp);
          for (var i = 0; i < inAppNames.length; i++) {
            if (inAppNames[i] === "clay-sessions" || inAppNames[i] === "clay-notes" || inAppNames[i] === "clay-handoff" || inAppNames[i] === "clay-documents") continue;
            // Debate tools were added above only when this request had an
            // exact session. Never duplicate them or advertise the static,
            // intentionally unbound proposal server.
            if (inAppNames[i] === "clay-debate" || inAppNames[i] === "clay-mate-creation" || inAppNames[i] === "clay-workspace" || inAppNames[i] === "clay-history" || inAppNames[i] === "clay-logs" || inAppNames[i] === "clay-knowledge") continue;
            extractServerTools(inAppNames[i], localMcp[inAppNames[i]]);
          }
        }

        // Remote MCP servers (extension-proxied only, skip local proxy servers)
        var remoteServers = _mcp.getMcpServers();
        if (remoteServers) {
          var remoteNames = Object.keys(remoteServers);
          for (var ri = 0; ri < remoteNames.length; ri++) {
            // Skip servers that Codex manages natively via Track 1
            if (localMcpNames[remoteNames[ri]]) continue;
            extractServerTools(remoteNames[ri], remoteServers[remoteNames[ri]]);
          }
        }

        return Promise.resolve(tools);
      },
      callTool: function (serverName, toolName, args) {
        if (boundSession && serverName === "clay-sessions") {
          var pairTools = _sessionPair.getToolDefs(boundSession);
          for (var pti = 0; pti < pairTools.length; pti++) {
            if (pairTools[pti].name === toolName && typeof pairTools[pti].handler === "function") {
              return Promise.resolve(pairTools[pti].handler(args || {}));
            }
          }
        }
        if (boundSession && serverName === "clay-notes") {
          var noteTools = _sessionNotes.getToolDefs(boundSession);
          for (var nti = 0; nti < noteTools.length; nti++) {
            if (noteTools[nti].name === toolName && typeof noteTools[nti].handler === "function") {
              return Promise.resolve(noteTools[nti].handler(args || {}));
            }
          }
        }
        if (boundSession && serverName === "clay-handoff") {
          var handoffTools = _sessionHandoff.getToolDefs(boundSession);
          for (var hti = 0; hti < handoffTools.length; hti++) {
            if (handoffTools[hti].name === toolName && typeof handoffTools[hti].handler === "function") {
              return Promise.resolve(handoffTools[hti].handler(args || {}));
            }
          }
        }
        if (boundSession && serverName === "clay-documents") {
          var documentTools = _sessionDocument.getToolDefs(boundSession);
          for (var dti = 0; dti < documentTools.length; dti++) {
            if (documentTools[dti].name === toolName && typeof documentTools[dti].handler === "function") {
              return Promise.resolve(documentTools[dti].handler(args || {}));
            }
          }
        }
        if (boundSession && serverName === "clay-debate") {
          return _debateProposal.callBridgeTool(boundSession, toolName, args);
        }
        if (boundSession && serverName === "clay-mate-creation") {
          return _mateCreationProposal.callBridgeTool(boundSession, toolName, args);
        }
        if (boundSession && serverName === "clay-workspace") {
          return _workspaceQuery.callBridgeTool(boundSession, toolName, args);
        }
        if (boundSession && serverName === "clay-history") {
          return _workspaceQuery.callHistoryBridgeTool(boundSession, toolName, args);
        }
        if (boundSession && serverName === "clay-logs") {
          return _projectLogs.callBridgeTool(boundSession, toolName, args);
        }
        if (boundSession && serverName === "clay-knowledge") {
          return _mateKnowledge.callBridgeTool(boundSession, toolName, args);
        }
        if (serverName === "clay-sessions" || serverName === "clay-notes" || serverName === "clay-handoff" || serverName === "clay-documents" || serverName === "clay-debate" || serverName === "clay-mate-creation" || serverName === "clay-workspace" || serverName === "clay-history" || serverName === "clay-logs" || serverName === "clay-knowledge") {
          return Promise.reject(new Error("Session-bound tool requires a valid Clay session: " + serverName + "/" + toolName));
        }
        if (sessionOnly) return Promise.reject(new Error("Session tool not found: " + serverName + "/" + toolName));
        // Try in-app servers first (gated by extension connectivity for clay-browser).
        var localMcp = getLocalMcpServers(boundSession);
        if (localMcp && localMcp[serverName]) {
          var server = localMcp[serverName];
          if (server.instance && server.instance._registeredTools && server.instance._registeredTools[toolName]) {
            var handler = server.instance._registeredTools[toolName].handler;
            if (typeof handler === "function") {
              return Promise.resolve(handler(args));
            }
          }
        }
        // Try remote/local proxy servers
        var remoteServers = _mcp.getMcpServers();
        if (remoteServers && remoteServers[serverName]) {
          var rServer = remoteServers[serverName];
          if (rServer.instance && rServer.instance._registeredTools && rServer.instance._registeredTools[toolName]) {
            var rHandler = rServer.instance._registeredTools[toolName].handler;
            if (typeof rHandler === "function") {
              return Promise.resolve(rHandler(args));
            }
          }
        }
        return Promise.reject(new Error("Tool not found: " + serverName + "/" + toolName));
      },
    };
  }

  // --- HTTP handler (delegated to project-http.js) ---
  var _http = attachHTTP({
    cwd: cwd,
    slug: slug,
    project: title || project,
    sm: sm,
    gitAttribution: _gitAttribution,
    send: send,
    imagesDir: imagesDir,
    saveGeneratedImageToProject: _image.saveGeneratedImageToProject,
    osUsers: osUsers,
    pushModule: pushModule,
    safePath: safePath,
    safeAbsPath: safeAbsPath,
    getOsUserInfoForReq: getOsUserInfoForReq,
    sendExtensionCommandAny: sendExtensionCommandAny,
    _extToken: _extToken,
    _browserTabList: browserState._browserTabList,
    getMcpBridgeHandler: getMcpBridgeHandler,
  });
  var handleHTTP = _http.handleHTTP;

  // --- Connection handler (delegated to project-connection.js) ---
  var _connection = attachConnection({
    cwd: cwd,
    slug: slug,
    isMate: isMate,
    osUsers: osUsers,
    debug: debug,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    currentVersion: currentVersion,
    lanHost: lanHost,
    sm: sm,
    tm: tm,
    nm: nm,
    clients: clients,
    send: send,
    sendTo: sendTo,
    opts: opts,
    _loop: _loop,
    _mcp: _mcp,
    _notifications: _notifications,
    _splitGroups: _splitGroups,
    _vendorLogin: _vendorLogin,
    resolveSessionForView: _sessions.resolveSessionForView,
    hydrateImageRefs: hydrateImageRefs,
    broadcastClientCount: broadcastClientCount,
    broadcastPresence: broadcastPresence,
    getProjectList: getProjectList,
    getHubSchedules: getHubSchedules,
    loadContextSources: loadContextSources,
    saveContextSources: saveContextSources,
    _email: _email,
    restoreDebateState: restoreDebateState,
    stopFileWatch: stopFileWatch,
    stopAllDirWatches: stopAllDirWatches,
    getProjectOwnerId: function () { return projectOwnerId; },
    setProjectOwnerId: function (id) { projectOwnerId = id; },
    getLatestVersion: function () { return latestVersion; },
    getTitle: function () { return title; },
    getProject: function () { return project; },
    // Exposed so the first websocket connection can lazily warm up the
    // adapters for this project (see project-connection handleConnection).
    warmup: function (linuxUser) {
      sdk.warmup(osUsers ? linuxUser : null);
      sdk.startIdleReaper();
      if (!osUsers && !sessionTitleMigrationScheduled) {
        sessionTitleMigrationScheduled = true;
        setTimeout(function () {
          try {
            sm.migrateSessionTitles(adapter, cwd);
          } catch (e) {
            console.error("[project] Session title migration failed for " + slug + ":", e && e.message ? e.message : e);
          }
        }, 5000);
      }
    },
  });

  // --- Destroy ---
  function destroy() {
    _loop.stopTimer();
    _email.destroy();
    stopFileWatch();
    stopAllDirWatches();
    // Abort all active sessions and clean up mention sessions
    sm.sessions.forEach(function (session) {
      session.destroying = true;
      if (session.autoContinueTimer) {
        clearTimeout(session.autoContinueTimer);
        session.autoContinueTimer = null;
      }
      if (session.scheduledMessage && session.scheduledMessage.timer) {
        clearTimeout(session.scheduledMessage.timer);
        session.scheduledMessage = null;
      }
      if (session.abortController) {
        try { session.abortController.abort(); } catch (e) {}
      }
      // Close SDK query to terminate the underlying claude child process
      if (session.queryInstance && typeof session.queryInstance.close === "function") {
        try { session.queryInstance.close(); } catch (e) {}
      }
      session.queryInstance = null;
      if (session.messageQueue) {
        try { session.messageQueue.end(); } catch (e) {}
      }
      if (session.worker) {
        try { session.worker.kill(); } catch (e) {}
        session.worker = null;
      }
      // Close all mention SDK sessions to prevent zombie processes
      if (session._mentionSessions) {
        var mateIds = Object.keys(session._mentionSessions);
        for (var mi = 0; mi < mateIds.length; mi++) {
          try { session._mentionSessions[mateIds[mi]].close(); } catch (e) {}
        }
        session._mentionSessions = {};
      }
    });
    // Kill all terminals
    tm.destroyAll();
    for (var ws of clients) {
      try { ws.close(); } catch (e) {}
    }
    clients.clear();
    // Cleanup tmp upload directory
    try {
      var cwdHash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 12);
      var tmpDir = path.join(os.tmpdir(), "clay-" + cwdHash);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}

    // Shut down every adapter that owns a child process. shutdown() is
    // optional on the YOKE contract, so adapters without one are skipped.
    var shutdowns = [];
    if (adapters) {
      Object.keys(adapters).forEach(function(vendor) {
        var adapter = adapters[vendor];
        if (!adapter || typeof adapter.shutdown !== "function") return;
        // Shared adapter instances (e.g. Claude) are reused across projects,
        // so tearing one down here would kill other projects' sessions.
        if (adapter.shared) return;
        try {
          shutdowns.push(Promise.resolve(adapter.shutdown()).catch(function(err) {
            console.error("[project] " + vendor + " shutdown failed for " + slug + ":", err && err.message ? err.message : err);
            return false;
          }));
        } catch (err) {
          console.error("[project] " + vendor + " shutdown threw for " + slug + ":", err && err.message ? err.message : err);
        }
      });
    }
    if (!shutdowns.length) return Promise.resolve(true);
    return Promise.all(shutdowns).then(function(results) {
      return results.every(function(r) { return r !== false; });
    });
  }

  // --- Status info ---
  function getStatus() {
    var sessionCount = sm.sessions.size;
    var hasProcessing = false;
    var pendingPermCount = 0;
    sm.sessions.forEach(function (s) {
      if (s.isProcessing) hasProcessing = true;
      if (s.pendingPermissions) {
        pendingPermCount += Object.keys(s.pendingPermissions).length;
      }
    });
    var status = {
      slug: slug,
      path: cwd,
      project: project,
      title: title,
      icon: icon,
      clients: clients.size,
      sessions: sessionCount,
      isProcessing: hasProcessing,
      pendingPermissions: pendingPermCount,
      projectOwnerId: projectOwnerId,
      projectKnowledgeId: projectKnowledgeId,
    };
    if (isMate) {
      status.isMate = true;
      status.mateId = mateId;
    }
    if (worktreeMeta) {
      status.isWorktree = true;
      status.parentSlug = worktreeMeta.parentSlug;
      status.branch = worktreeMeta.branch;
      status.changeSetId = worktreeMeta.changeSetId || null;
      status.baseCommit = worktreeMeta.baseCommit || null;
      status.headCommit = worktreeMeta.headCommit || null;
      status.worktreeExternal = worktreeMeta.external === true;
    }
    if (usersModule.isMultiUser()) {
      var seen = {};
      var onlineUsers = [];
      for (var c of clients) {
        if (!c._clayUser) continue;
        var u = c._clayUser;
        if (seen[u.id]) continue;
        seen[u.id] = true;
        var p = u.profile || {};
        onlineUsers.push({
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          avatarStyle: p.avatarStyle || "imprint",
          avatarSeed: p.avatarSeed || u.username,
          avatarCustom: p.avatarCustom || "",
        });
      }
      status.onlineUsers = onlineUsers;
    }
    return status;
  }

  function setTitle(newTitle) {
    title = newTitle || null;
    send({ type: "info", cwd: cwd, slug: slug, project: title || project, version: currentVersion, debug: !!debug, osUsers: osUsers, lanHost: lanHost, projectCount: getProjectCount(), projects: getProjectList(), projectOwnerId: projectOwnerId });
  }

  function setIcon(newIcon) {
    icon = newIcon || null;
  }

  // Mate projects: watch CLAUDE.md and enforce system-managed sections
  if (isMate) {
    var claudeMdPath = path.join(cwd, "CLAUDE.md");
    // Derive mateId from cwd (last path segment) and build ctx for dynamic team section
    var _mateId = path.basename(cwd);
    var _mateCtx = matesModule.buildMateCtx(projectOwnerId);
    // Collect non-mate projects for project registry injection
    var _projectList = (getProjectList(projectOwnerId) || []).filter(function (p) { return !p.isMate; });
    var _enforceOpts = { ctx: _mateCtx, mateId: _mateId, projects: _projectList };
    // Enforce all system sections atomically on startup (single read/write)
    var _selfWrite = false; // suppress watcher when we wrote the file ourselves
    try { _selfWrite = !!matesModule.enforceAllSections(claudeMdPath, _enforceOpts); } catch (e) {}
    // Sync sticky notes knowledge file on startup
    try {
      var knDir = path.join(cwd, "knowledge");
      var knFile = path.join(knDir, "sticky-notes.md");
      var notesText = nm.getActiveNotesText();
      if (notesText) {
        fs.mkdirSync(knDir, { recursive: true });
        fs.writeFileSync(knFile, notesText);
      } else {
        try { fs.unlinkSync(knFile); } catch (e) {}
      }
    } catch (e) {}
    // Watch for changes
    try {
      crisisWatcher = fs.watch(claudeMdPath, function () {
        if (crisisDebounce) clearTimeout(crisisDebounce);
        crisisDebounce = setTimeout(function () {
          crisisDebounce = null;
          // Skip if the previous change was our own write
          if (_selfWrite) { _selfWrite = false; return; }
          // Atomic enforce: single read/write for all system sections
          try { _selfWrite = !!matesModule.enforceAllSections(claudeMdPath, _enforceOpts); } catch (e) {}
        }, 500);
      });
      crisisWatcher.on("error", function () {});
    } catch (e) {}
  }

  return {
    cwd: cwd,
    slug: slug,
    project: project,
    clients: clients,
    sm: sm,
    sdk: sdk,
    send: send,
    sendTo: sendTo,
    forEachClient: function (fn) {
      for (var ws of clients) {
        if (ws.readyState === 1) fn(ws);
      }
    },
    handleConnection: handleConnection,
    handleMessage: handleMessage,
    handleDisconnection: handleDisconnection,
    handleHTTP: handleHTTP,
    getMcpBridgeHandler: getMcpBridgeHandler,
    getStatus: getStatus,
    getSessionManager: function () { return sm; },
    createDelegatedSession: _delegatedSession.createDelegatedSession,
    inspectDelegatedFollowUp: _delegatedFollowUp.inspectDelegatedFollowUp,
    dispatchDelegatedFollowUp: _delegatedFollowUp.dispatchDelegatedFollowUp,
    deliverCapsuleTurn: _capsuleTurn.deliverCapsuleTurn,
    unregisterHomeDebateClient: function (ws) { homeDebateClients.delete(ws); },
    handleHomeDebateProposalResponse: function (ws, msg, session) { return _debateProposal.handleHomeMessage(ws, msg, session); },
    handleHomeMateCreationProposalResponse: function (ws, msg, session) { return _mateCreationProposal.handleHomeMessage(ws, msg, session); },
    handleHomeAskUserResponse: function (msg, session) { return _sessions.respondToAskUser(session, msg); },
    handleHomeDebateControl: function (ws, msg, session) { return _debate.handleHomeControl(ws, msg, session); },
    getVendorModelCatalog: _models.getVendorCatalog,
    getVendorModelAvailability: _models.getVendorAvailability,
    getMemoryState: _memory.readMemoryState,
    listKnowledgeFiles: _knowledge.listKnowledgeFiles,
    refreshCapsuleCatalog: _capsuleCatalog.refreshSessions,
    getNotificationsModule: function () { return _notifications; },
    refreshVendorAuth: _vendorLogin.refreshVendorAuth,
    getSchedules: _loop.getSchedules,
    importSchedule: _loop.importSchedule,
    removeSchedule: _loop.removeSchedule,
    setTitle: setTitle,
    setIcon: setIcon,
    setProjectOwner: function (ownerId) { projectOwnerId = ownerId; },
    getProjectOwner: function () { return projectOwnerId; },
    getToolLlmConfig: function (ws, alias) {
      return _models.resolveConfiguredModel(ws, alias);
    },
    completeToolLlm: async function (ws, args) {
      var owner = projectOwnerId ? usersModule.findUserById(projectOwnerId) : null;
      var selection = await _models.resolveConfiguredModel(ws, args.model);
      return toolLlm.complete({
        adapters: adapters,
        cwd: cwd,
        linuxUser: owner && owner.linuxUser ? owner.linuxUser : null,
        args: args,
        selection: selection,
        timeoutMs: 60000,
      });
    },
    refreshUserProfile: function (userId) {
      var user = usersModule.findUserById(userId);
      if (!user) return;
      for (var ws of clients) {
        if (ws._clayUser && ws._clayUser.id === userId) {
          ws._clayUser = user;
        }
      }
      broadcastClientCount();
      broadcastPresence();
    },
    destroy: function () {
      sdk.stopIdleReaper();
      return destroy();
    },
  };
}

module.exports = { createProjectContext: createProjectContext, createMateToolControlMcp: createMateToolControlMcp, safePath: safePath, validateEnvString: validateEnvString };
