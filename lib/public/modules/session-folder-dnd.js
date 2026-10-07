// Live-preview drag and drop for reordering custom folders (desktop pointer).
//
// While a folder block is dragged, its neighbours slide aside (CSS transforms,
// expanded contents included) into the proposed order and the dragged block
// shows as a dashed placeholder in its proposed slot. Nothing is sent until a
// valid drop; cancel, Escape, outside drops, rerenders, project/DM changes and
// disconnects all restore the original order. Favorites and Unfiled are not
// part of the movable set, so they can neither move nor be displaced.
//
// Hit testing uses each block's ORIGINAL layout position (measured once at drag
// start, parent-relative), never its transformed position, so moving blocks
// cannot shift their own hitboxes and cause flicker. The drag lives in the store
// (sessionFolderDrag); this module only owns the functions.

import { store } from './store.js';
import { sendFolderOp } from './session-folders.js';

var SETTLE_FALLBACK_MS = 1500;
var WATCHDOG_MS = 500;
var STALE_MS = 1500;

function drag() {
  var current = store.get('sessionFolderDrag');
  return current && current.type === "folder" ? current : null;
}

function blockFor(id) {
  return document.querySelector('.session-folder-folder[data-folder-id="' + id + '"]');
}

function allBlocks() {
  return document.querySelectorAll(".session-folder-folder.folder-dnd");
}

function sameOrder(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function findEntry(layout, id) {
  for (var i = 0; i < layout.length; i++) if (layout[i].id === id) return layout[i];
  return null;
}

// Pure: where the dragged folder would land for a pointer at `y` (parent-relative).
export function proposeOrder(layout, id, y) {
  var others = layout.filter(function (entry) { return entry.id !== id; });
  var index = 0;
  for (var i = 0; i < others.length; i++) {
    if (others[i].top + others[i].height / 2 < y) index += 1;
  }
  var order = others.map(function (entry) { return entry.id; });
  order.splice(index, 0, id);
  return order;
}

// Pure: translateY for each folder so the stack matches `order`.
export function displacements(layout, gap, order) {
  var start = layout[0].top;
  for (var s = 1; s < layout.length; s++) if (layout[s].top < start) start = layout[s].top;
  var result = {};
  var cursor = start;
  for (var i = 0; i < order.length; i++) {
    var entry = findEntry(layout, order[i]);
    result[order[i]] = Math.round((cursor - entry.top) * 100) / 100;
    cursor += entry.height + gap;
  }
  return result;
}

function paint(state) {
  var blocks = allBlocks();
  var shifts = displacements(state.layout, state.gap, state.proposed);
  for (var i = 0; i < blocks.length; i++) {
    var id = blocks[i].dataset.folderId;
    var shift = shifts[id] || 0;
    blocks[i].style.transform = shift ? "translateY(" + shift + "px)" : "";
    blocks[i].classList.toggle("folder-dnd-source", id === state.id);
  }
}

function mark(state) {
  var movable = document.querySelectorAll(".session-folder-folder");
  for (var i = 0; i < movable.length; i++) movable[i].classList.add("folder-dnd");
  paint(state);
}

function unmark() {
  var blocks = allBlocks();
  for (var i = 0; i < blocks.length; i++) {
    blocks[i].style.transform = "";
    blocks[i].classList.remove("folder-dnd", "folder-dnd-source");
  }
}

function removeListeners() {
  document.removeEventListener("dragover", onDragOver, true);
  document.removeEventListener("drop", onDrop, true);
  document.removeEventListener("dragend", onDragEnd, true);
  document.removeEventListener("keydown", onKey, true);
}

export function cancelFolderDrag() {
  var state = drag();
  if (!state) return;
  removeListeners();
  unmark();
  store.set({ sessionFolderDrag: null });
}

function onDragOver(event) {
  var state = drag();
  if (!state || state.settling) return;
  var root = blockFor(state.id);
  var parent = root && root.parentElement;
  if (!parent) return;
  var rect = parent.getBoundingClientRect();
  var inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  var next = inside ? proposeOrder(state.layout, state.id, event.clientY - rect.top) : state.original;
  var now = Date.now();
  if (!sameOrder(next, state.proposed) || now - state.seen > 250 || state.inside !== inside) {
    var updated = Object.assign({}, state, { proposed: next, seen: now, inside: inside });
    store.set({ sessionFolderDrag: updated });
    if (!sameOrder(next, state.proposed)) paint(updated);
  }
  if (inside) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  } else if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "none";
  }
}

function onDrop(event) {
  var state = drag();
  if (!state || state.settling) return;
  if (!state.inside || sameOrder(state.proposed, state.original)) { cancelFolderDrag(); return; }
  event.preventDefault();
  var at = state.proposed.indexOf(state.id);
  var beforeId = at < state.proposed.length - 1 ? state.proposed[at + 1] : null;
  var targetId = beforeId || state.proposed[at - 1];
  // Keep the previewed order on screen until the server's snapshot rerenders it.
  store.set({ sessionFolderDrag: Object.assign({}, state, { settling: true, baseState: store.get('sessionFolders') }) });
  sendFolderOp({ op: "reorder_folder", folderId: state.id, targetId: targetId, insertBefore: !!beforeId });
  var token = state.id;
  setTimeout(function () {
    var current = drag();
    if (current && current.settling && current.id === token) cancelFolderDrag();
  }, SETTLE_FALLBACK_MS);
}

function onDragEnd() {
  var state = drag();
  if (state && !state.settling) cancelFolderDrag();
}

function onKey(event) {
  if (event.key === "Escape" && drag()) cancelFolderDrag();
}

function watchdog() {
  var state = drag();
  if (!state || state.settling) return;
  if (Date.now() - state.seen > STALE_MS) { cancelFolderDrag(); return; }
  setTimeout(watchdog, WATCHDOG_MS);
}

// Called after a list rerender replaced the DOM: the preview is re-applied to the
// fresh blocks, or dropped once the server snapshot it was waiting for arrived.
export function reapplyFolderDragPreview() {
  var state = drag();
  if (!state) return;
  if (state.settling && store.get('sessionFolders') !== state.baseState) { cancelFolderDrag(); return; }
  if (!blockFor(state.id)) { cancelFolderDrag(); return; }
  mark(state);
}

function ghostFor(label) {
  var ghost = document.createElement("div");
  ghost.className = "session-folder-drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  setTimeout(function () { ghost.remove(); }, 0);
  return ghost;
}

export function wireFolderDrag(header, folderId, label) {
  header.setAttribute("draggable", "true");
  header.addEventListener("dragstart", function (event) {
    var root = header.closest(".session-folder-folder");
    var parent = root && root.parentElement;
    if (!parent) return;
    var parentRect = parent.getBoundingClientRect();
    var blocks = Array.prototype.filter.call(parent.children, function (child) { return child.classList.contains("session-folder-folder"); });
    var layout = blocks.map(function (block) {
      var rect = block.getBoundingClientRect();
      return { id: block.dataset.folderId, top: rect.top - parentRect.top, height: rect.height };
    });
    var gap = layout.length > 1 ? Math.max(0, layout[1].top - (layout[0].top + layout[0].height)) : 2;
    var original = layout.map(function (entry) { return entry.id; });
    var state = { type: "folder", id: folderId, original: original, proposed: original.slice(), layout: layout, gap: gap, seen: Date.now(), inside: true, settling: false };
    store.set({ sessionFolderDrag: state });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", folderId);
    if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(ghostFor(label), 14, 14);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd, true);
    document.addEventListener("keydown", onKey, true);
    setTimeout(function () { var live = drag(); if (live) mark(live); }, 0);
    setTimeout(watchdog, WATCHDOG_MS);
  });
}
