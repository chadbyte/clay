import { applyPermissionHints } from './permission-hints.js';
// app-notifications.js - Notification banners (Apple banner style)
// New notifications appear as individual banners top-right, auto-dismiss after 3s.
// Bell button click shows all stored notifications as banners.

import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml } from './utils.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showHomeHub } from './app-home-hub.js';
import { openHomeChat } from './home-mate-chat.js';
import { getCachedProjects, switchProject, renderProjectList } from './app-projects.js';
import { mateAvatarUrl, userAvatarUrl } from './avatar.js';
import { openTuiModal } from './tui-attention.js';
import { requestVendorLogin } from './vendor-login.js';
import { startUrgentBlink, stopUrgentBlink } from './app-favicon.js';
import { playDoneSound, isNotifSoundEnabled } from './notifications.js';
import { attachSnoozeControl, setSnoozeBannerRemover } from './update-snooze.js';
var notifications = [];
var unreadCount = 0;
var bannerContainer = null;
var bellBtn = null;
var badgeEl = null;

function getVendorLoginCommand(vendor) {
  var vendors = store.get('vendorInfo') || {};
  var info = vendors[vendor];
  if (info && info.loginCommand) return info.loginCommand;
  var fallbacks = { codex: "codex login --device-auth", claude: "claude login" };
  return fallbacks[vendor] || fallbacks.claude;
}

// --- Pending TUI attention tracking ---
// Mirrors the icon-shake / favicon-blink behavior the SDK side already gets
// from `pendingPermissions` on project status broadcasts. The notification
// center is our source of truth for unresolved tui_attention notifications:
// when one arrives we bump the slug's count and start the urgent favicon
// blink; when it's dismissed (the user opened the session, clicked the
// banner, or closed it) we decrement and stop the blink once nothing is
// left pending. `notif.id -> slug` lets us decrement without having to
// re-derive the slug from a dismissed notification.
var pendingTuiBySlug = Object.create(null);
var pendingTuiBySlugId = Object.create(null);
var pendingTuiTotal = 0;

// --- Update available banner state ---
// Server pushes update_available on an hourly boundary; dismissal is
// per-banner-instance and doesn't need to persist. The next server push
// (next hour) acts as a fresh ping.
var pendingUpdateMsg = null;
var activeAuthRequiredMsg = null;

// ========================================================
// Init
// ========================================================

export function initAppNotifications() {
  bellBtn = document.getElementById("notif-center-btn");
  badgeEl = document.getElementById("notif-center-badge");

  // Banner teardown lives here (exit animation, clear-all sync), so the
  // snooze module borrows it rather than importing this module back.
  setSnoozeBannerRemover(removeBanner);

  // Split panes are secondary clients inside the parent shell. They keep
  // notification state in sync, but the parent owns the single visible
  // banner surface for the whole split view.
  if (store.get('paneMode')) return;

  // Create banner container
  bannerContainer = document.createElement("div");
  bannerContainer.className = "notif-banner-container";
  document.body.appendChild(bannerContainer);

  if (bellBtn) {
    bellBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      showAllBanners();
    });
  }
}

// ========================================================
// Show all stored notifications as banners
// ========================================================

function showAllBanners() {
  // Clear existing banners first
  if (bannerContainer) bannerContainer.innerHTML = "";

  // Re-add update banner if present (may be suppressed by recent dismiss)
  if (pendingUpdateMsg) showUpdateBanner(pendingUpdateMsg);

  for (var i = 0; i < notifications.length; i++) {
    showBanner(notifications[i], false);
  }

  if (activeAuthRequiredMsg) showAuthRequiredBanner(activeAuthRequiredMsg);

  // Check if any banner actually got rendered (update/auth banners can be suppressed)
  var hasVisibleBanner = bannerContainer.children.length > 0;
  if (notifications.length === 0 && !hasVisibleBanner) {
    showBanner({
      id: "_empty",
      type: "info",
      title: randomEmptyMessage(),
      body: "",
      slug: "",
    }, 3000);
  }
}

// ========================================================
// Banner
// ========================================================

function showBanner(notif, autoDismissMs) {
  if (!bannerContainer) return;

  var isEmpty = notif.id === "_empty";
  var isPermission = notif.type === "permission_request" && notif.meta && notif.meta.requestId;
  var isAuthRequired = notif.type === "auth_required";
  var isUserMention = notif.type === "user_mention";
  var isTuiAttention = notif.type === "tui_attention" && notif.meta && typeof notif.meta.terminalId === "number" && notif.slug;
  var projectIcon = isEmpty ? null : getProjectIcon(notif.slug);
  var projectName = isEmpty ? "" : (isAuthRequired ? "CLAY" : getProjectName(notif.slug));
  // TUI attention banners append the session name as a breadcrumb so the
  // user can tell which specific TUI session is asking for input - the
  // body text alone ("Claude needs your permission") is generic.
  if (isTuiAttention && notif.meta && notif.meta.sessionTitle && projectName) {
    projectName = projectName + " › " + notif.meta.sessionTitle;
  }
  var mate = isEmpty ? null : getMateForNotification(notif);
  var userMentionAvatarSrc = isUserMention ? buildUserMentionAvatarSrc(notif) : null;

  var banner = document.createElement("div");
  banner.className = "notif-banner" + (isAuthRequired ? " notif-banner-update notif-banner-auth" : isPermission ? " notif-banner-permission" : isUserMention ? " notif-banner-user-mention" : "");
  if (!isEmpty) banner.setAttribute("data-notif-id", notif.id);
  if (isAuthRequired) banner.setAttribute("data-auth-banner", "true");

  var iconHtmlStr = userMentionAvatarSrc
    ? '<img class="notif-banner-avatar" src="' + escapeHtml(userMentionAvatarSrc) + '" alt="' + escapeHtml((notif.meta && notif.meta.fromName) || "User") + '">'
    : mate
    ? '<img class="notif-banner-avatar" src="' + escapeHtml(mateAvatarUrl(mate, 32)) + '" alt="' + escapeHtml(mate.displayName || mate.name || "Mate") + '">'
    : isAuthRequired
      ? '<img src="/clay-studio-symbol.png" width="32" height="32" alt="Clay Studio">'
      : projectIcon
      ? '<span class="notif-banner-emoji">' + projectIcon + '</span>'
      : isEmpty
        ? '<img src="/clay-studio-symbol.png" width="32" height="32" alt="Clay Studio">'
        : iconHtml("folder");

  // Format permission title as "Can I ..." style
  if (isPermission && notif.meta) {
    var permInfo = formatPermissionInfo(notif.meta.toolName, notif.meta.toolInput);
    if (permInfo) {
      notif = Object.assign({}, notif, { title: "Can I " + permInfo.verb + (permInfo.target ? " " + permInfo.target : "") + "?" });
    }
  }

  var actionsHtml = "";
  if (isPermission) {
    actionsHtml =
      '<div class="notif-banner-actions">' +
        '<button class="notif-banner-allow">Sure</button>' +
        '<button class="notif-banner-always">Allow for session</button>' +
        '<button class="notif-banner-deny">No</button>' +
        '<button class="notif-banner-goto" title="Go to session">' + iconHtml("external-link") + '</button>' +
      '</div>';
  } else if (isAuthRequired) {
    actionsHtml =
      '<div class="notif-banner-actions">' +
        '<button class="notif-banner-auth-login notif-banner-update-now">Open terminal &amp; log in</button>' +
      '</div>';
  } else if (isTuiAttention) {
    actionsHtml =
      '<div class="notif-banner-actions">' +
        '<button class="notif-banner-tui-open">Open here</button>' +
        '<button class="notif-banner-tui-goto">Go to session</button>' +
      '</div>';
  }

  banner.innerHTML =
    '<div class="notif-banner-icon">' + iconHtmlStr + '</div>' +
    '<div class="notif-banner-body">' +
      (projectName ? '<div class="notif-banner-project">' + escapeHtml(projectName) + '</div>' : '') +
      '<div class="notif-banner-title">' + escapeHtml(notif.title) + '</div>' +
      (notif.body ? '<div class="notif-banner-text">' + escapeHtml(notif.body) + '</div>' : '') +
      actionsHtml +
    '</div>' +
    (!isEmpty ? '<button class="notif-banner-close">' + iconHtml("x") + '</button>' : '');

  bannerContainer.appendChild(banner);
  if (isPermission) applyPermissionHints(banner, notif.meta);
  refreshIcons();
  ensureClearAllButton();

  requestAnimationFrame(function () {
    banner.classList.add("show");
  });

  if (!isEmpty) {
    if (!isAuthRequired) {
      // Click banner body -> navigate + dismiss
      banner.addEventListener("click", function (e) {
        if (e.target.closest(".notif-banner-close")) return;
        removeBanner(banner);
        dismissNotif(notif.id);
        navigateToNotification(notif);
      });
    }

    // Close button -> dismiss
    var closeBtn = banner.querySelector(".notif-banner-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (isAuthRequired) activeAuthRequiredMsg = null;
        removeBanner(banner);
        dismissNotif(notif.id);
      });
    }

    // Permission actions
    if (isPermission) {
      var sureBtn = banner.querySelector(".notif-banner-allow");
      var alwaysBtn = banner.querySelector(".notif-banner-always");
      var noBtn = banner.querySelector(".notif-banner-deny");
      var gotoBtn = banner.querySelector(".notif-banner-goto");

      if (sureBtn) {
        sureBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          sendPermissionResponse(notif.meta.requestId, true, notif.slug);
          removeBanner(banner);
          dismissNotif(notif.id);
        });
      }
      if (alwaysBtn) {
        alwaysBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          sendPermissionResponse(notif.meta.requestId, "always", notif.slug);
          removeBanner(banner);
          dismissNotif(notif.id);
        });
      }
      if (noBtn) {
        noBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          sendPermissionResponse(notif.meta.requestId, false, notif.slug);
          removeBanner(banner);
          dismissNotif(notif.id);
        });
      }
      if (gotoBtn) {
        gotoBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          navigateToNotification(notif);
          removeBanner(banner);
          dismissNotif(notif.id);
        });
      }
    }

    if (isAuthRequired) {
      var loginBtn = banner.querySelector(".notif-banner-auth-login");
      if (loginBtn) {
        loginBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          activeAuthRequiredMsg = null;
          removeBanner(banner);
          dismissNotif(notif.id);
          var authMeta = notif.meta || {};
          // Deliberate click: re-attach to a live login terminal instead of
          // spawning a second one (the server dedups per vendor).
          requestVendorLogin(authMeta.vendor || "claude", { sessionId: notif.sessionId || null });
        });
      }
    }

    // TUI attention actions: "Open here" pops the inline xterm modal
    // (preserves the user's current project view), "Go to session"
    // switches to the source project and switches the session there.
    if (isTuiAttention) {
      var openHereBtn = banner.querySelector(".notif-banner-tui-open");
      var gotoBtn2 = banner.querySelector(".notif-banner-tui-goto");
      if (openHereBtn) {
        openHereBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          removeBanner(banner);
          dismissNotif(notif.id);
          try {
            openTuiModal(notif.meta.terminalId, notif.slug, {
              sessionTitle: notif.meta.sessionTitle || notif.title || "Claude session",
              projectName: getProjectName(notif.slug),
              projectIcon: getProjectIcon(notif.slug),
            });
          } catch (err) {}
        });
      }
      if (gotoBtn2) {
        gotoBtn2.addEventListener("click", function (e) {
          e.stopPropagation();
          removeBanner(banner);
          dismissNotif(notif.id);
          // Standard session navigation: switch project (if needed) then
          // switch session. Bypasses the modal branch in
          // navigateToNotification.
          var currentSlug = store.get('currentSlug') || "";
          if (notif.slug && notif.slug !== currentSlug) {
            if (notif.sessionId) {
              try { sessionStorage.setItem("pending-notif-session", notif.sessionId); } catch (err) {}
            }
            switchProject(notif.slug);
          } else if (notif.sessionId) {
            var ws = getWs();
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "switch_session", id: notif.sessionId }));
            }
          }
        });
      }
    }
  }

  // Auto-dismiss (number = ms, false = stay)
  if (typeof autoDismissMs === "number") {
    setTimeout(function () { removeBanner(banner); }, autoDismissMs);
  } else if (autoDismissMs === true) {
    setTimeout(function () { removeBanner(banner); }, 3000);
  }
}

export function showAuthRequiredBanner(msg) {
  if (!bannerContainer) return;
  var vendor = (msg && (msg.vendor || (msg.meta && msg.meta.vendor))) || "claude";
  var loginCommand = (msg && (msg.loginCommand || (msg.meta && msg.meta.loginCommand))) || getVendorLoginCommand(vendor);
  activeAuthRequiredMsg = Object.assign({}, msg || {}, {
    id: (msg && msg.id) || ("_auth_" + Date.now()),
    type: "auth_required",
    vendor: vendor,
    loginCommand: loginCommand,
    meta: Object.assign({}, msg && msg.meta ? msg.meta : {}, {
      vendor: vendor,
      loginCommand: loginCommand,
    }),
  });
  var existing = bannerContainer.querySelector('[data-auth-banner="true"]');
  if (existing) removeBanner(existing);
  showBanner(activeAuthRequiredMsg, false);
}

function removeBanner(banner) {
  if (!banner || !banner.parentNode) return;
  banner.classList.remove("show");
  banner.classList.add("hide");
  // Update the clear-all button right away so it disappears before the
  // last banner finishes animating out, and again after the node is
  // actually removed in case the count check depends on DOM presence.
  ensureClearAllButton();
  setTimeout(function () {
    if (banner.parentNode) banner.parentNode.removeChild(banner);
    ensureClearAllButton();
  }, 300);
}

// Count real (non-"_empty", not in hide animation) banners to decide
// whether a Clear-all affordance is worth showing.
function countActiveBanners() {
  if (!bannerContainer) return 0;
  var banners = bannerContainer.querySelectorAll('.notif-banner');
  var n = 0;
  for (var i = 0; i < banners.length; i++) {
    if (banners[i].classList.contains('hide')) continue;
    if (banners[i].getAttribute('data-notif-id')) n++;
  }
  return n;
}

function ensureClearAllButton() {
  if (!bannerContainer) return;
  var existing = bannerContainer.querySelector('.notif-banner-clear-all');
  if (countActiveBanners() >= 2) {
    if (existing) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notif-banner-clear-all';
    btn.innerHTML = iconHtml('x') + '<span>Clear all</span>';
    btn.addEventListener('click', clearAllBanners);
    bannerContainer.insertBefore(btn, bannerContainer.firstChild);
    refreshIcons();
  } else if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
}

function clearAllBanners() {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'notification_dismiss_all' }));
  }
  // Dismiss visually right away — the server will broadcast
  // notification_dismissed_all too, but doing it optimistically makes
  // the click feel instant.
  if (bannerContainer) {
    var banners = bannerContainer.querySelectorAll('.notif-banner[data-notif-id]');
    for (var i = 0; i < banners.length; i++) removeBanner(banners[i]);
  }
  var btn = bannerContainer && bannerContainer.querySelector('.notif-banner-clear-all');
  if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
}

function sendPermissionResponse(requestId, decision, slug) {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    var d = decision === "always" ? "allow_always" : decision ? "allow" : "deny";
    var msg = { type: "permission_response", requestId: requestId, decision: d };
    if (slug) msg.targetSlug = slug;
    ws.send(JSON.stringify(msg));
  }
}

function dismissNotif(id) {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "notification_dismiss", ids: [id] }));
  }
}

// ========================================================
// Message handlers
// ========================================================

function isPendingTuiAttention(notif) {
  return notif && notif.type === "tui_attention" && notif.slug;
}

function bumpTuiAttention(notif) {
  if (!isPendingTuiAttention(notif)) return false;
  if (pendingTuiBySlugId[notif.id]) return false;
  pendingTuiBySlugId[notif.id] = notif.slug;
  pendingTuiBySlug[notif.slug] = (pendingTuiBySlug[notif.slug] || 0) + 1;
  pendingTuiTotal++;
  return true;
}

function dropTuiAttentionById(id) {
  var slug = pendingTuiBySlugId[id];
  if (!slug) return false;
  delete pendingTuiBySlugId[id];
  pendingTuiBySlug[slug] = (pendingTuiBySlug[slug] || 1) - 1;
  if (pendingTuiBySlug[slug] <= 0) delete pendingTuiBySlug[slug];
  pendingTuiTotal--;
  if (pendingTuiTotal < 0) pendingTuiTotal = 0;
  return true;
}

function refreshTuiAttentionVisuals(prevTotal) {
  if (pendingTuiTotal > 0 && prevTotal === 0) {
    try { startUrgentBlink(); } catch (e) {}
  } else if (pendingTuiTotal === 0 && prevTotal > 0) {
    try { stopUrgentBlink(); } catch (e) {}
  }
  try { renderProjectList(); } catch (e) {}
}

export function getPendingTuiAttention(slug) {
  if (!slug) return 0;
  return pendingTuiBySlug[slug] || 0;
}

export function handleNotificationsState(msg) {
  notifications = msg.notifications || [];
  unreadCount = msg.unreadCount || 0;
  updateBadge();

  // Rebuild the pending-tui-attention map from the authoritative list. This
  // also covers reconnect — pre-existing notifications get the icon shake
  // and favicon blink restored without waiting for a fresh server event.
  var prevTotal = pendingTuiTotal;
  pendingTuiBySlug = Object.create(null);
  pendingTuiBySlugId = Object.create(null);
  pendingTuiTotal = 0;
  for (var i = 0; i < notifications.length; i++) {
    bumpTuiAttention(notifications[i]);
  }
  refreshTuiAttentionVisuals(prevTotal);

  // Check for pending session navigation after project switch
  try {
    var pendingSession = sessionStorage.getItem("pending-notif-session");
    if (pendingSession) {
      sessionStorage.removeItem("pending-notif-session");
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "switch_session", id: parseInt(pendingSession, 10) }));
      }
    }
  } catch (e) {}
}

export function handleNotificationCreated(msg) {
  var notif = msg.notification;

  // Auto-dismiss if it's for the session the user is currently viewing
  var activeSession = store.get('activeSessionId') || null;
  console.log("[notif] created:", notif.type, "sessionId=" + notif.sessionId + "(" + typeof notif.sessionId + ")", "active=" + activeSession + "(" + typeof activeSession + ")", "match=" + (notif.sessionId == activeSession));
  if (notif.type !== "auth_required" && notif.sessionId && String(notif.sessionId) === String(activeSession)) {
    dismissNotif(notif.id);
    return;
  }

  notifications.unshift(notif);
  unreadCount = msg.unreadCount;
  updateBadge();

  // auth_required no longer pops a banner: the login terminal modal opens
  // automatically (see autoStartLoginIfNeeded). Keep the notification in the
  // center (above) for history, but don't show the redundant banner.
  if (notif.type === "auth_required") return;

  // tui_attention drives the project icon shake and the favicon blink —
  // same visual cues the SDK already produces from pendingPermissions /
  // permission_request messages, so the user notices either kind without
  // having the right tab focused. Ring the ding too, gated on document.hidden
  // and the notif-sound toggle to match the SDK 'done' path — we don't want
  // to chime while the user is actively watching the tab.
  var prevTotal = pendingTuiTotal;
  if (bumpTuiAttention(notif)) {
    refreshTuiAttentionVisuals(prevTotal);
    if (document.hidden && isNotifSoundEnabled()) {
      try { playDoneSound(); } catch (e) {}
    }
  }

  // user_mention banners are persistent (no auto-dismiss). They go away when:
  //   1. The user clicks the banner (which navigates to the session — see
  //      banner click handler in showBanner / navigateToNotification), OR
  //   2. The user navigates to the target session by some other path, in which
  //      case handleNotificationCreated above already dismissed the notif on
  //      activeSessionId match, OR
  //   3. The user clicks the X close button.
  // Permission and auth banners are also persistent for the same UX reason.
  // tui_attention is also actionable (Open here / Go to session) and the
  // user needs time to read the response preview, so keep it persistent.
  var _autoDismiss = (notif.type === "permission_request" || notif.type === "auth_required" || notif.type === "user_mention" || notif.type === "tui_attention") ? false : true;
  showBanner(notif, _autoDismiss);
}

export function handleNotificationDismissed(msg) {
  var ids = msg.ids || [];
  notifications = notifications.filter(function (n) { return ids.indexOf(n.id) === -1; });
  unreadCount = msg.unreadCount;
  updateBadge();
  // Remove corresponding banners if visible
  if (bannerContainer) {
    for (var i = 0; i < ids.length; i++) {
      var el = bannerContainer.querySelector('[data-notif-id="' + ids[i] + '"]');
      if (el) removeBanner(el);
    }
  }
  var prevTotal = pendingTuiTotal;
  var anyTuiDropped = false;
  for (var j = 0; j < ids.length; j++) {
    if (dropTuiAttentionById(ids[j])) anyTuiDropped = true;
  }
  if (anyTuiDropped) refreshTuiAttentionVisuals(prevTotal);
}

export function handleNotificationDismissedAll() {
  notifications = [];
  unreadCount = 0;
  updateBadge();
  if (bannerContainer) bannerContainer.innerHTML = "";
  var prevTotal = pendingTuiTotal;
  pendingTuiBySlug = Object.create(null);
  pendingTuiBySlugId = Object.create(null);
  pendingTuiTotal = 0;
  if (prevTotal > 0) refreshTuiAttentionVisuals(prevTotal);
}

// ========================================================
// Badge
// ========================================================

function updateBadge() {
  if (!badgeEl) return;
  if (unreadCount > 0) {
    badgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badgeEl.classList.remove("hidden");
  } else {
    badgeEl.classList.add("hidden");
  }
}

// ========================================================
// Navigation
// ========================================================

function navigateToNotification(notif) {
  // TUI attention: pop the inline xterm modal attached to the same PTY
  // rather than navigating away. The user's current location (whatever
  // project/session they were in) is preserved; closing the modal returns
  // them to it. The modal opens its own WS to notif.slug because
  // terminalIds are project-local - sending term_* on the main WS would
  // miss (or hit the wrong terminal) if the user isn't currently viewing
  // that project.
  if (notif.type === "tui_attention" && notif.meta && typeof notif.meta.terminalId === "number" && notif.slug) {
    try {
      openTuiModal(notif.meta.terminalId, notif.slug, {
        sessionTitle: notif.meta.sessionTitle || notif.title || "Claude session",
        projectName: getProjectName(notif.slug),
        projectIcon: getProjectIcon(notif.slug),
      });
    } catch (e) {}
    return;
  }

  var mateId = notif.mateId || deriveMateIdFromNotification(notif);
  if (mateId) {
    if (notif.sessionId) {
      try { sessionStorage.setItem("pending-notif-session", notif.sessionId); } catch (e) {}
    }
    showHomeHub();
    openHomeChat(mateId);
    return;
  }

  var currentSlug = store.get('currentSlug') || "";
  var needsProjectSwitch = notif.slug && notif.slug !== currentSlug;

  if (needsProjectSwitch) {
    // Store target session for after project switch
    if (notif.sessionId) {
      try { sessionStorage.setItem("pending-notif-session", notif.sessionId); } catch (e) {}
    }
    switchProject(notif.slug);
  } else if (notif.sessionId) {
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "switch_session", id: notif.sessionId }));
    }
  }
}

function deriveMateIdFromNotification(notif) {
  if (!notif) return null;
  if (typeof notif.slug === "string" && notif.slug.indexOf("mate-") === 0) {
    return notif.slug.substring(5) || null;
  }
  return null;
}

// Build the sender avatar URL for a user_mention notification banner.
// Prefers the avatar fields stashed in `notif.meta` (set by the server when the
// notification is created), and falls back to the cached user list from
// `cachedAllUsers` so the banner still has a face even if meta is missing.
function buildUserMentionAvatarSrc(notif) {
  var meta = (notif && notif.meta) || {};
  if (meta.fromAvatarStyle || meta.fromAvatarSeed || meta.fromAvatarCustom) {
    return userAvatarUrl({
      avatarStyle: meta.fromAvatarStyle,
      avatarSeed: meta.fromAvatarSeed,
      avatarCustom: meta.fromAvatarCustom || "",
      username: meta.fromName,
      id: meta.fromUserId,
    }, 32);
  }
  if (meta.fromUserId) {
    var users = store.get('cachedAllUsers') || [];
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id === meta.fromUserId) return userAvatarUrl(users[i], 32);
    }
  }
  return null;
}

function getMateForNotification(notif) {
  var mateId = notif && notif.meta ? notif.meta.avatarMateId : null;
  if (!mateId) mateId = deriveMateIdFromNotification(notif);
  if (!mateId) return null;
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && mates[i].id === mateId) return mates[i];
  }
  return { id: mateId };
}

// ========================================================
// Update available banner
// ========================================================

export function showUpdateBanner(msg) {
  if (!msg || !msg.version) return;
  pendingUpdateMsg = msg;
  if (!bannerContainer) return;

  // If an update banner is already showing for the same version, skip the
  // re-render. The server pushes update_available every hour but we don't
  // want to flash/refresh the banner if the user already sees it.
  var existing = bannerContainer.querySelector('[data-notif-id="_update"]');
  if (existing) {
    var existingVersion = existing.getAttribute("data-update-version");
    if (existingVersion === msg.version) return;
    // Version changed (e.g. a newer release came in while old banner was
    // still up): tear down and re-render with the new version.
    removeBanner(existing);
  }

  var isHeadless = store.get('isHeadlessMode');
  var updTag = msg.version.indexOf("-beta") !== -1 ? "beta" : "latest";

  var banner = document.createElement("div");
  banner.className = "notif-banner notif-banner-update";
  banner.setAttribute("data-notif-id", "_update");
  banner.setAttribute("data-update-version", msg.version);

  // Headless installs update from the shell, so they get no install button —
  // but they still get the action row, because Snooze applies either way.
  var actionsHtml = '<div class="notif-banner-actions">' +
    (isHeadless ? '' : '<button class="notif-banner-update-now">Update now</button>') +
    '</div>';

  banner.innerHTML =
    '<div class="notif-banner-icon"><img src="/clay-studio-symbol.png" width="32" height="32" alt="Clay Studio"></div>' +
    '<div class="notif-banner-body">' +
      '<div class="notif-banner-project">CLAY</div>' +
      '<div class="notif-banner-title">v' + escapeHtml(msg.version) + ' is available</div>' +
      (isHeadless
        ? '<div class="notif-banner-text">Run: npx clay-server@' + escapeHtml(updTag) + '</div>'
        : '') +
      actionsHtml +
    '</div>' +
    '<button class="notif-banner-close">' + iconHtml("x") + '</button>';

  bannerContainer.appendChild(banner);
  attachSnoozeControl(banner.querySelector(".notif-banner-actions"));
  refreshIcons();

  requestAnimationFrame(function () {
    banner.classList.add("show");
  });

  // "Update now" button
  var updateBtn = banner.querySelector(".notif-banner-update-now");
  if (updateBtn) {
    updateBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "update_now" }));
        updateBtn.textContent = "Updating...";
        updateBtn.disabled = true;
      }
    });
  }

  // Close button -> dismiss. No local throttle; the server pushes a new
  // update_available on the next hour boundary, which re-shows naturally.
  var closeBtn = banner.querySelector(".notif-banner-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeBanner(banner);
    });
  }
}

// ========================================================
// Helpers
// ========================================================

function formatPermissionInfo(toolName, toolInput) {
  if (!toolName) return null;
  var input = toolInput && typeof toolInput === "object" ? toolInput : {};
  var verb = "use " + toolName;
  var target = "";
  var shortPath = function (p) { return p ? p.split(/[/\\]/).pop() : ""; };

  switch (toolName) {
    case "Write": verb = "write to"; target = shortPath(input.file_path); break;
    case "Edit": verb = "edit"; target = shortPath(input.file_path); break;
    case "Read": verb = "read"; target = shortPath(input.file_path); break;
    case "Bash": verb = "run"; target = input.description || (input.command || "").substring(0, 80); break;
    case "Grep": verb = "search"; target = input.pattern || ""; break;
    case "Glob": verb = "search for files in"; target = input.pattern || ""; break;
    case "WebFetch": verb = "fetch"; target = input.url || ""; break;
    case "WebSearch": verb = "search the web for"; target = input.query || ""; break;
  }
  return { verb: verb, target: target };
}

var EMPTY_MESSAGES = [
  "Quiet. Too quiet.",
  "Nothing. Suspiciously nothing.",
  "Inbox zero. Brag about it.",
  "No notifications. Are you even working?",
  "All clear. For now.",
  "The void stares back.",
  "Notification-free since just now.",
  "You have 0 problems. Allegedly.",
  "Tumbleweeds.",
  "Your agents are napping.",
];

function randomEmptyMessage() {
  return EMPTY_MESSAGES[Math.floor(Math.random() * EMPTY_MESSAGES.length)];
}

function getProjectIcon(slug) {
  var projects = getCachedProjects();
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].slug === slug) return projects[i].icon || null;
  }
  return null;
}

function getProjectName(slug) {
  var projects = getCachedProjects();
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].slug === slug) return projects[i].title || projects[i].name || slug;
  }
  return slug;
}
