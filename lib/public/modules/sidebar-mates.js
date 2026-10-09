// sidebar-mates.js - User/mate strip, DM picker, context menus, tooltips, presence
// Extracted from sidebar.js (PR-37)

import { userAvatarUrl } from './avatar.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { closeProjectCtxMenu } from './sidebar-projects.js';
import { spawnDustParticles } from './sidebar.js';
import { openDm } from './app-dm.js';
import { showMateManagementMenu, closeMateManagementMenu } from './mate-management.js';
import { showIconTooltip, hideIconTooltip } from './icon-strip-tooltip.js';

export { showIconTooltip, showIconTooltipHtml, hideIconTooltip, bindIconTooltip } from './icon-strip-tooltip.js';

function sendWs(msg) {
  var ws = getWs();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// --- User strip state ---
var cachedAllUsers = [];
var cachedOnlineUserIds = [];
var cachedDmFavorites = [];
var cachedDmConversations = [];
var cachedDmUnread = {};
var cachedMyUserId = null;
var currentDmUserId = null;
var dmPickerOpen = false;
var cachedDmRemovedUsers = {};
var cachedMates = [];
var activeMentionMateIds = {};

export function getActiveMentionMateIds() {
  return activeMentionMateIds;
}

export function setMentionActive(mateId, active) {
  if (active) { activeMentionMateIds[mateId] = true; }
  else { delete activeMentionMateIds[mateId]; }
  notifyMentionListeners();
}

export function clearAllMentionActive() {
  activeMentionMateIds = {};
  notifyMentionListeners();
}

// Mates render on the home hub now, so their mention state has to reach a
// renderer that no longer owns it. Listeners are registered by app.js.
var mentionListeners = [];

export function onMentionActiveChange(listener) {
  mentionListeners.push(listener);
}

function notifyMentionListeners() {
  for (var i = 0; i < mentionListeners.length; i++) {
    try { mentionListeners[i](); } catch (e) { /* listener must not break the strip */ }
  }
}
var _lastUserStripJson = "";

// --- DM user context menu ---
var userCtxMenu = null;

export function initSidebarMates() {
  // --- Reactive UI sync for user strip ---
  store.subscribe(function (state, prev) {
    if (state.cachedAllUsers !== prev.cachedAllUsers ||
        state.cachedOnlineIds !== prev.cachedOnlineIds ||
        state.cachedDmFavorites !== prev.cachedDmFavorites ||
        state.cachedDmConversations !== prev.cachedDmConversations ||
        state.dmUnread !== prev.dmUnread ||
        state.dmRemovedUsers !== prev.dmRemovedUsers ||
        state.cachedMatesList !== prev.cachedMatesList ||
        state.myUserId !== prev.myUserId) {
      renderUserStrip();
    }
  });
}

export function closeUserCtxMenu() {
  if (userCtxMenu) {
    userCtxMenu.remove();
    userCtxMenu = null;
  }
  document.removeEventListener("click", handleUserCtxOutsideClick, true);
  closeMateManagementMenu();
}

function showUserCtxMenu(anchorEl, user) {
  closeUserCtxMenu();
  if (closeProjectCtxMenu) closeProjectCtxMenu();

  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";

  var removeItem = document.createElement("button");
  removeItem.className = "project-ctx-item project-ctx-delete";
  removeItem.innerHTML = iconHtml("user-minus") + " <span>Remove from favorites</span>";
  removeItem.addEventListener("click", function (e) {
    e.stopPropagation();
    // Spawn dust particles at the user icon position
    var iconRect = anchorEl.getBoundingClientRect();
    if (spawnDustParticles) spawnDustParticles(iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2);
    closeUserCtxMenu();
    // Immediately mark as removed so strip re-render hides the icon,
    // even if the user was only visible via cachedDmConversations (not favorites)
    cachedDmRemovedUsers[user.id] = true;
    var dr = Object.assign({}, store.get('dmRemovedUsers')); dr[user.id] = true; store.set({ dmRemovedUsers: dr });
    // renderUserStrip is handled by the store subscriber
    sendWs({ type: "dm_remove_favorite", targetUserId: user.id });
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

export function showMateCtxMenu(anchorEl, mate) {
  showMateManagementMenu(anchorEl, mate, {
    beforeOpen: function () {
      closeUserCtxMenu();
      if (closeProjectCtxMenu) closeProjectCtxMenu();
    },
    onRemoved: function () {
      var iconRect = anchorEl.getBoundingClientRect();
      if (spawnDustParticles) spawnDustParticles(iconRect.left + iconRect.width / 2, iconRect.top + iconRect.height / 2);
    },
  });
}

// Presence avatar URL helper
function presenceAvatarUrl(userOrStyle) {
  if (userOrStyle && typeof userOrStyle === "object") return userAvatarUrl(userOrStyle, 24);
  return userAvatarUrl({ avatarStyle: userOrStyle || "imprint" }, 24);
}

// renderUserStrip: call with no args to read from store (subscriber pattern),
// or with all 8 args for legacy compatibility.
export function renderUserStrip(allUsers, onlineUserIds, myUserId, dmFavorites, dmConversations, dmUnread, dmRemovedUsers, matesList) {
  if (arguments.length === 0) {
    var s = store.snap();
    allUsers = s.cachedAllUsers;
    onlineUserIds = s.cachedOnlineIds;
    myUserId = s.myUserId;
    dmFavorites = s.cachedDmFavorites;
    dmConversations = s.cachedDmConversations;
    dmUnread = s.dmUnread;
    dmRemovedUsers = s.dmRemovedUsers;
    matesList = s.cachedMatesList;
  }
  // Skip full DOM rebuild if input data hasn't changed
  var fingerprint = JSON.stringify([allUsers, onlineUserIds, dmFavorites, dmConversations, dmUnread, dmRemovedUsers, matesList]);
  if (fingerprint === _lastUserStripJson) return;
  _lastUserStripJson = fingerprint;

  cachedMates = matesList || cachedMates || [];
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

  // Hide section if no other users and no mates
  if (allOthers.length === 0 && cachedMates.length === 0) {
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
      avatar.src = userAvatarUrl(u, 34);
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
        if (openDm) openDm(u.id);
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


  // Show container if we have mates even with no other users
  if (cachedMates.length > 0) {
    container.classList.remove("hidden");
  }

  // Add user (+) button
  var addBtn = document.createElement("button");
  addBtn.className = "icon-strip-invite";
  addBtn.innerHTML = iconHtml("user-plus");
  addBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleDmUserPicker(addBtn);
  });
  addBtn.addEventListener("mouseenter", function () { showIconTooltip(addBtn, "Add user"); });
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
  searchInput.setAttribute("aria-label", "Search users");
  picker.appendChild(searchInput);

  // User list element (appended later, after USERS label)
  var listEl = document.createElement("div");
  listEl.className = "dm-user-picker-list";

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
        av.src = userAvatarUrl(u, 28);
        av.alt = u.displayName;
        item.appendChild(av);

        var name = document.createElement("span");
        name.className = "dm-user-picker-name";
        name.textContent = u.displayName;
        item.appendChild(name);

        item.addEventListener("click", function () {
          sendWs({ type: "dm_add_favorite", targetUserId: u.id });
          closeDmUserPicker();
        });

        listEl.appendChild(item);
      })(available[i]);
    }
  }

  var usersLabel = document.createElement("div");
  usersLabel.className = "dm-user-picker-section";
  usersLabel.textContent = "Users";
  picker.appendChild(usersLabel);
  picker.appendChild(listEl);
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

export function getCurrentDmUserId() {
  return currentDmUserId;
}

export function getCachedMates() {
  return cachedMates;
}

export function getCachedDmFavorites() {
  return cachedDmFavorites;
}

export function getCachedDmUnread() {
  return cachedDmUnread;
}

export function getCachedDmRemovedUsers() {
  return cachedDmRemovedUsers;
}
