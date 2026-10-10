import { avatarUrl, mateAvatarUrl } from './avatar.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { hideKnowledge } from './mate-knowledge.js';
import { isSchedulerOpen, closeScheduler } from './scheduler.js';
import { hideNotes } from './sticky-notes.js';
import { openSearch as openSessionSearch } from './session-search.js';
import { isExperimentalVendor } from './vendor-priority.js';

var getWs = null;
var currentMateId = null;
var currentMate = null;
var cachedSessions = [];
var sessionCtxMenu = null;

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

export function initMateSidebar(wsGetter) {
  getWs = wsGetter;
  columnEl = document.getElementById("mate-sidebar-column");
  listEl = document.getElementById("mate-session-list");
  avatarEl = document.getElementById("mate-sidebar-avatar");
  nameEl = document.getElementById("mate-sidebar-name");
  newSessionBtn = document.getElementById("mate-new-session-btn");

  if (newSessionBtn) {
    newSessionBtn.addEventListener("click", function () {
      var ws = getWs ? getWs() : null;
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
        var ws = getWs ? getWs() : null;
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

  var mateColor = profile.avatarColor || mateData.avatarColor || "#5857fc";

  var mateAvUrl = mateAvatarUrl(mateData, 32);
  if (avatarEl) avatarEl.src = mateAvUrl;
  if (nameEl) nameEl.textContent = displayName;

  // Vendor toggle in header
  var mateVendorWrap = document.getElementById("mate-vendor-toggle");
  if (mateVendorWrap) {
    var available = store.get('availableVendors') || [];
    var mateVendor = mateData.vendor || "claude";
    var vendorIcons = {
      claude: "/claude-code-avatar.png",
      codex: "/codex-avatar.png",
      antigravity: "/antigravity-avatar.png",
      opencode: "/opencode-avatar.svg",
      kimi: "/kimi-avatar.svg",
      grok: "/grok-avatar.svg",
      copilot: "/copilot-avatar.svg",
      qwen: "/qwen-avatar.svg",
      junie: "/junie-avatar.svg",
      kiro: "/kiro-avatar.svg",
    };
    var vendorNames = { claude: "Claude Code", codex: "Codex", grok: "Grok Build", kimi: "Kimi Code", copilot: "GitHub Copilot CLI", qwen: "Qwen Code", junie: "Junie CLI", antigravity: "Antigravity CLI", opencode: "OpenCode", kiro: "Kiro CLI" };
    var vendorKeys = ["claude", "codex", "grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode", "kiro"];
    mateVendorWrap.innerHTML = "";
    for (var vi = 0; vi < vendorKeys.length; vi++) {
      var vk = vendorKeys[vi];
      var vBtn = document.createElement("button");
      vBtn.className = "mate-vendor-btn" + (vk === mateVendor ? " active" : "");
      if (isExperimentalVendor(vk)) vBtn.classList.add("experimental");
      if (available.indexOf(vk) === -1) vBtn.classList.add("disabled");
      vBtn.dataset.vendor = vk;
      vBtn.title = vendorNames[vk] + (isExperimentalVendor(vk) ? " · Experimental integration; not yet validated through direct use testing" : "");
      vBtn.innerHTML = '<img src="' + vendorIcons[vk] + '" class="mate-vendor-icon" alt="' + vendorNames[vk] + '"><span class="mate-vendor-label">' + vendorNames[vk] + '</span>';
      vBtn.addEventListener("click", function() {
        var v = this.dataset.vendor;
        var avail = store.get('availableVendors') || [];
        if (avail.indexOf(v) === -1) return;
        if (v === (currentMate && currentMate.vendor || "claude")) return;
        if (!currentMateId) return;
        var ws = getWs();
        if (ws) ws.send(JSON.stringify({ type: "mate_update", mateId: currentMateId, updates: { vendor: v } }));
        // Update UI immediately
        mateVendorWrap.querySelectorAll(".mate-vendor-btn").forEach(function(b) {
          b.classList.toggle("active", b.dataset.vendor === v);
        });
        if (currentMate) currentMate.vendor = v;
        // If current session is new (no history), sync vendor to input toggle
        var _hTotal = store.get('historyTotal') || 0;
        if (_hTotal === 0) store.set({ currentVendor: v });
      });
      mateVendorWrap.appendChild(vBtn);
    }
  }

  // Also populate collapsed header info
  var collapsedAvatar = document.getElementById("mate-collapsed-avatar");
  var collapsedName = document.getElementById("mate-collapsed-name");
  if (collapsedAvatar) collapsedAvatar.src = mateAvUrl;
  if (collapsedName) collapsedName.textContent = displayName;

  // Apply mate color to sidebar
  var headerEl = columnEl.querySelector(".mate-sidebar-header");
  if (headerEl) headerEl.style.background = mateColor;
  columnEl.style.background = mateColor + "0a";

  // Render seed data tooltip
  var seedTooltip = document.getElementById("mate-sidebar-seed-tooltip");
  if (seedTooltip) {
    seedTooltip.innerHTML = "";
    seedTooltip.classList.add("hidden");
    // Primary mate badge
    if (mateData.primary) {
      var badge = document.createElement("div");
      badge.className = "mate-sidebar-primary-badge";
      badge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' +
        '<span>System Agent</span>' +
        '<span class="mate-sidebar-primary-desc">Code-managed. Auto-updated. Sees across all mates.</span>';
      seedTooltip.appendChild(badge);
    }
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
  var mateColor = profile.avatarColor || mateData.avatarColor || "#5857fc";

  if (avatarEl) {
    avatarEl.src = mateAvatarUrl(mateData, 32);
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

export function getMateSessions() {
  return cachedSessions;
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

var expandedDebateGroups = new Set();

function appendMateSessionTitleLine(el, textSpan) {
  var processingDot = textSpan.querySelector('.session-processing');
  if (processingDot) processingDot.remove();
  var titleLine = document.createElement('span');
  titleLine.className = 'mate-session-title-line';
  titleLine.appendChild(textSpan);
  if (processingDot) titleLine.appendChild(processingDot);
  el.appendChild(titleLine);
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

  // Group debate sessions by loopId
  var debateGroups = {}; // groupKey -> [sessions]
  var normalSessions = [];
  for (var i = 0; i < cachedSessions.length; i++) {
    var s = cachedSessions[i];
    if (s.loop && s.loop.loopId && s.loop.source === "debate") {
      var groupKey = s.loop.loopId + ":" + (s.loop.startedAt || 0);
      if (!debateGroups[groupKey]) debateGroups[groupKey] = [];
      debateGroups[groupKey].push(s);
    } else {
      normalSessions.push(s);
    }
  }

  // Build items: normal sessions + debate groups
  var items = [];
  for (var j = 0; j < normalSessions.length; j++) {
    items.push({ type: "session", data: normalSessions[j], lastActivity: normalSessions[j].lastActivity || 0 });
  }
  var groupKeys = Object.keys(debateGroups);
  for (var k = 0; k < groupKeys.length; k++) {
    var gk = groupKeys[k];
    var children = debateGroups[gk];
    var maxActivity = 0;
    for (var m = 0; m < children.length; m++) {
      var act = children[m].lastActivity || 0;
      if (act > maxActivity) maxActivity = act;
    }
    items.push({ type: "debate", groupKey: gk, children: children, lastActivity: maxActivity });
  }

  // Sort by lastActivity descending
  items.sort(function (a, b) {
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  for (var n = 0; n < items.length; n++) {
    var item = items[n];
    var el;
    if (item.type === "debate") {
      el = renderDebateGroup(item.children, item.groupKey);
    } else {
      el = renderMateSessionItem(item.data);
    }
    // Apply search filter
    if (searchMatchIds !== null) {
      var hasMatch = false;
      if (item.type === "debate") {
        for (var q = 0; q < item.children.length; q++) {
          if (searchMatchIds.has(item.children[q].id)) { hasMatch = true; break; }
        }
      } else {
        hasMatch = searchMatchIds.has(item.data.id);
      }
      if (hasMatch) {
        el.classList.add("search-match");
      } else {
        el.classList.add("search-dimmed");
      }
    }
    listEl.appendChild(el);
  }
  refreshIcons();
}

function renderDebateGroup(children, groupKey) {
  var gk = groupKey;

  // Sort: crafting (setup) first, then debate
  children.sort(function (a, b) {
    var ar = (a.loop && a.loop.role === "crafting") ? 0 : 1;
    var br = (b.loop && b.loop.role === "crafting") ? 0 : 1;
    return ar - br;
  });

  var expanded = expandedDebateGroups.has(gk);
  var hasActive = false;
  var anyProcessing = false;
  var latestSession = children[0];
  for (var i = 0; i < children.length; i++) {
    if (children[i].active) hasActive = true;
    if (children[i].isProcessing) anyProcessing = true;
    if ((children[i].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = children[i];
    }
  }

  var debateName = (children[0].loop && children[0].loop.name) || "Debate";

  var wrapper = document.createElement("div");
  wrapper.className = "mate-debate-wrapper";

  // Group header row
  var el = document.createElement("div");
  el.className = "mate-debate-group" + (hasActive ? " active" : "") + (expanded ? " expanded" : "");

  var chevron = document.createElement("button");
  chevron.className = "mate-debate-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  chevron.addEventListener("click", (function (lid) {
    return function (e) {
      e.stopPropagation();
      if (expandedDebateGroups.has(lid)) {
        expandedDebateGroups.delete(lid);
      } else {
        expandedDebateGroups.add(lid);
      }
      renderMateSessionList(null);
    };
  })(gk));
  el.appendChild(chevron);

  var textSpan = document.createElement("span");
  textSpan.className = "mate-session-item-text";
  var textHtml = "";
  if (anyProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  textHtml += '<span class="mate-debate-icon">' + iconHtml("mic") + '</span>';
  textHtml += '<span class="mate-debate-name">' + escapeHtml(debateName) + '</span>';
  textHtml += '<span class="mate-debate-count">' + children.length + '</span>';
  textSpan.innerHTML = textHtml;
  appendMateSessionTitleLine(el, textSpan);

  // Click row -> switch to latest session
  el.addEventListener("click", (function (id) {
    return function () {
      hideKnowledge();
      if (isSchedulerOpen()) closeScheduler();
      hideNotes();
      var ws = getWs ? getWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
    };
  })(latestSession.id));

  wrapper.appendChild(el);

  // Expanded children
  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "mate-debate-children";
    for (var k = 0; k < children.length; k++) {
      var child = children[k];
      var childEl = document.createElement("div");
      childEl.className = "mate-debate-child" + (child.active ? " active" : "");
      childEl.dataset.sessionId = child.id;

      var roleName = child.loop && child.loop.role === "crafting" ? "Setup" : "Debate";
      var roleSpan = document.createElement("span");
      roleSpan.className = "mate-debate-child-role";
      roleSpan.textContent = roleName;
      childEl.appendChild(roleSpan);

      var titleSpan = document.createElement("span");
      titleSpan.className = "mate-debate-child-title";
      titleSpan.textContent = child.title || "Session";
      childEl.appendChild(titleSpan);

      childEl.addEventListener("click", (function (id) {
        return function (e) {
          e.stopPropagation();
          hideKnowledge();
          if (isSchedulerOpen()) closeScheduler();
          hideNotes();
          var ws = getWs ? getWs() : null;
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "switch_session", id: id }));
          }
        };
      })(child.id));

      childContainer.appendChild(childEl);
    }
    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

function renderMateSessionItem(s) {
  var el = document.createElement("div");
  el.className = "mate-session-item" + (s.active ? " active" : "");
  el.dataset.sessionId = s.id;

  var processingDot = document.createElement("span");
  processingDot.className = "session-processing";
  if (!s.isProcessing) processingDot.style.display = "none";
  el.appendChild(processingDot);

  var textSpan = document.createElement("span");
  textSpan.className = "mate-session-item-text";
  textSpan.textContent = s.title || "New Session";
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
      closeMateSessionCtxMenu();
      hideKnowledge();
      if (isSchedulerOpen()) closeScheduler();
      hideNotes();
      var pendingQuery = searchQuery || "";
      var ws = getWs ? getWs() : null;
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

  // Right-click: delete session
  el.addEventListener("contextmenu", (function (id, title) {
    return function (e) {
      e.preventDefault();
      e.stopPropagation();
      showMateSessionCtxMenu(el, id, title);
    };
  })(s.id, s.title || "New Session"));

  return el;
}

function closeMateSessionCtxMenu() {
  if (sessionCtxMenu) {
    sessionCtxMenu.remove();
    sessionCtxMenu = null;
  }
}

function showMateSessionCtxMenu(anchorEl, sessionId, title) {
  closeMateSessionCtxMenu();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var deleteItem = document.createElement("button");
  deleteItem.className = "project-ctx-item project-ctx-delete";
  deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
  deleteItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeMateSessionCtxMenu();
    // Simple confirm using a temporary inline prompt
    var confirmed = false;
    var overlay = document.createElement("div");
    overlay.className = "mate-confirm-overlay";
    overlay.innerHTML = '<div class="mate-confirm-box">' +
      '<div class="mate-confirm-text">Delete "' + escapeHtml(title) + '"?</div>' +
      '<div class="mate-confirm-actions">' +
      '<button class="mate-confirm-cancel">Cancel</button>' +
      '<button class="mate-confirm-delete">Delete</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector(".mate-confirm-cancel").addEventListener("click", function () { overlay.remove(); });
    overlay.querySelector(".mate-confirm-delete").addEventListener("click", function () {
      overlay.remove();
      var ws = getWs ? getWs() : null;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "delete_session", id: sessionId }));
      }
    });
  });
  menu.appendChild(deleteItem);

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  // Position menu
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = (rect.right + 4) + "px";
    menu.style.top = rect.top + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 4) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });

  // Close on outside click
  setTimeout(function () {
    document.addEventListener("click", function closeHandler() {
      closeMateSessionCtxMenu();
      document.removeEventListener("click", closeHandler);
    });
  }, 0);
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
