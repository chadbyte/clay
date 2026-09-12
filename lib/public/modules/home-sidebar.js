// Minimal Home navigation through Mates and their conversation history.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { updateHomeSurfacePreference } from './home-surface.js';
import { openHomeConversation, startNewHomeConversation } from './home-mate-chat.js';
import { openHomeDebatesArchive } from './home-debates-archive.js';
import { openHomeConversationsSheet, refreshHomeConversationsSheet } from './home-conversations-sheet.js';
import { renderHomeSidebarChats } from './home-sidebar-chat-list.js';
import { syncHomeSessionDetails } from './home-session-actions.js';
import { toggleHomeCapsules } from './home-dock.js';

var initialized = false;
var requestedMateIds = {};

function visibleMates() {
  return (store.get('cachedMatesList') || []).filter(function (mate) {
    return !!mate && !mate.archived;
  });
}

function requestConversationLists(force) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  if (force) requestedMateIds = {};
  var mates = visibleMates();
  for (var i = 0; i < mates.length; i++) {
    if (requestedMateIds[mates[i].id]) continue;
    requestedMateIds[mates[i].id] = true;
    ws.send(JSON.stringify({ type: "home_mate_sessions_list", mateId: mates[i].id }));
  }
}

function renderRecentConversations() {
  renderHomeSidebarChats(openConversationFromSidebar);
}

function renderChatScope() {
  var scope = store.get('homeChatScope') === "current" ? "current" : "all";
  var buttons = document.querySelectorAll("[data-home-chat-scope]");
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].setAttribute("aria-pressed", String(buttons[i].dataset.homeChatScope === scope));
  }
}

function renderSidebarState() {
  var hub = document.getElementById("home-hub");
  if (!hub) return;
  var collapsed = store.get('homeSidebarCollapsed') === true;
  hub.classList.toggle("home-sidebar-collapsed", collapsed);
  var collapse = document.getElementById("home-sidebar-collapse");
  var expand = document.getElementById("home-sidebar-expand");
  if (collapse) collapse.setAttribute("aria-expanded", String(!collapsed));
  if (expand) expand.setAttribute("aria-expanded", String(!collapsed));
  renderChatScope();
  renderRecentConversations();
  refreshHomeConversationsSheet();
  syncHomeSessionDetails();
}

function setCollapsed(collapsed) {
  updateHomeSurfacePreference({ sidebarCollapsed: collapsed });
}

function setChatScope(event) {
  var scope = event.currentTarget.dataset.homeChatScope;
  if (scope !== "current" && scope !== "all") return;
  if ((store.get('homeChatScope') || "all") === scope) return;
  updateHomeSurfacePreference({ chatScope: scope });
}

function isNarrowDrawer() {
  return !!window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
}

function focusNarrowNavigationTarget() {
  var composer = document.getElementById("home-mate-chat-input");
  if (composer && !composer.disabled && composer.getClientRects().length) {
    composer.focus();
    return;
  }
  var expand = document.getElementById("home-sidebar-expand");
  if (expand && expand.getClientRects().length) expand.focus();
}

function closeNarrowDrawer(focusConversation) {
  if (!isNarrowDrawer()) return;
  setCollapsed(true);
  if (focusConversation) focusNarrowNavigationTarget();
}

export function closeHomeSidebarAfterSelection() {
  closeNarrowDrawer(true);
}

function openConversationFromSidebar(mateId, sessionId) {
  openHomeConversation(mateId, sessionId);
  closeNarrowDrawer(true);
}

function startConversationFromSidebar() {
  startNewHomeConversation();
  closeNarrowDrawer(true);
}

function openAllConversations(event) {
  openHomeConversationsSheet(openConversationFromSidebar, event.currentTarget);
}

function openDebatesFromSidebar() {
  openHomeDebatesArchive();
  closeNarrowDrawer(false);
}

function toggleCapsulesFromSidebar() {
  var opening = store.get('dockOpen') !== true;
  toggleHomeCapsules();
  closeNarrowDrawer(!opening);
}

function handleSidebarKeydown(event) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!document.body.classList.contains("home-active")) return;
  if (document.querySelector(".home-conversations-sheet, .home-session-details-overlay")) return;
  if (!isNarrowDrawer() || store.get('homeSidebarCollapsed') === true) return;
  event.preventDefault();
  closeNarrowDrawer(true);
}

export function initHomeSidebar() {
  if (initialized) return;
  initialized = true;
  document.getElementById("home-sidebar-collapse").addEventListener("click", function () { setCollapsed(true); });
  document.getElementById("home-sidebar-expand").addEventListener("click", function () { setCollapsed(false); });
  document.getElementById("home-sidebar-backdrop").addEventListener("click", function () { setCollapsed(true); });
  document.getElementById("home-sidebar-new").addEventListener("click", startConversationFromSidebar);
  document.getElementById("home-sidebar-all").addEventListener("click", openAllConversations);
  document.getElementById("home-sidebar-debate").addEventListener("click", openDebatesFromSidebar);
  document.getElementById("home-tools-btn").addEventListener("click", toggleCapsulesFromSidebar);
  var scopeButtons = document.querySelectorAll("[data-home-chat-scope]");
  for (var i = 0; i < scopeButtons.length; i++) scopeButtons[i].addEventListener("click", setChatScope);
  store.subscribe(function (state, prev) {
    if (state.connected !== prev.connected && state.connected) requestConversationLists(true);
    if (state.cachedMatesList !== prev.cachedMatesList) requestConversationLists(false);
    if (state.homeMateSessions !== prev.homeMateSessions || state.homeChatMateId !== prev.homeChatMateId || state.homeChatSessionId !== prev.homeChatSessionId || state.homeSidebarCollapsed !== prev.homeSidebarCollapsed || state.homeChatScope !== prev.homeChatScope) {
      renderSidebarState();
    }
  });
  document.addEventListener("keydown", handleSidebarKeydown);
  requestConversationLists(false);
  renderSidebarState();
  refreshIcons();
}

export function refreshHomeSidebarSessions() {
  requestConversationLists(true);
}
