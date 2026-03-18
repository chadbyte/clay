import { escapeHtml, copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { openProjectSettings } from './project-settings.js';
import { triggerShare } from './qrcode.js';
import { parseEmojis } from './markdown.js';

var ctx;

// --- Agent status tracking ---
var sessionStatusMap = {}; // { sessionId: "idle" | "working" | "waiting_permission" | "waiting_input" | "done" | "errored" }

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
    return function (e) {
      if (e.shiftKey && ctx.openSessionInNewPane) {
        ctx.openSessionInNewPane(id);
      } else if (ctx.switchSessionInFocusedPane) {
        ctx.switchSessionInFocusedPane(id);
      } else if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
      closeSidebar();
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
    return function (e) {
      if (e.shiftKey && ctx.openSessionInNewPane) {
        ctx.openSessionInNewPane(id);
      } else if (ctx.switchSessionInFocusedPane) {
        ctx.switchSessionInFocusedPane(id);
      } else if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
      closeSidebar();
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
  // Agent status dot
  var agentStatus = sessionStatusMap[s.id] || "idle";
  var statusDot = createStatusDot(agentStatus);
  if (statusDot) el.insertBefore(statusDot, moreBtn);
  if (agentStatus === "waiting_permission" || agentStatus === "waiting_input") {
    el.classList.add("session-needs-attention");
  }

  el.appendChild(moreBtn);

  el.addEventListener("click", (function (id) {
    return function (e) {
      if (e.shiftKey && ctx.openSessionInNewPane) {
        ctx.openSessionInNewPane(id);
      } else if (ctx.switchSessionInFocusedPane) {
        ctx.switchSessionInFocusedPane(id);
      } else if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
      closeSidebar();
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

export function updateAgentStatus(sessionId, status) {
  sessionStatusMap[sessionId] = status;
  // Update the status dot on the session item without full re-render
  var item = ctx.sessionListEl.querySelector('[data-session-id="' + sessionId + '"]');
  if (item) {
    var existingDot = item.querySelector(".agent-status-dot");
    if (existingDot) existingDot.remove();
    var dot = createStatusDot(status);
    if (dot) {
      // Insert before the more button
      var moreBtn = item.querySelector(".session-more-btn");
      if (moreBtn) {
        item.insertBefore(dot, moreBtn);
      } else {
        item.appendChild(dot);
      }
    }
    // Toggle attention class
    var needsAttention = status === "waiting_permission" || status === "waiting_input";
    item.classList.toggle("session-needs-attention", needsAttention);
  }
}

export function getAttentionSessionIds() {
  var ids = [];
  var keys = Object.keys(sessionStatusMap);
  for (var i = 0; i < keys.length; i++) {
    var s = sessionStatusMap[keys[i]];
    if (s === "waiting_permission" || s === "waiting_input") {
      ids.push(parseInt(keys[i], 10));
    }
  }
  return ids;
}

function createStatusDot(status) {
  if (status === "idle") return null;
  var dot = document.createElement("span");
  dot.className = "agent-status-dot agent-status-" + status;
  dot.title = status.replace(/_/g, " ");
  return dot;
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

function showIconCtxMenu(anchorEl, slug) {
  closeProjectCtxMenu();
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
    openProjectSettings(slug, { slug: slug, name: name, icon: icon });
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
      // Spawn dust particles at trash position
      var rect = trash.getBoundingClientRect();
      spawnDustParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
      // Check for tasks before removing
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

function spawnDustParticles(cx, cy) {
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

// Persist folder collapse state
var collapsedFolders = {};
try {
  collapsedFolders = JSON.parse(localStorage.getItem("clay-collapsed-folders") || "{}");
} catch (e) {}
function setFolderCollapsed(slug, collapsed) {
  collapsedFolders[slug] = collapsed;
  try { localStorage.setItem("clay-collapsed-folders", JSON.stringify(collapsedFolders)); } catch (e) {}
}

function groupByParent(projects) {
  var parents = [];
  var worktreesByParent = {};
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    if (p.parentSlug) {
      if (!worktreesByParent[p.parentSlug]) worktreesByParent[p.parentSlug] = [];
      worktreesByParent[p.parentSlug].push(p);
    } else {
      parents.push(p);
    }
  }
  return { parents: parents, worktreesByParent: worktreesByParent };
}

function renderIconItem(p, currentSlug, isWorktree) {
  var el = document.createElement("a");
  var isActive = p.slug === currentSlug && !currentDmUserId;
  el.className = "icon-strip-item" + (isActive ? " active" : "") + (isWorktree ? " worktree" : "");
  el.href = "/p/" + p.slug + "/";
  el.dataset.slug = p.slug;

  if (isWorktree) {
    var branchName = p.name;
    var branchMatch = p.name.match(/\(([^)]+)\)$/);
    if (branchMatch) branchName = branchMatch[1];
    var branchAbbrev = document.createElement("span");
    branchAbbrev.className = "worktree-branch-abbrev";
    branchAbbrev.textContent = getProjectAbbrev(branchName);
    el.appendChild(branchAbbrev);
  } else if (p.icon) {
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

  var statusDot = document.createElement("span");
  statusDot.className = "icon-strip-status";
  if (p.isProcessing) statusDot.classList.add("processing");
  el.appendChild(statusDot);

  (function (name, elem) {
    elem.addEventListener("mouseenter", function () { showIconTooltip(elem, name); });
    elem.addEventListener("mouseleave", hideIconTooltip);
  })(p.name, el);

  (function (slug) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      if (ctx.switchProject) ctx.switchProject(slug);
    });
  })(p.slug);

  return el;
}

export function renderIconStrip(projects, currentSlug) {
  cachedProjectList = projects;
  cachedCurrentSlug = currentSlug;

  var container = document.getElementById("icon-strip-projects");
  if (!container) return;
  container.innerHTML = "";

  var grouped = groupByParent(projects);

  for (var i = 0; i < grouped.parents.length; i++) {
    var p = grouped.parents[i];
    var worktrees = grouped.worktreesByParent[p.slug] || [];
    var hasWorktrees = worktrees.length > 0;

    if (!hasWorktrees) {
      // Regular project — no folder
      var el = renderIconItem(p, currentSlug, false);
      (function (slug, elem) {
        elem.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          e.stopPropagation();
          showIconCtxMenu(elem, slug);
        });
      })(p.slug, el);
      setupDragHandlers(el, p.slug);
      container.appendChild(el);
      continue;
    }

    // Folder container for parent + worktrees
    var folder = document.createElement("div");
    folder.className = "icon-strip-folder";
    folder.dataset.parentSlug = p.slug;
    var isCollapsed = !!collapsedFolders[p.slug];
    if (isCollapsed) folder.classList.add("collapsed");

    // Check if any worktree (or parent) is active
    var anyActive = (p.slug === currentSlug);
    for (var ai = 0; ai < worktrees.length; ai++) {
      if (worktrees[ai].slug === currentSlug) anyActive = true;
    }

    // Folder header = parent project icon (clickable to open Clay for parent dir)
    var header = renderIconItem(p, currentSlug, false);
    header.classList.add("folder-header");
    if (anyActive && p.slug !== currentSlug) header.classList.add("folder-active");

    // Collapse/expand chevron
    var chevron = document.createElement("span");
    chevron.className = "folder-chevron";
    chevron.innerHTML = "&#9660;";
    (function (parentSlug, folderEl, chevronEl) {
      chevronEl.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var nowCollapsed = folderEl.classList.toggle("collapsed");
        setFolderCollapsed(parentSlug, nowCollapsed);
      });
    })(p.slug, folder, chevron);
    header.appendChild(chevron);

    // Context menu on header
    (function (slug, elem) {
      elem.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showIconCtxMenu(elem, slug);
      });
    })(p.slug, header);

    setupDragHandlers(header, p.slug);
    folder.appendChild(header);

    // Worktree items container
    var wtContainer = document.createElement("div");
    wtContainer.className = "folder-worktrees";

    for (var wi = 0; wi < worktrees.length; wi++) {
      var wtEl = renderIconItem(worktrees[wi], currentSlug, true);
      wtContainer.appendChild(wtEl);
    }

    // Plus button to create new worktree
    var addBtn = document.createElement("button");
    addBtn.className = "folder-add-worktree";
    addBtn.innerHTML = "+";
    (function (parentSlug, parentName, btnEl) {
      btnEl.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showCreateWorktreeModal(parentSlug, parentName);
      });
      btnEl.addEventListener("mouseenter", function () { showIconTooltip(btnEl, "New worktree"); });
      btnEl.addEventListener("mouseleave", hideIconTooltip);
    })(p.slug, p.name, addBtn);
    wtContainer.appendChild(addBtn);

    folder.appendChild(wtContainer);
    container.appendChild(folder);
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

  renderProjectList(projects, currentSlug);
}

function showCreateWorktreeModal(parentSlug, parentName) {
  // Remove any existing modal
  var existing = document.getElementById("create-worktree-modal");
  if (existing) existing.remove();

  var modal = document.createElement("div");
  modal.id = "create-worktree-modal";
  modal.className = "create-worktree-modal";

  var backdrop = document.createElement("div");
  backdrop.className = "confirm-backdrop";
  modal.appendChild(backdrop);

  var dialog = document.createElement("div");
  dialog.className = "confirm-dialog create-worktree-dialog";

  var title = document.createElement("div");
  title.className = "add-project-title";
  title.textContent = "New worktree — " + parentName;
  dialog.appendChild(title);

  var body = document.createElement("div");
  body.className = "add-project-body";

  var branchLabel = document.createElement("label");
  branchLabel.textContent = "Branch name";
  branchLabel.className = "create-worktree-label";
  body.appendChild(branchLabel);

  var branchInput = document.createElement("input");
  branchInput.type = "text";
  branchInput.id = "create-worktree-branch";
  branchInput.placeholder = "feat/my-feature";
  branchInput.autocomplete = "off";
  branchInput.spellcheck = false;
  branchInput.className = "create-worktree-input";
  body.appendChild(branchInput);

  var baseLabel = document.createElement("label");
  baseLabel.textContent = "Base branch";
  baseLabel.className = "create-worktree-label";
  body.appendChild(baseLabel);

  var baseInput = document.createElement("input");
  baseInput.type = "text";
  baseInput.id = "create-worktree-base";
  baseInput.placeholder = "develop";
  baseInput.value = "develop";
  baseInput.autocomplete = "off";
  baseInput.spellcheck = false;
  baseInput.className = "create-worktree-input";
  body.appendChild(baseInput);

  var errorDiv = document.createElement("div");
  errorDiv.className = "create-worktree-error hidden";
  body.appendChild(errorDiv);

  dialog.appendChild(body);

  var actions = document.createElement("div");
  actions.className = "confirm-actions";

  var cancelBtn = document.createElement("button");
  cancelBtn.className = "confirm-btn confirm-cancel";
  cancelBtn.textContent = "Cancel";
  actions.appendChild(cancelBtn);

  var createBtn = document.createElement("button");
  createBtn.className = "confirm-btn confirm-ok";
  createBtn.textContent = "Create";
  actions.appendChild(createBtn);

  dialog.appendChild(actions);
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  branchInput.focus();

  function closeModal() { modal.remove(); }

  function doCreate() {
    var branch = branchInput.value.trim();
    var base = baseInput.value.trim() || "develop";
    if (!branch) {
      errorDiv.textContent = "Branch name is required";
      errorDiv.classList.remove("hidden");
      return;
    }
    // Sanitize: use last segment as the worktree dir name
    var dirName = branch.replace(/\//g, "-");
    createBtn.disabled = true;
    createBtn.textContent = "Creating...";
    ctx.ws.send(JSON.stringify({
      type: "create_worktree",
      parentSlug: parentSlug,
      branchName: dirName,
      baseBranch: base
    }));
    // Listen for response
    var handler = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "create_worktree_result") {
        ctx.ws.removeEventListener("message", handler);
        if (msg.ok) {
          closeModal();
          if (msg.slug && ctx.switchProject) ctx.switchProject(msg.slug);
        } else {
          createBtn.disabled = false;
          createBtn.textContent = "Create";
          errorDiv.textContent = msg.error || "Failed to create worktree";
          errorDiv.classList.remove("hidden");
        }
      }
    };
    ctx.ws.addEventListener("message", handler);
  }

  backdrop.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  createBtn.addEventListener("click", doCreate);
  branchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") doCreate();
    if (e.key === "Escape") closeModal();
  });
  baseInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") doCreate();
    if (e.key === "Escape") closeModal();
  });
}

function renderMobileProjectItem(p, currentSlug, isWorktree) {
  var el = document.createElement("button");
  el.className = "mobile-project-item" + (p.slug === currentSlug ? " active" : "") + (isWorktree ? " worktree" : "");

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

  return el;
}

function renderProjectList(projects, currentSlug) {
  var list = document.getElementById("project-list");
  if (!list) return;
  list.innerHTML = "";

  var grouped = groupByParent(projects);

  for (var i = 0; i < grouped.parents.length; i++) {
    var p = grouped.parents[i];
    var worktrees = grouped.worktreesByParent[p.slug] || [];

    if (worktrees.length === 0) {
      list.appendChild(renderMobileProjectItem(p, currentSlug, false));
      continue;
    }

    // Folder header
    var folderDiv = document.createElement("div");
    folderDiv.className = "mobile-project-folder";
    var isCollapsed = !!collapsedFolders[p.slug];
    if (isCollapsed) folderDiv.classList.add("collapsed");

    var headerEl = renderMobileProjectItem(p, currentSlug, false);
    headerEl.classList.add("folder-header");

    var chevron = document.createElement("span");
    chevron.className = "mobile-folder-chevron";
    chevron.innerHTML = "&#9660;";
    (function (parentSlug, folderEl) {
      chevron.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var nowCollapsed = folderEl.classList.toggle("collapsed");
        setFolderCollapsed(parentSlug, nowCollapsed);
      });
    })(p.slug, folderDiv);
    headerEl.appendChild(chevron);
    folderDiv.appendChild(headerEl);

    var wtList = document.createElement("div");
    wtList.className = "mobile-folder-worktrees";
    for (var wi = 0; wi < worktrees.length; wi++) {
      wtList.appendChild(renderMobileProjectItem(worktrees[wi], currentSlug, true));
    }
    folderDiv.appendChild(wtList);
    list.appendChild(folderDiv);
  }
}

export function getEmojiCategories() { return EMOJI_CATEGORIES; }

// --- User strip (DM targets) ---
var cachedAllUsers = [];
var cachedOnlineUserIds = [];
var currentDmUserId = null;

export function renderUserStrip(allUsers, onlineUserIds, myUserId) {
  cachedAllUsers = allUsers || [];
  cachedOnlineUserIds = onlineUserIds || [];
  var container = document.getElementById("icon-strip-users");
  if (!container) return;

  // Filter out self, only show other users
  var others = cachedAllUsers.filter(function (u) { return u.id !== myUserId; });

  // Hide section if no other users (single-user mode or alone)
  if (others.length === 0) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }

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

      container.appendChild(el);
    })(others[i]);
  }

  // Invite button at bottom of user strip
  var inviteBtn = document.createElement("button");
  inviteBtn.className = "icon-strip-invite";
  inviteBtn.innerHTML = iconHtml("user-plus");
  inviteBtn.addEventListener("click", function () { triggerShare(); });
  inviteBtn.addEventListener("mouseenter", function () { showIconTooltip(inviteBtn, "Invite"); });
  inviteBtn.addEventListener("mouseleave", hideIconTooltip);
  container.appendChild(inviteBtn);
  refreshIcons();
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

export function initIconStrip(_ctx) {
  var addBtn = document.getElementById("icon-strip-add");
  if (addBtn) {
    addBtn.addEventListener("click", function () {
      var modal = _ctx.$("add-project-modal");
      if (modal) modal.classList.remove("hidden");
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
