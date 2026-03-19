import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { hideKnowledge } from './mate-knowledge.js';

var getMateWs = null;
var currentMateId = null;
var currentMate = null;
var cachedSessions = [];

var columnEl = null;
var listEl = null;
var avatarEl = null;
var nameEl = null;
var newSessionBtn = null;

export function initMateSidebar(mateWsGetter) {
  getMateWs = mateWsGetter;
  columnEl = document.getElementById("mate-sidebar-column");
  listEl = document.getElementById("mate-session-list");
  avatarEl = document.getElementById("mate-sidebar-avatar");
  nameEl = document.getElementById("mate-sidebar-name");
  newSessionBtn = document.getElementById("mate-new-session-btn");

  if (newSessionBtn) {
    newSessionBtn.addEventListener("click", function () {
      var ws = getMateWs ? getMateWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "new_session" }));
      }
    });
  }

  // Tools: reuse existing project sidebar buttons
  var mateStickyBtn = document.getElementById("mate-sticky-notes-btn");
  if (mateStickyBtn) {
    mateStickyBtn.addEventListener("click", function () {
      hideKnowledge();
      var origBtn = document.getElementById("sticky-notes-sidebar-btn");
      if (origBtn) origBtn.click();
    });
  }
  var mateSkillsBtn = document.getElementById("mate-skills-btn");
  if (mateSkillsBtn) {
    mateSkillsBtn.addEventListener("click", function () {
      var origBtn = document.getElementById("skills-btn");
      if (origBtn) origBtn.click();
    });
  }
}

export function showMateSidebar(mateId, mateData) {
  currentMateId = mateId;
  currentMate = mateData;
  cachedSessions = [];

  if (!columnEl) return;
  columnEl.classList.remove("hidden");

  // Populate header
  var profile = mateData.profile || mateData || {};
  var displayName = profile.displayName || mateData.displayName || mateData.name || "Mate";
  var avatarStyle = profile.avatarStyle || "bottts";
  var avatarSeed = profile.avatarSeed || mateId;

  var mateColor = profile.avatarColor || mateData.avatarColor || "#7c3aed";

  if (avatarEl) {
    avatarEl.src = "https://api.dicebear.com/9.x/" + encodeURIComponent(avatarStyle) + "/svg?seed=" + encodeURIComponent(avatarSeed) + "&size=32";
  }
  if (nameEl) nameEl.textContent = displayName;

  // Apply mate color to sidebar
  var headerEl = columnEl.querySelector(".mate-sidebar-header");
  if (headerEl) headerEl.style.background = mateColor;
  columnEl.style.background = mateColor + "0a";

  // Clear session list
  if (listEl) listEl.innerHTML = "";
  refreshIcons();
}

export function updateMateSidebarProfile(mateData) {
  if (!columnEl || !mateData) return;
  var profile = mateData.profile || mateData || {};
  var displayName = profile.displayName || mateData.displayName || mateData.name || "Mate";
  var avatarStyle = profile.avatarStyle || "bottts";
  var avatarSeed = profile.avatarSeed || (mateData.id || "mate");
  var mateColor = profile.avatarColor || mateData.avatarColor || "#7c3aed";

  if (avatarEl) {
    avatarEl.src = "https://api.dicebear.com/9.x/" + encodeURIComponent(avatarStyle) + "/svg?seed=" + encodeURIComponent(avatarSeed) + "&size=32";
  }
  if (nameEl) nameEl.textContent = displayName;
  var headerEl = columnEl.querySelector(".mate-sidebar-header");
  if (headerEl) headerEl.style.background = mateColor;
  columnEl.style.background = mateColor + "0a";
}

export function hideMateSidebar() {
  currentMateId = null;
  currentMate = null;
  cachedSessions = [];
  if (columnEl) columnEl.classList.add("hidden");
}

export function renderMateSessionList(sessions) {
  cachedSessions = sessions || [];
  if (!listEl) return;
  listEl.innerHTML = "";

  if (cachedSessions.length === 0) {
    var empty = document.createElement("div");
    empty.className = "mate-session-empty";
    empty.textContent = "No sessions yet";
    listEl.appendChild(empty);
    return;
  }

  for (var i = 0; i < cachedSessions.length; i++) {
    var s = cachedSessions[i];
    listEl.appendChild(renderMateSessionItem(s));
  }
  refreshIcons();
}

function renderMateSessionItem(s) {
  var el = document.createElement("div");
  el.className = "mate-session-item" + (s.active ? " active" : "");
  el.dataset.sessionId = s.id;

  var textSpan = document.createElement("span");
  textSpan.className = "mate-session-item-text";
  var html = "";
  if (s.isProcessing) {
    html += '<span class="mate-session-processing"></span>';
  }
  html += escapeHtml(s.title || "New Session");
  textSpan.innerHTML = html;
  el.appendChild(textSpan);

  // Relative time
  if (s.lastActivity) {
    var timeSpan = document.createElement("span");
    timeSpan.className = "mate-session-time";
    timeSpan.textContent = relativeTime(s.lastActivity);
    el.appendChild(timeSpan);
  }

  el.addEventListener("click", (function (id) {
    return function () {
      var ws = getMateWs ? getMateWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
      // Update active state visually
      var items = listEl.querySelectorAll(".mate-session-item");
      for (var j = 0; j < items.length; j++) {
        items[j].classList.remove("active");
      }
      el.classList.add("active");
    };
  })(s.id));

  return el;
}

function relativeTime(ts) {
  var now = Date.now();
  var diff = now - ts;
  var sec = Math.floor(diff / 1000);
  if (sec < 60) return "now";
  var min = Math.floor(sec / 60);
  if (min < 60) return min + "m";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h";
  var day = Math.floor(hr / 24);
  if (day < 30) return day + "d";
  var month = Math.floor(day / 30);
  return month + "mo";
}
