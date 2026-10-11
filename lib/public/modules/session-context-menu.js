// Session context-menu lifecycle and exact-row title editing.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';

function menuState() {
  return store.get('sessionContextMenu');
}

function renameState() {
  return store.get('sessionInlineRename');
}

export function closeSessionContextMenu(restoreFocus) {
  var state = menuState();
  if (!state) return;
  store.set({ sessionContextMenu: null });
  document.removeEventListener("pointerdown", onOutsidePress, true);
  document.removeEventListener("mousedown", onOutsidePress, true);
  document.removeEventListener("touchstart", onOutsidePress, true);
  document.removeEventListener("keydown", onMenuKey, true);
  window.removeEventListener("blur", onWindowBlur);
  if (state.anchor) state.anchor.setAttribute("aria-expanded", "false");
  if (state.el && state.el.isConnected) state.el.remove();
  if (restoreFocus !== false && state.anchor && state.anchor.isConnected) {
    state.anchor.focus({ preventScroll: true });
    if (!state.anchorHadTabIndex) {
      state.anchor.addEventListener("blur", function cleanupAnchorTabIndex() {
        state.anchor.removeAttribute("tabindex");
      }, { once: true });
    }
  }
  if (state.anchor && restoreFocus === false && !state.anchorHadTabIndex) state.anchor.removeAttribute("tabindex");
  else if (state.anchor && state.anchorHadTabIndex) state.anchor.setAttribute("tabindex", state.anchorTabIndex);
}

function onOutsidePress(event) {
  var state = menuState();
  if (!state) return;
  if (event.target && state.el.contains(event.target)) return;
  // Do not cancel the press: the outside control still receives its click.
  closeSessionContextMenu(false);
}

function onWindowBlur() {
  closeSessionContextMenu(false);
}

function onMenuKey(event) {
  var state = menuState();
  if (!state) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeSessionContextMenu(true);
  }
}

export function mountSessionContextMenu(menu, anchor, sessionId) {
  closeSessionContextMenu(false);
  menu.setAttribute("role", "menu");
  var items = menu.querySelectorAll("button");
  for (var i = 0; i < items.length; i++) {
    items[i].type = "button";
    items[i].setAttribute("role", "menuitem");
  }
  anchor.setAttribute("aria-haspopup", "menu");
  anchor.setAttribute("aria-expanded", "true");
  var anchorHadTabIndex = anchor.hasAttribute("tabindex");
  var anchorTabIndex = anchor.getAttribute("tabindex");
  if (!anchorHadTabIndex) anchor.setAttribute("tabindex", "-1");
  store.set({ sessionContextMenu: {
    el: menu,
    anchor: anchor,
    anchorHadTabIndex: anchorHadTabIndex,
    anchorTabIndex: anchorTabIndex,
    sessionId: sessionId || null,
  } });
  document.addEventListener("pointerdown", onOutsidePress, true);
  document.addEventListener("mousedown", onOutsidePress, true);
  document.addEventListener("touchstart", onOutsidePress, true);
  document.addEventListener("keydown", onMenuKey, true);
  window.addEventListener("blur", onWindowBlur);
  var first = menu.querySelector("button:not([disabled])");
  if (first) first.focus({ preventScroll: true });
}

function restoreTitle(state) {
  if (!state || !state.title || !state.title.isConnected) return;
  state.title.replaceChildren();
  for (var i = 0; i < state.originalNodes.length; i++) state.title.appendChild(state.originalNodes[i]);
  if (state.row) state.row.classList.remove("session-renaming");
  if (state.control) state.control.style.display = state.controlDisplay;
}

export function cancelSessionInlineRename(restoreFocus) {
  var state = renameState();
  if (!state) return;
  store.set({ sessionInlineRename: null });
  restoreTitle(state);
  if (restoreFocus && state.row && state.row.isConnected) state.row.focus({ preventScroll: true });
}

function currentRenameCanSend(state) {
  var ws = getWs();
  var permissions = store.get('permissions');
  var sameSession = state && state.source === "header" ?
    String(store.get('activeSessionId')) === String(state.sessionId) :
    state && state.row && String(state.row.dataset.sessionId) === String(state.sessionId);
  return !!(state && state.row && state.row.isConnected && sameSession &&
    store.get('connected') && state.ws === ws && ws && ws.readyState === 1 &&
    state.slug === store.get('currentSlug') &&
    (!permissions || permissions.sessionRename !== false));
}

function finishRename(state, commit) {
  if (!state || state !== renameState()) return;
  store.set({ sessionInlineRename: null });
  var nextTitle = state.input.value.trim();
  restoreTitle(state);
  if (!commit || !nextTitle || nextTitle === state.currentTitle) return;
  if (!currentRenameCanSend(state)) {
    showToast("Rename cancelled because the project, connection, or permission changed.", "warn");
    return;
  }
  try {
    state.ws.send(JSON.stringify({ type: "rename_session", id: state.sessionId, title: nextTitle }));
  } catch (error) {
    showToast("Session rename could not be sent.", "error");
  }
}

function stopRowInteraction(event) {
  event.stopPropagation();
}

function beginSessionInlineRename(row, title, control, session, source, inputClass) {
  cancelSessionInlineRename(false);
  if (!row || !row.isConnected || !title || !session) return false;

  var originalNodes = [];
  while (title.firstChild) originalNodes.push(title.removeChild(title.firstChild));
  var input = document.createElement("input");
  input.type = "text";
  input.className = inputClass || "session-rename-input";
  input.value = session.title || "New Session";
  input.maxLength = 100;
  input.setAttribute("aria-label", "Session title");
  title.appendChild(input);
  row.classList.add("session-renaming");
  var controlDisplay = control ? control.style.display : "";
  if (control) control.style.display = "none";

  var state = {
    row: row,
    title: title,
    input: input,
    originalNodes: originalNodes,
    sessionId: session.id,
    currentTitle: session.title || "New Session",
    control: control || null,
    controlDisplay: controlDisplay,
    source: source,
    slug: store.get('currentSlug'),
    ws: getWs(),
    composing: false,
  };
  store.set({ sessionInlineRename: state });

  input.addEventListener("compositionstart", function () { state.composing = true; });
  input.addEventListener("compositionend", function () { state.composing = false; });
  input.addEventListener("keydown", function (event) {
    event.stopPropagation();
    if (event.key === "Enter" && !state.composing && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      finishRename(state, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishRename(state, false);
    }
  });
  input.addEventListener("blur", function () { finishRename(state, true); });
  ["click", "dblclick", "pointerdown", "mousedown", "touchstart", "contextmenu", "dragstart"].forEach(function (type) {
    input.addEventListener(type, stopRowInteraction);
  });
  input.focus({ preventScroll: true });
  input.select();
  return true;
}

export function startSessionInlineRename(row, session) {
  if (!row) return false;
  var title = row.querySelector(".session-item-title") || row.querySelector(".mobile-session-title");
  return beginSessionInlineRename(row, title, null, session, "row", "session-rename-input");
}

export function startHeaderSessionInlineRename(title, control, session) {
  var row = title && title.closest(".title-bar-content");
  return beginSessionInlineRename(row, title, control, session, "header", "header-rename-input");
}

store.subscribe(function (state, previous) {
  if (state.currentSlug !== previous.currentSlug || state.dmMode !== previous.dmMode ||
      (previous.connected && !state.connected)) {
    closeSessionContextMenu(false);
    cancelSessionInlineRename(false);
  }
});
