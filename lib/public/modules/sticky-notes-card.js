// One floating sticky-note card: its markup, its drag and resize behaviour, and
// its header controls (colour, minimize, close, bring to front).
//
// The card knows how to build and wire itself. It does not own the board, so it
// never touches the notes map or the badges; the canvas module holds those and
// calls renderNote for each note.

import { refreshIcons, iconHtml } from './icons.js';
import { VENDOR_AVATARS } from './app-rendering.js';
import { getTitle, renderMiniMarkdown } from './sticky-note-markdown.js';
import { enhanceClayLogLinks } from './clay-log-links.js';
import {
  NOTE_COLORS,
  isClosedNote,
  send,
  clampPos,
  clampSize,
  debouncedUpdate,
} from './sticky-notes-shared.js';
import { closeHumanNote } from './sticky-notes-actions.js';
import { setupTextEdit } from './sticky-notes-editor.js';

var colorPickerEl = null;

// --- Note rendering ---

export function renderNote(data) {
  var el = document.createElement("div");
  el.className = "sticky-note";
  el.dataset.noteId = data.id;
  var clamped = clampPos(data.x, data.y, data.w, data.h);
  el.style.left = clamped.x + "px";
  el.style.top = clamped.y + "px";
  el.style.width = data.w + "px";
  el.style.height = data.h + "px";
  el.style.zIndex = 100 + (data.zIndex || 0);
  el.dataset.color = data.color || "purple";

  if (data.minimized) el.classList.add("minimized");
  if (isClosedNote(data)) el.classList.add("hidden");

  // Header
  var header = document.createElement("div");
  header.className = "sticky-note-header";

  if (data.origin && VENDOR_AVATARS[data.origin.vendor]) {
    var originBadge = document.createElement("img");
    originBadge.className = "sticky-note-agent-badge";
    originBadge.src = VENDOR_AVATARS[data.origin.vendor];
    originBadge.alt = "";
    originBadge.title = "Created by " + data.origin.vendor;
    header.appendChild(originBadge);
  }

  var closeBtn = document.createElement("button");
  closeBtn.className = "sticky-note-btn sticky-note-close";
  closeBtn.title = "Close";
  closeBtn.innerHTML = iconHtml("x");
  header.appendChild(closeBtn);

  var minBtn = document.createElement("button");
  minBtn.className = "sticky-note-btn sticky-note-min-btn";
  minBtn.title = data.minimized ? "Expand" : "Minimize";
  minBtn.innerHTML = data.minimized ? iconHtml("maximize-2") : iconHtml("minus");
  header.appendChild(minBtn);

  var spacer = document.createElement("div");
  spacer.className = "sticky-note-spacer";
  spacer.textContent = getTitle(data.text) || "Untitled";
  header.appendChild(spacer);

  var addBtn = document.createElement("button");
  addBtn.className = "sticky-note-btn";
  addBtn.title = "New note";
  addBtn.innerHTML = iconHtml("plus");
  addBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    send({ type: "note_create", x: 60, y: 60, color: "purple", opacity: 0.64 });
  });
  header.appendChild(addBtn);

  var colorBtn = document.createElement("button");
  colorBtn.className = "sticky-note-color-btn";
  colorBtn.title = "Change color";
  colorBtn.innerHTML = iconHtml("palette");
  header.appendChild(colorBtn);

  var mdBtn = document.createElement("button");
  mdBtn.className = "sticky-note-btn sticky-note-md-btn";
  mdBtn.title = "Edit markdown";
  mdBtn.innerHTML = "<span class='sn-md-label'>MD</span>";
  header.appendChild(mdBtn);

  var checklistBtn = document.createElement("button");
  checklistBtn.className = "sticky-note-btn sticky-note-checklist-btn";
  checklistBtn.title = data.checklistMode ? "Show note" : "Show checklist";
  checklistBtn.setAttribute("aria-label", checklistBtn.title);
  checklistBtn.setAttribute("aria-pressed", data.checklistMode === true ? "true" : "false");
  checklistBtn.innerHTML = iconHtml("list-check");
  if (data.checklistMode) checklistBtn.classList.add("active");
  header.appendChild(checklistBtn);

  var saveStatus = document.createElement("span");
  saveStatus.className = "sticky-note-save-status";
  saveStatus.setAttribute("role", "status");
  saveStatus.setAttribute("aria-live", "polite");
  header.appendChild(saveStatus);

  var opacityWrap = document.createElement("div");
  opacityWrap.className = "sticky-note-opacity";
  var opacitySlider = document.createElement("input");
  opacitySlider.type = "range";
  opacitySlider.min = "20";
  opacitySlider.max = "100";
  opacitySlider.value = String(Math.round((typeof data.opacity === "number" ? data.opacity : 0.64) * 100));
  opacitySlider.className = "sticky-note-opacity-slider";
  opacitySlider.title = "Opacity";
  opacityWrap.appendChild(opacitySlider);
  header.appendChild(opacityWrap);

  // Apply saved opacity via CSS variable (not element opacity, so header stays visible on hover)
  if (typeof data.opacity === "number") {
    el.style.setProperty("--note-opacity", data.opacity);
  }

  opacitySlider.addEventListener("input", function (e) {
    e.stopPropagation();
    var val = parseInt(opacitySlider.value, 10) / 100;
    el.style.setProperty("--note-opacity", val);
  });
  opacitySlider.addEventListener("change", function (e) {
    e.stopPropagation();
    var val = parseInt(opacitySlider.value, 10) / 100;
    el.style.setProperty("--note-opacity", val);
    debouncedUpdate(data.id, { opacity: val }, 300);
  });
  opacitySlider.addEventListener("mousedown", function (e) { e.stopPropagation(); });

  el.appendChild(header);

  // Body
  var body = document.createElement("div");
  body.className = "sticky-note-body";

  // Hidden textarea as markdown data store
  var textarea = document.createElement("textarea");
  textarea.className = "sticky-note-text";
  textarea.value = data.text || "";
  textarea.style.display = "none";
  body.appendChild(textarea);

  // Contenteditable rendered view (primary editing surface)
  var rendered = document.createElement("div");
  rendered.className = "sticky-note-rendered";
  rendered.contentEditable = "true";
  rendered.spellcheck = true;
  if (data.text && data.text.trim()) {
    rendered.innerHTML = renderMiniMarkdown(data.text, { checklistMode: data.checklistMode === true, checklistState: data.checklistState || [] });
    enhanceClayLogLinks(rendered);
  } else {
    rendered.classList.add("is-empty");
  }
  rendered.contentEditable = data.checklistMode === true ? "false" : "true";
  body.appendChild(rendered);

  el.appendChild(body);

  // Resize handle
  var resizeHandle = document.createElement("div");
  resizeHandle.className = "sticky-note-resize";
  el.appendChild(resizeHandle);

  // --- Event handlers ---
  setupDrag(el, spacer, data.id);
  setupResize(el, resizeHandle, data.id);
  setupTextEdit(textarea, rendered, data.id, mdBtn, checklistBtn, data);
  setupColorPicker(colorBtn, el, data.id);
  setupMinimize(minBtn, el, data.id);
  setupClose(closeBtn, el, data.id);
  setupBringToFront(el, data.id);

  refreshIcons();
  return el;
}
// --- Drag ---

function setupDrag(noteEl, spacerEl, noteId) {
  var dragging = false;
  var pointerId = null;
  var startX, startY, origX, origY;

  spacerEl.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    origX = parseInt(noteEl.style.left) || 0;
    origY = parseInt(noteEl.style.top) || 0;
    noteEl.classList.add("dragging");
    document.body.classList.add("sticky-note-interacting");
    spacerEl.setPointerCapture(pointerId);
  });

  function onMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    var c = clampPos(origX + dx, origY + dy, noteEl.offsetWidth, noteEl.offsetHeight);
    noteEl.style.left = c.x + "px";
    noteEl.style.top = c.y + "px";
  }

  function onUp(e) {
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    dragging = false;
    noteEl.classList.remove("dragging");
    document.body.classList.remove("sticky-note-interacting");
    if (pointerId !== null && spacerEl.hasPointerCapture(pointerId)) spacerEl.releasePointerCapture(pointerId);
    pointerId = null;
    debouncedUpdate(noteId, {
      x: parseInt(noteEl.style.left),
      y: parseInt(noteEl.style.top),
    }, 200);
  }

  spacerEl.addEventListener("pointermove", onMove);
  spacerEl.addEventListener("pointerup", onUp);
  spacerEl.addEventListener("pointercancel", onUp);
  spacerEl.addEventListener("lostpointercapture", onUp);
}

// --- Resize ---

function setupResize(noteEl, handle, noteId) {
  var resizing = false;
  var pointerId = null;
  var startX, startY, origW, origH;
  var MIN_W = 160;
  var MIN_H = 80;

  handle.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    origW = noteEl.offsetWidth;
    origH = noteEl.offsetHeight;
    noteEl.classList.add("resizing");
    document.body.classList.add("sticky-note-interacting");
    handle.setPointerCapture(pointerId);
  });

  function onMove(e) {
    if (!resizing || e.pointerId !== pointerId) return;
    var rawW = Math.max(MIN_W, origW + (e.clientX - startX));
    var rawH = Math.max(MIN_H, origH + (e.clientY - startY));
    var cs = clampSize(parseInt(noteEl.style.left) || 0, parseInt(noteEl.style.top) || 0, rawW, rawH);
    noteEl.style.width = Math.max(MIN_W, cs.w) + "px";
    noteEl.style.height = Math.max(MIN_H, cs.h) + "px";
  }

  function onUp(e) {
    if (!resizing || (e && e.pointerId !== pointerId)) return;
    resizing = false;
    noteEl.classList.remove("resizing");
    document.body.classList.remove("sticky-note-interacting");
    if (pointerId !== null && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    pointerId = null;
    debouncedUpdate(noteId, {
      w: noteEl.offsetWidth,
      h: noteEl.offsetHeight,
    }, 200);
  }

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
  handle.addEventListener("lostpointercapture", onUp);
}

// --- Color picker ---

export function closeColorPicker() {
  if (colorPickerEl) {
    colorPickerEl.remove();
    colorPickerEl = null;
  }
}

function setupColorPicker(btn, noteEl, noteId) {
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    showColorPicker(btn, noteEl, noteId);
  });
}

function showColorPicker(anchor, noteEl, noteId) {
  closeColorPicker();

  var picker = document.createElement("div");
  picker.className = "sticky-note-color-picker";

  for (var i = 0; i < NOTE_COLORS.length; i++) {
    (function (color) {
      var dot = document.createElement("button");
      dot.className = "sticky-note-color-dot";
      dot.dataset.color = color;
      if (noteEl.dataset.color === color) dot.classList.add("active");
      dot.addEventListener("click", function (e) {
        e.stopPropagation();
        noteEl.dataset.color = color;
        send({ type: "note_update", id: noteId, color: color });
        closeColorPicker();
      });
      picker.appendChild(dot);
    })(NOTE_COLORS[i]);
  }

  document.body.appendChild(picker);
  colorPickerEl = picker;

  // Position relative to anchor
  var rect = anchor.getBoundingClientRect();
  picker.style.left = rect.left + "px";
  picker.style.top = (rect.bottom + 4) + "px";

  // Close on outside click
  setTimeout(function () {
    document.addEventListener("click", function closeHandler() {
      closeColorPicker();
      document.removeEventListener("click", closeHandler);
    });
  }, 0);
}

// --- Minimize ---

function setupMinimize(btn, noteEl, noteId) {
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    var isMinimized = noteEl.classList.toggle("minimized");
    btn.innerHTML = isMinimized ? iconHtml("maximize-2") : iconHtml("minus");
    btn.title = isMinimized ? "Expand" : "Minimize";
    refreshIcons();
    send({ type: "note_update", id: noteId, minimized: isMinimized });
  });
}

// --- Close note ---
//
// The human close transaction retains nonempty notes in Closed and removes
// truly empty notes after checking the canonical source and visible draft.

function setupClose(btn, noteEl, noteId) {
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    closeHumanNote(noteId);
  });
}

// --- Bring to front ---

function setupBringToFront(noteEl, noteId) {
  noteEl.addEventListener("mousedown", function (e) {
    // Skip bring-to-front when clicking header buttons to avoid
    // race condition where server response replaces innerHTML
    // between mousedown and click, causing the click event to be lost
    if (e.target.closest("button")) return;
    send({ type: "note_bring_front", id: noteId });
  });
}
