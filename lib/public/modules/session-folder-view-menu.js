// Compact, non-modal View dropdown for the session folders toolbar. It floats
// below its button with no backdrop and no focus trap; group, sort and
// direction apply immediately while the list stays visible. Open state lives in
// the store (sessionFolderViewMenu); the menu's contents are repainted in place
// so keyboard focus survives server updates.

import { store } from './store.js';
import { escapeHtml } from './utils.js';
import { currentFolderState, sendFolderOp } from './session-folders.js';
import { SORT_OPTIONS, GROUP_OPTIONS, defaultDirectionFor } from './session-folder-layout.js';

var MENU_SELECTOR = ".session-folder-viewmenu";

function menuEl() {
  return document.querySelector(MENU_SELECTOR);
}

function buttonFor(surface) {
  return document.querySelector('[data-view-button="' + surface + '"]');
}

function sendViewPatch(patch) {
  var op = Object.assign({ op: "set_view" }, patch);
  if (patch.sort) op.direction = defaultDirectionFor(patch.sort);
  sendFolderOp(op);
}

function radioGroup(name, legend, entries, selected, onPick) {
  var set = document.createElement("div");
  set.className = "session-folder-radio-group";
  set.setAttribute("role", "radiogroup");
  set.setAttribute("aria-label", legend);
  var label = document.createElement("div");
  label.className = "session-folder-radio-legend";
  label.textContent = legend;
  set.appendChild(label);
  var rows = [];
  entries.forEach(function (entry, index) {
    var row = document.createElement("button");
    row.type = "button";
    row.className = "session-folder-radio" + (entry.value === selected ? " selected" : "");
    row.dataset.focusKey = name + ":" + entry.value;
    row.setAttribute("role", "radio");
    row.setAttribute("aria-checked", String(entry.value === selected));
    row.innerHTML = '<span class="session-folder-radio-dot" aria-hidden="true"></span><span>' + escapeHtml(entry.label) + "</span>";
    row.addEventListener("click", function () { onPick(entry.value); });
    row.addEventListener("keydown", function (event) {
      var step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0);
      if (!step) return;
      event.preventDefault();
      var next = (index + step + entries.length) % entries.length;
      rows[next].focus();
      onPick(entries[next].value);
    });
    rows.push(row);
    set.appendChild(row);
  });
  return set;
}

// Rebuilds the menu body from the current view and puts focus back on the same
// control (found by key) so a repaint never drops the keyboard user's place.
export function paintViewMenu() {
  var menu = menuEl();
  if (!menu) return;
  var active = document.activeElement;
  var focusKey = active && menu.contains(active) ? active.dataset.focusKey : null;
  var view = currentFolderState().view;
  var sortEntry = SORT_OPTIONS.filter(function (o) { return o.sort === view.sort; })[0];
  menu.innerHTML = "";
  menu.appendChild(radioGroup("group", "Group by", GROUP_OPTIONS.map(function (o) { return { value: o.group, label: o.label }; }), view.group, function (v) { sendViewPatch({ group: v }); }));
  menu.appendChild(radioGroup("sort", "Sort by", SORT_OPTIONS.map(function (o) { return { value: o.sort, label: o.label }; }), view.sort, function (v) { sendViewPatch({ sort: v }); }));
  if (sortEntry && sortEntry.directions) {
    menu.appendChild(radioGroup("direction", "Direction", Object.keys(sortEntry.directions).map(function (d) { return { value: d, label: sortEntry.directions[d] }; }), view.direction, function (v) { sendViewPatch({ direction: v }); }));
  } else {
    var note = document.createElement("div");
    note.className = "session-folder-view-note";
    note.textContent = "Drag sessions to arrange them. Favorites keep their own order.";
    menu.appendChild(note);
  }
  if (focusKey) {
    var target = menu.querySelector('[data-focus-key="' + focusKey + '"]') || menu.querySelector(".session-folder-radio.selected");
    if (target) target.focus();
  }
  positionViewMenu();
}

// Anchored below the button and clamped to the visible viewport, so it never
// runs off a phone screen; very tall content scrolls inside the menu.
export function positionViewMenu() {
  var state = store.get('sessionFolderViewMenu');
  var menu = menuEl();
  if (!state || !menu) return;
  var button = buttonFor(state.surface);
  if (!button) return;
  var rect = button.getBoundingClientRect();
  var margin = 8;
  var width = Math.min(260, window.innerWidth - margin * 2);
  menu.style.width = width + "px";
  var left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
  var top = rect.bottom + 4;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.style.maxHeight = Math.max(120, window.innerHeight - top - margin) + "px";
}

function onOutside(event) {
  var state = store.get('sessionFolderViewMenu');
  if (!state) return;
  var menu = menuEl();
  var button = buttonFor(state.surface);
  if ((menu && menu.contains(event.target)) || (button && button.contains(event.target))) return;
  closeViewMenu(false);
}

function onKey(event) {
  if (event.key !== "Escape" || !store.get('sessionFolderViewMenu')) return;
  event.preventDefault();
  event.stopPropagation();
  closeViewMenu(true);
}

function onResize() {
  positionViewMenu();
}

export function closeViewMenu(restoreFocus) {
  var state = store.get('sessionFolderViewMenu');
  if (!state) return;
  store.set({ sessionFolderViewMenu: null });
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("touchstart", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", onResize);
  var menu = menuEl();
  if (menu) menu.remove();
  var button = buttonFor(state.surface);
  if (button) {
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  }
}

export function toggleViewMenu(surface) {
  if (store.get('sessionFolderViewMenu')) {
    closeViewMenu(true);
    return;
  }
  var button = buttonFor(surface);
  if (!button) return;
  var menu = document.createElement("div");
  menu.className = "session-folder-viewmenu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "View options");
  document.body.appendChild(menu);
  store.set({ sessionFolderViewMenu: { surface: surface } });
  button.setAttribute("aria-expanded", "true");
  paintViewMenu();
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("touchstart", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  var first = menu.querySelector(".session-folder-radio.selected") || menu.querySelector("button");
  if (first) first.focus();
}

store.subscribe(function (state, previous) {
  if (state.sessionFolders !== previous.sessionFolders) paintViewMenu();
});
