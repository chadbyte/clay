// sidebar-mobile.js - Mobile sheet overlays, tab bar, and mobile-specific rendering
// Extracted from sidebar.js (PR-38)

import { mateAvatarUrl } from './avatar.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { parseEmojis } from './markdown.js';
import { getCurrentTheme, getChatLayout, setChatLayout } from './theme.js';
import { openCommandPalette } from './command-palette.js';
import { openProjectSettings } from './project-settings.js';
import {
  getCachedSessions,
  getDateGroup,
  resolveDefaultVendor,
  startNewSession
} from './sidebar-sessions.js';
import { VENDOR_AVATARS, VENDOR_NAMES, VENDOR_ORDER, VENDOR_HOMEPAGES, isExperimentalVendor } from './app-rendering.js';
import { defaultVendorUnavailable, resolvePreferredVendor, saveDefaultVendor } from './default-vendor.js';
import { renderSessionCreationCta } from './session-creation-cta.js';
import {
  getCachedProjectList,
  getCachedCurrentSlug,
  getProjectAbbrev
} from './sidebar-projects.js';
import {
  getCurrentDmUserId,
  getCachedMates,
  getCachedDmFavorites,
  getCachedDmUnread,
  getCachedDmRemovedUsers
} from './sidebar-mates.js';

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { dismissOverlayPanels, closeSidebar } from './sidebar.js';
import { switchProject, getCachedProjects } from './app-projects.js';
import { showHomeHub } from './app-home-hub.js';
import { openHomeChat } from './home-mate-chat.js';
import { openTerminal } from './terminal.js';
import { requestKnowledgeList } from './mate-knowledge.js';
import { loadRootDirectory, reopenFileViewer } from './filebrowser.js';
import {
  prepareSidebarHierarchy,
  renderMobileDriverHierarchy,
  renderMobileOrphanHierarchy
} from './sidebar-session-hierarchy.js';

// --- Mobile state ---
var mobileChatSheetOpen = false;
var mobileSheetMateData = null;
var expandedMobileLoopGroups = new Set();
var expandedMobileLoopRuns = new Set();

export function setMobileSheetMateData(data) {
  mobileSheetMateData = data;
}

export function openMobileSheet(type) {
  var sheet = document.getElementById("mobile-sheet");
  if (!sheet) return;

  var titleEl = sheet.querySelector(".mobile-sheet-title");
  var listEl = sheet.querySelector(".mobile-sheet-list");
  if (!titleEl || !listEl) return;

  // Return file tree to sidebar before clearing (prevents destroying it)
  if (sheet.classList.contains("sheet-files")) {
    var prevFileTree = document.getElementById("file-tree");
    var prevPanel = document.getElementById("sidebar-panel-files");
    if (prevFileTree && prevPanel) prevPanel.appendChild(prevFileTree);
  }
  // Return knowledge files to mate sidebar before clearing
  if (sheet.classList.contains("sheet-knowledge")) {
    var prevKnowledge = document.getElementById("mate-knowledge-files");
    var prevKnowledgePanel = document.getElementById("mate-sidebar-knowledge");
    if (prevKnowledge && prevKnowledgePanel) prevKnowledgePanel.appendChild(prevKnowledge);
  }

  listEl.innerHTML = "";
  sheet.classList.remove("sheet-files", "sheet-knowledge");

  if (type === "projects") {
    titleEl.textContent = "Projects";
    renderSheetProjects(listEl);
  } else if (type === "sessions") {
    titleEl.textContent = "Chat";
    renderSheetSessions(listEl);
  } else if (type === "files") {
    titleEl.textContent = "Files";
    sheet.classList.add("sheet-files");
    var fileTree = document.getElementById("file-tree");
    if (fileTree) {
      listEl.appendChild(fileTree);
      fileTree.classList.remove("hidden");
    }
    reopenFileViewer();
    loadRootDirectory();
  } else if (type === "mate-knowledge") {
    titleEl.textContent = "Knowledge";
    sheet.classList.add("sheet-knowledge");
    var knowledgeFiles = document.getElementById("mate-knowledge-files");
    if (knowledgeFiles) {
      listEl.appendChild(knowledgeFiles);
      knowledgeFiles.classList.remove("hidden");
    }
    // Request knowledge list if not loaded
    requestKnowledgeList();
  } else if (type === "mate-profile") {
    titleEl.textContent = "";
    renderSheetMateProfile(listEl);
  } else if (type === "search") {
    titleEl.textContent = "Search";
    renderSheetSearch(listEl);
  } else if (type === "tools") {
    titleEl.textContent = "Tools";
    renderSheetTools(listEl);
  } else if (type === "settings") {
    titleEl.textContent = "Settings";
    renderSheetSettings(listEl);
  }

  sheet.classList.remove("hidden", "closing");
  refreshIcons();
}

function closeMobileSheet() {
  var sheet = document.getElementById("mobile-sheet");
  if (!sheet || sheet.classList.contains("hidden")) return;

  mobileChatSheetOpen = false;

  // Return file tree to sidebar if it was moved
  if (sheet.classList.contains("sheet-files")) {
    var fileTree = document.getElementById("file-tree");
    var sidebarFilesPanel = document.getElementById("sidebar-panel-files");
    if (fileTree && sidebarFilesPanel) {
      sidebarFilesPanel.appendChild(fileTree);
    }
  }
  // Return knowledge files to mate sidebar if moved
  if (sheet.classList.contains("sheet-knowledge")) {
    var knowledgeFiles = document.getElementById("mate-knowledge-files");
    var knowledgePanel = document.getElementById("mate-sidebar-knowledge");
    if (knowledgeFiles && knowledgePanel) {
      knowledgePanel.appendChild(knowledgeFiles);
    }
  }

  sheet.classList.add("closing");
  setTimeout(function () {
    sheet.classList.add("hidden");
    sheet.classList.remove("closing", "sheet-files");
  }, 230);
}

function renderSheetProjects(listEl) {
  for (var i = 0; i < getCachedProjectList().length; i++) {
    (function (p) {
      var el = document.createElement("button");
      el.className = "mobile-project-item" + (p.slug === getCachedCurrentSlug() ? " active" : "");

      var abbrev = document.createElement("span");
      abbrev.className = "mobile-project-abbrev";
      if (p.icon) {
        abbrev.textContent = p.icon;
        parseEmojis(abbrev);
      } else {
        abbrev.textContent = getProjectAbbrev(p.name);
      }
      el.appendChild(abbrev);

      var name = document.createElement("span");
      name.className = "mobile-project-name";
      name.textContent = p.name;
      el.appendChild(name);

      if (p.isProcessing) {
        var dot = document.createElement("span");
        dot.className = "mobile-project-processing";
        el.appendChild(dot);
      }

      if (p.unread > 0 && p.slug !== getCachedCurrentSlug()) {
        var mBadge = document.createElement("span");
        mBadge.className = "mobile-project-unread";
        mBadge.textContent = p.unread > 99 ? "99+" : String(p.unread);
        el.appendChild(mBadge);
      }

      el.addEventListener("click", function () {
        if (switchProject) switchProject(p.slug);
        closeMobileSheet();
      });

      listEl.appendChild(el);
    })(getCachedProjectList()[i]);
  }
}

function renderSheetSessions(listEl) {
  // --- Context filter bar (horizontal scroll) ---
  var filterBar = document.createElement("div");
  filterBar.className = "mobile-chat-filter-bar";

  // Current project chip (always first, pre-selected)
  var currentProject = null;
  for (var pi = 0; pi < getCachedProjectList().length; pi++) {
    if (getCachedProjectList()[pi].slug === getCachedCurrentSlug()) {
      currentProject = getCachedProjectList()[pi];
      break;
    }
  }

  // Build chips: projects first, then mates
  var chips = [];

  for (var ci = 0; ci < getCachedProjectList().length; ci++) {
    (function (p) {
      var chip = document.createElement("button");
      chip.className = "mobile-chat-chip";
      var isDmActive = document.body.classList.contains("mate-dm-active");
      if (p.slug === getCachedCurrentSlug() && !isDmActive) chip.classList.add("active");
      chip.dataset.type = "project";
      chip.dataset.slug = p.slug;

      var abbrev = document.createElement("span");
      abbrev.className = "mobile-chat-chip-icon";
      if (p.icon) {
        abbrev.textContent = p.icon;
        parseEmojis(abbrev);
      } else {
        abbrev.textContent = getProjectAbbrev(p.name);
      }
      chip.appendChild(abbrev);

      var label = document.createElement("span");
      label.textContent = p.name;
      chip.appendChild(label);

      // Processing dot: same class as icon strip
      var statusDot = document.createElement("span");
      statusDot.className = "icon-strip-status";
      if (p.isProcessing) statusDot.classList.add("processing");
      chip.appendChild(statusDot);

      if (p.unread > 0 && p.slug !== getCachedCurrentSlug()) {
        var badge = document.createElement("span");
        badge.className = "mobile-chat-chip-badge";
        badge.textContent = p.unread > 99 ? "99+" : String(p.unread);
        chip.appendChild(badge);
      }

      chips.push(chip);
    })(getCachedProjectList()[ci]);
  }

  var favoriteChipMates = getCachedMates().filter(function (m) {
    if (getCachedDmRemovedUsers()[m.id]) return false;
    if (getCachedDmFavorites().indexOf(m.id) !== -1) return true;
    if (getCachedDmUnread()[m.id] && getCachedDmUnread()[m.id] > 0) return true;
    return false;
  });
  var sortedChipMates = favoriteChipMates.sort(function (a, b) {
    var aBuiltin = a.builtinKey ? 1 : 0;
    var bBuiltin = b.builtinKey ? 1 : 0;
    if (aBuiltin !== bBuiltin) return bBuiltin - aBuiltin;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  for (var mi = 0; mi < sortedChipMates.length; mi++) {
    (function (mate) {
      var mp = mate.profile || {};
      var chip = document.createElement("button");
      chip.className = "mobile-chat-chip";
      if (getCurrentDmUserId() === mate.id) chip.classList.add("active");
      chip.dataset.type = "mate";
      chip.dataset.mateId = mate.id;

      var avatarEl = document.createElement("img");
      avatarEl.className = "mobile-chat-chip-avatar";
      avatarEl.src = mateAvatarUrl(mate, 20);
      avatarEl.alt = mp.displayName || mate.name || "";
      chip.appendChild(avatarEl);

      var label = document.createElement("span");
      label.textContent = mp.displayName || mate.name || "Mate";
      chip.appendChild(label);

      // Processing dot: same class as icon strip, same data source
      var mateSlug = "mate-" + mate.id;
      var mateProj = null;
      var allProjects = getCachedProjects() || [];
      for (var pi = 0; pi < allProjects.length; pi++) {
        if (allProjects[pi].slug === mateSlug) { mateProj = allProjects[pi]; break; }
      }
      var statusDot = document.createElement("span");
      statusDot.className = "icon-strip-status";
      if (mateProj && mateProj.isProcessing) statusDot.classList.add("processing");
      chip.appendChild(statusDot);

      var unreadCount = getCachedDmUnread()[mate.id] || 0;
      if (unreadCount > 0) {
        var badge = document.createElement("span");
        badge.className = "mobile-chat-chip-badge";
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        chip.appendChild(badge);
      }

      chips.push(chip);
    })(sortedChipMates[mi]);
  }

  for (var i = 0; i < chips.length; i++) {
    filterBar.appendChild(chips[i]);
  }
  listEl.appendChild(filterBar);

  // --- Session list container ---
  var sessionListEl = document.createElement("div");
  sessionListEl.className = "mobile-chat-session-list";
  listEl.appendChild(sessionListEl);

  // --- Render sessions for a context ---
  function renderSessionsForContext(type, slug, mateId) {
    sessionListEl.innerHTML = "";

    if (type === "project") {
      renderMobileSessionsInto(sessionListEl);
    } else if (type === "mate") {
      closeMobileSheet();
      showHomeHub();
      openHomeChat(mateId);
    }

    refreshIcons();
  }

  // --- Chip click handlers ---
  for (var j = 0; j < chips.length; j++) {
    (function (chip) {
      chip.addEventListener("click", function () {
        // Deactivate all chips
        for (var k = 0; k < chips.length; k++) {
          chips[k].classList.remove("active");
        }
        chip.classList.add("active");

        var type = chip.dataset.type;
        if (type === "project") {
          var slug = chip.dataset.slug;
          var isDmNow = !!getCurrentDmUserId();
          if (slug !== getCachedCurrentSlug() || isDmNow) {
            // Switch project (or exit DM back to same project)
            sessionListEl.innerHTML = "";
            if (slug !== getCachedCurrentSlug()) {
              var loading = document.createElement("div");
              loading.className = "mobile-chat-context-note";
              loading.textContent = "Loading sessions...";
              sessionListEl.appendChild(loading);
            }
            if (switchProject) switchProject(slug);
            if (!isDmNow || slug !== getCachedCurrentSlug()) {
              // renderSessionList will be called by WS, which calls refreshMobileChatSheet
            } else {
              // Exited DM, same project - render sessions now
              renderSessionsForContext("project", slug, null);
            }
          } else {
            renderSessionsForContext("project", slug, null);
          }
        } else if (type === "mate") {
          renderSessionsForContext("mate", null, chip.dataset.mateId);
        }
      });
    })(chips[j]);
  }

  // Track that chat sheet is open
  mobileChatSheetOpen = true;

  // Mate chips navigate away immediately, so the sheet always renders project sessions.
  renderSessionsForContext("project", getCachedCurrentSlug(), null);
}

// Helper: create a mobile session item element
function createMobileSessionItem(s, options) {
  var itemOptions = options || {};
  var el = document.createElement("button");
  el.className = "mobile-session-item" + (s.active ? " active" : "");
  if (itemOptions.worker) el.classList.add("mobile-worker-item");

  // Vendor badge (legacy sessions without a vendor are Claude)
  var mVendor = s.vendor || "claude";
  var vendorIcon = document.createElement("img");
  vendorIcon.className = "mobile-session-vendor-icon";
  vendorIcon.src = VENDOR_AVATARS[mVendor] || VENDOR_AVATARS.claude;
  vendorIcon.alt = "";
  el.appendChild(vendorIcon);

  // Processing dot (left side, before title)
  if (s.isProcessing) {
    var dot = document.createElement("span");
    dot.className = "mobile-session-processing";
    el.appendChild(dot);
  }

  var titleSpan = document.createElement("span");
  titleSpan.className = "mobile-session-title";
  titleSpan.appendChild(document.createTextNode(s.title || "New Session"));
  el.appendChild(titleSpan);

  if (itemOptions.worker) {
    var generation = document.createElement("span");
    generation.className = "mobile-worker-generation" + (itemOptions.current ? " current" : "");
    generation.textContent = itemOptions.current ? "Current" : (s.workerGeneration ? "Gen " + s.workerGeneration : "Worker");
    el.appendChild(generation);
  }

  // Unread badge (right side)
  if (s.unread > 0 && !s.active) {
    var badge = document.createElement("span");
    badge.className = "mobile-session-unread";
    badge.textContent = s.unread > 99 ? "99+" : String(s.unread);
    el.appendChild(badge);
  }

  (function (id) {
    el.addEventListener("click", function () {
      if (getWs() && store.get('connected')) {
        getWs().send(JSON.stringify({ type: "switch_session", id: id }));
      }
      if (dismissOverlayPanels) dismissOverlayPanels();
      closeMobileSheet();
    });
  })(s.id);

  return el;
}

// Helper: create a mobile loop child element (individual session inside a group)
function createMobileLoopChild(s) {
  var el = document.createElement("button");
  el.className = "mobile-loop-child" + (s.active ? " active" : "");

  if (s.isProcessing) {
    var dot = document.createElement("span");
    dot.className = "mobile-session-processing";
    el.appendChild(dot);
  }

  var textSpan = document.createElement("span");
  textSpan.className = "mobile-session-title";
  if (s.loop) {
    var isRalphChild = s.loop.source === "ralph";
    var roleName = s.loop.role === "crafting" ? "Crafting" : s.loop.role === "judge" ? "Judge" : (isRalphChild ? "Coder" : "Run");
    var iterSuffix = s.loop.role === "crafting" ? "" : " #" + s.loop.iteration;
    var roleCls = s.loop.role === "crafting" ? " crafting" : (!isRalphChild ? " scheduled" : "");
    var badge = document.createElement("span");
    badge.className = "mobile-loop-role-badge" + roleCls;
    badge.textContent = roleName + iterSuffix;
    textSpan.appendChild(badge);
  }
  el.appendChild(textSpan);

  (function (id) {
    el.addEventListener("click", function () {
      if (getWs() && store.get('connected')) {
        getWs().send(JSON.stringify({ type: "switch_session", id: id }));
      }
      if (dismissOverlayPanels) dismissOverlayPanels();
      closeMobileSheet();
    });
  })(s.id);

  return el;
}

// Helper: create a mobile loop run sub-group (collapsible time group)
function createMobileLoopRun(parentGk, startedAtKey, sessions, isRalph) {
  var runGk = parentGk + ":" + startedAtKey;
  var expanded = expandedMobileLoopRuns.has(runGk);
  var startedAt = Number(startedAtKey);
  var timeLabel = startedAt ? new Date(startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Unknown";

  var hasActive = false;
  var anyProcessing = false;
  var latestSession = sessions[0];
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].active) hasActive = true;
    if (sessions[i].isProcessing) anyProcessing = true;
    if ((sessions[i].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = sessions[i];
    }
  }

  var wrapper = document.createElement("div");
  wrapper.className = "mobile-loop-run-wrapper";

  var header = document.createElement("button");
  header.className = "mobile-loop-run" + (hasActive ? " active" : "") + (expanded ? " expanded" : "") + (isRalph ? "" : " scheduled");

  var chevron = document.createElement("span");
  chevron.className = "mobile-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  header.appendChild(chevron);

  var label = document.createElement("span");
  label.className = "mobile-loop-run-time";
  var labelHtml = "";
  if (anyProcessing) {
    labelHtml += '<span class="mobile-session-processing"></span> ';
  }
  labelHtml += escapeHtml(timeLabel);
  label.innerHTML = labelHtml;
  header.appendChild(label);

  var countBadge = document.createElement("span");
  countBadge.className = "mobile-loop-count" + (isRalph ? "" : " scheduled");
  countBadge.textContent = String(sessions.length);
  header.appendChild(countBadge);

  header.addEventListener("click", (function (rk) {
    return function (e) {
      e.stopPropagation();
      if (expandedMobileLoopRuns.has(rk)) {
        expandedMobileLoopRuns.delete(rk);
      } else {
        expandedMobileLoopRuns.add(rk);
      }
      refreshMobileChatSheet();
    };
  })(runGk));

  wrapper.appendChild(header);

  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "mobile-loop-children";
    for (var k = 0; k < sessions.length; k++) {
      childContainer.appendChild(createMobileLoopChild(sessions[k]));
    }
    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

// Helper: create a mobile loop group element (collapsible group header)
function createMobileLoopGroup(loopId, children, groupKey) {
  var gk = groupKey || loopId;

  // Sub-group children by startedAt (each run)
  var runMap = {};
  for (var i = 0; i < children.length; i++) {
    var runKey = String(children[i].loop && children[i].loop.startedAt || 0);
    if (!runMap[runKey]) runMap[runKey] = [];
    runMap[runKey].push(children[i]);
  }
  var runKeys = Object.keys(runMap);

  // Sort each run's children by iteration then role
  for (var ri = 0; ri < runKeys.length; ri++) {
    runMap[runKeys[ri]].sort(function (a, b) {
      var ai = (a.loop && a.loop.iteration) || 0;
      var bi = (b.loop && b.loop.iteration) || 0;
      if (ai !== bi) return ai - bi;
      var ar = (a.loop && a.loop.role === "judge") ? 1 : 0;
      var br = (b.loop && b.loop.role === "judge") ? 1 : 0;
      return ar - br;
    });
  }

  // Sort runs by startedAt descending (newest first)
  runKeys.sort(function (a, b) { return Number(b) - Number(a); });

  var expanded = expandedMobileLoopGroups.has(gk);
  var hasActive = false;
  var anyProcessing = false;
  var latestSession = children[0];
  for (var ci = 0; ci < children.length; ci++) {
    if (children[ci].active) hasActive = true;
    if (children[ci].isProcessing) anyProcessing = true;
    if ((children[ci].lastActivity || 0) > (latestSession.lastActivity || 0)) {
      latestSession = children[ci];
    }
  }

  var loopName = (children[0].loop && children[0].loop.name) || "Loop";
  var isRalph = children[0].loop && children[0].loop.source === "ralph";
  var isCrafting = false;
  for (var j = 0; j < children.length; j++) {
    if (children[j].loop && children[j].loop.role === "crafting") isCrafting = true;
  }
  var runCount = runKeys.length;

  var wrapper = document.createElement("div");
  wrapper.className = "mobile-loop-wrapper";

  // Group header row
  var header = document.createElement("button");
  header.className = "mobile-loop-group" + (hasActive ? " active" : "") + (expanded ? " expanded" : "") + (isRalph ? "" : " scheduled");

  var chevron = document.createElement("span");
  chevron.className = "mobile-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  header.appendChild(chevron);

  var iconSpan = document.createElement("span");
  var groupIcon = isRalph ? "repeat" : "calendar-clock";
  iconSpan.className = "mobile-loop-icon" + (isRalph ? "" : " scheduled");
  iconSpan.innerHTML = iconHtml(groupIcon);
  header.appendChild(iconSpan);

  if (anyProcessing) {
    var dot = document.createElement("span");
    dot.className = "mobile-session-processing";
    header.appendChild(dot);
  }

  var nameSpan = document.createElement("span");
  nameSpan.className = "mobile-loop-name";
  nameSpan.textContent = loopName;
  header.appendChild(nameSpan);

  if (isCrafting && children.length === 1) {
    var craftBadge = document.createElement("span");
    craftBadge.className = "mobile-loop-badge crafting";
    craftBadge.textContent = "Crafting";
    header.appendChild(craftBadge);
  } else {
    var countBadge = document.createElement("span");
    countBadge.className = "mobile-loop-count" + (isRalph ? "" : " scheduled");
    var countLabel = runCount === 1 ? String(children.length) : runCount + (runCount === 1 ? " run" : " runs");
    countBadge.textContent = countLabel;
    header.appendChild(countBadge);
  }

  // Chevron toggles expansion
  header.addEventListener("click", (function (lid) {
    return function (e) {
      e.stopPropagation();
      if (expandedMobileLoopGroups.has(lid)) {
        expandedMobileLoopGroups.delete(lid);
      } else {
        expandedMobileLoopGroups.add(lid);
      }
      refreshMobileChatSheet();
    };
  })(gk));

  wrapper.appendChild(header);

  // Expanded: show runs
  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "mobile-loop-children";

    if (runCount === 1) {
      var singleRun = runMap[runKeys[0]];
      for (var sk = 0; sk < singleRun.length; sk++) {
        childContainer.appendChild(createMobileLoopChild(singleRun[sk]));
      }
    } else {
      for (var rk = 0; rk < runKeys.length; rk++) {
        childContainer.appendChild(createMobileLoopRun(gk, runKeys[rk], runMap[runKeys[rk]], isRalph));
      }
    }

    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

// Helper: render sorted sessions into a container with date groups (with loop session grouping)
export function renderMobileSessionsInto(container) {
  var mobileDefaultVendor = resolvePreferredVendor(store.get('installedVendors') || []) || resolveDefaultVendor();
  var mobileInstalled = store.get('installedVendors') || [];
  var mobileDefaultState = store.get('defaultVendorState') || {};

  var vendorList = document.createElement("div");
  vendorList.className = "mobile-vendor-list hidden";
  vendorList.id = "mobile-session-provider-menu";
  var mobileVendorName = VENDOR_NAMES[mobileDefaultVendor] || mobileDefaultVendor;
  var mobileCreateTitle = "Create a " + mobileVendorName + " session";
  if (defaultVendorUnavailable(mobileInstalled)) mobileCreateTitle += " (saved default is unavailable; using installed priority)";
  var controls;
  controls = renderSessionCreationCta({
    rowClass: "mobile-session-new-row",
    createClass: "mobile-session-new mobile-session-new-main",
    providerClass: "mobile-session-new mobile-session-new-provider",
    iconClass: "mobile-session-new-icon",
    vendorName: mobileVendorName,
    vendorAvatar: VENDOR_AVATARS[mobileDefaultVendor] || VENDOR_AVATARS.claude,
    createTitle: mobileCreateTitle,
    providerTitle: "Switch AI provider (current: " + mobileVendorName + ")",
    menuId: vendorList.id,
    onCreate: function () { startNewSession(mobileDefaultVendor); closeMobileSheet(); },
    onProvider: function () {
      var opening = vendorList.classList.contains("hidden");
      vendorList.classList.toggle("hidden", !opening);
      controls.providerButton.classList.toggle("expanded", opening);
      controls.providerButton.setAttribute("aria-expanded", opening ? "true" : "false");
      if (opening) {
        var first = vendorList.querySelector("button:not(:disabled)");
        if (first) first.focus();
      }
    },
  });
  var newRow = controls.element;
  vendorList.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    vendorList.classList.add("hidden");
    controls.providerButton.classList.remove("expanded");
    controls.providerButton.setAttribute("aria-expanded", "false");
    controls.providerButton.focus();
  });

  if (defaultVendorUnavailable(mobileInstalled) && mobileDefaultState.preference) {
    var mobileFallbackNote = document.createElement("div");
    mobileFallbackNote.className = "mobile-session-new-preference-status mobile-session-new-fallback-note";
    mobileFallbackNote.textContent = "Saved default " + (VENDOR_NAMES[mobileDefaultState.preference] || mobileDefaultState.preference) + " is unavailable. Using " + (VENDOR_NAMES[mobileDefaultVendor] || mobileDefaultVendor) + ".";
  }

  // Every known vendor is listed. Uninstalled ones stay visible but disabled,
  // and tapping one opens the vendor's homepage.
  for (var vi = 0; vi < VENDOR_ORDER.length; vi++) {
    (function (vendor) {
      var isInstalled = mobileInstalled.indexOf(vendor) !== -1;
      var name = VENDOR_NAMES[vendor] || vendor;
      var vendorRow = document.createElement("div");
      vendorRow.className = "mobile-vendor-row";
      var vBtn = document.createElement("button");
      vBtn.className = "mobile-session-new mobile-session-new-vendor";
      if (!isInstalled) vBtn.classList.add("disabled");
      if (vendor === mobileDefaultVendor) vBtn.classList.add("active");
      vBtn.innerHTML = '<img src="' + VENDOR_AVATARS[vendor] + '" class="mobile-session-new-icon" alt="">' +
        '<span>' + (isInstalled ? "Create with " : "Learn about ") + name + '</span>' +
        (isExperimentalVendor(vendor) ? '<span class="vendor-experimental-badge" aria-label="Experimental integration" title="Experimental integration; not yet validated through direct use testing">🧪</span>' : '') +
        (isInstalled ? "" : '<span class="mobile-vendor-note">Not installed</span>');
      vBtn.addEventListener("click", function () {
        if (!isInstalled) {
          window.open(VENDOR_HOMEPAGES[vendor], "_blank", "noopener");
          return;
        }
        vendorList.classList.add("hidden");
        controls.providerButton.classList.remove("expanded");
        controls.providerButton.setAttribute("aria-expanded", "false");
        startNewSession(vendor);
        closeMobileSheet();
      });
      vendorRow.appendChild(vBtn);
      if (isInstalled) {
        var defaultBtn = document.createElement("button");
        defaultBtn.type = "button";
        defaultBtn.className = "mobile-vendor-set-default";
        defaultBtn.textContent = mobileDefaultState.saving ? "Saving…" : (vendor === mobileDefaultVendor && !defaultVendorUnavailable(mobileInstalled) ? "Default" : "Set default");
        defaultBtn.disabled = mobileDefaultState.saving === true;
        defaultBtn.setAttribute("aria-label", "Set " + name + " as default vendor");
        defaultBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          saveDefaultVendor(vendor);
        });
        vendorRow.appendChild(defaultBtn);
      }
      vendorList.appendChild(vendorRow);
    })(VENDOR_ORDER[vi]);
  }

  var automaticBtn = document.createElement("button");
  automaticBtn.className = "mobile-session-new mobile-session-new-vendor mobile-session-new-automatic";
  automaticBtn.type = "button";
  automaticBtn.textContent = "Use automatic default";
  automaticBtn.disabled = mobileDefaultState.saving === true;
  automaticBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    saveDefaultVendor("");
  });
  vendorList.appendChild(automaticBtn);
  if (mobileDefaultState.error) {
    var mobileStatus = document.createElement("div");
    mobileStatus.className = "mobile-session-new-preference-status";
    mobileStatus.setAttribute("role", "alert");
    mobileStatus.textContent = mobileDefaultState.error;
    vendorList.appendChild(mobileStatus);
  }

  container.appendChild(newRow);
  if (mobileFallbackNote) container.appendChild(mobileFallbackNote);
  container.appendChild(vendorList);

  // Partition: loop sessions vs normal sessions (same logic as desktop renderSessionList)
  var sessions = getCachedSessions();
  var hierarchy = prepareSidebarHierarchy(sessions);
  var hierarchyByDriver = hierarchy.byDriver;
  var loopGroups = {};
  var normalSessions = [];
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (s.sessionRole === "worker") continue;
    if (s.loop && s.loop.loopId && s.loop.role === "crafting" && s.loop.source !== "ralph" && s.loop.source !== "debate") {
      continue;
    } else if (s.loop && s.loop.loopId) {
      var startedAt = s.loop.startedAt || 0;
      var dateStr = startedAt ? new Date(startedAt).toISOString().slice(0, 10) : "unknown";
      var groupKey = s.loop.loopId + ":" + dateStr;
      if (!loopGroups[groupKey]) loopGroups[groupKey] = [];
      loopGroups[groupKey].push(s);
    } else {
      normalSessions.push(s);
    }
  }

  // Build virtual items
  var items = [];
  for (var j = 0; j < normalSessions.length; j++) {
    var driverRoot = hierarchyByDriver.get(normalSessions[j].id);
    if (driverRoot) items.push({ type: "driver-hierarchy", data: driverRoot.driver, root: driverRoot, lastActivity: driverRoot.lastActivity });
    else items.push({ type: "session", data: normalSessions[j], lastActivity: normalSessions[j].lastActivity || 0 });
  }
  if (hierarchy.orphans.length) {
    var orphanActivity = 0;
    for (var oi = 0; oi < hierarchy.orphans.length; oi++) orphanActivity = Math.max(orphanActivity, hierarchy.orphans[oi].lastActivity || 0);
    items.push({ type: "orphan-workers", workers: hierarchy.orphans, lastActivity: orphanActivity });
  }
  var groupKeys = Object.keys(loopGroups);
  for (var k = 0; k < groupKeys.length; k++) {
    var gk = groupKeys[k];
    var children = loopGroups[gk];
    var realLoopId = children[0].loop.loopId;
    var maxActivity = 0;
    for (var m = 0; m < children.length; m++) {
      var act = children[m].lastActivity || 0;
      if (act > maxActivity) maxActivity = act;
    }
    items.push({ type: "loop", loopId: realLoopId, groupKey: gk, children: children, lastActivity: maxActivity });
  }

  // Sort by lastActivity descending
  items.sort(function (a, b) {
    var aBookmarked = !!(a.type === "loop" || a.type === "orphan-workers" ? false : a.data && a.data.bookmarked);
    var bBookmarked = !!(b.type === "loop" || b.type === "orphan-workers" ? false : b.data && b.data.bookmarked);
    if (aBookmarked !== bBookmarked) return aBookmarked ? -1 : 1;
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var bookmarkedItems = [];
  var regularItems = [];
  for (var n = 0; n < items.length; n++) {
    var item = items[n];
    if ((item.type === "session" || item.type === "driver-hierarchy") && item.data && item.data.bookmarked) {
      bookmarkedItems.push(item);
    } else {
      regularItems.push(item);
    }
  }

  if (bookmarkedItems.length > 0) {
    var bookmarkedHeader = document.createElement("div");
    bookmarkedHeader.className = "mobile-sheet-group";
    bookmarkedHeader.textContent = "Favorites";
    container.appendChild(bookmarkedHeader);

    for (var bi = 0; bi < bookmarkedItems.length; bi++) {
      if (bookmarkedItems[bi].type === "driver-hierarchy") container.appendChild(renderMobileDriverHierarchy(bookmarkedItems[bi].root, createMobileSessionItem, refreshMobileChatSheet));
      else container.appendChild(createMobileSessionItem(bookmarkedItems[bi].data));
    }
  }

  var currentGroup = "";
  for (var ri = 0; ri < regularItems.length; ri++) {
    var item = regularItems[ri];
    var group = getDateGroup(item.lastActivity || 0);
    if (group !== currentGroup) {
      currentGroup = group;
      if (group !== "Today") {
        var header = document.createElement("div");
        header.className = "mobile-sheet-group";
        header.textContent = group;
        container.appendChild(header);
      }
    }
    if (item.type === "loop") {
      container.appendChild(createMobileLoopGroup(item.loopId, item.children, item.groupKey));
    } else if (item.type === "driver-hierarchy") {
      container.appendChild(renderMobileDriverHierarchy(item.root, createMobileSessionItem, refreshMobileChatSheet));
    } else if (item.type === "orphan-workers") {
      container.appendChild(renderMobileOrphanHierarchy(item.workers, createMobileSessionItem, refreshMobileChatSheet));
    } else {
      container.appendChild(createMobileSessionItem(item.data));
    }
  }
}

// Refresh mobile chat sheet when session data updates (called from renderSessionList)
export function refreshMobileChatSheet() {
  if (!mobileChatSheetOpen) return;
  var sheet = document.getElementById("mobile-sheet");
  if (!sheet || sheet.classList.contains("hidden")) {
    mobileChatSheetOpen = false;
    return;
  }
  var sessionListEl = sheet.querySelector(".mobile-chat-session-list");
  if (!sessionListEl) return;

  // Update chips: active state and processing dots
  var chips = sheet.querySelectorAll(".mobile-chat-chip");
  for (var i = 0; i < chips.length; i++) {
    var chip = chips[i];
    chip.classList.remove("active");

    // Update active state
    var isDmActive = !!getCurrentDmUserId();
    if (chip.dataset.type === "project" && chip.dataset.slug === getCachedCurrentSlug() && !isDmActive) {
      chip.classList.add("active");
    } else if (chip.dataset.type === "mate" && chip.dataset.mateId === getCurrentDmUserId()) {
      chip.classList.add("active");
    }

    // Update processing dot: same class as icon strip
    var statusDot = chip.querySelector(".icon-strip-status");
    if (statusDot) {
      var isProcessing = false;
      var allProjects = getCachedProjects() || [];
      var lookupSlug = chip.dataset.type === "mate" ? ("mate-" + chip.dataset.mateId) : chip.dataset.slug;
      for (var pi = 0; pi < allProjects.length; pi++) {
        if (allProjects[pi].slug === lookupSlug && allProjects[pi].isProcessing) {
          isProcessing = true;
          break;
        }
      }
      statusDot.classList.toggle("processing", isProcessing);
    }
  }

  // Re-render sessions for current context
  sessionListEl.innerHTML = "";
  renderMobileSessionsInto(sessionListEl);

  refreshIcons();
}

function renderSheetMateProfile(listEl) {
  if (!mobileSheetMateData) return;
  var data = mobileSheetMateData;

  // Profile header
  var header = document.createElement("div");
  header.className = "mate-profile-header";

  var avatar = document.createElement("img");
  avatar.className = "mate-profile-avatar";
  avatar.src = data.avatarUrl || "";
  avatar.alt = data.displayName || "";
  header.appendChild(avatar);

  var info = document.createElement("div");
  info.className = "mate-profile-info";
  var nameEl = document.createElement("div");
  nameEl.className = "mate-profile-name";
  nameEl.textContent = data.displayName || "";
  info.appendChild(nameEl);
  if (data.description) {
    var descEl = document.createElement("div");
    descEl.className = "mate-profile-desc";
    descEl.textContent = data.description;
    info.appendChild(descEl);
  }
  header.appendChild(info);
  listEl.appendChild(header);

  // Action buttons
  var actions = [
    { icon: "book-open", label: "Knowledge", btnId: "mate-knowledge-btn", countId: "mate-knowledge-count" },
    { icon: "sticky-note", label: "Sticky Notes", btnId: "sticky-notes-sidebar-btn", countId: "sticky-notes-sidebar-count" },
    { icon: "puzzle", label: "Skills", btnId: "mate-skills-btn" }
  ];

  for (var i = 0; i < actions.length; i++) {
    (function (action) {
      var btn = document.createElement("button");
      btn.className = "mate-profile-action";
      var countHtml = "";
      if (action.countId) {
        var countEl = document.getElementById(action.countId);
        if (countEl && !countEl.classList.contains("hidden") && countEl.textContent) {
          countHtml = '<span class="mate-profile-action-count">' + escapeHtml(countEl.textContent) + '</span>';
        }
      }
      btn.innerHTML = '<i data-lucide="' + action.icon + '"></i><span>' + action.label + '</span>' + countHtml;
      btn.addEventListener("click", function () {
        closeMobileSheet();
        var targetBtn = document.getElementById(action.btnId);
        if (targetBtn) {
          setTimeout(function () { targetBtn.click(); }, 250);
        }
      });
      listEl.appendChild(btn);
    })(actions[i]);
  }
}

function renderSheetSearch(listEl) {
  // Search input at top
  var wrap = document.createElement("div");
  wrap.className = "mobile-search-input-wrap";
  var input = document.createElement("input");
  input.className = "mobile-search-input";
  input.type = "text";
  input.placeholder = "Search sessions, messages...";
  input.autocomplete = "off";
  input.spellcheck = false;
  wrap.appendChild(input);
  listEl.appendChild(wrap);

  // Results container
  var resultsEl = document.createElement("div");
  resultsEl.style.padding = "0 8px";
  listEl.appendChild(resultsEl);

  // Auto-focus
  setTimeout(function () { input.focus(); }, 300);

  // Show all sessions initially
  renderSearchResults(resultsEl, "");

  input.addEventListener("input", function () {
    var q = input.value.trim().toLowerCase();
    renderSearchResults(resultsEl, q);
  });
  input.addEventListener("keydown", function (e) { e.stopPropagation(); });
  input.addEventListener("keyup", function (e) { e.stopPropagation(); });
  input.addEventListener("keypress", function (e) { e.stopPropagation(); });
}

function renderSearchResults(container, query) {
  container.innerHTML = "";
  var sorted = getCachedSessions().slice().sort(function (a, b) {
    if (!!a.bookmarked !== !!b.bookmarked) return a.bookmarked ? -1 : 1;
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var found = 0;
  for (var i = 0; i < sorted.length; i++) {
    var s = sorted[i];
    var title = s.title || "New Session";
    if (query && title.toLowerCase().indexOf(query) === -1) continue;
    found++;

    var el = document.createElement("button");
    el.className = "mobile-session-item";
    if (s.active) el.classList.add("active");

    var titleSpan = document.createElement("span");
    titleSpan.className = "mobile-session-title";
    titleSpan.appendChild(document.createTextNode(title));
    el.appendChild(titleSpan);

    if (s.isProcessing) {
      var dot = document.createElement("span");
      dot.className = "mobile-session-processing";
      el.appendChild(dot);
    }

    (function (id) {
      el.addEventListener("click", function () {
        if (getWs() && store.get('connected')) {
          getWs().send(JSON.stringify({ type: "switch_session", id: id }));
        }
        if (dismissOverlayPanels) dismissOverlayPanels();
        closeMobileSheet();
      });
    })(s.id);

    container.appendChild(el);
  }

  if (found === 0 && query) {
    var empty = document.createElement("div");
    empty.className = "mobile-alert-empty";
    empty.textContent = 'No results for "' + query + '"';
    container.appendChild(empty);
  }
}

function renderSheetTools(listEl) {
  var isMateDm = document.body.classList.contains("mate-dm-active");

  var items = isMateDm ? [
    { icon: "brain", label: "Memory", action: "mate-memory" },
    { icon: "book-open", label: "Knowledge", action: "mate-knowledge" },
    { icon: "sticky-note", label: "Sticky Notes", action: "mate-sticky" },
    { icon: "puzzle", label: "Skills", action: "mate-skills" }
  ] : [
    { icon: "folder-tree", label: "Files", action: "files" },
    { icon: "square-terminal", label: "Terminal", action: "terminal" },
    { icon: "circle-dot", label: "Issues", action: "issues" },
    { icon: "notebook-tabs", label: "Logs", action: "project-logs" }
  ];

  for (var i = 0; i < items.length; i++) {
    (function (item) {
      var btn = document.createElement("button");
      btn.className = "mobile-more-item";
      btn.innerHTML = '<i data-lucide="' + item.icon + '"></i><span class="mobile-more-item-label">' + item.label + '</span>';
      btn.addEventListener("click", function () {
        closeMobileSheet();
        var targetId = null;
        if (item.action === "files") {
          setTimeout(function () { openMobileSheet("files"); }, 250);
        } else if (item.action === "terminal") {
          openTerminal();
        } else if (item.action === "issues") {
          targetId = "issues-btn";
        } else if (item.action === "project-logs") {
          targetId = "project-logs-btn";
        } else if (item.action === "mate-knowledge") {
          setTimeout(function () { openMobileSheet("mate-knowledge"); }, 250);
          return;
        } else if (item.action === "mate-sticky") {
          targetId = "mate-sticky-notes-btn";
        } else if (item.action === "mate-skills") {
          targetId = "mate-skills-btn";
        } else if (item.action === "mate-memory") {
          targetId = "mate-memory-btn";
        } else if (item.action === "mate-debate") {
          targetId = "mate-debate-btn";
        }
        if (targetId) {
          var targetBtn = document.getElementById(targetId);
          if (targetBtn) setTimeout(function () { targetBtn.click(); }, 250);
        }
      });
      listEl.appendChild(btn);
    })(items[i]);
  }
}

function renderSheetSettings(listEl) {
  var items = [
    { icon: "folder-cog", label: "Project Settings", action: "project-settings" },
    { icon: "settings", label: "Server Settings", action: "server-settings" }
  ];

  for (var i = 0; i < items.length; i++) {
    (function (item) {
      var btn = document.createElement("button");
      btn.className = "mobile-more-item";
      btn.innerHTML = '<i data-lucide="' + item.icon + '"></i><span class="mobile-more-item-label">' + item.label + '</span>';
      btn.addEventListener("click", function () {
        closeMobileSheet();
        if (item.action === "project-settings") {
          setTimeout(function () {
            // Find current project data
            var proj = null;
            for (var pi = 0; pi < getCachedProjectList().length; pi++) {
              if (getCachedProjectList()[pi].slug === getCachedCurrentSlug()) {
                proj = getCachedProjectList()[pi];
                break;
              }
            }
            // For mate projects, use mate display name instead of slug
            if (proj && proj.isMate && getCachedMates().length > 0) {
              var mateId = getCachedCurrentSlug().replace("mate-", "");
              var _mates = getCachedMates();
              for (var mi = 0; mi < _mates.length; mi++) {
                var mp = _mates[mi].profile || {};
                if (_mates[mi].id === mateId) {
                  proj = Object.assign({}, proj, { name: mp.displayName || _mates[mi].name || proj.name });
                  break;
                }
              }
            }
            if (proj && store.get('ownerLocked')) proj = Object.assign({}, proj, { ownerLocked: true });
            openProjectSettings(getCachedCurrentSlug(), proj);
          }, 250);
        } else if (item.action === "server-settings") {
          var settingsBtn = document.getElementById("server-settings-btn");
          if (settingsBtn) setTimeout(function () { settingsBtn.click(); }, 250);
        }
      });
      listEl.appendChild(btn);
    })(items[i]);
  }

  // Dark/Light switch button
  var isDark = getCurrentTheme().variant === "dark";
  var themeBtn = document.createElement("button");
  themeBtn.className = "mobile-more-item";
  themeBtn.innerHTML = '<i data-lucide="' + (isDark ? "sun" : "moon") + '"></i><span class="mobile-more-item-label">Switch to ' + (isDark ? "Light" : "Dark") + '</span>';

  themeBtn.addEventListener("click", function () {
    var themeToggle = document.getElementById("theme-toggle-check");
    if (themeToggle) themeToggle.click();
    // Update button text after a tick (theme applies async)
    setTimeout(function () {
      var nowDark = getCurrentTheme().variant === "dark";
      themeBtn.innerHTML = '<i data-lucide="' + (nowDark ? "sun" : "moon") + '"></i><span class="mobile-more-item-label">Switch to ' + (nowDark ? "Light" : "Dark") + '</span>';
      refreshIcons();
    }, 50);
  });

  listEl.appendChild(themeBtn);

  // Chat Layout switch button
  var currentLayout = getChatLayout();
  var isBubble = currentLayout === "bubble";
  var layoutBtn = document.createElement("button");
  layoutBtn.className = "mobile-more-item";
  layoutBtn.innerHTML = '<i data-lucide="' + (isBubble ? "monitor" : "message-circle") + '"></i>'
    + '<span class="mobile-more-item-label">Switch to ' + (isBubble ? "Channel" : "Bubble") + '</span>';

  layoutBtn.addEventListener("click", function () {
    var next = getChatLayout() === "bubble" ? "channel" : "bubble";
    setChatLayout(next);
    fetch('/api/user/chat-layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: next })
    });
    closeMobileSheet();
  });

  listEl.appendChild(layoutBtn);

  // "Open as app" -- only show if not already in PWA standalone mode
  if (!document.documentElement.classList.contains("pwa-standalone")) {
    var pwaBtn = document.createElement("button");
    pwaBtn.className = "mobile-more-item";
    pwaBtn.innerHTML = '<i data-lucide="smartphone"></i><span class="mobile-more-item-label">Open as app</span>';
    pwaBtn.addEventListener("click", function () {
      closeMobileSheet();
      // Trigger the existing PWA install modal
      var installPill = document.getElementById("pwa-install-pill");
      if (installPill) {
        setTimeout(function () { installPill.click(); }, 250);
      }
    });
    listEl.appendChild(pwaBtn);
  }
}

export function initSidebarMobile() {

  // --- Mobile sheet close handlers ---
  var mobileSheet = document.getElementById("mobile-sheet");
  if (mobileSheet) {
    var sheetBackdrop = mobileSheet.querySelector(".mobile-sheet-backdrop");
    var sheetCloseBtn = mobileSheet.querySelector(".mobile-sheet-close");
    if (sheetBackdrop) sheetBackdrop.addEventListener("click", closeMobileSheet);
    if (sheetCloseBtn) sheetCloseBtn.addEventListener("click", closeMobileSheet);

    // --- Drag to dismiss sheet ---
    var sheetHandle = mobileSheet.querySelector(".mobile-sheet-handle");
    var sheetContent = mobileSheet.querySelector(".mobile-sheet-content");
    if (sheetHandle && sheetContent) {
      var dragStartY = 0;
      var dragging = false;

      sheetHandle.addEventListener("touchstart", function (e) {
        dragStartY = e.touches[0].clientY;
        dragging = true;
        sheetContent.style.transition = "none";
      }, { passive: true });

      mobileSheet.addEventListener("touchmove", function (e) {
        if (!dragging) return;
        var deltaY = e.touches[0].clientY - dragStartY;
        if (deltaY < 0) deltaY = 0;
        sheetContent.style.transform = "translateY(" + deltaY + "px)";
        if (sheetBackdrop) {
          var opacity = Math.max(0, 1 - deltaY / (sheetContent.offsetHeight * 0.5));
          sheetBackdrop.style.opacity = opacity;
        }
      }, { passive: true });

      mobileSheet.addEventListener("touchend", function () {
        if (!dragging) return;
        dragging = false;
        var currentY = parseFloat(sheetContent.style.transform.replace(/[^0-9.-]/g, "")) || 0;
        var threshold = sheetContent.offsetHeight * 0.3;

        if (currentY > threshold) {
          sheetContent.style.transition = "transform 0.22s ease-in";
          sheetContent.style.transform = "translateY(100%)";
          if (sheetBackdrop) {
            sheetBackdrop.style.transition = "opacity 0.22s ease-in";
            sheetBackdrop.style.opacity = "0";
          }
          setTimeout(function () {
            sheetContent.style.transition = "";
            sheetContent.style.transform = "";
            if (sheetBackdrop) {
              sheetBackdrop.style.transition = "";
              sheetBackdrop.style.opacity = "";
            }
            // Close without animation since we already animated
            var sheet = document.getElementById("mobile-sheet");
            if (sheet) {
              if (sheet.classList.contains("sheet-files")) {
                var fileTree = document.getElementById("file-tree");
                var sidebarFilesPanel = document.getElementById("sidebar-panel-files");
                if (fileTree && sidebarFilesPanel) {
                  sidebarFilesPanel.appendChild(fileTree);
                }
              }
              sheet.classList.add("hidden");
              sheet.classList.remove("closing", "sheet-files");
            }
          }, 230);
        } else {
          sheetContent.style.transition = "transform 0.2s ease-out";
          sheetContent.style.transform = "translateY(0)";
          if (sheetBackdrop) {
            sheetBackdrop.style.transition = "opacity 0.2s ease-out";
            sheetBackdrop.style.opacity = "";
          }
          setTimeout(function () {
            sheetContent.style.transition = "";
            sheetContent.style.transform = "";
            if (sheetBackdrop) {
              sheetBackdrop.style.transition = "";
              sheetBackdrop.style.opacity = "";
            }
          }, 200);
        }
      }, { passive: true });
    }
  }

  // --- Mobile tab bar ---
  var mobileTabBar = document.getElementById("mobile-tab-bar");
  var mobileTabs = mobileTabBar ? mobileTabBar.querySelectorAll(".mobile-tab") : [];
  var mobileHomeBtn = document.getElementById("mobile-home-btn");

  function setMobileTabActive(tabName) {
    for (var i = 0; i < mobileTabs.length; i++) {
      if (mobileTabs[i].dataset.tab === tabName) {
        mobileTabs[i].classList.add("active");
      } else {
        mobileTabs[i].classList.remove("active");
      }
    }
    if (mobileHomeBtn) {
      if (tabName === "home") {
        mobileHomeBtn.classList.add("active");
      } else {
        mobileHomeBtn.classList.remove("active");
      }
    }
  }

  for (var t = 0; t < mobileTabs.length; t++) {
    (function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.dataset.tab;

        if (name === "chat") {
          openMobileSheet("sessions");
          setMobileTabActive("chat");
        } else if (name === "search") {
          openCommandPalette();
          setMobileTabActive("search");
        } else if (name === "tools") {
          openMobileSheet("tools");
          setMobileTabActive("tools");
        } else if (name === "settings") {
          openMobileSheet("settings");
          setMobileTabActive("settings");
        }
      });
    })(mobileTabs[t]);
  }

  if (mobileHomeBtn) {
    mobileHomeBtn.addEventListener("click", function () {
      closeSidebar();
      setMobileTabActive("home");
      showHomeHub();
    });
  }
}
