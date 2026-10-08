// Actions menu for custom folders, opened from the folder header itself: right
// click (at the pointer), the ContextMenu key or Shift+F10 (below the focused
// header), or a long press on touch. There are no visible dots or reserved
// slots; Favorites and Unfiled never get this menu. Menu, press and click
// suppression state live in the store; this module only owns the functions.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';

var LONG_PRESS_MS = 500;
var MOVE_TOLERANCE = 10;
var POST_RELEASE_MS = 400;
var HOLD_MAX_MS = 15000;
var EDGE = 8;

function contextState() {
  return store.get('sessionFolderContext') || { press: null, held: null, suppressUntil: 0 };
}

function patchContext(change) {
  store.set({ sessionFolderContext: Object.assign({}, contextState(), change) });
}

// --- Menu ---

export function closeFolderMenu(restoreFocus) {
  var menu = store.get('sessionFolderMenu');
  if (!menu) return;
  store.set({ sessionFolderMenu: null });
  document.removeEventListener("pointerdown", onMenuOutside, true);
  document.removeEventListener("mousedown", onMenuOutside, true);
  document.removeEventListener("touchstart", onMenuOutside, true);
  document.removeEventListener("keydown", onMenuKey, true);
  window.removeEventListener("blur", onMenuBlur);
  menu.el.remove();
  if (restoreFocus !== false && menu.anchor && document.contains(menu.anchor)) menu.anchor.focus({ preventScroll: true });
}

// Any press that starts outside the menu dismisses it. pointerdown is the
// primary signal: surfaces that call preventDefault() on pointerdown make the
// browser skip the compatibility mousedown/touchstart, which left the menu
// open. Those two stay as fallbacks. The press is never cancelled, and focus is
// left to the control that was pressed (the anchor only regains it when the
// menu closes by Escape or by choosing an item).
function onMenuOutside(event) {
  var menu = store.get('sessionFolderMenu');
  if (!menu) return;
  var target = event.target;
  if (target && target.nodeType === 1 && menu.el.contains(target)) return;
  closeFolderMenu(false);
}

// Focus moving into an iframe or another window never reaches this
// document's pointer events.
function onMenuBlur() {
  if (store.get('sessionFolderMenu')) closeFolderMenu(false);
}

function onMenuKey(event) {
  var menu = store.get('sessionFolderMenu');
  if (!menu) return;
  var items = Array.prototype.filter.call(menu.el.querySelectorAll("button"), function (b) { return !b.disabled; });
  var at = items.indexOf(document.activeElement);
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFolderMenu(); }
  else if (event.key === "ArrowDown") { event.preventDefault(); items[(at + 1) % items.length].focus(); }
  else if (event.key === "ArrowUp") { event.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
  else if (event.key === "Tab") { event.preventDefault(); items[(at + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus(); }
  else if (event.key === "Home") { event.preventDefault(); items[0].focus(); }
  else if (event.key === "End") { event.preventDefault(); items[items.length - 1].focus(); }
}

// Opens the menu with its top-left corner at the point, kept inside the viewport.
export function openFolderMenuAt(anchor, entries, point) {
  closeFolderMenu();
  var menu = document.createElement("div");
  menu.className = "session-ctx-menu session-folder-menu";
  menu.setAttribute("role", "menu");
  entries.forEach(function (entry) {
    var item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.className = "session-ctx-item" + (entry.danger ? " session-ctx-delete" : "");
    item.disabled = entry.disabled === true;
    item.innerHTML = iconHtml(entry.icon) + " <span>" + escapeHtml(entry.label) + "</span>";
    item.addEventListener("click", function (event) {
      event.stopPropagation();
      // The finger that opened the menu by long press lifts right over it; that tap is not a choice.
      if (consumeFolderClickSuppress()) return;
      closeFolderMenu();
      entry.run();
    });
    menu.appendChild(item);
  });
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  var box = menu.getBoundingClientRect();
  var left = Math.min(Math.max(EDGE, point.x), Math.max(EDGE, window.innerWidth - box.width - EDGE));
  var top = point.y;
  if (top + box.height > window.innerHeight - EDGE) top = Math.min(point.y - box.height, window.innerHeight - box.height - EDGE);
  top = Math.max(EDGE, top);
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.style.right = "auto";
  menu.style.visibility = "";
  store.set({ sessionFolderMenu: { el: menu, anchor: anchor } });
  document.addEventListener("pointerdown", onMenuOutside, true);
  document.addEventListener("mousedown", onMenuOutside, true);
  document.addEventListener("touchstart", onMenuOutside, true);
  document.addEventListener("keydown", onMenuKey, true);
  window.addEventListener("blur", onMenuBlur);
  refreshIcons();
  var first = menu.querySelector("button:not([disabled])");
  if (first) first.focus({ preventScroll: true });
}

// --- Long press (touch and pen) ---

function onScrollCancel() {
  cancelFolderPress();
}

// A press that has not fired yet: cancelled by movement, release, scroll, drag
// and anything that replaces the DOM it was started on.
export function cancelFolderPress() {
  var press = contextState().press;
  if (!press) return;
  clearTimeout(press.timer);
  document.removeEventListener("scroll", onScrollCancel, true);
  patchContext({ press: null });
}

// The finger that opened the menu is still down. Its release, however late, must
// not toggle the folder or choose an item; a short window after it covers the
// compatibility click that follows the release.
function onHoldEnd(event) {
  var held = contextState().held;
  if (!held) return;
  if (held.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== held.pointerId) return;
  releaseFolderHold(true);
}

function releaseFolderHold(keepWindow) {
  document.removeEventListener("pointerup", onHoldEnd, true);
  document.removeEventListener("pointercancel", onHoldEnd, true);
  if (!contextState().held && !keepWindow) return;
  patchContext({ held: null, suppressUntil: keepWindow ? Date.now() + POST_RELEASE_MS : 0 });
}

// Cleanup for project and DM transitions.
export function resetFolderGestures() {
  cancelFolderPress();
  releaseFolderHold(false);
}

// True while the opening finger is still down, and briefly after it lifts.
export function consumeFolderClickSuppress() {
  var state = contextState();
  if (state.held && Date.now() - state.held.at < HOLD_MAX_MS) return true;
  return Date.now() < state.suppressUntil;
}

// Wires the custom-folder gestures onto a header. entriesFor() builds the menu
// entries when it opens, so they always reflect the current folder order.
export function wireFolderContext(header, anchor, entriesFor) {
  function open(x, y) {
    if (store.get('sessionFolderMenu')) return;
    openFolderMenuAt(anchor, entriesFor(), { x: x, y: y });
  }

  header.addEventListener("contextmenu", function (event) {
    event.preventDefault();
    event.stopPropagation();
    open(event.clientX, event.clientY);
  });

  header.addEventListener("keydown", function (event) {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    event.preventDefault();
    event.stopPropagation();
    var rect = anchor.getBoundingClientRect();
    open(rect.left + 16, rect.bottom);
  });

  header.addEventListener("pointerdown", function (event) {
    if (event.pointerType === "mouse" || event.isPrimary === false) return;
    cancelFolderPress();
    releaseFolderHold(false);
    var x = event.clientX;
    var y = event.clientY;
    var pointerId = event.pointerId;
    var timer = setTimeout(function () {
      var live = contextState().press;
      if (!live || live.timer !== timer) return;
      document.removeEventListener("scroll", onScrollCancel, true);
      // A rerender may have replaced the header while the press was pending.
      if (!header.isConnected || !anchor.isConnected) { patchContext({ press: null }); return; }
      patchContext({ press: null, held: { pointerId: pointerId, at: Date.now() }, suppressUntil: 0 });
      document.addEventListener("pointerup", onHoldEnd, true);
      document.addEventListener("pointercancel", onHoldEnd, true);
      open(x, y);
    }, LONG_PRESS_MS);
    document.addEventListener("scroll", onScrollCancel, true);
    patchContext({ press: { timer: timer, x: x, y: y } });
  });
  header.addEventListener("pointermove", function (event) {
    var press = contextState().press;
    if (!press) return;
    if (Math.abs(event.clientX - press.x) > MOVE_TOLERANCE || Math.abs(event.clientY - press.y) > MOVE_TOLERANCE) cancelFolderPress();
  });
  header.addEventListener("pointerup", cancelFolderPress);
  header.addEventListener("pointercancel", cancelFolderPress);
  header.addEventListener("pointerleave", cancelFolderPress);
  header.addEventListener("dragstart", cancelFolderPress);
}
