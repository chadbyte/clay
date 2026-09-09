// app-home-hub.js - Home work hub navigation and first-depth Mate list.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedProjects, switchProject } from './app-projects.js';
import { chooseProjectActivationTarget } from './project-activation.js';
import { mateAvatarUrl } from './avatar.js';
import { exitDmMode } from './app-dm.js';
import { closeHomeDock, initHomeDock, renderDock, requestHomeDockPreference } from './home-dock.js';
import { openHomeChat, openHomeMateAction, renderHomeChat, resumeHomeChat, startHomeCapsuleCreation } from './home-mate-chat.js';
import { closeHomeSidebarAfterSelection } from './home-sidebar.js';
import { iconHtml, refreshIcons } from './icons.js';
import { getActiveMentionMateIds } from './sidebar-mates.js';
import { requestTools } from './home-tools.js';
import { showHomeShell, hideHomeShell } from './home-shell.js';
import { requestHomeSurfacePreference, rememberHomePrimarySurface } from './home-surface.js';
import { resolveHomeMate } from './home-mate-selection.js';
import { createHomeMateSettingsTrigger, disposeHomeMateSettingsMenu } from './home-mate-settings-menu.js';
import { closeHomeMateSettings, syncHomeMateSettingsTarget } from './home-mate-settings.js';
import { disposeHomeSessionActions } from './home-session-actions.js';
import { initHomeDebatesArchive, restoreHomeDebatesArchive } from './home-debates-archive.js';
import { isHomeDebatesSurface } from './home-sub-surface.js';
import { HOME_CAPSULE_CREATION_EVENT } from './home-capsule-creation-intent.js';

var homeHub = null;
var homeHubVisible = false;
var homeHubSuspended = false;
var lastRenderedMateId = null;

function handleHomeCapsuleCreation(event) {
  var detail = event && event.detail ? event.detail : {};
  detail.accepted = startHomeCapsuleCreation(detail.mateId, detail.description);
  if (detail.accepted) closeHomeDock();
}

function syncHomePresentation() {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "home_mate_present", visible: homeHubVisible && !document.hidden }));
}

function syncHomeCloseControl() {
  var close = document.getElementById("home-close-control");
  if (!close) return;
  close.classList.toggle("hidden", !getHomeReturnSlug());
}

function getHomeReturnSlug() {
  return chooseProjectActivationTarget(
    getCachedProjects(),
    [store.get('currentSlug'), store.get('homeSurfaceProjectSlug')]
  );
}

function getVisibleMates() {
  var mates = (store.get('cachedMatesList') || []).filter(function (mate) {
    return !!mate && !mate.archived;
  });
  mates.sort(function (a, b) {
    var aClay = a.builtinKey === "clay" ? 0 : 1;
    var bClay = b.builtinKey === "clay" ? 0 : 1;
    if (aClay !== bClay) return aClay - bClay;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return mates;
}

function getMateName(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.displayName || (mate && (mate.displayName || mate.name)) || "Mate";
}

function syncMateContextControls(mate) {
  var name = mate ? getMateName(mate) : "Mate";
  var newChat = document.getElementById("home-sidebar-new");
  if (newChat) {
    newChat.disabled = !mate;
    newChat.setAttribute("aria-label", mate ? "Start a new chat with " + name : "Start a new chat with the current Mate");
  }
  var debates = document.getElementById("home-sidebar-debate");
  if (debates) {
    debates.disabled = false;
    debates.setAttribute("aria-label", "Browse debates");
  }
}

function getMateActivity() {
  var status = {};
  var projects = getCachedProjects() || [];
  for (var i = 0; i < projects.length; i++) {
    if (projects[i] && projects[i].slug) status[projects[i].slug] = projects[i];
  }
  return status;
}

function isMateBusy(mate, projectStatus, mentionActive) {
  var project = projectStatus["mate-" + mate.id] || {};
  return !!project.isProcessing || !!mentionActive[mate.id];
}

function selectHomeMate(mateId) {
  if (mateId !== store.get('homeChatMateId') || isHomeDebatesSurface()) openHomeChat(mateId);
  closeHomeSidebarAfterSelection();
}

function createMateListRow(mate, activeMateId, projectStatus, mentionActive, unread) {
  var name = getMateName(mate);
  var busy = isMateBusy(mate, projectStatus, mentionActive);
  var count = unread[mate.id] || 0;
  var item = document.createElement("div");
  item.className = "home-mate-list-item";
  item.setAttribute("role", "listitem");
  var row = document.createElement("button");
  row.type = "button";
  row.className = "home-mate-list-row" + (mate.id === activeMateId ? " is-active" : "");
  row.dataset.homeMateId = mate.id;
  row.setAttribute("aria-label", name + (mate.id === activeMateId ? ", current Mate" : "") + (mate.model ? ", model " + mate.model : "") + (busy ? ", working" : "") + (count ? ", " + count + " unread" : ""));
  if (mate.id === activeMateId) row.setAttribute("aria-current", "true");

  var avatarWrap = document.createElement("span");
  avatarWrap.className = "home-mate-list-avatar-wrap";
  var avatar = document.createElement("img");
  avatar.className = "home-mate-list-avatar";
  avatar.src = mateAvatarUrl(mate, 32);
  avatar.alt = "";
  avatarWrap.appendChild(avatar);
  if (busy) {
    var activity = document.createElement("span");
    activity.className = "home-mate-list-activity";
    activity.title = "Working";
    activity.setAttribute("aria-hidden", "true");
    avatarWrap.appendChild(activity);
  }
  row.appendChild(avatarWrap);

  var copy = document.createElement("span");
  copy.className = "home-mate-list-copy";
  var nameEl = document.createElement("span");
  nameEl.className = "home-mate-list-name";
  nameEl.textContent = name;
  copy.appendChild(nameEl);
  if (mate.model) {
    var model = document.createElement("span");
    model.className = "home-mate-list-model";
    model.textContent = mate.model;
    copy.appendChild(model);
  }
  row.appendChild(copy);
  if (count > 0) {
    var badge = document.createElement("span");
    badge.className = "home-mate-list-unread";
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.setAttribute("aria-hidden", "true");
    row.appendChild(badge);
  }
  row.addEventListener("click", function () { selectHomeMate(mate.id); });
  item.appendChild(row);
  item.appendChild(createHomeMateSettingsTrigger(mate));
  if (mate.id === activeMateId) item.classList.add("is-active");
  return item;
}

function createNewMateRow(disabled) {
  var item = document.createElement("div");
  item.className = "home-mate-list-item home-mate-list-create-item";
  item.setAttribute("role", "listitem");
  var row = document.createElement("button");
  row.id = "home-sidebar-new-mate";
  row.type = "button";
  row.className = "home-mate-list-row home-mate-list-create";
  row.disabled = disabled === true;
  row.setAttribute("aria-label", "Create a new Mate with Clay");
  var icon = document.createElement("span");
  icon.className = "home-mate-list-create-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = iconHtml("user-round-plus");
  row.appendChild(icon);
  var copy = document.createElement("span");
  copy.className = "home-mate-list-copy";
  var name = document.createElement("span");
  name.className = "home-mate-list-name";
  name.textContent = "Create new Mate";
  copy.appendChild(name);
  row.appendChild(copy);
  row.addEventListener("click", function () {
    openHomeMateAction("mate");
    closeHomeSidebarAfterSelection();
  });
  item.appendChild(row);
  return item;
}

function handleMateListKeydown(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  if (!event.target.classList.contains("home-mate-list-row")) return;
  var rows = event.currentTarget.querySelectorAll(".home-mate-list-row");
  if (!rows.length) return;
  event.preventDefault();
  var current = Array.prototype.indexOf.call(rows, event.target);
  var next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = rows.length - 1;
  else if (event.key === "ArrowDown") next = current === rows.length - 1 ? 0 : current + 1;
  else next = current <= 0 ? rows.length - 1 : current - 1;
  rows[next].focus();
}

function renderMateListLoading(list) {
  list.innerHTML = "";
  list.appendChild(createNewMateRow(true));
  var empty = document.createElement("div");
  empty.className = "home-mate-list-empty";
  empty.textContent = "Loading Mates...";
  list.appendChild(empty);
  refreshIcons();
}

function findMateRow(list, mateId) {
  var rows = list.querySelectorAll(".home-mate-list-row");
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].dataset.homeMateId === mateId) return rows[i];
  }
  return null;
}

function findMateOverflow(list, mateId) {
  var buttons = list.querySelectorAll(".home-mate-list-overflow");
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].dataset.homeMateId === mateId) return buttons[i];
  }
  return null;
}

function keepMateRowVisible(list, row) {
  if (!list || !row || !list.getBoundingClientRect || !row.getBoundingClientRect) return;
  var listRect = list.getBoundingClientRect();
  var rowRect = row.getBoundingClientRect();
  if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
  else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
}

export function initHomeHub() {
  homeHub = document.getElementById("home-hub");
  window.addEventListener(HOME_CAPSULE_CREATION_EVENT, handleHomeCapsuleCreation);
  initHomeDock();
  initHomeDebatesArchive();
  document.getElementById("home-mate-list").addEventListener("keydown", handleMateListKeydown);
  document.getElementById("home-close-control").addEventListener("click", minimizeHomeHub);
  window.addEventListener("clay:home-debate", function () { hideHomeHub(); });
  document.addEventListener("visibilitychange", syncHomePresentation);

  store.subscribe(function (state, prev) {
    if (state.connected !== prev.connected && state.connected && homeHubVisible) syncHomePresentation();
    if (state.currentSlug !== prev.currentSlug) syncHomeCloseControl();
    if (state.homeChatMateId !== prev.homeChatMateId || state.cachedMatesList !== prev.cachedMatesList) renderHomeMateSwitcher();
    if (state.homeSidebarCollapsed !== prev.homeSidebarCollapsed && !state.homeSidebarCollapsed) {
      requestAnimationFrame(renderHomeMateSwitcher);
    }
    if (state.homeSurfaceLoaded !== prev.homeSurfaceLoaded && homeHubVisible) {
      syncHomePresentation();
      if (!restoreHomeDebatesArchive() && state.homeChatMateId) resumeHomeChat();
      renderHomeMateSwitcher();
    }
    if (state.homeSurfaceRestoreRequested === true && prev.homeSurfaceRestoreRequested !== true) {
      showHomeHub(true);
      store.set({ homeSurfaceRestoreRequested: false });
    }
  });
  syncHomeCloseControl();
  renderHomeChat();
}

export function isHomeHubVisible() {
  return homeHubVisible;
}

export function renderHomeMateSwitcher() {
  var list = document.getElementById("home-mate-list");
  if (!list) return;
  var visibleMates = getVisibleMates();
  var activeMateId = store.get('homeChatMateId');
  var selectionChanged = activeMateId !== lastRenderedMateId;
  var activeMate = resolveHomeMate(visibleMates, activeMateId, null);
  if (!activeMate || activeMate.id !== activeMateId) activeMate = null;
  if (homeHubVisible && !store.get('homeSurfaceLoaded') && !activeMate) {
    syncMateContextControls(null);
    renderMateListLoading(list);
    return;
  }
  if (homeHubVisible && store.get('homeSurfaceLoaded') && !activeMate) {
    var nextMate = resolveHomeMate(visibleMates, activeMateId, store.get('homePreferredMateId'));
    if (nextMate) {
      if (isHomeDebatesSurface()) {
        store.set({ homeChatMateId: nextMate.id });
        return;
      }
      openHomeChat(nextMate.id);
      return;
    }
  }
  syncMateContextControls(activeMate);
  var focusedMateId = list.contains(document.activeElement) ? document.activeElement.dataset.homeMateId : null;
  var focusedOverflow = !!focusedMateId && document.activeElement.classList.contains("home-mate-list-overflow");
  var mentionActive = getActiveMentionMateIds();
  var projectStatus = getMateActivity();
  var unread = store.get('dmUnread') || {};
  disposeHomeMateSettingsMenu();
  syncHomeMateSettingsTarget();
  list.innerHTML = "";
  list.appendChild(createNewMateRow(false));
  if (!visibleMates.length) {
    var empty = document.createElement("div");
    empty.className = "home-mate-list-empty";
    empty.textContent = "No Mates are available.";
    list.appendChild(empty);
    refreshIcons();
    return;
  }
  for (var i = 0; i < visibleMates.length; i++) {
    list.appendChild(createMateListRow(visibleMates[i], activeMateId, projectStatus, mentionActive, unread));
  }
  var focusedRow = null;
  if (focusedMateId) {
    focusedRow = focusedOverflow ? findMateOverflow(list, focusedMateId) : findMateRow(list, focusedMateId);
    if (focusedRow) focusedRow.focus({ preventScroll: true });
  }
  var activeRow = findMateRow(list, activeMateId);
  keepMateRowVisible(list, selectionChanged ? activeRow : focusedRow || activeRow);
  lastRenderedMateId = activeMateId;
  refreshIcons();
}

export function updateHomeIconBadge() {
  var badge = document.getElementById("icon-strip-home-badge");
  if (!badge) return;
  var mates = store.get('cachedMatesList') || [];
  var unread = store.get('dmUnread') || {};
  var total = 0;
  for (var i = 0; i < mates.length; i++) {
    total += unread[mates[i].id] || 0;
  }
  if (total > 0) {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.classList.add("has-unread");
  } else {
    badge.textContent = "";
    badge.classList.remove("has-unread");
  }
}

export function showHomeHub(fromHistory) {
  if (store.get('dmMode')) exitDmMode();
  var activeMateId = store.get('homeChatMateId');
  var resume = homeHubSuspended || homeHubVisible;
  homeHubVisible = true;
  homeHubSuspended = false;
  showHomeShell();
  homeHub.classList.remove("hidden");
  rememberHomePrimarySurface("home");
  syncHomePresentation();
  syncHomeCloseControl();
  renderHomeMateSwitcher();
  if (activeMateId && !resume && !isHomeDebatesSurface()) openHomeChat(activeMateId);
  if (isHomeDebatesSurface()) restoreHomeDebatesArchive();
  if (!resume && store.get('homeSurfaceRestoreRequested') !== true) {
    requestTools();
    requestHomeDockPreference();
    requestHomeSurfacePreference();
    renderDock();
  }
  if (!fromHistory && location.pathname !== "/") {
    if (document.documentElement.classList.contains("pwa-standalone")) {
      history.replaceState(null, "", "/");
    } else {
      history.pushState(null, "", "/");
    }
  }
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) homeIcon.classList.add("active");
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.add("active");
}

export function hideHomeHub() {
  if (!homeHubVisible) return;
  disposeHomeMateSettingsMenu();
  closeHomeMateSettings();
  disposeHomeSessionActions();
  homeHubVisible = false;
  homeHubSuspended = true;
  hideHomeShell();
  homeHub.classList.add("hidden");
  syncHomePresentation();
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) homeIcon.classList.remove("active");
  var mobileHome = document.getElementById("mobile-home-btn");
  if (mobileHome) mobileHome.classList.remove("active");
}

export function minimizeHomeHub() {
  var slug = getHomeReturnSlug();
  if (!slug || !homeHubVisible) return;
  switchProject(slug);
  var projectInput = document.getElementById("input");
  if (projectInput && !projectInput.disabled) projectInput.focus({ preventScroll: true });
}
