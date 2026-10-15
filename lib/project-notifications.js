// project-notifications.js - Global notification queue, event-based creation
// Single instance shared by all projects. All formatting logic lives here.
// Follows attachXxx(ctx) pattern per MODULE_MAP.md

var fs = require("fs");
var path = require("path");
var config = require("./config");
var yoke = require("./yoke");

var NOTIF_FILE = path.join(config.CONFIG_DIR, "notifications.json");
var REMINDER_INTERVAL = 60 * 60 * 1000; // 1 hour

function generateId() {
  var rand = Math.random().toString(36).substring(2, 8);
  return "n_" + Date.now() + "_" + rand;
}

// ========================================================
// Event -> notification formatters
// ========================================================

var formatters = {
  auth_required: function (data) {
    var vendor = data.vendor || "claude";
    var vendorInfo = yoke.getVendorInfo(vendor);
    var title = data.title || (((vendorInfo && vendorInfo.displayName) || "Claude Code") + " is not logged in");
    return {
      type: "auth_required",
      title: title,
      body: data.body || "Open a terminal, then click the URL and follow the instructions.",
      meta: {
        vendor: vendor,
        loginCommand: data.loginCommand || "",
        linuxUser: data.linuxUser || null,
        canAutoLogin: !!data.canAutoLogin,
      },
    };
  },

  loop_complete: function (data) {
    var reason = data.reason || "complete";
    var body = (reason === "pass" || reason === "complete")
      ? "Completed after " + (data.iterations || 0) + " iteration(s)"
      : reason === "max_iterations"
        ? "Reached max iterations (" + (data.maxIterations || "?") + ")"
        : reason === "stopped"
          ? "Stopped by user"
          : "Ended due to error";
    return {
      type: reason === "error" ? "loop_error" : "loop_complete",
      title: (data.name || "Loop") + " " + (reason === "error" ? "failed" : "complete"),
      body: body,
      meta: { reason: reason, iterations: data.iterations },
    };
  },

  response_done: function (data) {
    return {
      type: "response_done",
      title: data.title || "Response ready",
      body: data.preview || "",
    };
  },

  permission_request: function (data) {
    return {
      type: "permission_request",
      title: data.title || "Permission requested",
      body: data.body || "",
      meta: { requestId: data.requestId, toolName: data.toolName, toolInput: data.toolInput || null, defaultToNo: data.defaultToNo === true, suppressAlwaysAllowRule: data.suppressAlwaysAllowRule === true },
    };
  },

  tui_attention: function (data) {
    return {
      type: "tui_attention",
      title: data.title || "Claude needs your attention",
      body: data.body || "",
      meta: {
        terminalId: typeof data.terminalId === "number" ? data.terminalId : null,
        cliSessionId: data.cliSessionId || null,
        sessionTitle: data.sessionTitle || "",
      },
    };
  },

  mate_dm: function (data) {
    return {
      type: "mate_dm",
      title: data.senderName || "Message",
      body: data.preview || "Sent you a message",
    };
  },

  mention_response: function (data) {
    return {
      type: "mention_response",
      title: data.title || "Mention response ready",
      body: data.preview || "",
      meta: { avatarMateId: data.avatarMateId || null },
    };
  },

  user_mention: function (data) {
    return {
      type: "user_mention",
      title: "@" + (data.fromName || "Someone"),
      body: data.preview || "Mentioned you",
      meta: {
        fromUserId: data.fromUserId || null,
        fromName: data.fromName || "",
        fromAvatarStyle: data.fromAvatarStyle || null,
        fromAvatarSeed: data.fromAvatarSeed || null,
        fromAvatarColor: data.fromAvatarColor || null,
        fromAvatarCustom: data.fromAvatarCustom || "",
        persistent: true,
      },
    };
  },
};

// ========================================================
// Module (global singleton)
// ========================================================

function attachNotifications(ctx) {
  var broadcastAll = ctx.broadcastAll;
  var sendToUser = ctx.sendToUser || null; // (userId, msg) -> void; iterates all project clients
  var pushModule = ctx.pushModule;

  var notifications = loadNotifications();
  var reminderTimer = null;

  function loadNotifications() {
    try {
      var raw = fs.readFileSync(NOTIF_FILE, "utf8");
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
    return [];
  }

  function saveNotifications() {
    var tmp = NOTIF_FILE + ".tmp";
    try {
      fs.writeFileSync(tmp, JSON.stringify(notifications, null, 2));
      fs.renameSync(tmp, NOTIF_FILE);
    } catch (e) {
      console.error("[notifications] Failed to save:", e.message);
    }
  }

  function getUnreadCount() {
    return notifications.length;
  }

  function visible(ws) {
    return notifications.filter(function (notification) { return !ctx.canView || ctx.canView(ws, notification); });
  }

  function publish(payload) {
    if (!ctx.forEachClient) return broadcastAll(payload);
    ctx.forEachClient(function (ws) {
      if (ws.readyState !== 1) return;
      if (payload.notification && !ctx.canView(ws, payload.notification)) return;
      var list = visible(ws);
      ws.send(JSON.stringify(Object.assign({}, payload, { unreadCount: list.length })));
    });
  }

  // --- Core API ---

  function notify(event, data) {
    data = data || {};
    var formatter = formatters[event];
    if (!formatter) {
      console.warn("[notifications] Unknown event: " + event);
      return null;
    }
    var formatted = formatter(data || {});
    if (!formatted) return null;

    var notif = {
      id: generateId(),
      type: formatted.type || event,
      title: formatted.title || "",
      body: formatted.body || "",
      slug: data.slug || "",
      sessionId: data.sessionId || null,
      mateId: data.mateId || null,
      ownerId: data.ownerId || null,
      targetUserId: data.targetUserId || null,
      createdAt: Date.now(),
      meta: formatted.meta || {},
    };
    notifications.unshift(notif);
    saveNotifications();
    var payload = {
      type: "notification_created",
      notification: notif,
      unreadCount: getUnreadCount(),
    };
    // Project/session previews are projected for each authenticated viewer.
    if (ctx.forEachClient) {
      publish(payload);
    } else if (notif.targetUserId && typeof sendToUser === "function") {
      sendToUser(notif.targetUserId, payload);
    } else {
      broadcastAll(payload);
    }
    return notif;
  }

  function dismiss(ids, ws) {
    var permitted = visible(ws).map(function (notification) { return notification.id; });
    ids = ids.filter(function (id) { return permitted.indexOf(id) !== -1; });
    var before = notifications.length;
    notifications = notifications.filter(function(n) { return ids.indexOf(n.id) === -1; });
    if (notifications.length !== before) {
      saveNotifications();
      publish({
        type: "notification_dismissed",
        ids: ids,
        unreadCount: getUnreadCount(),
      });
    }
  }

  function canReadOwned(principal, item) {
    var owner = principal.userId || null;
    return (owner ? (item.targetUserId === owner || item.ownerId === owner) && (!item.targetUserId || item.targetUserId === owner) : !item.ownerId && !item.targetUserId) &&
      (!ctx.canViewPrincipal || ctx.canViewPrincipal(principal, item));
  }
  function authorizeOwned(principal, items) {
    if (items.some(function (item) { return !canReadOwned(principal, item); })) throw new Error('Owned notification access changed.');
  }
  function listOwned(principal) {
    return notifications.filter(function (item) { return canReadOwned(principal, item); }).slice(0, 100).map(function (item) { return JSON.parse(JSON.stringify(item)); });
  }
  function inspectOwned(principal, ids) {
    var owned = listOwned(principal);
    return ids.map(function (id) {
      var item = owned.find(function (entry) { return entry.id === id; });
      if (!item) throw new Error('The exact owned notification is absent or inaccessible.');
      return item;
    });
  }
  function dismissOwned(principal, ids, revalidate) {
    revalidate(); inspectOwned(principal, ids);
    var previous = notifications;
    notifications = notifications.filter(function (item) { return ids.indexOf(item.id) < 0; });
    var tmp = NOTIF_FILE + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(notifications, null, 2)); fs.renameSync(tmp, NOTIF_FILE); }
    catch (error) { notifications = previous; throw error; }
    // Use the ordinary per-viewer notification state; no private IDs are broadcast.
    var published = true;
    if (ctx.forEachClient) ctx.forEachClient(function (ws) { try { sendConnectionState(ws, function (client, payload) { if (client.readyState === 1) client.send(JSON.stringify(payload)); }); } catch (error) { published = false; } });
    try { revalidate(); } catch (error) { return { status: 'failed', persisted: true, dismissedIds: ids, error: error.message, retrySafe: false }; }
    return { status: published ? 'completed' : 'failed', persisted: true, dismissedIds: ids, viewerPublication: published ? 'sent' : 'partial', retrySafe: false };
  }

  function dismissAll(ws) {
    dismiss(visible(ws).map(function (notification) { return notification.id; }), ws);
  }

  // --- Periodic reminder ---

  function startReminder() {
    if (reminderTimer) return;
    reminderTimer = setInterval(function () {
      if (ctx.canView && ctx.getUsers && pushModule && pushModule.sendPushToUser) {
        ctx.getUsers().forEach(function (user) {
          var count = visible({ _clayUser: user }).length;
          if (count) pushModule.sendPushToUser(user.id, { type: "reminder", title: "Clay", body: count + " unread notification" + (count > 1 ? "s" : ""), tag: "clay-notif-reminder" });
        });
        return;
      }
      var count = getUnreadCount();
      if (count > 0 && pushModule && !ctx.canView) {
        pushModule.sendPush({
          type: "reminder",
          title: "Clay",
          body: count + " unread notification" + (count > 1 ? "s" : ""),
          tag: "clay-notif-reminder",
        });
      }
    }, REMINDER_INTERVAL);
  }

  function stopReminder() {
    if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
  }

  startReminder();

  // --- Connection state (called per-client with sendTo) ---

  function sendConnectionState(ws, sendTo) {
    if (!sendTo) return;
    var list = visible(ws);
    sendTo(ws, {
      type: "notifications_state",
      notifications: list,
      unreadCount: list.length,
    });
  }

  // --- Message handler ---

  function handleNotificationMessage(ws, msg) {
    if (msg.type === "notification_dismiss") {
      dismiss(msg.ids || [], ws);
      return true;
    }
    if (msg.type === "notification_dismiss_all") {
      dismissAll(ws);
      return true;
    }
    return false;
  }

  return {
    authorizeOwned: authorizeOwned,
    listOwned: listOwned,
    inspectOwned: inspectOwned,
    dismissOwned: dismissOwned,
    notify: notify,
    getUnreadCount: getUnreadCount,
    sendConnectionState: sendConnectionState,
    handleNotificationMessage: handleNotificationMessage,
    stopReminder: stopReminder,
  };
}

module.exports = { attachNotifications: attachNotifications };
