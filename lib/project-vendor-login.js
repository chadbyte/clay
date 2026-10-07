// Vendor login flow coordinator.
//
// Owns the "the vendor CLI is not logged in" recovery path end to end so the
// client never has to guess. One login terminal per vendor per requester is the
// single source of truth: repeated auth_required events (other sessions, split
// panes, a burst of 401 retries) re-use that record instead of spawning more
// terminals.
//
// Lifecycle:
//   vendor_login_start  -> create (or re-use) a PTY running the vendor login
//                          command, reply with vendor_login_ready
//   PTY output/exit     -> detect a successful login, restart the vendor's
//                          YOKE adapter so it re-reads the credential file,
//                          send auth_refreshed, close the terminal and browser
//   vendor_login_cancel -> user dismissed the flow; kill the terminal
//
// The adapter restart is the actual bug fix: a Codex app-server is a long-lived
// child process that reads ~/.codex/auth.json once at spawn, so without a
// restart every query after a successful login keeps hitting 401 and re-arms
// auth_required forever.

var vendorRegistry = require("./yoke/vendor-registry");
var yoke = require("./yoke");

// Login CLIs print a success line and then hand the shell back, so the PTY
// itself does not exit. Watch the output stream instead. Deliberately narrow:
// "Successfully logged out" and MCP-server logins must not match.
var LOGIN_SUCCESS_PATTERNS = [
  /successfully logged in(?![ \t]+to[ \t]+mcp)/i,
  /logged in successfully/i,
  /login successful/i,
  /successfully authenticated/i,
  /authentication successful/i,
  /signed in successfully/i,
  /signed in with your [a-z ]+ account/i,
  /you(?:'re| are) (?:now )?(?:logged|signed) in/i,
];

// Rolling window kept per flow so a success line split across PTY chunks is
// still matched, without buffering the whole login transcript.
var OUTPUT_TAIL_MAX = 4096;

// Grace period between detecting success and killing the terminal, so the user
// actually sees the confirmation line before the modal closes.
var CLOSE_AFTER_SUCCESS_MS = 2000;

var ANSI_PATTERN = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r/g;

function stripAnsi(text) {
  return String(text).replace(ANSI_PATTERN, "");
}

function looksLikeLoginSuccess(text) {
  for (var i = 0; i < LOGIN_SUCCESS_PATTERNS.length; i++) {
    if (LOGIN_SUCCESS_PATTERNS[i].test(text)) return true;
  }
  return false;
}

/**
 * ctx fields:
 *   slug, osUsers,
 *   sm, tm, adapters,
 *   send, sendTo,
 *   usersModule,
 *   getOsUserInfoForWs, getOsUserInfoForLinuxUser, getLinuxUserForSession,
 *   refreshVendorAuthEverywhere
 */
function attachVendorLogin(ctx) {
  var slug = ctx.slug;
  var osUsers = ctx.osUsers;

  var sm = ctx.sm;
  var tm = ctx.tm;
  var adapters = ctx.adapters || {};

  var send = ctx.send;
  var sendTo = ctx.sendTo;

  var usersModule = ctx.usersModule;

  var getOsUserInfoForWs = ctx.getOsUserInfoForWs;
  var getOsUserInfoForLinuxUser = ctx.getOsUserInfoForLinuxUser;
  var getLinuxUserForSession = ctx.getLinuxUserForSession;
  var refreshVendorAuthEverywhere = ctx.refreshVendorAuthEverywhere;

  // Requester + vendor -> flow. Credentials and sign-in views stay user-bound.
  var _flows = Object.create(null);
  function flowKey(ws, vendor) {
    return JSON.stringify([ws && ws._clayUser ? String(ws._clayUser.id) : null, vendor]);
  }
  var browserLogin = require("./vendor-login-browser-flow").attachBrowserLogin({
    osUsers: osUsers, sendTo: sendTo, hasTerminalPermission: hasTerminalPermission,
    createLoginBrowser: ctx.createLoginBrowser,
    flowKey: flowKey,
    cancel: function (vendor) { closeFlowTerminal(discardFlow(vendor)); broadcastState(); },
  });

  function loginCommandFor(vendor) {
    if (vendor === "claude") return "claude auth login";
    var info = vendorRegistry.getVendorInfo(vendor);
    return (info && info.loginCommand) || "claude login";
  }

  function vendorDisplayName(vendor) {
    var info = vendorRegistry.getVendorInfo(vendor);
    return (info && info.displayName) || vendor || "Vendor";
  }

  function listFlows(ws) {
    var result = [];
    var vendors = Object.keys(_flows);
    for (var i = 0; i < vendors.length; i++) {
      var flow = _flows[vendors[i]];
      if (ws && flowKey(ws, flow.vendor) !== vendors[i]) continue;
      result.push({
        vendor: flow.vendor,
        terminalId: flow.terminalId,
        startedAt: flow.startedAt,
        completed: !!flow.completed,
        browserId: flow.browser ? flow.browser.id : null,
      });
    }
    return result;
  }

  function broadcastState() {
    if (ctx.clients) { ctx.clients.forEach(sendStateTo); return; }
    send({ type: "vendor_login_state", slug: slug, flows: listFlows() });
  }

  function sendStateTo(ws) {
    sendTo(ws, { type: "vendor_login_state", slug: slug, flows: hasTerminalPermission(ws) ? listFlows(ws) : [] });
  }

  function hasTerminalPermission(ws) {
    if (ctx.requestAccess) return ctx.requestAccess.canAccessProject(ws, slug) && ctx.requestAccess.hasPermission(ws, "terminal");
    if (!ws || !ws._clayUser) return true;
    if (!usersModule || typeof usersModule.getEffectivePermissions !== "function") return true;
    var perms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
    return !!(perms && perms.terminal);
  }

  // The login terminal must write credentials to the same HOME the adapter
  // will read them from. With OS-user isolation the adapter runs as the
  // *session owner's* Linux user, which is not necessarily the connected
  // client, so prefer the session identity when the requester is entitled to
  // it. Without isolation both sides run as the daemon user and this resolves
  // to null on both paths.
  function resolveLoginIdentity(ws, msg) {
    if (!osUsers) return { linuxUser: null, osUserInfo: null };

    var sessionLinuxUser = null;
    var sessionId = msg && msg.sessionId;
    if (sessionId && sm && sm.sessions && typeof getLinuxUserForSession === "function") {
      var session = sm.sessions.get(sessionId);
      if (session) {
        var requesterId = ws && ws._clayUser ? ws._clayUser.id : null;
        var isOwner = !session.ownerId || (requesterId && String(session.ownerId) === String(requesterId));
        var isAdmin = !!(ws && ws._clayUser && ws._clayUser.role === "admin");
        if (isOwner || isAdmin) sessionLinuxUser = getLinuxUserForSession(session);
      }
    }

    if (sessionLinuxUser && typeof getOsUserInfoForLinuxUser === "function") {
      return { linuxUser: sessionLinuxUser, osUserInfo: getOsUserInfoForLinuxUser(sessionLinuxUser) };
    }

    var wsInfo = typeof getOsUserInfoForWs === "function" ? getOsUserInfoForWs(ws) : null;
    return { linuxUser: wsInfo ? wsInfo.user : null, osUserInfo: wsInfo };
  }

  function isFlowTerminalAlive(flow) {
    return !!(flow && typeof flow.terminalId === "number" && tm.has(flow.terminalId));
  }

  function discardFlow(vendor) {
    var flow = _flows[vendor];
    if (!flow) return null;
    delete _flows[vendor];
    if (flow.browser) flow.browser.close();
    if (flow.expiryTimer) clearTimeout(flow.expiryTimer);
    if (flow.closeTimer) {
      clearTimeout(flow.closeTimer);
      flow.closeTimer = null;
    }
    return flow;
  }

  // Kill the PTY and drop it from the sidebar list. `flow.closing` keeps the
  // terminal's own exit hook from re-entering finalization.
  function closeFlowTerminal(flow) {
    if (!flow || typeof flow.terminalId !== "number") return;
    flow.closing = true;
    try { tm.close(flow.terminalId); } catch (e) {}
    send({ type: "term_list", terminals: tm.list() });
  }

  // Restart the vendor adapter so the next query spawns a process that reads
  // the credentials the login just wrote. Shared adapter instances (Claude) are
  // reused by every project, so tearing one down here would kill unrelated
  // sessions; those runtimes pick up new credentials on their own.
  function refreshVendorAuth(vendor, linuxUser) {
    var adapter = adapters[vendor];
    if (!adapter || typeof adapter.shutdown !== "function") return Promise.resolve(false);
    if (adapter.shared) {
      console.log("[vendor-login] " + vendor + " adapter is shared; skipping restart for " + slug);
      return Promise.resolve(false);
    }
    if (typeof adapter.refreshAuthIdentity === "function") {
      return Promise.resolve(adapter.refreshAuthIdentity(linuxUser || null));
    }
    if (linuxUser) return Promise.resolve(false);
    // adapter.shutdown() already fans out to every per-OS-user runtime it
    // created (shutdownUserRuntimes), so one call covers isolated setups too.
    return Promise.resolve()
      .then(function () { return adapter.shutdown(); })
      .then(function () {
        console.log("[vendor-login] Restarted " + vendor + " adapter for " + slug + " after login");
        return true;
      })
      .catch(function (err) {
        console.error("[vendor-login] " + vendor + " adapter restart failed for " + slug + ":",
          err && err.message ? err.message : err);
        return false;
      });
  }

  function finishFlow(vendor, succeeded) {
    var flow = _flows[vendor];
    if (!flow || flow.finishing) return;
    flow.finishing = true;
    flow.completed = !!succeeded;

    // The next session must not reuse the pre-login "not authenticated"
    // result. Re-check before restarting the runtime, which will then read
    // the newly written credential file.
    if (succeeded) yoke.invalidateAuthCache();
    var refresh = Promise.resolve(false);
    if (succeeded) {
      refresh = typeof refreshVendorAuthEverywhere === "function"
        ? refreshVendorAuthEverywhere(flow.vendor, flow.linuxUser || null)
        : refreshVendorAuth(flow.vendor, flow.linuxUser || null);
    }
    refresh.then(function (restarted) {
      if (_flows[vendor] !== flow) return;
      discardFlow(vendor);
      closeFlowTerminal(flow);
      if (succeeded) {
        var message = { type: "auth_refreshed", slug: slug, vendor: flow.vendor, adapterRestarted: !!restarted };
        if (ctx.clients) ctx.clients.forEach(function (ws) { if (flowKey(ws, flow.vendor) === vendor && hasTerminalPermission(ws)) sendTo(ws, message); });
        else send(message);
      }
      broadcastState();
    });
  }

  function handleFlowOutput(vendor, chunk) {
    var flow = _flows[vendor];
    if (!flow || flow.finishing || flow.succeeded) return;
    flow.outputTail = (flow.outputTail + stripAnsi(chunk)).slice(-OUTPUT_TAIL_MAX);
    if (flow.browser) flow.browser.output(stripAnsi(chunk));
    if (!looksLikeLoginSuccess(flow.outputTail)) return;

    flow.succeeded = true;
    console.log("[vendor-login] Detected successful " + flow.vendor + " login in " + slug);
    // Let the success line land on screen before the terminal disappears.
    flow.closeTimer = setTimeout(function () {
      finishFlow(vendor, true);
    }, CLOSE_AFTER_SUCCESS_MS);
    if (flow.closeTimer && typeof flow.closeTimer.unref === "function") flow.closeTimer.unref();
  }

  // Fires for both a PTY that exited on its own and one the user closed from
  // the sidebar. Either way the flow is over; refresh auth if the command had
  // already reported success.
  function handleFlowExit(vendor) {
    var flow = _flows[vendor];
    if (!flow || flow.closing || flow.finishing) return;
    finishFlow(vendor, !!flow.succeeded);
  }

  function startFlow(ws, vendor, msg) {
    var key = flowKey(ws, vendor);
    var identity = resolveLoginIdentity(ws, msg);
    var command = loginCommandFor(vendor);
    var browserMode = msg.mode === "browser" && (vendor === "claude" || vendor === "codex");
    if (browserMode) command = vendor === "codex" ? "codex login" : "claude auth login";
    var flow = {
      vendor: vendor,
      key: key,
      ownerId: ws && ws._clayUser ? String(ws._clayUser.id) : null,
      terminalId: null,
      startedAt: Date.now(),
      linuxUser: identity.linuxUser,
      outputTail: "",
      succeeded: false,
      finishing: false,
      closing: false,
      completed: false,
      closeTimer: null,
    };
    // Registered before create() so the PTY's first output chunk (hooks fire
    // synchronously from spawn) already finds the record.
    _flows[key] = flow;

    var terminal = null;
    try {
      if (browserMode) browserLogin.prepare(ws, flow, identity);
      terminal = tm.create(100, 30, identity.osUserInfo, ws, {
        initialInput: command + "\n",
        title: vendorDisplayName(vendor) + " login",
        kind: "vendor-login",
        loginBrowserEnv: flow.browser ? flow.browser.env : null,
        onData: function (data) { if (_flows[key] === flow) handleFlowOutput(key, data); },
        onExit: function () { if (_flows[key] === flow) handleFlowExit(key); },
      });
    } catch (e) {
      console.error("[vendor-login] Failed to spawn " + vendor + " login terminal in " + slug + ":",
        e && e.message ? e.message : e);
    }

    if (!terminal) {
      discardFlow(key);
      return null;
    }

    flow.terminalId = terminal.id;
    if (!flow.browser) tm.attach(terminal.id, ws);
    send({ type: "term_list", terminals: tm.list() });
    return flow;
  }

  function handleVendorLoginMessage(ws, msg) {
    if (browserLogin.handle(ws, msg, _flows)) return true;
    if (msg.type === "vendor_login_state_request") {
      sendStateTo(ws);
      return true;
    }

    if (msg.type === "vendor_login_cancel") {
      var cancelVendor = String(msg.vendor || "");
      var cancelled = discardFlow(flowKey(ws, cancelVendor));
      if (cancelled) closeFlowTerminal(cancelled);
      broadcastState();
      return true;
    }

    if (msg.type === "vendor_login_start") {
      var vendor = String(msg.vendor || "claude");
      if (!vendorRegistry.getVendorInfo(vendor)) {
        sendTo(ws, { type: "vendor_login_error", vendor: vendor, error: "Unknown vendor: " + vendor });
        return true;
      }
      if (!hasTerminalPermission(ws)) {
        sendTo(ws, { type: "vendor_login_error", vendor: vendor, error: "Terminal access is not permitted" });
        return true;
      }

      var key = flowKey(ws, vendor);
      var existing = _flows[key];
      if (existing && !isFlowTerminalAlive(existing)) {
        // Terminal died without its exit hook clearing the record.
        discardFlow(key);
        existing = null;
      }

      if (existing) {
        // An auto-triggered request (a fresh auth_required from another
        // session or split pane) must not pop a second prompt; it only learns
        // that a flow is already running. A deliberate request re-attaches.
        if (!msg.auto) {
          if (!existing.browser) tm.attach(existing.terminalId, ws);
          sendTo(ws, {
            type: "vendor_login_ready",
            slug: slug,
            vendor: vendor,
            terminalId: existing.terminalId,
            reused: true,
            browserId: existing.browser ? existing.browser.id : null,
          });
        }
        sendStateTo(ws);
        return true;
      }

      var started = startFlow(ws, vendor, msg);
      if (!started) {
        sendTo(ws, {
          type: "vendor_login_error",
          vendor: vendor,
          error: "Cannot create terminal (node-pty not available or limit reached)",
        });
        return true;
      }

      console.log("[vendor-login] Started " + vendor + " login terminal " + started.terminalId + " in " + slug);
      sendTo(ws, {
        type: "vendor_login_ready",
        slug: slug,
        vendor: vendor,
        terminalId: started.terminalId,
        reused: false,
        browserId: started.browser ? started.browser.id : null,
      });
      broadcastState();
      return true;
    }

    return false;
  }

  // The sidebar "close terminal" path goes through tm.close() directly, which
  // fires our exit hook. This is the explicit entry point for callers that
  // remove a terminal without going through the PTY.
  function forgetTerminal(terminalId) {
    var vendors = Object.keys(_flows);
    for (var i = 0; i < vendors.length; i++) {
      if (_flows[vendors[i]].terminalId === terminalId) {
        handleFlowExit(vendors[i]);
        return true;
      }
    }
    return false;
  }

  function isLoginTerminal(terminalId) {
    var vendors = Object.keys(_flows);
    for (var i = 0; i < vendors.length; i++) {
      if (_flows[vendors[i]].terminalId === terminalId) return true;
    }
    return false;
  }

  return {
    handleVendorLoginMessage: handleVendorLoginMessage,
    sendStateTo: sendStateTo,
    listFlows: listFlows,
    forgetTerminal: forgetTerminal,
    isLoginTerminal: isLoginTerminal,
    refreshVendorAuth: refreshVendorAuth,
    destroy: function () {
      Object.keys(_flows).forEach(function (vendor) { closeFlowTerminal(discardFlow(vendor)); });
    },
  };
}

module.exports = { attachVendorLogin: attachVendorLogin };
