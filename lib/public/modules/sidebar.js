import { escapeHtml, copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { openProjectSettings } from './project-settings.js';
import { triggerShare } from './qrcode.js';
import { parseEmojis } from './markdown.js';

var ctx;

// --- Session search ---
var searchQuery = "";
var searchMatchIds = null; // null = no search, Set of matched session IDs
var searchDebounce = null;
var cachedSessions = [];
var expandedLoopGroups = new Set();

// --- Cached project data for mobile sheet ---
var cachedProjectList = [];
var cachedCurrentSlug = null;

// --- Session presence (multi-user: who is viewing which session) ---
var sessionPresence = {}; // { sessionId: [{ id, displayName, avatarStyle, avatarSeed }] }

// --- Countdown timer for upcoming schedules ---
var countdownTimer = null;
var countdownContainer = null;

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

function showSessionCtxMenu(anchorBtn, sessionId, title, cliSid, sessionData) {
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

  // Session visibility toggle (only the session owner can change)
  if (ctx.multiUser && sessionData && sessionData.ownerId && sessionData.ownerId === ctx.myUserId) {
    var currentVis = (sessionData && sessionData.sessionVisibility) || "shared";
    var isPrivate = currentVis === "private";
    var visItem = document.createElement("button");
    visItem.className = "session-ctx-item";
    visItem.innerHTML = iconHtml(isPrivate ? "eye" : "eye-off") + " <span>" + (isPrivate ? "Make Shared" : "Make Private") + "</span>";
    visItem.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSessionCtxMenu();
      var newVis = isPrivate ? "shared" : "private";
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "set_session_visibility", sessionId: sessionId, visibility: newVis }));
      }
    });
    menu.appendChild(visItem);
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

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  // Position: fixed relative to the anchor button
  requestAnimationFrame(function () {
    var btnRect = anchorBtn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (btnRect.bottom + 2) + "px";
    menu.style.right = (window.innerWidth - btnRect.right) + "px";
    menu.style.left = "auto";
    // If menu overflows below viewport, flip up
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (btnRect.top - menuRect.height - 2) + "px";
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

function showLoopCtxMenu(anchorBtn, loopId, loopName, childCount) {
  closeSessionCtxMenu();

  var menu = document.createElement("div");
  menu.className = "session-ctx-menu";

  var renameItem = document.createElement("button");
  renameItem.className = "session-ctx-item";
  renameItem.innerHTML = iconHtml("pencil") + " <span>Rename</span>";
  renameItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    startLoopInlineRename(loopId, loopName);
  });
  menu.appendChild(renameItem);

  var deleteItem = document.createElement("button");
  deleteItem.className = "session-ctx-item session-ctx-delete";
  deleteItem.innerHTML = iconHtml("trash-2") + " <span>Delete</span>";
  deleteItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeSessionCtxMenu();
    var msg = 'Delete "' + (loopName || "Ralph Loop") + '"';
    if (childCount > 1) msg += " and its " + childCount + " sessions";
    msg += "? This cannot be undone.";
    ctx.showConfirm(msg, function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "delete_loop_group", loopId: loopId }));
      }
    });
  });
  menu.appendChild(deleteItem);

  document.body.appendChild(menu);
  sessionCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var btnRect = anchorBtn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (btnRect.bottom + 2) + "px";
    menu.style.right = (window.innerWidth - btnRect.right) + "px";
    menu.style.left = "auto";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (btnRect.top - menuRect.height - 2) + "px";
    }
  });
}

function startLoopInlineRename(loopId, currentName) {
  var el = ctx.sessionListEl.querySelector('.session-loop-group[data-loop-id="' + loopId + '"]');
  if (!el) return;
  var textSpan = el.querySelector(".session-item-text");
  if (!textSpan) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-rename-input";
  input.value = currentName || "Ralph Loop";

  var originalHtml = textSpan.innerHTML;
  textSpan.innerHTML = "";
  textSpan.appendChild(input);
  input.focus();
  input.select();

  function commitRename() {
    var newName = input.value.trim();
    if (newName && newName !== currentName && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "loop_registry_rename", id: loopId, name: newName }));
    }
    textSpan.innerHTML = originalHtml;
    if (newName && newName !== currentName) {
      // Update text inline immediately
      var nameNode = textSpan.querySelector(".session-loop-name");
      if (nameNode) nameNode.textContent = newName;
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

function renderLoopChild(s) {
  var el = document.createElement("div");
  var isMatch = searchMatchIds !== null && searchMatchIds.has(s.id);
  var dimmed = searchMatchIds !== null && !isMatch;
  el.className = "session-loop-child" + (s.active ? " active" : "") + (isMatch ? " search-match" : "") + (dimmed ? " search-dimmed" : "");
  el.dataset.sessionId = s.id;

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (s.isProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  if (s.loop) {
    var isRalphChild = s.loop.source === "ralph";
    var roleName = s.loop.role === "crafting" ? "Crafting" : s.loop.role === "judge" ? "Judge" : (isRalphChild ? "Coder" : "Run");
    var iterSuffix = s.loop.role === "crafting" ? "" : " #" + s.loop.iteration;
    var roleCls = s.loop.role === "crafting" ? " crafting" : (!isRalphChild ? " scheduled" : "");
    textHtml += '<span class="session-loop-role-badge' + roleCls + '">' + roleName + iterSuffix + '</span>';
  }
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

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

function renderLoopGroup(loopId, children, groupKey) {
  var gk = groupKey || loopId;
  // Sort children by iteration then role (coder before judge)
  children.sort(function (a, b) {
    var ai = (a.loop && a.loop.iteration) || 0;
    var bi = (b.loop && b.loop.iteration) || 0;
    if (ai !== bi) return ai - bi;
    // coder before judge within same iteration
    var ar = (a.loop && a.loop.role === "judge") ? 1 : 0;
    var br = (b.loop && b.loop.role === "judge") ? 1 : 0;
    return ar - br;
  });

  var expanded = expandedLoopGroups.has(gk);
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

  var loopName = (children[0].loop && children[0].loop.name) || "Ralph Loop";
  var isRalph = children[0].loop && children[0].loop.source === "ralph";
  var isCrafting = false;
  var maxIter = 0;
  for (var j = 0; j < children.length; j++) {
    var iter = (children[j].loop && children[j].loop.iteration) || 0;
    if (iter > maxIter) maxIter = iter;
    if (children[j].loop && children[j].loop.role === "crafting") isCrafting = true;
  }

  var wrapper = document.createElement("div");
  wrapper.className = "session-loop-wrapper";

  // Group header row
  var el = document.createElement("div");
  el.className = "session-loop-group" + (hasActive ? " active" : "") + (expanded ? " expanded" : "") + (isRalph ? "" : " scheduled");
  el.dataset.loopId = loopId;

  var chevron = document.createElement("button");
  chevron.className = "session-loop-chevron";
  chevron.innerHTML = iconHtml("chevron-right");
  chevron.addEventListener("click", (function (lid) {
    return function (e) {
      e.stopPropagation();
      if (expandedLoopGroups.has(lid)) {
        expandedLoopGroups.delete(lid);
      } else {
        expandedLoopGroups.add(lid);
      }
      renderSessionList(null);
    };
  })(gk));
  el.appendChild(chevron);

  var textSpan = document.createElement("span");
  textSpan.className = "session-item-text";
  var textHtml = "";
  if (anyProcessing) {
    textHtml += '<span class="session-processing"></span>';
  }
  var groupIcon = isRalph ? "repeat" : "calendar-clock";
  textHtml += '<span class="session-loop-icon' + (isRalph ? "" : " scheduled") + '">' + iconHtml(groupIcon) + '</span>';
  textHtml += '<span class="session-loop-name">' + escapeHtml(loopName) + '</span>';
  if (isCrafting && children.length === 1) {
    textHtml += '<span class="session-loop-badge crafting">Crafting</span>';
  } else {
    textHtml += '<span class="session-loop-count' + (isRalph ? "" : " scheduled") + '">' + children.length + '</span>';
  }
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  // More button (ellipsis)
  var moreBtn = document.createElement("button");
  moreBtn.className = "session-more-btn";
  moreBtn.innerHTML = iconHtml("ellipsis");
  moreBtn.title = "More options";
  moreBtn.addEventListener("click", (function (lid, name, count, btn) {
    return function (e) {
      e.stopPropagation();
      showLoopCtxMenu(btn, lid, name, count);
    };
  })(loopId, loopName, children.length, moreBtn));
  el.appendChild(moreBtn);

  // Click row (not chevron/more) → switch to latest session
  el.addEventListener("click", (function (id) {
    return function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        closeSidebar();
      }
    };
  })(latestSession.id));

  wrapper.appendChild(el);

  // Expanded children
  if (expanded) {
    var childContainer = document.createElement("div");
    childContainer.className = "session-loop-children";
    for (var k = 0; k < children.length; k++) {
      childContainer.appendChild(renderLoopChild(children[k]));
    }
    wrapper.appendChild(childContainer);
  }

  return wrapper;
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
  if (ctx.multiUser && s.sessionVisibility === "private") {
    textHtml += '<span class="session-private-icon" title="Private session">' + iconHtml("lock") + '</span>';
  }
  textHtml += highlightMatch(s.title || "New Session", searchQuery);
  textSpan.innerHTML = textHtml;
  el.appendChild(textSpan);

  var moreBtn = document.createElement("button");
  moreBtn.className = "session-more-btn";
  moreBtn.innerHTML = iconHtml("ellipsis");
  moreBtn.title = "More options";
  moreBtn.addEventListener("click", (function(id, title, cliSid, btn, sData) {
    return function(e) {
      e.stopPropagation();
      showSessionCtxMenu(btn, id, title, cliSid, sData);
    };
  })(s.id, s.title, s.cliSessionId, moreBtn, s));
  el.appendChild(moreBtn);

  // Unread badge
  var unreadBadge = document.createElement("span");
  unreadBadge.className = "session-unread-badge";
  unreadBadge.dataset.sessionId = s.id;
  if (s.unread > 0) {
    unreadBadge.textContent = s.unread > 99 ? "99+" : String(s.unread);
    unreadBadge.classList.add("has-unread");
  }
  el.appendChild(unreadBadge);

  el.addEventListener("click", (function (id) {
    return function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        closeSidebar();
      }
    };
  })(s.id));

  // Presence avatars (multi-user)
  renderPresenceAvatars(el, String(s.id));

  return el;
}

export function renderSessionList(sessions) {
  if (sessions) cachedSessions = sessions;

  ctx.sessionListEl.innerHTML = "";

  // Partition: loop sessions vs normal sessions
  // Group by loopId + startedAt so different runs of the same task are separate groups
  var loopGroups = {}; // groupKey -> [sessions]
  var normalSessions = [];
  for (var i = 0; i < cachedSessions.length; i++) {
    var s = cachedSessions[i];
    if (s.loop && s.loop.loopId && s.loop.role === "crafting" && s.loop.source !== "ralph") {
      // Task crafting sessions live in the scheduler calendar, not the main list
      continue;
    } else if (s.loop && s.loop.loopId) {
      var groupKey = s.loop.loopId + ":" + (s.loop.startedAt || 0);
      if (!loopGroups[groupKey]) loopGroups[groupKey] = [];
      loopGroups[groupKey].push(s);
    } else {
      normalSessions.push(s);
    }
  }

  // Build virtual items: normal sessions + one entry per loop group (using latest child's lastActivity)
  var items = [];
  for (var j = 0; j < normalSessions.length; j++) {
    items.push({ type: "session", data: normalSessions[j], lastActivity: normalSessions[j].lastActivity || 0 });
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
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });

  var currentGroup = "";
  for (var n = 0; n < items.length; n++) {
    var item = items[n];
    var group = getDateGroup(item.lastActivity || 0);
    if (group !== currentGroup) {
      currentGroup = group;
      var header = document.createElement("div");
      header.className = "session-group-header";
      header.textContent = group;
      ctx.sessionListEl.appendChild(header);
    }
    if (item.type === "loop") {
      ctx.sessionListEl.appendChild(renderLoopGroup(item.loopId, item.children, item.groupKey));
    } else {
      ctx.sessionListEl.appendChild(renderSessionItem(item.data));
    }
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

export function updateSessionPresence(presence) {
  sessionPresence = presence;
  // Update presence avatars on existing session items without full re-render
  var items = ctx.sessionListEl.querySelectorAll("[data-session-id]");
  for (var i = 0; i < items.length; i++) {
    renderPresenceAvatars(items[i], items[i].dataset.sessionId);
  }
}

function presenceAvatarUrl(style, seed) {
  var s = encodeURIComponent(seed || "anonymous");
  return "https://api.dicebear.com/9.x/" + (style || "thumbs") + "/svg?seed=" + s + "&size=24";
}

function renderPresenceAvatars(el, sessionId) {
  // Remove existing presence container
  var existing = el.querySelector(".session-presence");
  if (existing) existing.remove();

  var users = sessionPresence[sessionId];
  if (!users || users.length === 0) return;

  var container = document.createElement("span");
  container.className = "session-presence";

  var max = 3;
  var shown = users.length > max ? max : users.length;
  for (var i = 0; i < shown; i++) {
    var u = users[i];
    var img = document.createElement("img");
    img.className = "session-presence-avatar";
    img.src = presenceAvatarUrl(u.avatarStyle, u.avatarSeed);
    img.alt = u.displayName;
    img.dataset.tip = u.displayName + (u.username ? " (@" + u.username + ")" : "");
    if (i > 0) img.style.marginLeft = "-6px";
    container.appendChild(img);
  }
  if (users.length > max) {
    var more = document.createElement("span");
    more.className = "session-presence-more";
    more.textContent = "+" + (users.length - max);
    container.appendChild(more);
  }

  // Insert before the more-btn
  var moreBtn = el.querySelector(".session-more-btn");
  if (moreBtn) {
    el.insertBefore(container, moreBtn);
  } else {
    el.appendChild(container);
  }
}

export function updatePageTitle() {
  var sessionTitle = "";
  var activeItem = ctx.sessionListEl.querySelector(".session-item.active .session-item-text");
  if (activeItem) sessionTitle = activeItem.textContent;
  if (ctx.headerTitleEl) {
    ctx.headerTitleEl.textContent = sessionTitle || ctx.projectName || "Clay";
  }
  var tbProjectName = ctx.$("title-bar-project-name");
  if (tbProjectName && ctx.projectName) {
    tbProjectName.textContent = ctx.projectName;
  } else if (tbProjectName && !tbProjectName.textContent) {
    // Fallback: derive name from URL slug when projectName not yet available
    var _m = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
    if (_m) tbProjectName.textContent = _m[1];
  }
  if (ctx.projectName && sessionTitle) {
    document.title = sessionTitle + " - " + ctx.projectName;
  } else if (ctx.projectName) {
    document.title = ctx.projectName + " - Clay";
  } else {
    document.title = "Clay";
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

// --- Mobile sheet (fullscreen overlay for Projects / Sessions) ---

function openMobileSheet(type) {
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

  listEl.innerHTML = "";
  sheet.classList.remove("sheet-files");

  if (type === "projects") {
    titleEl.textContent = "Projects";
    renderSheetProjects(listEl);
  } else if (type === "sessions") {
    titleEl.textContent = "Sessions";
    renderSheetSessions(listEl);
  } else if (type === "files") {
    titleEl.textContent = "Files";
    sheet.classList.add("sheet-files");
    var fileTree = document.getElementById("file-tree");
    if (fileTree) {
      listEl.appendChild(fileTree);
      fileTree.classList.remove("hidden");
    }
    if (ctx.onFilesTabOpen) ctx.onFilesTabOpen();
  }

  sheet.classList.remove("hidden", "closing");
  refreshIcons();
}

function closeMobileSheet() {
  var sheet = document.getElementById("mobile-sheet");
  if (!sheet || sheet.classList.contains("hidden")) return;

  // Return file tree to sidebar if it was moved
  if (sheet.classList.contains("sheet-files")) {
    var fileTree = document.getElementById("file-tree");
    var sidebarFilesPanel = document.getElementById("sidebar-panel-files");
    if (fileTree && sidebarFilesPanel) {
      sidebarFilesPanel.appendChild(fileTree);
    }
  }

  sheet.classList.add("closing");
  setTimeout(function () {
    sheet.classList.add("hidden");
    sheet.classList.remove("closing", "sheet-files");
  }, 230);
}

function renderSheetProjects(listEl) {
  for (var i = 0; i < cachedProjectList.length; i++) {
    (function (p) {
      var el = document.createElement("button");
      el.className = "mobile-project-item" + (p.slug === cachedCurrentSlug ? " active" : "");

      var abbrev = document.createElement("span");
      abbrev.className = "mobile-project-abbrev";
      abbrev.textContent = getProjectAbbrev(p.name);
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

      if (p.unread > 0 && p.slug !== cachedCurrentSlug) {
        var mBadge = document.createElement("span");
        mBadge.className = "mobile-project-unread";
        mBadge.textContent = p.unread > 99 ? "99+" : String(p.unread);
        el.appendChild(mBadge);
      }

      el.addEventListener("click", function () {
        if (ctx.switchProject) ctx.switchProject(p.slug);
        closeMobileSheet();
      });

      listEl.appendChild(el);
    })(cachedProjectList[i]);
  }
}

function renderSheetSessions(listEl) {
  // New session button at top
  var newBtn = document.createElement("button");
  newBtn.className = "mobile-session-new";
  newBtn.innerHTML = '<i data-lucide="plus" style="width:16px;height:16px"></i> New session';
  newBtn.addEventListener("click", function () {
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
    }
    closeMobileSheet();
  });
  listEl.appendChild(newBtn);

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
      header.className = "mobile-sheet-group";
      header.textContent = group;
      listEl.appendChild(header);
    }

    var el = document.createElement("button");
    el.className = "mobile-session-item" + (s.active ? " active" : "");

    var titleSpan = document.createElement("span");
    titleSpan.className = "mobile-session-title";
    titleSpan.textContent = s.title || "New Session";
    el.appendChild(titleSpan);

    if (s.isProcessing) {
      var dot = document.createElement("span");
      dot.className = "mobile-session-processing";
      el.appendChild(dot);
    }

    (function (id) {
      el.addEventListener("click", function () {
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
        }
        closeMobileSheet();
      });
    })(s.id);

    listEl.appendChild(el);
  }
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
    setTimeout(function () { syncUserIslandWidth(); syncResizeHandle(); }, 210);
  }

  if (ctx.sidebarToggleBtn) ctx.sidebarToggleBtn.addEventListener("click", toggleSidebarCollapse);
  if (ctx.sidebarExpandBtn) ctx.sidebarExpandBtn.addEventListener("click", toggleSidebarCollapse);

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

  // --- New Ralph Loop button ---
  var newRalphBtn = ctx.$("new-ralph-btn");
  if (newRalphBtn) {
    newRalphBtn.addEventListener("click", function () {
      if (ctx.openRalphWizard) ctx.openRalphWizard();
    });
  }

  // --- Session search ---
  var searchBtn = ctx.$("search-session-btn");
  var searchBox = ctx.$("session-search");
  var searchInput = ctx.$("session-search-input");
  var searchClear = ctx.$("session-search-clear");

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

  if (searchClear) {
    searchClear.addEventListener("click", function () {
      closeSearch();
    });
  }

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

  // --- Panel switch (sessions / files / projects) ---
  var fileBrowserBtn = ctx.$("file-browser-btn");
  var projectsPanel = ctx.$("sidebar-panel-projects");
  var sessionsPanel = ctx.$("sidebar-panel-sessions");
  var filesPanel = ctx.$("sidebar-panel-files");
  var sessionsHeaderContent = ctx.$("sessions-header-content");
  var filesHeaderContent = ctx.$("files-header-content");
  var filePanelClose = ctx.$("file-panel-close");

  function hideAllPanels() {
    if (projectsPanel) projectsPanel.classList.add("hidden");
    if (sessionsPanel) sessionsPanel.classList.add("hidden");
    if (filesPanel) filesPanel.classList.add("hidden");
    if (sessionsHeaderContent) sessionsHeaderContent.classList.add("hidden");
    if (filesHeaderContent) filesHeaderContent.classList.add("hidden");
  }

  function showProjectsPanel() {
    hideAllPanels();
    if (projectsPanel) projectsPanel.classList.remove("hidden");
  }

  function showSessionsPanel() {
    hideAllPanels();
    if (sessionsPanel) sessionsPanel.classList.remove("hidden");
    if (sessionsHeaderContent) sessionsHeaderContent.classList.remove("hidden");
  }

  function showFilesPanel() {
    hideAllPanels();
    if (filesPanel) filesPanel.classList.remove("hidden");
    if (filesHeaderContent) filesHeaderContent.classList.remove("hidden");
    if (ctx.onFilesTabOpen) ctx.onFilesTabOpen();
  }

  if (fileBrowserBtn) {
    fileBrowserBtn.addEventListener("click", showFilesPanel);
  }
  if (filePanelClose) {
    filePanelClose.addEventListener("click", showSessionsPanel);
  }

  // --- Mobile sheet close handlers ---
  var mobileSheet = document.getElementById("mobile-sheet");
  if (mobileSheet) {
    var sheetBackdrop = mobileSheet.querySelector(".mobile-sheet-backdrop");
    var sheetCloseBtn = mobileSheet.querySelector(".mobile-sheet-close");
    if (sheetBackdrop) sheetBackdrop.addEventListener("click", closeMobileSheet);
    if (sheetCloseBtn) sheetCloseBtn.addEventListener("click", closeMobileSheet);
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
  }

  for (var t = 0; t < mobileTabs.length; t++) {
    (function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.dataset.tab;

        if (name === "terminal") {
          closeSidebar();
          setMobileTabActive("");
          if (ctx.openTerminal) ctx.openTerminal();
          return;
        }

        if (name === "projects") {
          openMobileSheet("projects");
          setMobileTabActive("projects");
        } else if (name === "sessions") {
          openMobileSheet("sessions");
          setMobileTabActive("sessions");
        } else if (name === "files") {
          openMobileSheet("files");
          setMobileTabActive("files");
        }
      });
    })(mobileTabs[t]);
  }

  if (mobileHomeBtn) {
    mobileHomeBtn.addEventListener("click", function () {
      closeSidebar();
      setMobileTabActive("");
      if (ctx.showHomeHub) ctx.showHomeHub();
    });
  }

  // --- User island width sync ---
  var userIsland = document.getElementById("user-island");
  var sidebarColumn = document.getElementById("sidebar-column");

  function syncUserIslandWidth() {
    if (!userIsland || !sidebarColumn) return;
    var rect = sidebarColumn.getBoundingClientRect();
    userIsland.style.width = (rect.right - 8 - 8) + "px";
  }

  // --- Sidebar resize handle ---
  var resizeHandle = document.getElementById("sidebar-resize-handle");

  function syncResizeHandle() {
    if (!resizeHandle || !sidebarColumn) return;
    var rect = sidebarColumn.getBoundingClientRect();
    var parentRect = sidebarColumn.parentElement.getBoundingClientRect();
    resizeHandle.style.left = (rect.right - parentRect.left) + "px";
  }

  if (resizeHandle && sidebarColumn) {
    var dragging = false;

    function onResizeMove(e) {
      if (!dragging) return;
      e.preventDefault();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var iconStrip = document.getElementById("icon-strip");
      var stripWidth = iconStrip ? iconStrip.offsetWidth : 72;
      var newWidth = clientX - stripWidth;
      if (newWidth < 192) newWidth = 192;
      if (newWidth > 320) newWidth = 320;
      sidebarColumn.style.width = newWidth + "px";
      syncResizeHandle();
      syncUserIslandWidth();
    }

    function onResizeEnd() {
      if (!dragging) return;
      dragging = false;
      resizeHandle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeEnd);
      document.removeEventListener("touchmove", onResizeMove);
      document.removeEventListener("touchend", onResizeEnd);
      try { localStorage.setItem("sidebar-width", sidebarColumn.style.width); } catch (e) {}
    }

    function onResizeStart(e) {
      e.preventDefault();
      dragging = true;
      resizeHandle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeEnd);
      document.addEventListener("touchmove", onResizeMove, { passive: false });
      document.addEventListener("touchend", onResizeEnd);
    }

    resizeHandle.addEventListener("mousedown", onResizeStart);
    resizeHandle.addEventListener("touchstart", onResizeStart, { passive: false });

    // Restore saved width (skip transition so user-island syncs immediately)
    try {
      var savedWidth = localStorage.getItem("sidebar-width");
      if (savedWidth) {
        var px = parseInt(savedWidth, 10);
        if (px >= 192 && px <= 320) {
          sidebarColumn.style.transition = "none";
          sidebarColumn.style.width = px + "px";
          sidebarColumn.offsetWidth; // force reflow
          sidebarColumn.style.transition = "";
        }
      }
    } catch (e) {}

    syncResizeHandle();
    syncUserIslandWidth();
  }

  // Initial sync even if no resize handle
  syncUserIslandWidth();

  // --- Schedule countdown timer ---
  startCountdownTimer();
}

function startCountdownTimer() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdowns, 1000);
}

function updateCountdowns() {
  if (!ctx || !ctx.getUpcomingSchedules || !ctx.sessionListEl) return;
  var upcoming = ctx.getUpcomingSchedules(3 * 60 * 1000); // 3 minutes

  // Remove stale container
  if (countdownContainer && !ctx.sessionListEl.contains(countdownContainer)) {
    countdownContainer = null;
  }

  if (upcoming.length === 0) {
    if (countdownContainer) {
      countdownContainer.remove();
      countdownContainer = null;
    }
    return;
  }

  if (!countdownContainer) {
    countdownContainer = document.createElement("div");
    countdownContainer.className = "session-countdown-group";
    ctx.sessionListEl.insertBefore(countdownContainer, ctx.sessionListEl.firstChild);
  }

  var html = "";
  var now = Date.now();
  for (var i = 0; i < upcoming.length; i++) {
    var u = upcoming[i];
    var remaining = Math.max(0, Math.ceil((u.nextRunAt - now) / 1000));
    var min = Math.floor(remaining / 60);
    var sec = remaining % 60;
    var timeStr = min + ":" + (sec < 10 ? "0" : "") + sec;
    var colorStyle = u.color ? " style=\"border-left-color:" + u.color + "\"" : "";
    html += '<div class="session-countdown-item"' + colorStyle + '>';
    html += '<span class="session-countdown-name">' + escapeHtml(u.name) + '</span>';
    html += '<span class="session-countdown-badge">' + timeStr + '</span>';
    html += '</div>';
  }
  countdownContainer.innerHTML = html;
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
  var pickerLoading = ctx.$("resume-picker-loading");
  var pickerEmpty = ctx.$("resume-picker-empty");
  var pickerList = ctx.$("resume-picker-list");
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
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "resume_session", cliSessionId: sessionId }));
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
var pendingSearchScrollTarget = null; // { historyIndex, snippet, query } for scroll after history load

export function getActiveSearchQuery() {
  return searchQuery;
}

// Request server-side content search for the active session
export function buildSearchTimeline(query) {
  removeSearchTimeline();
  if (!query) return;
  activeSearchQuery = query;
  // Request full-history search from server
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "search_session_content", query: query }));
  }
}

// Handle server response with full-history search results
export function handleSearchContentResults(msg) {
  if (msg.query !== activeSearchQuery) return; // stale response
  var savedQuery = activeSearchQuery;
  removeSearchTimeline();
  if (!msg.hits || msg.hits.length === 0) return;
  activeSearchQuery = savedQuery;

  var hits = msg.hits;
  var total = msg.total;
  var messagesEl = ctx.messagesEl;

  var timeline = document.createElement("div");
  timeline.className = "search-timeline";
  timeline.id = "search-timeline";

  var track = document.createElement("div");
  track.className = "rewind-timeline-track";
  track.dataset.historyTotal = total;

  var viewport = document.createElement("div");
  viewport.className = "rewind-timeline-viewport";
  track.appendChild(viewport);

  for (var i = 0; i < hits.length; i++) {
    var hit = hits[i];
    // Position based on historyIndex relative to total history length
    var pct = total <= 1 ? 50 : 6 + (hit.historyIndex / (total - 1)) * 88;

    var snippetText = hit.snippet;
    if (snippetText.length > 24) snippetText = snippetText.substring(0, 24) + "\u2026";

    var marker = document.createElement("div");
    marker.className = "rewind-timeline-marker search-hit-marker";
    marker.innerHTML = iconHtml("search") + '<span class="marker-text">' + escapeHtml(snippetText) + '</span>';
    marker.style.top = pct + "%";
    // Store historyIndex for click handling and viewport check
    marker.dataset.historyIndex = hit.historyIndex;

    (function(hitData, markerEl) {
      markerEl.addEventListener("click", function() {
        scrollToSearchHit(hitData.historyIndex, hitData.snippet, msg.query);
      });
    })(hit, marker);

    track.appendChild(marker);
  }

  timeline.appendChild(track);

  // Position to align with messages area
  var appEl = ctx.$("app");
  var titleBarEl = document.querySelector(".title-bar-content");
  var inputAreaEl = ctx.$("input-area");
  var appRect = appEl.getBoundingClientRect();
  var titleBarRect = titleBarEl ? titleBarEl.getBoundingClientRect() : { bottom: appRect.top };
  var inputRect = inputAreaEl.getBoundingClientRect();

  timeline.style.top = (titleBarRect.bottom - appRect.top + 4) + "px";
  timeline.style.bottom = (appRect.bottom - inputRect.top + 4) + "px";

  appEl.appendChild(timeline);
  refreshIcons();

  searchTimelineScrollHandler = function() { updateSearchTimelineViewport(track, viewport); };
  messagesEl.addEventListener("scroll", searchTimelineScrollHandler);
  updateSearchTimelineViewport(track, viewport);
}

function scrollToSearchHit(historyIndex, snippet, query) {
  var historyFrom = ctx.getHistoryFrom ? ctx.getHistoryFrom() : 0;
  if (historyIndex < historyFrom) {
    // Need to load older history first
    pendingSearchScrollTarget = { historyIndex: historyIndex, snippet: snippet, query: query };
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "load_more_history", before: historyFrom, target: historyIndex }));
    }
    return;
  }
  // History is loaded, find matching element in DOM
  findAndScrollToMatch(snippet, query);
}

function findAndScrollToMatch(snippet, query) {
  var messagesEl = ctx.messagesEl;
  var q = query.toLowerCase();
  var allMsgs = messagesEl.querySelectorAll(".msg-user, .msg-assistant");
  for (var i = 0; i < allMsgs.length; i++) {
    var msgEl = allMsgs[i];
    var textEl = msgEl.querySelector(".bubble") || msgEl.querySelector(".md-content");
    if (!textEl) continue;
    var text = textEl.textContent || "";
    if (text.toLowerCase().indexOf(q) === -1) continue;
    // Check if the snippet content matches (strip ellipsis for comparison)
    var cleanSnippet = snippet.replace(/^\u2026/, "").replace(/\u2026$/, "");
    if (text.indexOf(cleanSnippet) !== -1) {
      msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
      msgEl.classList.remove("search-blink");
      void msgEl.offsetWidth;
      msgEl.classList.add("search-blink");
      return;
    }
  }
  // Fallback: scroll to any element containing the query text
  for (var j = 0; j < allMsgs.length; j++) {
    var el = allMsgs[j];
    var tEl = el.querySelector(".bubble") || el.querySelector(".md-content");
    if (!tEl) continue;
    if ((tEl.textContent || "").toLowerCase().indexOf(q) !== -1) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("search-blink");
      void el.offsetWidth;
      el.classList.add("search-blink");
      return;
    }
  }
}

// Called after history_prepend completes, to scroll to pending target
export function onHistoryPrepended() {
  if (!pendingSearchScrollTarget) return;
  var target = pendingSearchScrollTarget;
  pendingSearchScrollTarget = null;
  requestAnimationFrame(function() {
    findAndScrollToMatch(target.snippet, target.query);
  });
}

function updateSearchTimelineViewport(track, viewport) {
  if (!track) return;
  var messagesEl = ctx.messagesEl;
  var scrollH = messagesEl.scrollHeight;
  var viewH = messagesEl.clientHeight;

  // Map the visible scroll area to the timeline range (6% to 94%)
  var historyFrom = ctx.getHistoryFrom ? ctx.getHistoryFrom() : 0;
  var total = parseInt(track.dataset.historyTotal || "0", 10) || 1;
  var timelineStart = 6 + (historyFrom / (total - 1 || 1)) * 88;
  var timelineEnd = 94;
  var timelineRange = timelineEnd - timelineStart;

  if (scrollH <= viewH) {
    viewport.style.top = timelineStart + "%";
    viewport.style.height = timelineRange + "%";
  } else {
    var scrollFrac = messagesEl.scrollTop / scrollH;
    var viewFrac = viewH / scrollH;
    viewport.style.top = (timelineStart + scrollFrac * timelineRange) + "%";
    viewport.style.height = (viewFrac * timelineRange) + "%";
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

// --- Icon Strip (Discord-style project icons) ---
var iconStripTooltip = null;

function getProjectAbbrev(name) {
  if (!name) return "?";
  // Take first letter of each word, max 2 chars
  var words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function showIconTooltip(el, text) {
  hideIconTooltip();
  var tip = document.createElement("div");
  tip.className = "icon-strip-tooltip";
  tip.textContent = text;
  document.body.appendChild(tip);
  iconStripTooltip = tip;

  requestAnimationFrame(function () {
    var rect = el.getBoundingClientRect();
    tip.style.top = (rect.top + rect.height / 2 - tip.offsetHeight / 2) + "px";
    tip.classList.add("visible");
  });
}

function hideIconTooltip() {
  if (iconStripTooltip) {
    iconStripTooltip.remove();
    iconStripTooltip = null;
  }
}

// --- DM user context menu ---
var userCtxMenu = null;

function closeUserCtxMenu() {
  if (userCtxMenu) {
    userCtxMenu.remove();
    userCtxMenu = null;
  }
  document.removeEventListener("click", handleUserCtxOutsideClick, true);
}

function showUserCtxMenu(anchorEl, user) {
  closeUserCtxMenu();
  closeProjectCtxMenu();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var removeItem = document.createElement("button");
  removeItem.className = "project-ctx-item project-ctx-delete";
  removeItem.innerHTML = iconHtml("user-minus") + " <span>Remove from favorites</span>";
  removeItem.addEventListener("click", function (e) {
    e.stopPropagation();
    // Spawn dust particles at the user icon position
    var iconRect = anchorEl.getBoundingClientRect();
    spawnDustParticles(iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2);
    closeUserCtxMenu();
    // Immediately mark as removed so strip re-render hides the icon,
    // even if the user was only visible via cachedDmConversations (not favorites)
    cachedDmRemovedUsers[user.id] = true;
    if (ctx.onDmRemoveUser) ctx.onDmRemoveUser(user.id);
    renderUserStrip(cachedAllUsers, cachedOnlineUserIds, cachedMyUserId, cachedDmFavorites, cachedDmConversations, cachedDmUnread, cachedDmRemovedUsers);
    if (ctx.sendWs) {
      ctx.sendWs({ type: "dm_remove_favorite", targetUserId: user.id });
    }
  });
  menu.appendChild(removeItem);

  document.body.appendChild(menu);
  userCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = (rect.right + 6) + "px";
    menu.style.top = rect.top + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 6) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });

  // Close on outside click
  setTimeout(function () {
    document.addEventListener("click", handleUserCtxOutsideClick, true);
  }, 0);
}

function handleUserCtxOutsideClick(e) {
  if (userCtxMenu && !userCtxMenu.contains(e.target)) {
    closeUserCtxMenu();
  }
}

// --- Project context menu ---
var projectCtxMenu = null;

var EMOJI_CATEGORIES = [
  { id: "frequent", icon: "🕐", label: "Frequent", emojis: [
    "😀","😎","🤓","🧠","💡","🔥","⚡","🚀",
    "🎯","🎮","🎨","🎵","📦","📁","📝","💻",
    "🖥️","⌨️","🔧","🛠️","⚙️","🧪","🔬","🧬",
    "🌍","🌱","🌊","🌸","🍀","🌈","☀️","🌙",
    "🐱","🐶","🐼","🦊","🦋","🐝","🐙","🦄",
    "🍕","🍔","☕","🍩","🍎","🍇","🧁","🍣",
    "❤️","💜","💙","💚","💛","🧡","🤍","🖤",
    "⭐","✨","💎","🏆","👑","🎪","🎭","🃏",
  ]},
  { id: "smileys", icon: "😀", label: "Smileys & People", emojis: [
    "😀","😃","😄","😁","😆","😅","🤣","😂",
    "🙂","😊","😇","🥰","😍","🤩","😘","😗",
    "😚","😙","🥲","😋","😛","😜","🤪","😝",
    "🤑","🤗","🤭","🫢","🤫","🤔","🫡","🤐",
    "🤨","😐","😑","😶","🫥","😏","😒","🙄",
    "😬","🤥","😌","😔","😪","🤤","😴","😷",
    "🤒","🤕","🤢","🤮","🥴","😵","🤯","🥳",
    "🥸","😎","🤓","🧐","😕","🫤","😟","🙁",
    "😮","😯","😲","😳","🥺","🥹","😦","😧",
    "😨","😰","😥","😢","😭","😱","😖","😣",
    "😞","😓","😩","😫","🥱","😤","😡","😠",
    "🤬","😈","👿","💀","☠️","💩","🤡","👹",
    "👺","👻","👽","👾","🤖","😺","😸","😹",
    "😻","😼","😽","🙀","😿","😾","🙈","🙉",
    "🙊","👋","🤚","🖐️","✋","🖖","🫱","🫲",
    "🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰",
    "🤟","🤘","🤙","👈","👉","👆","🖕","👇",
    "☝️","🫵","👍","👎","✊","👊","🤛","🤜",
    "👏","🙌","🫶","👐","🤲","🤝","🙏","💪",
  ]},
  { id: "animals", icon: "🐻", label: "Animals & Nature", emojis: [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼",
    "🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐽","🐸",
    "🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦",
    "🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺",
    "🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌",
    "🐞","🐜","🪰","🪲","🪳","🦟","🦗","🕷️",
    "🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑",
    "🦐","🦞","🦀","🪸","🐡","🐠","🐟","🐬",
    "🐳","🐋","🦈","🐊","🐅","🐆","🦓","🫏",
    "🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫",
    "🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖",
    "🐏","🐑","🦙","🐐","🦌","🫎","🐕","🐩",
    "🦮","🐕‍🦺","🐈","🐈‍⬛","🪶","🐓","🦃","🦤",
    "🦚","🦜","🦢","🪿","🦩","🕊️","🐇","🦝",
    "🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿️",
    "🦔","🌵","🎄","🌲","🌳","🌴","🪵","🌱",
    "🌿","☘️","🍀","🎍","🪴","🎋","🍃","🍂",
    "🍁","🪺","🪹","🍄","🌾","💐","🌷","🌹",
    "🥀","🪻","🌺","🌸","🌼","🌻","🌞","🌝",
    "🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑",
    "🌒","🌓","🌔","🌙","🌎","🌍","🌏","🪐",
    "💫","⭐","🌟","✨","⚡","☄️","💥","🔥",
    "🌪️","🌈","☀️","🌤️","⛅","🌥️","☁️","🌦️",
    "🌧️","⛈️","🌩️","❄️","☃️","⛄","🌬️","💨",
    "💧","💦","🫧","☔","☂️","🌊","🌫️",
  ]},
  { id: "food", icon: "🍔", label: "Food & Drink", emojis: [
    "🍇","🍈","🍉","🍊","🍋","🍌","🍍","🥭",
    "🍎","🍏","🍐","🍑","🍒","🍓","🫐","🥝",
    "🍅","🫒","🥥","🥑","🍆","🥔","🥕","🌽",
    "🌶️","🫑","🥒","🥬","🥦","🧄","🧅","🥜",
    "🫘","🌰","🫚","🫛","🍞","🥐","🥖","🫓",
    "🥨","🥯","🥞","🧇","🧀","🍖","🍗","🥩",
    "🥓","🍔","🍟","🍕","🌭","🥪","🌮","🌯",
    "🫔","🥙","🧆","🥚","🍳","🥘","🍲","🫕",
    "🥣","🥗","🍿","🧈","🧂","🥫","🍱","🍘",
    "🍙","🍚","🍛","🍜","🍝","🍠","🍢","🍣",
    "🍤","🍥","🥮","🍡","🥟","🥠","🥡","🦀",
    "🦞","🦐","🦑","🦪","🍦","🍧","🍨","🍩",
    "🍪","🎂","🍰","🧁","🥧","🍫","🍬","🍭",
    "🍮","🍯","🍼","🥛","☕","🫖","🍵","🍶",
    "🍾","🍷","🍸","🍹","🍺","🍻","🥂","🥃",
    "🫗","🥤","🧋","🧃","🧉","🧊",
  ]},
  { id: "activity", icon: "⚽", label: "Activity", emojis: [
    "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉",
    "🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍",
    "🏏","🪃","🥅","⛳","🪁","🛝","🏹","🎣",
    "🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️",
    "🥌","🎿","⛷️","🏂","🪂","🏋️","🤸","🤺",
    "⛹️","🤾","🏌️","🏇","🧘","🏄","🏊","🤽",
    "🚣","🧗","🚵","🚴","🎪","🤹","🎭","🎨",
    "🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷",
    "🎺","🪗","🎸","🪕","🎻","🪈","🎲","♟️",
    "🎯","🎳","🎮","🕹️","🧩","🪩",
  ]},
  { id: "travel", icon: "🚗", label: "Travel & Places", emojis: [
    "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑",
    "🚒","🚐","🛻","🚚","🚛","🚜","🛵","🏍️",
    "🛺","🚲","🛴","🛹","🚏","🛣️","🛤️","⛽",
    "🛞","🚨","🚥","🚦","🛑","🚧","⚓","🛟",
    "⛵","🛶","🚤","🛳️","⛴️","🛥️","🚢","✈️",
    "🛩️","🛫","🛬","🪂","💺","🚁","🚟","🚠",
    "🚡","🛰️","🚀","🛸","🏠","🏡","🏘️","🏚️",
    "🏗️","🏭","🏢","🏬","🏣","🏤","🏥","🏦",
    "🏨","🏪","🏫","🏩","💒","🏛️","⛪","🕌",
    "🛕","🕍","⛩️","🕋","⛲","⛺","🌁","🌃",
    "🏙️","🌄","🌅","🌆","🌇","🌉","🗼","🗽",
    "🗻","🏕️","🎠","🎡","🎢","🏖️","🏝️","🏜️",
    "🌋","⛰️","🗺️","🧭","🏔️",
  ]},
  { id: "objects", icon: "💡", label: "Objects", emojis: [
    "⌚","📱","📲","💻","⌨️","🖥️","🖨️","🖱️",
    "🖲️","🕹️","🗜️","💽","💾","💿","📀","📼",
    "📷","📸","📹","🎥","📽️","🎞️","📞","☎️",
    "📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭",
    "⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋",
    "🪫","🔌","💡","🔦","🕯️","🪔","🧯","🛢️",
    "🛍️","💰","💴","💵","💶","💷","🪙","💸",
    "💳","🧾","💹","✉️","📧","📨","📩","📤",
    "📥","📦","📫","📬","📭","📮","🗳️","✏️",
    "✒️","🖋️","🖊️","🖌️","🖍️","📝","💼","📁",
    "📂","🗂️","📅","📆","🗒️","🗓️","📇","📈",
    "📉","📊","📋","📌","📍","📎","🖇️","📏",
    "📐","✂️","🗃️","🗄️","🗑️","🔒","🔓","🔏",
    "🔐","🔑","🗝️","🔨","🪓","⛏️","⚒️","🛠️",
    "🗡️","⚔️","💣","🪃","🏹","🛡️","🪚","🔧",
    "🪛","🔩","⚙️","🗜️","⚖️","🦯","🔗","⛓️",
    "🪝","🧰","🧲","🪜","⚗️","🧪","🧫","🧬",
    "🔬","🔭","📡","💉","🩸","💊","🩹","🩼",
    "🩺","🩻","🚪","🛗","🪞","🪟","🛏️","🛋️",
    "🪑","🚽","🪠","🚿","🛁","🪤","🪒","🧴",
    "🧷","🧹","🧺","🧻","🪣","🧼","🫧","🪥",
    "🧽","🧯","🛒","🚬","⚰️","🪦","⚱️","🧿",
    "🪬","🗿","🪧","🪪",
  ]},
  { id: "symbols", icon: "❤️", label: "Symbols", emojis: [
    "❤️","🧡","💛","💚","💙","💜","🖤","🤍",
    "🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓",
    "💗","💖","💘","💝","💟","☮️","✝️","☪️",
    "🕉️","☸️","🪯","✡️","🔯","🕎","☯️","☦️",
    "🛐","⛎","♈","♉","♊","♋","♌","♍",
    "♎","♏","♐","♑","♒","♓","🆔","⚛️",
    "🉑","☢️","☣️","📴","📳","🈶","🈚","🈸",
    "🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️",
    "🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑",
    "🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫",
    "💯","💢","♨️","🚷","🚯","🚳","🚱","🔞",
    "📵","🚭","❗","❕","❓","❔","‼️","⁉️",
    "🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰",
    "♻️","✅","🈯","💹","❇️","✳️","❎","🌐",
    "💠","Ⓜ️","🌀","💤","🏧","🚾","♿","🅿️",
    "🛗","🈳","🈂️","🛂","🛃","🛄","🛅","🚹",
    "🚺","🚼","⚧️","🚻","🚮","🎦","📶","🈁",
    "🔣","ℹ️","🔤","🔡","🔠","🆖","🆗","🆙",
    "🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣",
    "5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣",
    "*️⃣","⏏️","▶️","⏸️","⏯️","⏹️","⏺️","⏭️",
    "⏮️","⏩","⏪","⏫","⏬","◀️","🔼","🔽",
    "➡️","⬅️","⬆️","⬇️","↗️","↘️","↙️","↖️",
    "↕️","↔️","↩️","↪️","⤴️","⤵️","🔀","🔁",
    "🔂","🔄","🔃","🎵","🎶","✖️","➕","➖",
    "➗","🟰","♾️","💲","💱","™️","©️","®️",
    "〰️","➰","➿","🔚","🔙","🔛","🔝","🔜",
    "✔️","☑️","🔘","🔴","🟠","🟡","🟢","🔵",
    "🟣","⚫","⚪","🟤","🔺","🔻","🔸","🔹",
    "🔶","🔷","🔳","🔲","▪️","▫️","◾","◽",
    "◼️","◻️","🟥","🟧","🟨","🟩","🟦","🟪",
    "⬛","⬜","🟫","🔈","🔇","🔉","🔊","🔔",
    "🔕","📣","📢","👁️‍🗨️","💬","💭","🗯️","♠️",
    "♣️","♥️","♦️","🃏","🎴","🀄","🕐","🕑",
    "🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛",
  ]},
  { id: "flags", icon: "🏁", label: "Flags", emojis: [
    "🏁","🚩","🎌","🏴","🏳️","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️",
    "🇦🇨","🇦🇩","🇦🇪","🇦🇫","🇦🇬","🇦🇮","🇦🇱","🇦🇲",
    "🇦🇴","🇦🇶","🇦🇷","🇦🇸","🇦🇹","🇦🇺","🇦🇼","🇦🇽",
    "🇦🇿","🇧🇦","🇧🇧","🇧🇩","🇧🇪","🇧🇫","🇧🇬","🇧🇭",
    "🇧🇮","🇧🇯","🇧🇱","🇧🇲","🇧🇳","🇧🇴","🇧🇶","🇧🇷",
    "🇧🇸","🇧🇹","🇧🇻","🇧🇼","🇧🇾","🇧🇿","🇨🇦","🇨🇨",
    "🇨🇩","🇨🇫","🇨🇬","🇨🇭","🇨🇮","🇨🇰","🇨🇱","🇨🇲",
    "🇨🇳","🇨🇴","🇨🇵","🇨🇷","🇨🇺","🇨🇻","🇨🇼","🇨🇽",
    "🇨🇾","🇨🇿","🇩🇪","🇩🇬","🇩🇯","🇩🇰","🇩🇲","🇩🇴",
    "🇩🇿","🇪🇦","🇪🇨","🇪🇪","🇪🇬","🇪🇭","🇪🇷","🇪🇸",
    "🇪🇹","🇪🇺","🇫🇮","🇫🇯","🇫🇰","🇫🇲","🇫🇴","🇫🇷",
    "🇬🇦","🇬🇧","🇬🇩","🇬🇪","🇬🇫","🇬🇬","🇬🇭","🇬🇮",
    "🇬🇱","🇬🇲","🇬🇳","🇬🇵","🇬🇶","🇬🇷","🇬🇸","🇬🇹",
    "🇬🇺","🇬🇼","🇬🇾","🇭🇰","🇭🇲","🇭🇳","🇭🇷","🇭🇹",
    "🇭🇺","🇮🇨","🇮🇩","🇮🇪","🇮🇱","🇮🇲","🇮🇳","🇮🇴",
    "🇮🇶","🇮🇷","🇮🇸","🇮🇹","🇯🇪","🇯🇲","🇯🇴","🇯🇵",
    "🇰🇪","🇰🇬","🇰🇭","🇰🇮","🇰🇲","🇰🇳","🇰🇵","🇰🇷",
    "🇰🇼","🇰🇾","🇰🇿","🇱🇦","🇱🇧","🇱🇨","🇱🇮","🇱🇰",
    "🇱🇷","🇱🇸","🇱🇹","🇱🇺","🇱🇻","🇱🇾","🇲🇦","🇲🇨",
    "🇲🇩","🇲🇪","🇲🇫","🇲🇬","🇲🇭","🇲🇰","🇲🇱","🇲🇲",
    "🇲🇳","🇲🇴","🇲🇵","🇲🇶","🇲🇷","🇲🇸","🇲🇹","🇲🇺",
    "🇲🇻","🇲🇼","🇲🇽","🇲🇾","🇲🇿","🇳🇦","🇳🇨","🇳🇪",
    "🇳🇫","🇳🇬","🇳🇮","🇳🇱","🇳🇴","🇳🇵","🇳🇷","🇳🇺",
    "🇳🇿","🇴🇲","🇵🇦","🇵🇪","🇵🇫","🇵🇬","🇵🇭","🇵🇰",
    "🇵🇱","🇵🇲","🇵🇳","🇵🇷","🇵🇸","🇵🇹","🇵🇼","🇵🇾",
    "🇶🇦","🇷🇪","🇷🇴","🇷🇸","🇷🇺","🇷🇼","🇸🇦","🇸🇧",
    "🇸🇨","🇸🇩","🇸🇪","🇸🇬","🇸🇭","🇸🇮","🇸🇯","🇸🇰",
    "🇸🇱","🇸🇲","🇸🇳","🇸🇴","🇸🇷","🇸🇸","🇸🇹","🇸🇻",
    "🇸🇽","🇸🇾","🇸🇿","🇹🇦","🇹🇨","🇹🇩","🇹🇫","🇹🇬",
    "🇹🇭","🇹🇯","🇹🇰","🇹🇱","🇹🇲","🇹🇳","🇹🇴","🇹🇷",
    "🇹🇹","🇹🇻","🇹🇼","🇹🇿","🇺🇦","🇺🇬","🇺🇲","🇺🇳",
    "🇺🇸","🇺🇾","🇺🇿","🇻🇦","🇻🇨","🇻🇪","🇻🇬","🇻🇮",
    "🇻🇳","🇻🇺","🇼🇫","🇼🇸","🇽🇰","🇾🇪","🇾🇹","🇿🇦",
    "🇿🇲","🇿🇼",
  ]},
];

function closeProjectCtxMenu() {
  if (projectCtxMenu) {
    projectCtxMenu.remove();
    projectCtxMenu = null;
  }
}

function showIconCtxMenu(anchorEl, slug, name) {
  closeProjectCtxMenu();
  closeUserCtxMenu();
  closeEmojiPicker();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var iconItem = document.createElement("button");
  iconItem.className = "project-ctx-item";
  iconItem.innerHTML = iconHtml("smile") + " <span>Set Icon</span>";
  iconItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    showEmojiPicker(slug, anchorEl);
  });
  menu.appendChild(iconItem);

  // --- Separator ---
  var sep = document.createElement("div");
  sep.className = "project-ctx-separator";
  menu.appendChild(sep);

  // --- Remove Project ---
  var removeItem = document.createElement("button");
  removeItem.className = "project-ctx-item project-ctx-delete";
  removeItem.innerHTML = iconHtml("trash-2") + " <span>Remove Project</span>";
  removeItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "remove_project_check", slug: slug, name: name || slug }));
    }
  });
  menu.appendChild(removeItem);

  document.body.appendChild(menu);
  projectCtxMenu = menu;
  refreshIcons();

  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = (rect.right + 6) + "px";
    menu.style.top = rect.top + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 6) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });
}

function showProjectCtxMenu(anchorEl, slug, name, icon, position) {
  closeProjectCtxMenu();
  closeUserCtxMenu();
  closeEmojiPicker();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  // --- Project Settings ---
  var settingsItem = document.createElement("button");
  settingsItem.className = "project-ctx-item";
  settingsItem.innerHTML = iconHtml("settings") + " <span>Project Settings</span>";
  settingsItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    openProjectSettings(slug, { slug: slug, name: name, icon: icon, projectOwnerId: ctx.projectOwnerId });
  });
  menu.appendChild(settingsItem);

  // --- Share ---
  var shareItem = document.createElement("button");
  shareItem.className = "project-ctx-item";
  shareItem.innerHTML = iconHtml("share") + " <span>Share</span>";
  shareItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    triggerShare();
  });
  menu.appendChild(shareItem);

  // --- Separator ---
  var sep = document.createElement("div");
  sep.className = "project-ctx-separator";
  menu.appendChild(sep);

  // --- Delete ---
  var deleteItem = document.createElement("button");
  deleteItem.className = "project-ctx-item project-ctx-delete";
  deleteItem.innerHTML = iconHtml("trash-2") + " <span>Remove Project</span>";
  deleteItem.addEventListener("click", function (e) {
    e.stopPropagation();
    closeProjectCtxMenu();
    // Check for tasks/schedules first before removing
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "remove_project_check", slug: slug, name: name }));
    }
  });
  menu.appendChild(deleteItem);

  document.body.appendChild(menu);
  projectCtxMenu = menu;
  refreshIcons();

  // Position
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    if (position === "below") {
      // Chevron dropdown: directly below the anchor
      menu.style.left = rect.left + "px";
      menu.style.top = (rect.bottom + 4) + "px";
    } else {
      // Icon strip right-click: to the right of the anchor
      menu.style.left = (rect.right + 6) + "px";
      menu.style.top = rect.top + "px";
    }
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
      menu.style.left = (rect.left - menuRect.width - 6) + "px";
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
    }
  });
}

// --- Emoji picker ---
var emojiPickerEl = null;

function closeEmojiPicker() {
  if (emojiPickerEl) {
    emojiPickerEl.remove();
    emojiPickerEl = null;
  }
}

function showEmojiPicker(slug, anchorEl) {
  closeEmojiPicker();

  var picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.addEventListener("click", function (e) { e.stopPropagation(); });

  // --- Header ---
  var header = document.createElement("div");
  header.className = "emoji-picker-header";
  header.textContent = "Choose Icon";

  var removeBtn = document.createElement("button");
  removeBtn.className = "emoji-picker-remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    closeEmojiPicker();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "set_project_icon", slug: slug, icon: null }));
    }
  });
  header.appendChild(removeBtn);
  picker.appendChild(header);

  // --- Category tabs ---
  var tabBar = document.createElement("div");
  tabBar.className = "emoji-picker-tabs";
  var tabBtns = [];

  for (var t = 0; t < EMOJI_CATEGORIES.length; t++) {
    (function (cat, idx) {
      var tab = document.createElement("button");
      tab.className = "emoji-picker-tab" + (idx === 0 ? " active" : "");
      tab.textContent = cat.icon;
      tab.title = cat.label;
      tab.addEventListener("click", function (e) {
        e.stopPropagation();
        switchCategory(idx);
      });
      tabBar.appendChild(tab);
      tabBtns.push(tab);
    })(EMOJI_CATEGORIES[t], t);
  }
  parseEmojis(tabBar);
  picker.appendChild(tabBar);

  // --- Scrollable grid area ---
  var scrollArea = document.createElement("div");
  scrollArea.className = "emoji-picker-scroll";

  var grid = document.createElement("div");
  grid.className = "emoji-picker-grid";
  scrollArea.appendChild(grid);
  picker.appendChild(scrollArea);

  function buildGrid(emojis) {
    grid.innerHTML = "";
    for (var i = 0; i < emojis.length; i++) {
      (function (emoji) {
        var btn = document.createElement("button");
        btn.className = "emoji-picker-item";
        btn.textContent = emoji;
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          closeEmojiPicker();
          if (ctx.ws && ctx.connected) {
            ctx.ws.send(JSON.stringify({ type: "set_project_icon", slug: slug, icon: emoji }));
          }
        });
        grid.appendChild(btn);
      })(emojis[i]);
    }
    parseEmojis(grid);
    scrollArea.scrollTop = 0;
  }

  function switchCategory(idx) {
    for (var j = 0; j < tabBtns.length; j++) {
      tabBtns[j].classList.toggle("active", j === idx);
    }
    buildGrid(EMOJI_CATEGORIES[idx].emojis);
  }

  // Start with first category (Frequent)
  buildGrid(EMOJI_CATEGORIES[0].emojis);



  document.body.appendChild(picker);
  emojiPickerEl = picker;

  // Position
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    picker.style.left = (rect.right + 6) + "px";
    picker.style.top = rect.top + "px";
    var pRect = picker.getBoundingClientRect();
    if (pRect.right > window.innerWidth - 8) {
      picker.style.left = (rect.left - pRect.width - 6) + "px";
    }
    if (pRect.bottom > window.innerHeight - 8) {
      picker.style.top = (window.innerHeight - pRect.height - 8) + "px";
    }
  });
}

// --- Rename prompt ---
function showProjectRename(slug, currentName) {
  var nameEl = document.getElementById("title-bar-project-name");
  if (!nameEl) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "project-rename-input";
  input.value = currentName || "";

  var originalText = nameEl.textContent;
  nameEl.textContent = "";
  nameEl.appendChild(input);
  input.focus();
  input.select();

  var committed = false;

  function commitRename() {
    if (committed) return;
    committed = true;
    var newName = input.value.trim();
    if (newName && newName !== currentName && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "set_project_title", slug: slug, title: newName }));
      nameEl.textContent = newName;
    } else {
      nameEl.textContent = originalText;
    }
  }

  input.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); committed = true; nameEl.textContent = originalText; }
  });
  input.addEventListener("blur", commitRename);
  input.addEventListener("click", function (e) { e.stopPropagation(); });
}

// Click outside to close
document.addEventListener("click", function () {
  closeProjectCtxMenu();
  closeEmojiPicker();
});

// --- Drag-and-drop state ---
var draggedSlug = null;
var draggedEl = null;

function showTrashZone() {
  var addBtn = document.getElementById("icon-strip-add");
  if (!addBtn) return;
  addBtn.style.display = "none";

  var existing = document.getElementById("icon-strip-trash");
  if (existing) existing.remove();

  var trash = document.createElement("div");
  trash.id = "icon-strip-trash";
  trash.className = "icon-strip-trash";
  trash.innerHTML = iconHtml("trash-2");
  addBtn.parentNode.insertBefore(trash, addBtn.nextSibling);
  refreshIcons();

  // Tooltip
  trash.addEventListener("mouseenter", function () { showIconTooltip(trash, "Remove project"); });
  trash.addEventListener("mouseleave", hideIconTooltip);

  trash.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    trash.classList.add("drag-hover");
  });
  trash.addEventListener("dragleave", function () {
    trash.classList.remove("drag-hover");
  });
  trash.addEventListener("drop", function (e) {
    e.preventDefault();
    trash.classList.remove("drag-hover");
    var slug = e.dataTransfer.getData("text/plain");
    if (slug && ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "remove_project_check", slug: slug }));
    }
  });
}

function hideTrashZone() {
  var trash = document.getElementById("icon-strip-trash");
  if (trash) trash.remove();
  var addBtn = document.getElementById("icon-strip-add");
  if (addBtn) addBtn.style.display = "";
}

export function spawnDustParticles(cx, cy) {
  var colors = ["#8B7355", "#A0522D", "#D2B48C", "#C4A882", "#9E9E9E", "#B8860B", "#BC8F8F"];
  var count = 24;
  var container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "0";
  container.style.height = "0";
  container.style.pointerEvents = "none";
  container.style.zIndex = "10000";
  document.body.appendChild(container);

  for (var i = 0; i < count; i++) {
    var dot = document.createElement("div");
    dot.className = "dust-particle";
    var size = 3 + Math.random() * 5;
    var angle = Math.random() * Math.PI * 2;
    var dist = 30 + Math.random() * 60;
    var dx = Math.cos(angle) * dist;
    var dy = Math.sin(angle) * dist - 20; // bias upward
    var duration = 600 + Math.random() * 500;

    dot.style.width = size + "px";
    dot.style.height = size + "px";
    dot.style.left = cx + "px";
    dot.style.top = cy + "px";
    dot.style.background = colors[Math.floor(Math.random() * colors.length)];
    dot.style.setProperty("--dust-x", dx + "px");
    dot.style.setProperty("--dust-y", dy + "px");
    dot.style.setProperty("--dust-duration", duration + "ms");

    container.appendChild(dot);
  }

  setTimeout(function () { container.remove(); }, 1200);
}

function clearDragIndicators() {
  var items = document.querySelectorAll(".icon-strip-item.drag-over-above, .icon-strip-item.drag-over-below");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove("drag-over-above", "drag-over-below");
  }
}

function setupDragHandlers(el, slug) {
  el.setAttribute("draggable", "true");

  el.addEventListener("dragstart", function (e) {
    draggedSlug = slug;
    draggedEl = el;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", slug);

    // Custom drag image — just the 38px rounded icon, no pill/status
    var ghost = document.createElement("div");
    ghost.textContent = el.textContent.trim().split("\n")[0]; // abbreviation only
    ghost.style.cssText = "position:fixed;left:-200px;top:-200px;width:38px;height:38px;border-radius:12px;" +
      "background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;" +
      "font-size:15px;font-weight:600;pointer-events:none;z-index:-1;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 19, 19);
    setTimeout(function () { ghost.remove(); }, 0);

    setTimeout(function () { el.classList.add("dragging"); }, 0);
    hideIconTooltip();
    showTrashZone();
  });

  el.addEventListener("dragover", function (e) {
    e.preventDefault();
    if (!draggedSlug || draggedSlug === slug) return;
    e.dataTransfer.dropEffect = "move";

    clearDragIndicators();
    var rect = el.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      el.classList.add("drag-over-above");
    } else {
      el.classList.add("drag-over-below");
    }
  });

  el.addEventListener("dragleave", function () {
    el.classList.remove("drag-over-above", "drag-over-below");
  });

  el.addEventListener("drop", function (e) {
    e.preventDefault();
    clearDragIndicators();
    if (!draggedSlug || draggedSlug === slug) return;

    var rect = el.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    var insertBefore = e.clientY < midY;

    // Build new slug order
    var container = document.getElementById("icon-strip-projects");
    var items = container.querySelectorAll(".icon-strip-item");
    var slugs = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].dataset.slug !== draggedSlug) {
        slugs.push(items[i].dataset.slug);
      }
    }
    // Insert dragged slug at correct position
    var targetIdx = slugs.indexOf(slug);
    if (!insertBefore) targetIdx++;
    slugs.splice(targetIdx, 0, draggedSlug);

    // Send reorder to server
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "reorder_projects", slugs: slugs }));
    }
  });

  el.addEventListener("dragend", function () {
    el.classList.remove("dragging");
    clearDragIndicators();
    draggedSlug = null;
    draggedEl = null;
    hideTrashZone();
  });
}

export function renderSidebarPresence(onlineUsers) {
  var container = document.getElementById("sidebar-presence");
  if (!container) return;
  container.innerHTML = "";
  if (!onlineUsers || onlineUsers.length < 2) return;
  var maxShow = 4;
  for (var i = 0; i < Math.min(onlineUsers.length, maxShow); i++) {
    var ou = onlineUsers[i];
    var img = document.createElement("img");
    img.className = "sidebar-presence-avatar";
    img.src = presenceAvatarUrl(ou.avatarStyle, ou.avatarSeed);
    img.alt = ou.displayName;
    img.dataset.tip = ou.displayName + " (@" + ou.username + ")";
    container.appendChild(img);
  }
  if (onlineUsers.length > maxShow) {
    var more = document.createElement("span");
    more.className = "sidebar-presence-more";
    more.textContent = "+" + (onlineUsers.length - maxShow);
    container.appendChild(more);
  }
}

export function renderIconStrip(projects, currentSlug) {
  // Cache for mobile sheet
  cachedProjectList = projects;
  cachedCurrentSlug = currentSlug;

  var container = document.getElementById("icon-strip-projects");
  if (!container) return;
  container.innerHTML = "";

  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    var el = document.createElement("a");
    var isActive = p.slug === currentSlug && !currentDmUserId;
    el.className = "icon-strip-item" + (isActive ? " active" : "");
    el.href = "/p/" + p.slug + "/";
    el.dataset.slug = p.slug;

    // Icon: twemoji or abbreviation
    if (p.icon) {
      var emojiSpan = document.createElement("span");
      emojiSpan.className = "project-emoji";
      emojiSpan.textContent = p.icon;
      parseEmojis(emojiSpan);
      el.appendChild(emojiSpan);
    } else {
      el.appendChild(document.createTextNode(getProjectAbbrev(p.name)));
    }

    var pill = document.createElement("span");
    pill.className = "icon-strip-pill";
    el.appendChild(pill);

    // Socket status indicator dot (bottom-right)
    var statusDot = document.createElement("span");
    statusDot.className = "icon-strip-status";
    if (p.isProcessing) statusDot.classList.add("processing");
    el.appendChild(statusDot);

    // Unread badge (top-right)
    var projectBadge = document.createElement("span");
    projectBadge.className = "icon-strip-project-badge";
    if (p.unread > 0 && !isActive) {
      projectBadge.textContent = p.unread > 99 ? "99+" : String(p.unread);
      projectBadge.classList.add("has-unread");
    }
    el.appendChild(projectBadge);

    // Tooltip on hover
    (function (name, elem) {
      elem.addEventListener("mouseenter", function () { showIconTooltip(elem, name); });
      elem.addEventListener("mouseleave", hideIconTooltip);
    })(p.name, el);

    // Click handler — switch to project (no reload)
    (function (slug) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        if (ctx.switchProject) ctx.switchProject(slug);
      });
    })(p.slug);

    // Right-click context menu (icon only)
    (function (slug, name, elem) {
      elem.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showIconCtxMenu(elem, slug, name);
      });
    })(p.slug, p.name || p.slug, el);

    // Drag-and-drop reordering
    setupDragHandlers(el, p.slug);

    container.appendChild(el);
  }

  // Update home icon active state
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) {
    if ((!currentSlug || projects.length === 0) && !currentDmUserId) {
      homeIcon.classList.add("active");
    } else {
      homeIcon.classList.remove("active");
    }
  }

  // Also update mobile project list
  renderProjectList(projects, currentSlug);
}

function renderProjectList(projects, currentSlug) {
  var list = document.getElementById("project-list");
  if (!list) return;
  list.innerHTML = "";

  for (var i = 0; i < projects.length; i++) {
    (function (p) {
      var el = document.createElement("button");
      el.className = "mobile-project-item" + (p.slug === currentSlug ? " active" : "");

      var abbrev = document.createElement("span");
      abbrev.className = "mobile-project-abbrev";
      abbrev.textContent = getProjectAbbrev(p.name);
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

      el.addEventListener("click", function () {
        if (ctx.switchProject) ctx.switchProject(p.slug);
        closeSidebar();
      });

      list.appendChild(el);
    })(projects[i]);
  }
}

export function getEmojiCategories() { return EMOJI_CATEGORIES; }

// --- User strip (DM targets) ---
var cachedAllUsers = [];
var cachedOnlineUserIds = [];
var cachedDmFavorites = [];
var cachedDmConversations = [];
var cachedDmUnread = {};
var cachedMyUserId = null;
var currentDmUserId = null;
var dmPickerOpen = false;

var cachedDmRemovedUsers = {};

export function renderUserStrip(allUsers, onlineUserIds, myUserId, dmFavorites, dmConversations, dmUnread, dmRemovedUsers) {
  cachedAllUsers = allUsers || [];
  cachedOnlineUserIds = onlineUserIds || [];
  cachedDmFavorites = dmFavorites || [];
  cachedDmConversations = dmConversations || [];
  cachedDmUnread = dmUnread || {};
  cachedDmRemovedUsers = dmRemovedUsers || {};
  cachedMyUserId = myUserId;
  var container = document.getElementById("icon-strip-users");
  if (!container) return;

  // All other users
  var allOthers = cachedAllUsers.filter(function (u) { return u.id !== myUserId; });

  // Hide section if no other users (single-user mode or alone)
  if (allOthers.length === 0) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }

  // Filter to show only: favorites + users with unread + users with DM conversations
  // But exclude users explicitly removed from favorites
  var others = allOthers.filter(function (u) {
    if (cachedDmRemovedUsers[u.id]) return false;
    if (cachedDmFavorites.indexOf(u.id) !== -1) return true;
    if (cachedDmUnread[u.id] && cachedDmUnread[u.id] > 0) return true;
    if (cachedDmConversations.indexOf(u.id) !== -1) return true;
    return false;
  });

  container.classList.remove("hidden");
  container.innerHTML = "";

  for (var i = 0; i < others.length; i++) {
    (function (u) {
      var el = document.createElement("div");
      el.className = "icon-strip-user";
      el.dataset.userId = u.id;
      if (u.id === currentDmUserId) el.classList.add("active");
      if (onlineUserIds.indexOf(u.id) !== -1) el.classList.add("online");

      var pill = document.createElement("span");
      pill.className = "icon-strip-pill";
      el.appendChild(pill);

      var avatar = document.createElement("img");
      avatar.className = "icon-strip-user-avatar";
      avatar.src = "https://api.dicebear.com/9.x/" + (u.avatarStyle || "thumbs") + "/svg?seed=" + encodeURIComponent(u.avatarSeed || u.username) + "&size=34";
      avatar.alt = u.displayName;
      el.appendChild(avatar);

      var onlineDot = document.createElement("span");
      onlineDot.className = "icon-strip-user-online";
      el.appendChild(onlineDot);

      var badge = document.createElement("span");
      badge.className = "icon-strip-user-badge";
      badge.dataset.userId = u.id;
      el.appendChild(badge);

      // Tooltip
      el.addEventListener("mouseenter", function () { showIconTooltip(el, u.displayName); });
      el.addEventListener("mouseleave", hideIconTooltip);

      // Click: open DM
      el.addEventListener("click", function () {
        if (ctx.openDm) ctx.openDm(u.id);
      });

      // Right-click: show context menu
      el.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showUserCtxMenu(el, u);
      });

      container.appendChild(el);
    })(others[i]);
  }

  // Add user (+) button
  var addBtn = document.createElement("button");
  addBtn.className = "icon-strip-invite";
  addBtn.innerHTML = iconHtml("user-plus");
  addBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleDmUserPicker(addBtn);
  });
  addBtn.addEventListener("mouseenter", function () { showIconTooltip(addBtn, "Add DM favorite"); });
  addBtn.addEventListener("mouseleave", hideIconTooltip);
  container.appendChild(addBtn);
  refreshIcons();
}

function toggleDmUserPicker(anchorEl) {
  if (dmPickerOpen) {
    closeDmUserPicker();
    return;
  }
  dmPickerOpen = true;

  var picker = document.createElement("div");
  picker.className = "dm-user-picker";
  picker.id = "dm-user-picker";

  // Search input
  var searchInput = document.createElement("input");
  searchInput.className = "dm-user-picker-search";
  searchInput.type = "text";
  searchInput.placeholder = "Search users...";
  picker.appendChild(searchInput);

  // Scrollable list
  var listEl = document.createElement("div");
  listEl.className = "dm-user-picker-list";
  picker.appendChild(listEl);

  // Position the picker above the + button
  document.body.appendChild(picker);
  var rect = anchorEl.getBoundingClientRect();
  picker.style.left = (rect.right + 8) + "px";
  picker.style.bottom = (window.innerHeight - rect.bottom) + "px";

  function renderPickerList(filter) {
    listEl.innerHTML = "";
    var allOthers = cachedAllUsers.filter(function (u) { return u.id !== cachedMyUserId; });
    // Exclude already-favorited users
    var available = allOthers.filter(function (u) {
      return cachedDmFavorites.indexOf(u.id) === -1;
    });
    if (filter) {
      var lf = filter.toLowerCase();
      available = available.filter(function (u) {
        return (u.displayName && u.displayName.toLowerCase().indexOf(lf) !== -1) ||
               (u.username && u.username.toLowerCase().indexOf(lf) !== -1);
      });
    }
    if (available.length === 0) {
      var emptyEl = document.createElement("div");
      emptyEl.className = "dm-user-picker-empty";
      emptyEl.textContent = filter ? "No users found" : "No more users to add";
      listEl.appendChild(emptyEl);
      return;
    }
    for (var i = 0; i < available.length; i++) {
      (function (u) {
        var item = document.createElement("div");
        item.className = "dm-user-picker-item";

        var av = document.createElement("img");
        av.className = "dm-user-picker-avatar";
        av.src = "https://api.dicebear.com/9.x/" + (u.avatarStyle || "thumbs") + "/svg?seed=" + encodeURIComponent(u.avatarSeed || u.username) + "&size=28";
        av.alt = u.displayName;
        item.appendChild(av);

        var name = document.createElement("span");
        name.className = "dm-user-picker-name";
        name.textContent = u.displayName;
        item.appendChild(name);

        item.addEventListener("click", function () {
          if (ctx.sendWs) {
            ctx.sendWs({ type: "dm_add_favorite", targetUserId: u.id });
          }
          closeDmUserPicker();
        });

        listEl.appendChild(item);
      })(available[i]);
    }
  }

  renderPickerList("");
  searchInput.addEventListener("input", function () {
    renderPickerList(searchInput.value);
  });

  // Focus search
  setTimeout(function () { searchInput.focus(); }, 50);

  // Close on click outside
  function onDocClick(e) {
    if (!picker.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
      closeDmUserPicker();
      document.removeEventListener("click", onDocClick, true);
    }
  }
  setTimeout(function () {
    document.addEventListener("click", onDocClick, true);
  }, 10);
  picker._docClickHandler = onDocClick;
}

export function closeDmUserPicker() {
  dmPickerOpen = false;
  var picker = document.getElementById("dm-user-picker");
  if (picker) {
    if (picker._docClickHandler) {
      document.removeEventListener("click", picker._docClickHandler, true);
    }
    picker.remove();
  }
}

export function setCurrentDmUser(userId) {
  currentDmUserId = userId;
  // Update active state on user icons immediately
  var container = document.getElementById("icon-strip-users");
  if (!container) return;
  var items = container.querySelectorAll(".icon-strip-user");
  for (var i = 0; i < items.length; i++) {
    if (items[i].dataset.userId === userId) {
      items[i].classList.add("active");
    } else {
      items[i].classList.remove("active");
    }
  }
}

export function updateDmBadge(userId, count) {
  var badge = document.querySelector('.icon-strip-user-badge[data-user-id="' + userId + '"]');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

export function updateSessionBadge(sessionId, count) {
  var badge = document.querySelector('.session-unread-badge[data-session-id="' + sessionId + '"]');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

export function updateProjectBadge(slug, count) {
  var icon = document.querySelector('.icon-strip-item[data-slug="' + slug + '"]');
  if (!icon) return;
  var badge = icon.querySelector(".icon-strip-project-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

export function initIconStrip(_ctx) {
  var addBtn = document.getElementById("icon-strip-add");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      if (_ctx.openAddProjectModal) {
        _ctx.openAddProjectModal();
      } else {
        var modal = _ctx.$("add-project-modal");
        if (modal) modal.classList.remove("hidden");
      }
    });
    addBtn.addEventListener("mouseenter", function () { showIconTooltip(addBtn, "Add project"); });
    addBtn.addEventListener("mouseleave", hideIconTooltip);
  }

  var exploreBtn = document.getElementById("icon-strip-explore");
  if (exploreBtn) {
    exploreBtn.addEventListener("click", function () {
      // Toggle file browser
      var fileBrowserBtn = _ctx.$("file-browser-btn");
      if (fileBrowserBtn) fileBrowserBtn.click();
    });
    exploreBtn.addEventListener("mouseenter", function () { showIconTooltip(exploreBtn, "File browser"); });
    exploreBtn.addEventListener("mouseleave", hideIconTooltip);
  }

  // Tooltip + click for home icon
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) {
    homeIcon.addEventListener("mouseenter", function () { showIconTooltip(homeIcon, "Clay"); });
    homeIcon.addEventListener("mouseleave", hideIconTooltip);
    homeIcon.addEventListener("click", function (e) {
      e.preventDefault();
      if (_ctx.showHomeHub) _ctx.showHomeHub();
    });
    homeIcon.style.cursor = "pointer";
  }

  // Chevron dropdown on project name
  var dropdownBtn = document.getElementById("title-bar-project-dropdown");
  if (dropdownBtn) {
    dropdownBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      // Find current project info from cached list
      var current = null;
      for (var i = 0; i < cachedProjectList.length; i++) {
        if (cachedProjectList[i].slug === cachedCurrentSlug) {
          current = cachedProjectList[i];
          break;
        }
      }
      if (!current) return;

      // Toggle open state
      if (projectCtxMenu) {
        closeProjectCtxMenu();
        dropdownBtn.classList.remove("open");
        return;
      }
      dropdownBtn.classList.add("open");
      showProjectCtxMenu(dropdownBtn, current.slug, current.name, current.icon, "below");
      // Remove open class when menu closes
      var observer = new MutationObserver(function () {
        if (!projectCtxMenu) {
          dropdownBtn.classList.remove("open");
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true });
    });
  }
}
