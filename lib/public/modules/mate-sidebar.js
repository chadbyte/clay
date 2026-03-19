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

  // Header click: toggle seed data panel
  var headerEl = document.getElementById("mate-sidebar-header");
  if (headerEl) {
    headerEl.addEventListener("click", function () {
      var seedPanel = document.getElementById("mate-sidebar-seed");
      if (!seedPanel) return;
      var expanded = !seedPanel.classList.contains("hidden");
      if (expanded) {
        seedPanel.classList.add("hidden");
        headerEl.classList.remove("expanded");
      } else {
        seedPanel.classList.remove("hidden");
        headerEl.classList.add("expanded");
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

  // Render seed data panel
  var seedPanel = document.getElementById("mate-sidebar-seed");
  var headerClickEl = document.getElementById("mate-sidebar-header");
  if (seedPanel) {
    seedPanel.innerHTML = "";
    seedPanel.classList.add("hidden");
    if (headerClickEl) headerClickEl.classList.remove("expanded");
    var sd = mateData.seedData || {};
    if (sd.relationship) {
      seedPanel.appendChild(makeSeedRow("Role", sd.relationship.replace(/_/g, " ")));
    }
    if (sd.activity && sd.activity.length > 0) {
      seedPanel.appendChild(makeSeedTags("Activities", sd.activity));
    }
    if (sd.communicationStyle && sd.communicationStyle.length > 0) {
      seedPanel.appendChild(makeSeedTags("Style", sd.communicationStyle.map(function (s) { return s.replace(/_/g, " "); })));
    }
    if (sd.autonomy) {
      var autonomyLabels = {
        always_ask: "Ask me everything",
        minor_stuff_ok: "Small stuff is fine",
        mostly_autonomous: "Mostly free",
        fully_autonomous: "Full freedom",
      };
      seedPanel.appendChild(makeSeedRow("Autonomy", autonomyLabels[sd.autonomy] || sd.autonomy.replace(/_/g, " ")));
    }
  }

  // Clear session list
  if (listEl) listEl.innerHTML = "";
  refreshIcons();
}

function makeSeedRow(label, value) {
  var row = document.createElement("div");
  row.className = "mate-sidebar-seed-row";
  row.innerHTML = '<span class="mate-sidebar-seed-label">' + escapeHtml(label) + '</span><span class="mate-sidebar-seed-value">' + escapeHtml(value) + '</span>';
  return row;
}

function makeSeedTags(label, items) {
  var row = document.createElement("div");
  row.className = "mate-sidebar-seed-row";
  var labelEl = document.createElement("span");
  labelEl.className = "mate-sidebar-seed-label";
  labelEl.textContent = label;
  row.appendChild(labelEl);
  var tagsEl = document.createElement("div");
  tagsEl.className = "mate-sidebar-seed-tags";
  for (var i = 0; i < items.length; i++) {
    var tag = document.createElement("span");
    tag.className = "mate-sidebar-seed-tag";
    tag.textContent = items[i];
    tagsEl.appendChild(tag);
  }
  row.appendChild(tagsEl);
  return row;
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
  // Check if name changed for engrave effect
  var oldName = nameEl ? nameEl.textContent : "";
  if (nameEl && displayName !== oldName && oldName !== displayName) {
    engraveText(nameEl, displayName, mateColor);
  } else if (nameEl) {
    nameEl.textContent = displayName;
  }
  var headerEl = columnEl.querySelector(".mate-sidebar-header");
  if (headerEl) headerEl.style.background = mateColor;
  columnEl.style.background = mateColor + "0a";
}

// Ten Commandments engrave effect: letters appear one by one with spark particles
var engraveTimers = [];
var engraveTarget = null;

function engraveText(el, text, color) {
  // Cancel any pending engrave
  for (var t = 0; t < engraveTimers.length; t++) {
    clearTimeout(engraveTimers[t]);
  }
  engraveTimers = [];

  // Skip if already engraving to the same name
  if (engraveTarget === text) return;
  engraveTarget = text;

  el.textContent = "";
  el.style.position = "relative";
  var chars = text.split("");
  var step = 80;

  // Flash the header background
  var headerEl = columnEl ? columnEl.querySelector(".mate-sidebar-header") : null;
  if (headerEl) {
    headerEl.style.animation = "none";
    void headerEl.offsetWidth; // reflow
    headerEl.style.animation = "engrave-header-flash 0.8s ease-out";
  }

  for (var i = 0; i < chars.length; i++) {
    (function (ch, idx) {
      var tid = setTimeout(function () {
        var span = document.createElement("span");
        span.textContent = ch;
        span.style.opacity = "0";
        span.style.display = "inline-block";
        span.style.animation = "engrave-char 0.5s ease-out forwards";
        el.appendChild(span);

        // Spawn spark particles at character position
        var tid2 = setTimeout(function () {
          var rect = span.getBoundingClientRect();
          spawnSparks(rect.left + rect.width / 2, rect.top + rect.height / 2, color);
        }, 30);
        engraveTimers.push(tid2);
      }, idx * step);
      engraveTimers.push(tid);
    })(chars[i], i);
  }
}

function spawnSparks(cx, cy) {
  var sparkColors = ["#fff700", "#ff8c00", "#ff4500", "#fffbe6", "#ffdd57"];
  var count = 8;
  for (var i = 0; i < count; i++) {
    var spark = document.createElement("div");
    spark.className = "mate-engrave-spark";
    var angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 1.0;
    var dist = 10 + Math.random() * 18;
    var dx = Math.cos(angle) * dist;
    var dy = Math.sin(angle) * dist;
    var sc = sparkColors[Math.floor(Math.random() * sparkColors.length)];
    spark.style.left = cx + "px";
    spark.style.top = cy + "px";
    spark.style.setProperty("--dx", dx + "px");
    spark.style.setProperty("--dy", dy + "px");
    spark.style.setProperty("--spark-color", sc);
    spark.style.background = sc;
    document.body.appendChild(spark);
    spark.addEventListener("animationend", function () { spark.remove(); });
  }
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
