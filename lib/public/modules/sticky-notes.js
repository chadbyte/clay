// The sticky-note canvas: the board of floating cards over the conversation.
// This module owns the notes map, visibility, the badges, and the WebSocket
// handlers. Card markup and interactions live in sticky-notes-card.js, text
// editing in sticky-notes-editor.js, and leaf helpers in
// sticky-notes-shared.js. The browse/index pane is sticky-notes-browser.js.

import { refreshIcons, iconHtml } from './icons.js';
import { isClosedNote, send, clampPos, clearNoteTimers, deleteNoteUiState } from './sticky-notes-shared.js';
import { renderNote, closeColorPicker } from './sticky-notes-card.js';
import { closeFormatToolbar, isFormatToolbarOpen } from './sticky-notes-editor.js';
import { store } from './store.js';
import { reconcileNote, reconcileNoteResult } from './sticky-notes-state.js';

var notes = new Map();  // id -> { data, el }
var notesVisible = false;
var notesResizeObserver = null;

// The canvas shows open notes only. Closed notes live in the browser's Closed tab.
function openCount() {
  var count = 0;
  notes.forEach(function (entry) {
    if (entry && !isClosedNote(entry.data)) count++;
  });
  return count;
}

// The browser pane registers here rather than being imported, so the canvas
// module and the browser module never form an import cycle.
var browserRefresh = null;

export function setBrowserRefresh(fn) {
  browserRefresh = typeof fn === "function" ? fn : null;
}

function refreshBrowser() {
  if (browserRefresh) browserRefresh();
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setFlightAccessibility(el, hidden) {
  el.inert = hidden;
  el.setAttribute("aria-hidden", hidden ? "true" : "false");
}

function nearestEdgeTransform(el, container) {
  // offsetLeft/Top and offsetWidth/Height are layout geometry, unaffected by
  // an in-flight transform. Never derive the next vector from a translated
  // boundingClientRect or repeated hide/show cycles will accumulate distance.
  var left = el.offsetLeft;
  var top = el.offsetTop;
  var width = el.offsetWidth;
  var height = el.offsetHeight;
  var containerWidth = container.clientWidth;
  var containerHeight = container.clientHeight;
  var edges = [
    { name: "left", distance: left, transform: "translateX(" + -(left + width + 20) + "px)" },
    { name: "right", distance: containerWidth - left - width, transform: "translateX(" + (containerWidth - left + 20) + "px)" },
    { name: "top", distance: top, transform: "translateY(" + -(top + height + 20) + "px)" },
    { name: "bottom", distance: containerHeight - top - height, transform: "translateY(" + (containerHeight - top + 20) + "px)" },
  ];
  edges.sort(function (a, b) { return a.distance - b.distance; });
  return edges[0];
}

function animateNote(el, hidden, immediate) {
  if (!el || el.classList.contains("hidden")) return;
  var container = document.getElementById("sticky-notes-container");
  if (!container) return;
  if (hidden) {
    var edge = nearestEdgeTransform(el, container);
    el.style.setProperty("--sticky-note-flight", edge.transform);
    el.style.setProperty("--sticky-note-flight-duration", prefersReducedMotion() || immediate ? "0ms" : "240ms");
    el.classList.add("sticky-note-flight-away");
    setFlightAccessibility(el, true);
    return;
  }
  el.style.setProperty("--sticky-note-flight-duration", prefersReducedMotion() || immediate ? "0ms" : "320ms");
  el.classList.remove("sticky-note-flight-away");
  setFlightAccessibility(el, false);
}

function syncFlightState(el, immediate) {
  if (store.get("notesTemporarilyHidden")) animateNote(el, true, immediate);
  else animateNote(el, false, immediate);
}

function recomputeFlightGeometry() {
  if (!notesVisible) return;
  reclampAllNotes();
  if (store.get("notesTemporarilyHidden")) {
    notes.forEach(function (entry) { if (entry && entry.el) syncFlightState(entry.el, true); });
  }
}

function syncFlightControls() {
  var buttons = document.querySelectorAll("#sticky-notes-toggle-btn");
  var hidden = !!store.get("notesTemporarilyHidden");
  var label = hidden ? "Show sticky notes" : "Hide sticky notes";
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].setAttribute("aria-label", label);
    buttons[i].setAttribute("aria-pressed", hidden ? "true" : "false");
    buttons[i].title = label;
    var icon = buttons[i].querySelector("[data-lucide]");
    if (icon) icon.setAttribute("data-lucide", hidden ? "eye" : "eye-off");
  }
  refreshIcons();
}

export function toggleNotesTemporaryVisibility() {
  var hidden = !store.get("notesTemporarilyHidden");
  if (hidden) {
    closeColorPicker();
    closeFormatToolbar();
    var active = document.activeElement;
    var container = document.getElementById("sticky-notes-container");
    if (container && active && container.contains(active) && active.blur) active.blur();
  }
  store.set({ notesTemporarilyHidden: hidden });
  notes.forEach(function (entry) { if (entry && entry.el) syncFlightState(entry.el); });
  syncFlightControls();
}

// Read-only view of every note the client knows about, for the browser pane.
export function listNoteData() {
  var out = [];
  notes.forEach(function (entry) { if (entry && entry.data) out.push(entry.data); });
  return out;
}

// Bring one open note to the front of the canvas and flash it.
export function focusNoteOnCanvas(id) {
  var entry = notes.get(id);
  if (!entry || isClosedNote(entry.data)) return;
  showNotes();
  send({ type: "note_bring_front", id: id });
  if (entry.data.minimized) send({ type: "note_update", id: id, minimized: false });
  if (!entry.el) return;
  entry.el.classList.add("note-flash");
  setTimeout(function () { if (entry.el) entry.el.classList.remove("note-flash"); }, 600);
}


function reclampAllNotes() {
  notes.forEach(function (entry) {
    var el = entry.el;
    var noteW = el.offsetWidth;
    var noteH = el.offsetHeight;
    var curX = parseInt(el.style.left) || 0;
    var curY = parseInt(el.style.top) || 0;
    var c = clampPos(curX, curY, noteW, noteH);
    el.style.left = c.x + "px";
    el.style.top = c.y + "px";
    if (store.get("notesTemporarilyHidden")) syncFlightState(el, true);
  });
}

export function initStickyNotes() {
  // Close format toolbar on outside click
  document.addEventListener("mousedown", function (e) {
    if (isFormatToolbarOpen() && !e.target.closest(".sn-format-toolbar") && !e.target.closest(".sticky-note-text") && !e.target.closest(".sticky-note-rendered")) {
      closeFormatToolbar();
    }
  });

  // Re-clamp note positions on window resize so notes stay visible
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (notesVisible && notes.size > 0) {
        reclampAllNotes();
      }
      if (store.get("notesTemporarilyHidden")) notes.forEach(function (entry) { if (entry && entry.el) syncFlightState(entry.el, true); });
    }, 100);
  });

  var canvas = document.getElementById("sticky-notes-container");
  if (canvas && typeof ResizeObserver === "function") {
    notesResizeObserver = new ResizeObserver(function () {
      recomputeFlightGeometry();
    });
    notesResizeObserver.observe(canvas);
  }

}

// --- Visibility ---

export function showNotes(restoreTemporary) {
  notesVisible = true;
  if (restoreTemporary !== false) store.set({ notesTemporarilyHidden: false });
  applyCanvasVisibility();
  notes.forEach(function (entry) { if (entry && entry.el) syncFlightState(entry.el); });
  syncFlightControls();
}

// Project Settings owns the screen while open. Suppression is separate from
// intent: `notesVisible` keeps tracking show/hide requests and updates, and only
// the canvas element is held hidden, so release shows the latest intended state.
var notesSuppressed = false;
function applyCanvasVisibility() {
  var container = document.getElementById("sticky-notes-container");
  if (container) container.classList.toggle("hidden", !notesVisible || notesSuppressed);
}
export function holdNotesForSettings() {
  notesSuppressed = true;
  closeColorPicker();
  closeFormatToolbar();
  applyCanvasVisibility();
}
export function releaseNotesForSettings() {
  notesSuppressed = false;
  applyCanvasVisibility();
}

export function hideNotes() {
  notesVisible = false;
  applyCanvasVisibility();
  closeColorPicker();
  notes.forEach(function (entry) { if (entry && entry.el) syncFlightState(entry.el, true); });
  syncFlightControls();
}

export function createNote() {
  var container = document.getElementById("sticky-notes-container");
  if (!container) return;
  // Scatter position so notes don't stack exactly
  var offset = (notes.size % 5) * 30;
  send({
    type: "note_create",
    x: 60 + offset,
    y: 60 + offset,
    color: "purple",
    opacity: 0.64,
  });
}

function updateBadge() {
  var badge = document.querySelector(".sticky-notes-count");
  if (!badge) return;
  var count = openCount();
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// --- WS message handlers ---

export function handleNotesList(msg) {
  var container = document.getElementById("sticky-notes-container");
  if (!container) return;

  // Reconcile keyed cards in place so reconnects retain the active editor.
  var list = msg.notes || [];
  var seen = {};
  var created = false;
  var i;

  for (i = 0; i < list.length; i++) {
    var data = list[i];
    if (!data || !data.id) continue;
    seen[data.id] = true;
    var entry = notes.get(data.id);
    if (entry && entry.el && entry.el.parentNode === container) {
      patchNote(entry, data);
      continue;
    }
    var el = renderNote(data);
    notes.set(data.id, { data: data, el: el });
    container.appendChild(el);
    syncFlightState(el, true);
    created = true;
  }

  // Remove subscriptions and delayed writes along with stale cards.
  var staleIds = [];
  notes.forEach(function (value, id) {
    if (!seen[id]) staleIds.push(id);
  });
  for (i = 0; i < staleIds.length; i++) {
    var stale = notes.get(staleIds[i]);
    if (stale && stale.el && stale.el._stickyNoteDispose) stale.el._stickyNoteDispose();
    if (stale && stale.el && stale.el.parentNode) stale.el.parentNode.removeChild(stale.el);
    clearNoteTimers(staleIds[i]);
    deleteNoteUiState(staleIds[i]);
    notes.delete(staleIds[i]);
  }

  // An all-patch list adds no icon markup and needs no document-wide scan.
  if (created) refreshIcons();

  updateBadge();
  updateSidebarBadge();
  refreshBrowser();

  if (openCount() > 0 && !notesVisible) {
    notesVisible = true;
    applyCanvasVisibility();
  }
  if (created) reclampAllNotes();
  syncFlightControls();
}

export function handleNoteCreated(msg) {
  var container = document.getElementById("sticky-notes-container");
  if (!container || !msg.note) return;

  // Don't duplicate
  if (notes.has(msg.note.id)) return;

  var el = renderNote(msg.note);
  notes.set(msg.note.id, { data: msg.note, el: el });
  container.appendChild(el);
  syncFlightState(el, true);
  updateBadge();
  updateSidebarBadge();
  refreshBrowser();

  // Show container if hidden, unless the user explicitly flew the notes out.
  if (!notesVisible && !store.get("notesTemporarilyHidden")) {
    notesVisible = true;
    applyCanvasVisibility();
  }
  reclampAllNotes();
  syncFlightControls();
}

// Canonical content reconciles through the store; geometry patches independently
// so movement and stacking updates preserve the editor and its draft.
// Return whether the minimize control introduced fresh icon markup.
function patchNote(entry, next) {
  if (!entry || !next) return false;
  entry.data = next;
  reconcileNote(next);
  var el = entry.el;

  el.style.left = next.x + "px";
  el.style.top = next.y + "px";
  el.style.width = next.w + "px";
  el.style.height = next.h + "px";
  el.style.zIndex = 100 + (next.zIndex || 0);
  el.dataset.color = next.color || "purple";

  if (typeof next.opacity === "number") {
    el.style.setProperty("--note-opacity", next.opacity);
    var slider = el.querySelector(".sticky-note-opacity-slider");
    if (slider) slider.value = String(Math.round(next.opacity * 100));
  }

  if (isClosedNote(next)) el.classList.add("hidden");
  else el.classList.remove("hidden");
  syncFlightState(el, true);

  var iconsReplaced = false;
  var wasMinimized = el.classList.contains("minimized");
  var minBtn = el.querySelector(".sticky-note-min-btn");
  if (next.minimized) {
    el.classList.add("minimized");
    if (minBtn && !wasMinimized) {
      minBtn.innerHTML = iconHtml("maximize-2");
      minBtn.title = "Expand";
      iconsReplaced = true;
    }
  } else {
    el.classList.remove("minimized");
    if (minBtn && wasMinimized) {
      minBtn.innerHTML = iconHtml("minus");
      minBtn.title = "Minimize";
      iconsReplaced = true;
    }
  }
  return iconsReplaced;
}

export function handleNoteUpdated(msg) {
  if (!msg.note) return;
  var entry = notes.get(msg.note.id);
  if (!entry) return;

  if (patchNote(entry, msg.note)) refreshIcons();
  reclampAllNotes();

  updateBadge();
  updateSidebarBadge();
  refreshBrowser();
}

export function handleNoteUpdateResult(msg) {
  var entry = notes.get(msg.noteId);
  if (!entry || !msg.requestId) return;
  var canonical = reconcileNoteResult(msg);
  if (canonical) { entry.data = canonical; refreshBrowser(); }
}

export function handleNoteWritten(msg) {
  var entry = notes.get(msg.id);
  if (!entry) return;
  entry.el.classList.remove("sticky-note-attention");
  void entry.el.offsetWidth;
  entry.el.classList.add("sticky-note-attention");
  setTimeout(function () {
    entry.el.classList.remove("sticky-note-attention");
  }, 2100);
}

export function handleNoteDeleted(msg) {
  var entry = notes.get(msg.id);
  if (entry && entry.el._stickyNoteDispose) entry.el._stickyNoteDispose();
  if (entry) entry.el.remove();
  deleteNoteUiState(msg.id);
  clearNoteTimers(msg.id);
  notes.delete(msg.id);
  updateBadge();
  updateSidebarBadge();

  refreshBrowser();
}

// --- Sidebar badge ---

function updateSidebarBadge() {
  var badge = document.getElementById("sticky-notes-sidebar-count");
  if (!badge) return;
  var count = openCount();
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

export function isNotesVisible() {
  return notesVisible;
}

// Project navigation must cancel writes and detach subscriptions before reuse.
export function resetStickyNotes() {
  handleNotesList({ notes: [] });
  closeFormatToolbar();
  closeColorPicker();
}

store.subscribe(function (next, previous) {
  if (next.currentSlug !== previous.currentSlug) resetStickyNotes();
});
