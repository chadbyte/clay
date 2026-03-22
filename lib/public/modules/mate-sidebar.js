import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { hideKnowledge } from './mate-knowledge.js';
import { isSchedulerOpen, closeScheduler } from './scheduler.js';
import { hideNotes } from './sticky-notes.js';
import { openSearch as openSessionSearch } from './session-search.js';

var getMateWs = null;
var currentMateId = null;
var currentMate = null;
var cachedSessions = [];

var columnEl = null;
var listEl = null;
var avatarEl = null;
var nameEl = null;
var newSessionBtn = null;

// Search state
var searchBtn = null;
var searchContainer = null;
var searchInput = null;
var searchClearBtn = null;
var searchQuery = "";
var searchMatchIds = null;
var searchDebounce = null;

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

  // Session search
  searchBtn = document.getElementById("mate-search-session-btn");
  searchContainer = document.getElementById("mate-session-search");
  searchInput = document.getElementById("mate-session-search-input");
  searchClearBtn = document.getElementById("mate-session-search-clear");

  if (searchBtn) {
    searchBtn.addEventListener("click", function () {
      if (searchContainer && searchContainer.classList.contains("hidden")) {
        openSearch();
      } else {
        closeSearch();
      }
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener("click", closeSearch);
  }
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      var q = searchInput.value.trim();
      searchQuery = q;
      if (searchDebounce) clearTimeout(searchDebounce);
      if (!q) {
        searchMatchIds = null;
        renderMateSessionList(null);
        return;
      }
      searchDebounce = setTimeout(function () {
        var ws = getMateWs ? getMateWs() : null;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "search_sessions", query: q }));
        }
      }, 200);
    });
    searchInput.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") closeSearch();
    });
    searchInput.addEventListener("keyup", function (e) { e.stopPropagation(); });
    searchInput.addEventListener("keypress", function (e) { e.stopPropagation(); });
  }

  // Name hover: show seed data tooltip
  if (nameEl) {
    nameEl.addEventListener("mouseenter", function () {
      var tooltip = document.getElementById("mate-sidebar-seed-tooltip");
      if (tooltip && tooltip.innerHTML.trim()) tooltip.classList.remove("hidden");
    });
    nameEl.addEventListener("mouseleave", function () {
      var tooltip = document.getElementById("mate-sidebar-seed-tooltip");
      if (tooltip) tooltip.classList.add("hidden");
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
  var mateSchedulerBtn = document.getElementById("mate-scheduler-btn");
  if (mateSchedulerBtn) {
    mateSchedulerBtn.addEventListener("click", function () {
      hideKnowledge();
      var origBtn = document.getElementById("scheduler-btn");
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

  // Render seed data tooltip
  var seedTooltip = document.getElementById("mate-sidebar-seed-tooltip");
  if (seedTooltip) {
    seedTooltip.innerHTML = "";
    seedTooltip.classList.add("hidden");
    var sd = mateData.seedData || {};
    if (sd.relationship) {
      seedTooltip.appendChild(makeSeedRow("Role", sd.relationship.replace(/_/g, " ")));
    }
    if (sd.activity && sd.activity.length > 0) {
      seedTooltip.appendChild(makeSeedTags("Activities", sd.activity));
    }
    if (sd.communicationStyle && sd.communicationStyle.length > 0) {
      seedTooltip.appendChild(makeSeedTags("Style", sd.communicationStyle.map(function (s) { return s.replace(/_/g, " "); })));
    }
    if (sd.autonomy) {
      var autonomyLabels = {
        always_ask: "Ask me everything",
        minor_stuff_ok: "Small stuff is fine",
        mostly_autonomous: "Mostly free",
        fully_autonomous: "Full freedom",
      };
      seedTooltip.appendChild(makeSeedRow("Autonomy", autonomyLabels[sd.autonomy] || sd.autonomy.replace(/_/g, " ")));
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
  // Sync chat title bar color
  var titleBarContent = document.querySelector(".title-bar-content.mate-dm-active");
  if (titleBarContent) titleBarContent.style.background = mateColor;
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

function openSearch() {
  if (searchContainer) searchContainer.classList.remove("hidden");
  if (searchBtn) searchBtn.classList.add("active");
  if (searchInput) { searchInput.value = ""; searchInput.focus(); }
  searchQuery = "";
  searchMatchIds = null;
}

function closeSearch() {
  if (searchContainer) searchContainer.classList.add("hidden");
  if (searchBtn) searchBtn.classList.remove("active");
  if (searchInput) searchInput.value = "";
  searchQuery = "";
  searchMatchIds = null;
  if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
  renderMateSessionList(null);
}

export function handleMateSearchResults(msg) {
  if (msg.query !== searchQuery) return;
  var ids = new Set();
  if (msg.results) {
    for (var i = 0; i < msg.results.length; i++) {
      ids.add(msg.results[i].id);
    }
  }
  searchMatchIds = ids;
  renderMateSessionList(null);
}

export function renderMateSessionList(sessions) {
  if (sessions) cachedSessions = sessions;
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
    var el = renderMateSessionItem(s);
    // Apply search filter
    if (searchMatchIds !== null) {
      if (searchMatchIds.has(s.id)) {
        el.classList.add("search-match");
      } else {
        el.classList.add("search-dimmed");
      }
    }
    listEl.appendChild(el);
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
      // Close any open panels
      hideKnowledge();
      if (isSchedulerOpen()) closeScheduler();
      hideNotes();
      var pendingQuery = searchQuery || "";
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
      // Open in-session search with the sidebar search query
      if (pendingQuery) {
        setTimeout(function () { openSessionSearch(pendingQuery); }, 400);
      }
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
