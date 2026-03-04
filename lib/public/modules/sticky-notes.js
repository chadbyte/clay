import { refreshIcons, iconHtml } from './icons.js';

var ctx;
var notes = new Map();  // id -> { data, el }
var notesVisible = false;
var updateTimers = {};
var textTimers = {};
var colorPickerEl = null;

var NOTE_COLORS = ["yellow", "blue", "green", "pink", "orange", "purple"];

function getContainerBounds() {
  var c = document.getElementById("sticky-notes-container");
  if (!c || c.clientWidth === 0 || c.clientHeight === 0) return null;
  return { w: c.clientWidth, h: c.clientHeight };
}

function clampPos(x, y, noteW, noteH) {
  var b = getContainerBounds();
  if (!b) return { x: x, y: y };
  return {
    x: Math.max(0, Math.min(x, b.w - noteW)),
    y: Math.max(0, Math.min(y, b.h - noteH)),
  };
}

function clampSize(x, y, w, h) {
  var b = getContainerBounds();
  if (!b) return { w: w, h: h };
  return {
    w: Math.min(w, b.w - x),
    h: Math.min(h, b.h - y),
  };
}

export function initStickyNotes(_ctx) {
  ctx = _ctx;

  var toggleBtn = document.getElementById("sticky-notes-toggle-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", function () {
      if (!notesVisible && notes.size > 0) {
        // Hidden with existing notes → just show them
        showNotes();
      } else {
        // Visible or no notes → create a new one
        showNotes();
        createNote();
      }
    });

    // Long-press or right-click to toggle hide
    toggleBtn.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (notesVisible) hideNotes();
    });
  }
}

// --- Visibility ---

function showNotes() {
  notesVisible = true;
  var container = document.getElementById("sticky-notes-container");
  var toggleBtn = document.getElementById("sticky-notes-toggle-btn");
  if (container) container.classList.remove("hidden");
  if (toggleBtn) toggleBtn.classList.add("active");
}

function hideNotes() {
  notesVisible = false;
  var container = document.getElementById("sticky-notes-container");
  var toggleBtn = document.getElementById("sticky-notes-toggle-btn");
  if (container) container.classList.add("hidden");
  if (toggleBtn) toggleBtn.classList.remove("active");
  closeColorPicker();
}

function createNote() {
  var container = document.getElementById("sticky-notes-container");
  if (!container) return;
  // Scatter position so notes don't stack exactly
  var offset = (notes.size % 5) * 30;
  wsSend({
    type: "note_create",
    x: 60 + offset,
    y: 60 + offset,
    color: "yellow",
  });
}

function updateBadge() {
  var badge = document.querySelector(".sticky-notes-count");
  if (!badge) return;
  if (notes.size > 0) {
    badge.textContent = notes.size;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// --- WS send helpers ---

function wsSend(obj) {
  if (ctx && ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify(obj));
  }
}

function debouncedUpdate(id, changes, delay) {
  clearTimeout(updateTimers[id]);
  updateTimers[id] = setTimeout(function () {
    changes.type = "note_update";
    changes.id = id;
    wsSend(changes);
  }, delay || 300);
}

function debouncedTextUpdate(id, text) {
  clearTimeout(textTimers[id]);
  textTimers[id] = setTimeout(function () {
    wsSend({ type: "note_update", id: id, text: text });
  }, 500);
}

// --- Simple markdown ---

function getTitle(text) {
  if (!text) return "";
  var idx = text.indexOf("\n");
  return idx === -1 ? text : text.substring(0, idx);
}

function renderMiniMarkdown(text) {
  if (!text) return "";
  var lines = text.split("\n");
  var title = lines[0];
  var body = lines.slice(1).join("\n");

  function fmt(s) {
    var escaped = s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/^- \[x\]/gm, '<span class="sn-check checked">✓</span>')
      .replace(/^- \[ \]/gm, '<span class="sn-check">☐</span>')
      .replace(/\n/g, "<br>");
  }

  var html = '<div class="sn-title">' + fmt(title) + '</div>';
  if (body.trim()) {
    html += fmt(body);
  }
  return html;
}

function syncTitle(noteEl, text) {
  var spacer = noteEl.querySelector(".sticky-note-spacer");
  if (spacer) spacer.textContent = getTitle(text);
}

// --- Note rendering ---

function renderNote(data) {
  var el = document.createElement("div");
  el.className = "sticky-note";
  el.dataset.noteId = data.id;
  var clamped = clampPos(data.x, data.y, data.w, data.h);
  el.style.left = clamped.x + "px";
  el.style.top = clamped.y + "px";
  el.style.width = data.w + "px";
  el.style.height = data.h + "px";
  el.style.zIndex = 100 + (data.zIndex || 0);
  el.dataset.color = data.color || "yellow";

  if (data.minimized) el.classList.add("minimized");

  // Header
  var header = document.createElement("div");
  header.className = "sticky-note-header";

  var deleteBtn = document.createElement("button");
  deleteBtn.className = "sticky-note-btn sticky-note-delete";
  deleteBtn.title = "Delete";
  deleteBtn.innerHTML = iconHtml("x");
  header.appendChild(deleteBtn);

  var minBtn = document.createElement("button");
  minBtn.className = "sticky-note-btn sticky-note-min-btn";
  minBtn.title = data.minimized ? "Expand" : "Minimize";
  minBtn.innerHTML = data.minimized ? iconHtml("maximize-2") : iconHtml("minus");
  header.appendChild(minBtn);

  var spacer = document.createElement("div");
  spacer.className = "sticky-note-spacer";
  spacer.textContent = getTitle(data.text);
  header.appendChild(spacer);

  var addBtn = document.createElement("button");
  addBtn.className = "sticky-note-btn";
  addBtn.title = "New note";
  addBtn.innerHTML = iconHtml("plus");
  addBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    createNote();
  });
  header.appendChild(addBtn);

  var colorBtn = document.createElement("button");
  colorBtn.className = "sticky-note-color-btn";
  colorBtn.title = "Change color";
  colorBtn.innerHTML = iconHtml("palette");
  header.appendChild(colorBtn);

  el.appendChild(header);

  // Body
  var body = document.createElement("div");
  body.className = "sticky-note-body";

  var textarea = document.createElement("textarea");
  textarea.className = "sticky-note-text";
  textarea.value = data.text || "";
  textarea.placeholder = "Type a note...";
  body.appendChild(textarea);

  var rendered = document.createElement("div");
  rendered.className = "sticky-note-rendered";
  body.appendChild(rendered);

  // Show rendered view if there's content
  if (data.text) {
    rendered.innerHTML = renderMiniMarkdown(data.text);
    textarea.style.display = "none";
    rendered.style.display = "";
  } else {
    textarea.style.display = "";
    rendered.style.display = "none";
  }

  el.appendChild(body);

  // Resize handle
  var resizeHandle = document.createElement("div");
  resizeHandle.className = "sticky-note-resize";
  el.appendChild(resizeHandle);

  // --- Event handlers ---
  setupDrag(el, spacer, data.id);
  setupResize(el, resizeHandle, data.id);
  setupTextEdit(textarea, rendered, data.id);
  setupColorPicker(colorBtn, el, data.id);
  setupMinimize(minBtn, el, data.id);
  setupDelete(deleteBtn, data.id);
  setupBringToFront(el, data.id);

  refreshIcons();
  return el;
}

// --- Drag ---

function setupDrag(noteEl, spacerEl, noteId) {
  var dragging = false;
  var startX, startY, origX, origY;

  spacerEl.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = parseInt(noteEl.style.left) || 0;
    origY = parseInt(noteEl.style.top) || 0;
    noteEl.classList.add("dragging");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  function onMove(e) {
    if (!dragging) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    var c = clampPos(origX + dx, origY + dy, noteEl.offsetWidth, noteEl.offsetHeight);
    noteEl.style.left = c.x + "px";
    noteEl.style.top = c.y + "px";
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    noteEl.classList.remove("dragging");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    debouncedUpdate(noteId, {
      x: parseInt(noteEl.style.left),
      y: parseInt(noteEl.style.top),
    }, 200);
  }

  // Touch support
  spacerEl.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    var touch = e.touches[0];
    dragging = true;
    startX = touch.clientX;
    startY = touch.clientY;
    origX = parseInt(noteEl.style.left) || 0;
    origY = parseInt(noteEl.style.top) || 0;
    noteEl.classList.add("dragging");
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  }, { passive: true });

  function onTouchMove(e) {
    if (!dragging) return;
    e.preventDefault();
    var touch = e.touches[0];
    var dx = touch.clientX - startX;
    var dy = touch.clientY - startY;
    var c = clampPos(origX + dx, origY + dy, noteEl.offsetWidth, noteEl.offsetHeight);
    noteEl.style.left = c.x + "px";
    noteEl.style.top = c.y + "px";
  }

  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;
    noteEl.classList.remove("dragging");
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    debouncedUpdate(noteId, {
      x: parseInt(noteEl.style.left),
      y: parseInt(noteEl.style.top),
    }, 200);
  }
}

// --- Resize ---

function setupResize(noteEl, handle, noteId) {
  var resizing = false;
  var startX, startY, origW, origH;
  var MIN_W = 160;
  var MIN_H = 80;

  handle.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    origW = noteEl.offsetWidth;
    origH = noteEl.offsetHeight;
    noteEl.classList.add("resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  function onMove(e) {
    if (!resizing) return;
    var rawW = Math.max(MIN_W, origW + (e.clientX - startX));
    var rawH = Math.max(MIN_H, origH + (e.clientY - startY));
    var cs = clampSize(parseInt(noteEl.style.left) || 0, parseInt(noteEl.style.top) || 0, rawW, rawH);
    noteEl.style.width = Math.max(MIN_W, cs.w) + "px";
    noteEl.style.height = Math.max(MIN_H, cs.h) + "px";
  }

  function onUp() {
    if (!resizing) return;
    resizing = false;
    noteEl.classList.remove("resizing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    debouncedUpdate(noteId, {
      w: noteEl.offsetWidth,
      h: noteEl.offsetHeight,
    }, 200);
  }

  // Touch resize
  handle.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    var touch = e.touches[0];
    resizing = true;
    startX = touch.clientX;
    startY = touch.clientY;
    origW = noteEl.offsetWidth;
    origH = noteEl.offsetHeight;
    noteEl.classList.add("resizing");
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  }, { passive: true });

  function onTouchMove(e) {
    if (!resizing) return;
    e.preventDefault();
    var touch = e.touches[0];
    var rawW = Math.max(MIN_W, origW + (touch.clientX - startX));
    var rawH = Math.max(MIN_H, origH + (touch.clientY - startY));
    var cs = clampSize(parseInt(noteEl.style.left) || 0, parseInt(noteEl.style.top) || 0, rawW, rawH);
    noteEl.style.width = Math.max(MIN_W, cs.w) + "px";
    noteEl.style.height = Math.max(MIN_H, cs.h) + "px";
  }

  function onTouchEnd() {
    if (!resizing) return;
    resizing = false;
    noteEl.classList.remove("resizing");
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    debouncedUpdate(noteId, {
      w: noteEl.offsetWidth,
      h: noteEl.offsetHeight,
    }, 200);
  }
}

// --- Text edit ---

function switchToEdit(textarea, rendered) {
  rendered.style.display = "none";
  textarea.style.display = "";
  textarea.focus();
}

function setupTextEdit(textarea, rendered, noteId) {
  var noteEl = textarea.closest(".sticky-note");
  var spacer = noteEl.querySelector(".sticky-note-spacer");

  textarea.addEventListener("input", function () {
    debouncedTextUpdate(noteId, textarea.value);
    syncTitle(noteEl, textarea.value);
  });

  // Click spacer → switch to edit
  if (spacer) {
    spacer.addEventListener("click", function () {
      if (noteEl.classList.contains("minimized")) return;
      switchToEdit(textarea, rendered);
    });
  }

  // Click rendered → switch to edit
  rendered.addEventListener("mousedown", function (e) {
    e.stopPropagation();
  });
  rendered.addEventListener("click", function (e) {
    if (e.target.tagName === "A") return;
    switchToEdit(textarea, rendered);
  });

  // Blur textarea → switch to rendered (if has content)
  textarea.addEventListener("blur", function () {
    if (textarea.value.trim()) {
      rendered.innerHTML = renderMiniMarkdown(textarea.value);
      textarea.style.display = "none";
      rendered.style.display = "";
    }
  });

  // Prevent drag when clicking textarea
  textarea.addEventListener("mousedown", function (e) {
    e.stopPropagation();
  });
}

// --- Color picker ---

function closeColorPicker() {
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
        wsSend({ type: "note_update", id: noteId, color: color });
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
    wsSend({ type: "note_update", id: noteId, minimized: isMinimized });
  });
}

// --- Delete ---

function setupDelete(btn, noteId) {
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    wsSend({ type: "note_delete", id: noteId });
  });
}

// --- Bring to front ---

function setupBringToFront(noteEl, noteId) {
  noteEl.addEventListener("mousedown", function (e) {
    // Skip bring-to-front when clicking header buttons to avoid
    // race condition where server response replaces innerHTML
    // between mousedown and click, causing the click event to be lost
    if (e.target.closest("button")) return;
    wsSend({ type: "note_bring_front", id: noteId });
  });
}

// --- WS message handlers ---

export function handleNotesList(msg) {
  var container = document.getElementById("sticky-notes-container");
  if (!container) return;

  // Clear existing
  container.innerHTML = "";
  notes.clear();

  var list = msg.notes || [];
  for (var i = 0; i < list.length; i++) {
    var el = renderNote(list[i]);
    notes.set(list[i].id, { data: list[i], el: el });
    container.appendChild(el);
  }

  updateBadge();

  // Auto-show if there are notes
  if (list.length > 0 && !notesVisible) {
    notesVisible = true;
    container.classList.remove("hidden");
    var toggleBtn = document.getElementById("sticky-notes-toggle-btn");
    if (toggleBtn) toggleBtn.classList.add("active");
  }
}

export function handleNoteCreated(msg) {
  var container = document.getElementById("sticky-notes-container");
  if (!container || !msg.note) return;

  // Don't duplicate
  if (notes.has(msg.note.id)) return;

  var el = renderNote(msg.note);
  notes.set(msg.note.id, { data: msg.note, el: el });
  container.appendChild(el);
  updateBadge();

  // Show container if hidden
  if (!notesVisible) {
    notesVisible = true;
    container.classList.remove("hidden");
    var toggleBtn = document.getElementById("sticky-notes-toggle-btn");
    if (toggleBtn) toggleBtn.classList.add("active");
  }
}

export function handleNoteUpdated(msg) {
  if (!msg.note) return;
  var entry = notes.get(msg.note.id);
  if (!entry) return;

  entry.data = msg.note;

  // Update DOM
  entry.el.style.left = msg.note.x + "px";
  entry.el.style.top = msg.note.y + "px";
  entry.el.style.width = msg.note.w + "px";
  entry.el.style.height = msg.note.h + "px";
  entry.el.style.zIndex = 100 + (msg.note.zIndex || 0);
  entry.el.dataset.color = msg.note.color || "yellow";

  // Update text only if not actively editing
  var textarea = entry.el.querySelector(".sticky-note-text");
  var rendered = entry.el.querySelector(".sticky-note-rendered");
  if (textarea && textarea !== document.activeElement) {
    textarea.value = msg.note.text || "";
    if (rendered && msg.note.text) {
      rendered.innerHTML = renderMiniMarkdown(msg.note.text);
    }
    syncTitle(entry.el, msg.note.text);
  }

  var minBtn = entry.el.querySelector(".sticky-note-min-btn");
  if (msg.note.minimized) {
    entry.el.classList.add("minimized");
    if (minBtn) { minBtn.innerHTML = iconHtml("maximize-2"); minBtn.title = "Expand"; }
  } else {
    entry.el.classList.remove("minimized");
    if (minBtn) { minBtn.innerHTML = iconHtml("minus"); minBtn.title = "Minimize"; }
  }
  refreshIcons();
}

export function handleNoteDeleted(msg) {
  var entry = notes.get(msg.id);
  if (!entry) return;
  entry.el.remove();
  notes.delete(msg.id);
  updateBadge();

  // Clear debounce timers
  clearTimeout(updateTimers[msg.id]);
  clearTimeout(textTimers[msg.id]);
  delete updateTimers[msg.id];
  delete textTimers[msg.id];
}
