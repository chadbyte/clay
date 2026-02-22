import { escapeHtml, copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;

// --- Session search ---
var searchQuery = "";
var searchMatchIds = null; // null = no search, Set of matched session IDs
var searchDebounce = null;
var cachedSessions = [];

// --- Session context menu ---
var sessionCtxMenu = null;
var sessionCtxSessionId = null;

function closeSessionCtxMenu() {
  if (sessionCtxMenu) {
    sessionCtxMenu.remove();
    sessionCtxMenu = null;
    sessionCtxSessionId = null;
  }
}

function showSessionCtxMenu(anchorBtn, sessionId, title, cliSid) {
  closeSessionCtxMenu();
  sessionCtxSessionId = sessionId;

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startInlineRename(sessionId, title);
  });
  menu.appendChild(renameItem);

  if (cliSid) {
    var copyResumeItem = document.createElement("button");
    copyResumeItem.className = "session-ctx-item";
    copyResumeItem.innerHTML = iconHtml("copy") + " <span>Copy resume command</span>";
    copyResumeItem.addEventListener("click", function (e) {
      e.stopPropagation();
      copyToClipboard("claude --resume " + cliSid).then(function () {
        copyResumeItem.innerHTML = iconHtml("check") + " <span>Copied!</span>";
        refreshIcons();
        setTimeout(function () { closeSessionCtxMenu(); }, 800);
      });
    });
    menu.appendChild(copyResumeItem);
  }

  var deleteItem = document.createElement("button");
  deleteItem.className = "session-ctx-item session-ctx-delete";
  deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
  deleteItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    ctx.showConfirm('Delete "' + (title || "New Session") + '"? This session and its history will be permanently removed.', function () {
      var ws = ctx.ws;
      if (ws && ctx.connected) {
        ws.send(JSON.stringify({ type: "delete_session", id: sessionId }));
      }
    });
  });
  menu.appendChild(deleteItem);

  anchorBtn.parentElement.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  // Position: align to right edge of parent, below the button
  requestAnimationFrame(function () {
    var rect = menu.getBoundingClientRect();
    var parentRect = menu.parentElement.getBoundingClientRect();
    // If menu overflows below the sidebar, flip up
    var sidebarRect = ctx.sessionListEl.getBoundingClientRect();
    if (rect.bottom > sidebarRect.bottom) {
      menu.style.top = "auto";
      menu.style.bottom = "100%";
      menu.style.marginBottom = "2px";
    }
  });
}

function startInlineRename(sessionId, currentTitle) {
  var el = ctx.sessionListEl.querySelector('.session-item[data-session-id="' + sessionId + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".session-item-text");
  if (!textSpan) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = currentTitle || "New Session";

  var originalHtml = textSpan.innerHTML;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();

  function commitRename() {
    var newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "rename_session", id: sessionId, title: newTitle }));
    }
    // Restore text (server will send updated session_list)
    textSpan.innerHTML = originalHtml;
    if (newTitle && newTitle !== currentTitle) {
      textSpan.textContent = newTitle;
    }
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); textSpan.innerHTML = originalHtml; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

function getDateGroup(ts) {
  var now = new Date();
  var d = new Date(ts);
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var yesterday = new Date(today.getTime() - 86400000);
  var weekAgo = new Date(today.getTime() - 7 * 86400000);
  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  if (d >= weekAgo) return "This Week";
  return "Older";
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  var lower = text.toLowerCase();
  var qLower = query.toLowerCase();
  var idx = lower.indexOf(qLower);
  if (idx === -1) return escapeHtml(text);
  var before = text.substring(0, idx);
  var match = text.substring(idx, idx + query.length);
  var after = text.substring(idx + query.length);
  return escapeHtml(before) + '<mark class="session-highlight">' + escapeHtml(match) + '</mark>' + escapeHtml(after);
}

function renderSessionItem(s) {
  var el = document.createElement("div");
  var isMatch = searchMatchIds !== null && searchMatchIds.has(s.id);
  var dimmed = searchMatchIds !== null && !isMatch;
  el.className = "session-item" + (s.active ? " active" : "") + (isMatch ? " search-match" : "") + (dimmed ? " search-dimmed" : "");
  el.dataset.sessionId = s.id;

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (s.isProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  textHtml += highlightMatch(s.title || "New Session", searchQuery);
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  var moreBtn = document.createElement("button");
  moreBtn.className = "session-more-btn";
  moreBtn.innerHTML = iconHtml("ellipsis");
  moreBtn.title = "More options";
  moreBtn.addEventListener("click", (function(id, title, cliSid, btn) {
    return function(e) {
      e.stopPropagation();
      showSessionCtxMenu(btn, id, title, cliSid);
    };
  })(s.id, s.title, s.cliSessionId, moreBtn));
  el.appendChild(moreBtn);

  el.addEventListener("click", (function (id) {
    return function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        closeSidebar();
      }
    };
  })(s.id));

  return el;
}

export function renderSessionList(sessions) {
  if (sessions) cachedSessions = sessions;

  ctx.sessionListEl.innerHTML = "";

  // Sort by lastActivity descending (most recent first)
  var sorted = cachedSessions.slice().sort(function (a, b) {
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var currentGroup = "";
  for (var i = 0; i < sorted.length; i++) {
    var s = sorted[i];
    var group = getDateGroup(s.lastActivity || 0);
    if (group !== currentGroup) {
      currentGroup = group;
      var header = document.createElement("div");
      header.className = "session-group-header";
      header.textContent = group;
      ctx.sessionListEl.appendChild(header);
    }
    ctx.sessionListEl.appendChild(renderSessionItem(s));
  }
  refreshIcons();
  updatePageTitle();
}

export function handleSearchResults(msg) {
  if (msg.query !== searchQuery) return; // stale response
  var ids = new Set();
  for (var i = 0; i < msg.results.length; i++) {
    ids.add(msg.results[i].id);
  }
  searchMatchIds = ids;
  renderSessionList(null);

  // Build timeline for current session if it matches
  var activeEl = ctx.sessionListEl.querySelector(".session-item.active");
  if (activeEl) {
    var activeId = parseInt(activeEl.dataset.sessionId, 10);
    if (ids.has(activeId)) {
      buildSearchTimeline(searchQuery);
    } else {
      removeSearchTimeline();
    }
  }
}

export function updatePageTitle() {
  var sessionTitle = "";
  var activeItem = ctx.sessionListEl.querySelector(".session-item.active .session-item-text");
  if (activeItem) sessionTitle = activeItem.textContent;
  if (ctx.projectName && sessionTitle) {
    document.title = sessionTitle + " - " + ctx.projectName;
  } else if (ctx.projectName) {
    document.title = ctx.projectName + " - Claude Relay";
  } else {
    document.title = "Claude Relay";
  }
}

export function openSidebar() {
  ctx.sidebar.classList.add("open");
  ctx.sidebarOverlay.classList.add("visible");
}

export function closeSidebar() {
  ctx.sidebar.classList.remove("open");
  ctx.sidebarOverlay.classList.remove("visible");
}

export function initSidebar(_ctx) {
  ctx = _ctx;

  document.addEventListener("click", function () { closeSessionCtxMenu(); });

  ctx.hamburgerBtn.addEventListener("click", function () {
    ctx.sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });

  ctx.sidebarOverlay.addEventListener("click", closeSidebar);

  // --- Desktop sidebar collapse/expand ---
  function toggleSidebarCollapse() {
    var layout = ctx.$("layout");
    var collapsed = layout.classList.toggle("sidebar-collapsed");
    try { localStorage.setItem("sidebar-collapsed", collapsed ? "1" : ""); } catch (e) {}
  }

  ctx.sidebarToggleBtn.addEventListener("click", toggleSidebarCollapse);
  ctx.sidebarExpandBtn.addEventListener("click", toggleSidebarCollapse);

  // Restore collapsed state from localStorage
  try {
    if (localStorage.getItem("sidebar-collapsed") === "1") {
      ctx.$("layout").classList.add("sidebar-collapsed");
    }
  } catch (e) {}

  ctx.newSessionBtn.addEventListener("click", function () {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
      closeSidebar();
    }
  });

  // --- Session search ---
  var searchBtn = ctx.$("search-session-btn");
  var searchBox = ctx.$("session-search");
  var searchInput = ctx.$("session-search-input");

  function openSearch() {
    searchBox.classList.remove("hidden");
    searchBtn.classList.add("active");
    searchInput.value = "";
    searchQuery = "";
    setTimeout(function () { searchInput.focus(); }, 50);
  }

  function closeSearch() {
    searchBox.classList.add("hidden");
    searchBtn.classList.remove("active");
    searchInput.value = "";
    searchQuery = "";
    searchMatchIds = null;
    if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
    removeSearchTimeline();
    renderSessionList(null);
  }

  searchBtn.addEventListener("click", function () {
    if (searchBox.classList.contains("hidden")) {
      openSearch();
    } else {
      closeSearch();
    }
  });

  searchInput.addEventListener("input", function () {
    searchQuery = searchInput.value.trim();
    if (searchDebounce) clearTimeout(searchDebounce);
    if (!searchQuery) {
      searchMatchIds = null;
      removeSearchTimeline();
      renderSessionList(null);
      return;
    }
    searchDebounce = setTimeout(function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "search_sessions", query: searchQuery }));
      }
    }, 200);
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  });

  // --- Resume session picker ---
  var resumeModal = ctx.$("resume-modal");
  var resumeCancel = ctx.$("resume-cancel");
  var pickerLoading = ctx.$("resume-picker-loading");
  var pickerEmpty = ctx.$("resume-picker-empty");
  var pickerList = ctx.$("resume-picker-list");

  function openResumeModal() {
    resumeModal.classList.remove("hidden");
    pickerLoading.classList.remove("hidden");
    pickerEmpty.classList.add("hidden");
    pickerList.classList.add("hidden");
    pickerList.innerHTML = "";
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "list_cli_sessions" }));
    }
  }

  function closeResumeModal() {
    resumeModal.classList.add("hidden");
  }

  ctx.resumeSessionBtn.addEventListener("click", openResumeModal);
  resumeCancel.addEventListener("click", closeResumeModal);
  resumeModal.querySelector(".confirm-backdrop").addEventListener("click", closeResumeModal);

  // --- Continue session button ---
  var continueBtn = ctx.$("continue-session-btn");
  if (continueBtn) {
    continueBtn.addEventListener("click", function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "continue_session" }));
        closeSidebar();
      }
    });
  }

  // --- File browser panel switch ---
  var fileBrowserBtn = ctx.$("file-browser-btn");
  var sessionsPanel = ctx.$("sidebar-panel-sessions");
  var filesPanel = ctx.$("sidebar-panel-files");
  var filePanelBack = ctx.$("file-panel-back");

  function showFilesPanel() {
    sessionsPanel.classList.add("hidden");
    filesPanel.classList.remove("hidden");
    if (ctx.onFilesTabOpen) ctx.onFilesTabOpen();
  }

  function showSessionsPanel() {
    filesPanel.classList.add("hidden");
    sessionsPanel.classList.remove("hidden");
  }

  if (fileBrowserBtn) {
    fileBrowserBtn.addEventListener("click", showFilesPanel);
  }
  if (filePanelBack) {
    filePanelBack.addEventListener("click", showSessionsPanel);
  }
}

// --- CLI session picker ---
function relativeTime(isoString) {
  if (!isoString) return "";
  var ms = Date.now() - new Date(isoString).getTime();
  var sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  var min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  var days = Math.floor(hr / 24);
  if (days < 30) return days + "d ago";
  return new Date(isoString).toLocaleDateString();
}

export function populateCliSessionList(sessions) {
  console.log("[debug] populateCliSessionList called, sessions:", sessions && sessions.length);
  var pickerLoading = ctx.$("resume-picker-loading");
  var pickerEmpty = ctx.$("resume-picker-empty");
  var pickerList = ctx.$("resume-picker-list");
  console.log("[debug] picker elements:", !!pickerLoading, !!pickerEmpty, !!pickerList);
  if (!pickerLoading || !pickerList) return;

  pickerLoading.classList.add("hidden");

  if (!sessions || sessions.length === 0) {
    pickerEmpty.classList.remove("hidden");
    pickerList.classList.add("hidden");
    return;
  }

  pickerEmpty.classList.add("hidden");
  pickerList.classList.remove("hidden");
  pickerList.innerHTML = "";

  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var item = document.createElement("div");
    item.className = "cli-session-item";

    var title = document.createElement("div");
    title.className = "cli-session-title";
    title.textContent = s.firstPrompt || "Untitled session";
    item.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "cli-session-meta";
    if (s.lastActivity) {
      var time = document.createElement("span");
      time.textContent = relativeTime(s.lastActivity);
      meta.appendChild(time);
    }
    if (s.model) {
      var model = document.createElement("span");
      model.className = "badge";
      model.textContent = s.model;
      meta.appendChild(model);
    }
    if (s.gitBranch) {
      var branch = document.createElement("span");
      branch.className = "badge";
      branch.textContent = s.gitBranch;
      meta.appendChild(branch);
    }
    item.appendChild(meta);

    (function (sessionId) {
      item.addEventListener("click", function () {
        console.log("[debug] cli session clicked:", sessionId);
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "resume_session", cliSessionId: sessionId }));
        } else {
          console.log("[debug] ws not connected, cannot send");
        }
        var modal = ctx.$("resume-modal");
        if (modal) modal.classList.add("hidden");
        closeSidebar();
      });
    })(s.sessionId);

    pickerList.appendChild(item);
  }
}

// --- Search hit timeline (right-side markers) ---
var searchTimelineScrollHandler = null;
var activeSearchQuery = ""; // query active in the timeline

export function getActiveSearchQuery() {
  return searchQuery;
}

export function buildSearchTimeline(query) {
  removeSearchTimeline();
  if (!query) return;
  activeSearchQuery = query;

  var q = query.toLowerCase();
  var messagesEl = ctx.messagesEl;

  // Collect all message elements that contain the query
  var allMsgs = messagesEl.querySelectorAll(".msg-user, .msg-assistant");
  var hits = [];
  for (var i = 0; i < allMsgs.length; i++) {
    var msgEl = allMsgs[i];
    var textEl = msgEl.querySelector(".bubble") || msgEl.querySelector(".md-content");
    if (!textEl) continue;
    var text = textEl.textContent || "";
    if (text.toLowerCase().indexOf(q) === -1) continue;

    // Extract a snippet around the match
    var idx = text.toLowerCase().indexOf(q);
    var start = Math.max(0, idx - 10);
    var end = Math.min(text.length, idx + query.length + 10);
    var snippet = (start > 0 ? "\u2026" : "") + text.substring(start, end) + (end < text.length ? "\u2026" : "");
    hits.push({ el: msgEl, snippet: snippet });
  }

  if (hits.length === 0) return;

  var timeline = document.createElement("div");
  timeline.className = "search-timeline";
  timeline.id = "search-timeline";

  var track = document.createElement("div");
  track.className = "rewind-timeline-track";

  var viewport = document.createElement("div");
  viewport.className = "rewind-timeline-viewport";
  track.appendChild(viewport);

  for (var i = 0; i < hits.length; i++) {
    var hit = hits[i];
    var pct = hits.length === 1 ? 50 : 6 + (i / (hits.length - 1)) * 88;

    var snippetText = hit.snippet;
    if (snippetText.length > 24) snippetText = snippetText.substring(0, 24) + "\u2026";

    var marker = document.createElement("div");
    marker.className = "rewind-timeline-marker search-hit-marker";
    marker.innerHTML = iconHtml("search") + '<span class="marker-text">' + escapeHtml(snippetText) + '</span>';
    marker.style.top = pct + "%";
    marker.dataset.offsetTop = hit.el.offsetTop;

    (function(targetEl, markerEl) {
      markerEl.addEventListener("click", function() {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        targetEl.classList.remove("search-blink");
        void targetEl.offsetWidth; // force reflow
        targetEl.classList.add("search-blink");
      });
    })(hit.el, marker);

    track.appendChild(marker);
  }

  timeline.appendChild(track);

  // Position to align with messages area
  var appEl = ctx.$("app");
  var headerEl = ctx.$("header");
  var inputAreaEl = ctx.$("input-area");
  var appRect = appEl.getBoundingClientRect();
  var headerRect = headerEl.getBoundingClientRect();
  var inputRect = inputAreaEl.getBoundingClientRect();

  timeline.style.top = (headerRect.bottom - appRect.top + 4) + "px";
  timeline.style.bottom = (appRect.bottom - inputRect.top + 4) + "px";

  appEl.appendChild(timeline);
  refreshIcons();

  searchTimelineScrollHandler = function() { updateSearchTimelineViewport(track, viewport); };
  messagesEl.addEventListener("scroll", searchTimelineScrollHandler);
  updateSearchTimelineViewport(track, viewport);
}

function updateSearchTimelineViewport(track, viewport) {
  if (!track) return;
  var messagesEl = ctx.messagesEl;
  var scrollH = messagesEl.scrollHeight;
  var viewH = messagesEl.clientHeight;
  if (scrollH <= viewH) {
    viewport.style.top = "0";
    viewport.style.height = "100%";
  } else {
    var viewTop = messagesEl.scrollTop / scrollH;
    var viewBot = (messagesEl.scrollTop + viewH) / scrollH;
    viewport.style.top = (viewTop * 100) + "%";
    viewport.style.height = ((viewBot - viewTop) * 100) + "%";
  }

  var markers = track.querySelectorAll(".search-hit-marker");
  var vTop = messagesEl.scrollTop;
  var vBot = vTop + viewH;

  for (var i = 0; i < markers.length; i++) {
    var msgTop = parseInt(markers[i].dataset.offsetTop, 10);
    if (msgTop >= vTop && msgTop <= vBot) {
      markers[i].classList.add("in-view");
    } else {
      markers[i].classList.remove("in-view");
    }
  }
}

export function removeSearchTimeline() {
  var existing = document.getElementById("search-timeline");
  if (existing) existing.remove();
  if (searchTimelineScrollHandler && ctx.messagesEl) {
    ctx.messagesEl.removeEventListener("scroll", searchTimelineScrollHandler);
    searchTimelineScrollHandler = null;
  }
  activeSearchQuery = "";
}
