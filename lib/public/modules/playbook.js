/**
 * Playbook Engine — interactive step-by-step tutorials with branching.
 *
 * Each playbook is a state machine: steps with actions, conditions, and branches.
 * Define playbooks declaratively, register them, then open by id.
 *
 * Playbook shape:
 *   { id, title, icon, description, steps: [ { id, title, body, actions?, condition?, branches? } ] }
 *
 * Step shape:
 *   id:        unique step identifier
 *   title:     heading text
 *   body:      description (supports simple HTML)
 *   actions:   [ { label, action?, next } ]  — buttons. action = string key → resolved by actionHandlers
 *   condition: function returning a string key
 *   branches:  { [key]: stepId }  — auto-navigate based on condition result
 *   note:      optional small footnote text
 */

import { iconHtml, refreshIcons } from './icons.js';

var registry = {};       // id → playbook definition
var actionHandlers = {}; // action key → function(cb) — cb(result) when done
var modal = null;        // DOM element
var overlay = null;
var currentPlaybook = null;
var currentStepIdx = 0;
var stepHistory = [];
var completedPlaybooks = {};
var onCloseCallback = null;

// --- Registry ---

export function registerPlaybook(pb) {
  registry[pb.id] = pb;
}

export function registerAction(key, handler) {
  actionHandlers[key] = handler;
}

export function getPlaybooks() {
  var list = [];
  for (var id in registry) {
    if (registry.hasOwnProperty(id)) {
      var pb = registry[id];
      list.push({
        id: pb.id,
        title: pb.title,
        icon: pb.icon || "📖",
        description: pb.description || "",
        completed: !!completedPlaybooks[pb.id],
        steps: pb.steps.length,
      });
    }
  }
  return list;
}

export function isCompleted(id) {
  return !!completedPlaybooks[id];
}

// --- Open / Close ---

export function openPlaybook(id, onClose) {
  var pb = registry[id];
  if (!pb) return;
  currentPlaybook = pb;
  currentStepIdx = 0;
  stepHistory = [];
  onCloseCallback = onClose || null;
  ensureModal();
  navigateToStep(pb.steps[0].id);
  overlay.classList.remove("hidden");
  modal.classList.remove("hidden");
  // Focus trap
  setTimeout(function () { modal.focus(); }, 50);
}

export function closePlaybook() {
  if (overlay) overlay.classList.add("hidden");
  if (modal) modal.classList.add("hidden");
  var cb = onCloseCallback;
  currentPlaybook = null;
  onCloseCallback = null;
  if (cb) cb();
}

// --- Init (call once from app.js) ---

export function initPlaybook() {
  loadCompleted();
  registerBuiltinPlaybooks();
}

// --- DOM ---

function ensureModal() {
  if (modal) return;
  overlay = document.createElement("div");
  overlay.className = "playbook-overlay hidden";
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closePlaybook();
  });

  modal = document.createElement("div");
  modal.className = "playbook-modal hidden";
  modal.setAttribute("tabindex", "-1");
  modal.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePlaybook();
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function navigateToStep(stepId) {
  if (!currentPlaybook) return;
  var step = null;
  var idx = 0;
  for (var i = 0; i < currentPlaybook.steps.length; i++) {
    if (currentPlaybook.steps[i].id === stepId) {
      step = currentPlaybook.steps[i];
      idx = i;
      break;
    }
  }
  if (!step) return;
  currentStepIdx = idx;
  stepHistory.push(stepId);

  // Auto-branch if condition exists
  if (step.condition && step.branches) {
    var key = step.condition();
    var nextId = step.branches[key] || step.branches["default"];
    if (nextId) {
      navigateToStep(nextId);
      return;
    }
  }

  renderStep(step);
}

function renderStep(step) {
  var pb = currentPlaybook;
  var totalSteps = pb.steps.filter(function (s) { return !s.condition; }).length;
  var visibleIdx = 0;
  var count = 0;
  for (var i = 0; i < pb.steps.length; i++) {
    if (!pb.steps[i].condition) {
      count++;
      if (pb.steps[i].id === step.id) visibleIdx = count;
    }
  }

  var html = '';
  // Header
  html += '<div class="playbook-header">';
  html += '<div class="playbook-header-left">';
  html += '<span class="playbook-icon">' + (pb.icon || "📖") + '</span>';
  html += '<span class="playbook-title">' + escHtml(pb.title) + '</span>';
  html += '</div>';
  html += '<button class="playbook-close" title="Close">&times;</button>';
  html += '</div>';

  // Progress
  html += '<div class="playbook-progress">';
  for (var p = 0; p < totalSteps; p++) {
    var cls = "playbook-progress-dot";
    if (p + 1 < visibleIdx) cls += " done";
    else if (p + 1 === visibleIdx) cls += " active";
    html += '<span class="' + cls + '"></span>';
  }
  html += '</div>';

  // Body
  html += '<div class="playbook-body">';
  html += '<h2 class="playbook-step-title">' + escHtml(step.title) + '</h2>';
  var bodyContent = typeof step.body === "function" ? step.body() : (step.body || "");
  html += '<div class="playbook-step-body">' + bodyContent + '</div>';
  if (step.note) {
    html += '<div class="playbook-step-note">' + escHtml(step.note) + '</div>';
  }
  html += '</div>';

  // Actions
  if (step.actions && step.actions.length > 0) {
    html += '<div class="playbook-actions">';
    for (var a = 0; a < step.actions.length; a++) {
      var act = step.actions[a];
      var btnClass = "playbook-btn";
      if (a === 0) btnClass += " playbook-btn-primary";
      else btnClass += " playbook-btn-secondary";
      html += '<button class="' + btnClass + '" data-action="' + (act.action || "") + '" data-next="' + (act.next || "") + '">' + escHtml(act.label) + '</button>';
    }
    html += '</div>';
  }

  modal.innerHTML = html;
  refreshIcons();

  // Wire close button
  var closeBtn = modal.querySelector(".playbook-close");
  if (closeBtn) closeBtn.addEventListener("click", closePlaybook);

  // Wire action buttons
  var btns = modal.querySelectorAll(".playbook-btn");
  for (var b = 0; b < btns.length; b++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var actionKey = btn.dataset.action;
        var nextStep = btn.dataset.next;
        if (actionKey && actionHandlers[actionKey]) {
          btn.disabled = true;
          btn.textContent += "...";
          actionHandlers[actionKey](function () {
            if (nextStep) navigateToStep(nextStep);
            else {
              markCompleted(currentPlaybook.id);
              closePlaybook();
            }
          });
        } else if (nextStep) {
          navigateToStep(nextStep);
        } else {
          markCompleted(currentPlaybook.id);
          closePlaybook();
        }
      });
    })(btns[b]);
  }

  // Wire copy-url buttons (for denied step)
  var copyBtns = modal.querySelectorAll("[data-copy-url]");
  for (var c = 0; c < copyBtns.length; c++) {
    (function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var url = btn.dataset.copyUrl;
        navigator.clipboard.writeText(url).then(function () {
          btn.textContent = "Copied!";
          setTimeout(function () { btn.textContent = "Copy"; }, 1500);
        });
      });
    })(copyBtns[c]);
  }
}

// --- Completion tracking ---

function markCompleted(id) {
  completedPlaybooks[id] = true;
  try { localStorage.setItem("clay-playbooks-done", JSON.stringify(completedPlaybooks)); } catch (e) {}
}

function loadCompleted() {
  try {
    var data = JSON.parse(localStorage.getItem("clay-playbooks-done") || "{}");
    completedPlaybooks = data || {};
  } catch (e) { completedPlaybooks = {}; }
}

// --- Tip ↔ Playbook linking ---

export function getPlaybookForTip(tipText) {
  for (var id in registry) {
    if (!registry.hasOwnProperty(id)) continue;
    var pb = registry[id];
    if (pb.tipMatch && pb.tipMatch(tipText)) return pb.id;
  }
  return null;
}

// --- Built-in Playbooks ---

function registerBuiltinPlaybooks() {
  // === Push Notifications ===
  registerPlaybook({
    id: "push-notifications",
    title: "Push Notifications",
    icon: "🔔",
    description: "Get notified when Claude finishes a long task",
    tipMatch: function (t) { return t.indexOf("Push notification") !== -1; },
    steps: [
      {
        id: "intro",
        title: "Never miss a response",
        body: "When Claude is working on a long task, you can walk away and get a push notification the moment it's done. Works even when Clay is in the background.",
        actions: [
          { label: "Enable notifications", action: "notif_request", next: "check_perm" },
          { label: "Not now", next: "" },
        ],
      },
      {
        id: "check_perm",
        condition: function () {
          if (typeof Notification === "undefined") return "unsupported";
          return Notification.permission;  // "granted" | "denied" | "default"
        },
        branches: {
          "granted": "test",
          "denied": "denied",
          "default": "denied",
          "unsupported": "unsupported",
        },
      },
      {
        id: "test",
        title: "Let's test it!",
        body: "Click below to send a test notification. You should see it pop up from your system.",
        actions: [
          { label: "Send test notification", action: "notif_test", next: "check_test" },
          { label: "Skip", next: "done" },
        ],
      },
      {
        id: "check_test",
        title: "Did you see it?",
        body: "A notification should have appeared from your system just now.",
        actions: [
          { label: "Yes, it worked!", next: "done" },
          { label: "No, nothing appeared", next: "troubleshoot" },
        ],
      },
      {
        id: "troubleshoot",
        title: "Troubleshooting",
        body: function () {
          var isMac = navigator.platform && navigator.platform.indexOf("Mac") !== -1;
          var browser = "your browser";
          var ua = navigator.userAgent || "";
          if (ua.indexOf("Arc") !== -1) browser = "Arc";
          else if (ua.indexOf("Edg/") !== -1) browser = "Edge";
          else if (ua.indexOf("Firefox") !== -1) browser = "Firefox";
          else if (ua.indexOf("Chrome") !== -1) browser = "Chrome";
          else if (ua.indexOf("Safari") !== -1) browser = "Safari";

          var hasUntrustedCert = location.protocol === "https:" &&
            location.hostname !== "localhost" &&
            location.hostname !== "127.0.0.1";

          var html = "The browser says permission is granted, but the notification didn't show.<br><br>";

          if (hasUntrustedCert) {
            html += "🔒 <strong>Untrusted certificate?</strong><br>" +
              "If you're using a self-signed or untrusted TLS certificate, " +
              "some browsers silently block notifications even on HTTPS.<br>" +
              "Run <strong>mkcert -install</strong> on the server to trust the root CA, " +
              "or add the certificate to your system keychain as trusted.<br><br>";
          }

          html += "<strong>Also check your OS notification settings:</strong><br>";
          if (isMac) {
            html += "<strong>1.</strong> Open <strong>System Settings → Notifications</strong><br>" +
              "<strong>2.</strong> Find <strong>" + browser + "</strong> in the list<br>" +
              "<strong>3.</strong> Make sure <strong>Allow Notifications</strong> is turned on<br>" +
              "<strong>4.</strong> Check that <strong>Do Not Disturb</strong> / Focus mode is off<br>";
          } else {
            html += "<strong>1.</strong> Make sure notifications are enabled for <strong>" + browser + "</strong><br>" +
              "<strong>2.</strong> Check that Do Not Disturb / Focus mode is off<br>";
          }
          html += "<br>After adjusting, come back and try again.";
          return html;
        },
        actions: [
          { label: "Try again", action: "notif_test", next: "check_test" },
          { label: "I'll fix it later", next: "done" },
        ],
      },
      {
        id: "denied",
        title: "Permission needed",
        body: function () {
          var isInsecure = !window.isSecureContext ||
            (location.protocol === "http:" &&
             location.hostname !== "localhost" &&
             location.hostname !== "127.0.0.1" &&
             location.hostname !== "[::1]");

          if (isInsecure) {
            return "⚠️ <strong>Insecure context detected.</strong><br><br>" +
              "Notifications require a <strong>secure context</strong> (HTTPS or localhost). " +
              "You're accessing Clay over <strong>" + location.protocol + "//" + location.hostname + "</strong>, so the browser automatically blocks notifications.<br><br>" +
              "<strong>How to fix:</strong><br>" +
              "<strong>1.</strong> Access Clay via <strong>https://</strong> (set up a TLS certificate)<br>" +
              "<strong>2.</strong> Or access via <strong>localhost:" + location.port + "</strong> instead of an IP address<br>";
          }

          var url = "chrome://settings/content/notifications";
          var ua = navigator.userAgent || "";
          if (ua.indexOf("Firefox") !== -1) url = "about:preferences#privacy";
          else if (ua.indexOf("Edg/") !== -1) url = "edge://settings/content/notifications";
          else if (ua.indexOf("Arc") !== -1) url = "arc://settings/content/notifications";
          return "Your browser blocked the notification permission.<br><br>" +
            "<strong>1.</strong> Click the lock icon in the address bar<br>" +
            "<strong>2.</strong> Find \"Notifications\" and set it to \"Allow\"<br>" +
            "<strong>3.</strong> Reload the page<br><br>" +
            "Or paste this into your address bar:<br>" +
            "<div style=\"display:flex;align-items:center;gap:6px;margin-top:6px\">" +
            "<code style=\"font-size:12px;color:var(--accent);flex:1;user-select:all\">" + url + "</code>" +
            "<button class=\"playbook-btn-secondary\" style=\"padding:3px 8px;font-size:11px\" data-copy-url=\"" + url + "\">Copy</button>" +
            "</div>";
        },
        actions: [
          { label: "Got it", next: "" },
        ],
      },
      {
        id: "unsupported",
        title: "Not supported",
        body: "Your browser doesn't support notifications. Try Chrome, Edge, or Firefox for the best experience.",
        actions: [
          { label: "Got it", next: "" },
        ],
      },
      {
        id: "done",
        title: "All set! 🎉",
        body: "You'll now get a notification whenever Claude finishes processing. This works even when Clay is minimized or in another tab.",
        note: "You can toggle notifications anytime from the header bar.",
        actions: [
          { label: "Done", next: "" },
        ],
      },
    ],
  });

  // === Action handlers for Push Notifications ===
  registerAction("notif_request", function (cb) {
    if (typeof Notification === "undefined") { cb(); return; }
    Notification.requestPermission().then(function (perm) {
      // Sync with app's notification toggle state
      if (perm === "granted") {
        try {
          localStorage.setItem("notif-alert", "1");
          // Update the toggle if visible
          var toggle = document.getElementById("notif-toggle-alert");
          if (toggle) toggle.checked = true;
        } catch (e) {}
      }
      cb();
    }).catch(function () { cb(); });
  });

  registerAction("notif_test", function (cb) {
    if (typeof Notification === "undefined") { cb(); return; }
    // Ensure permission is granted before trying
    if (Notification.permission !== "granted") {
      Notification.requestPermission().then(function (perm) {
        if (perm === "granted") fireTestNotification(cb);
        else cb();
      }).catch(function () { cb(); });
      return;
    }
    fireTestNotification(cb);
  });

  function fireTestNotification(cb) {
    try {
      var n = new Notification("Clay", {
        body: "Notifications are working! 🎉",
        tag: "clay-test-" + Date.now(),
      });
      n.onclick = function () { window.focus(); n.close(); };
      setTimeout(function () { try { n.close(); } catch (e) {} }, 5000);
    } catch (e) {
      console.warn("[Playbook] Notification failed:", e);
    }
    setTimeout(cb, 800);
  }
}

// --- Utils ---

function escHtml(str) {
  var div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
