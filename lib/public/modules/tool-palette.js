// tool-palette.js — Sidebar tool palette
//
// Renders the per-session and per-mate tool grids from a data registry and
// lets users reorder them. Preserves the original button IDs so existing
// click handlers (attached by sidebar.js, terminal.js, mcp-ui.js, etc.) keep
// working on the rendered nodes.
//
// Design notes:
// - Buttons are created once on init and never destroyed; reorder moves
//   existing DOM nodes, so event listeners bound elsewhere survive.
// - Tools can no longer be hidden or added back. A tool a saved preference
//   marks hidden is simply shown, appended after the ordered tools, and the
//   stored preference is not rewritten on load.
// - Order persists per-user via the /api/user/tool-palettes endpoint. An
//   in-flight save is debounced so rapid drag reorders don't spam.

import { refreshIcons } from './icons.js';
import { PALETTES, normalizeToolPreferences } from './tool-palette-order.js';

var _saveTimers = {};
var _draggingEl = null;
var _draggingPaletteName = null;

export function initToolPalettes() {
  for (var name in PALETTES) {
    buildPalette(name);
  }

  // Load saved preferences and apply to both palettes once buttons exist.
  loadPreferences();

  refreshIcons();
}

function buildPalette(name) {
  var palette = PALETTES[name];
  var active = document.getElementById(palette.activeContainerId);
  if (!active) return;

  // Create buttons with stable IDs and append in registry order (default).
  for (var i = 0; i < palette.tools.length; i++) {
    active.appendChild(buildToolButton(palette.tools[i], name));
  }

  // Drag-reorder within the active container. Users can rearrange in
  // place (matches the macOS dock pattern). HTML5 drag has a small movement
  // threshold, so quick clicks still activate the tool normally.
  active.addEventListener('dragover', function (e) {
    if (_draggingPaletteName !== name || !_draggingEl) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    var after = getDragAfterElement(active, e.clientX, e.clientY);
    if (after == null) {
      if (_draggingEl.parentNode !== active || _draggingEl.nextSibling) {
        active.appendChild(_draggingEl);
      }
    } else if (after !== _draggingEl) {
      active.insertBefore(_draggingEl, after);
    }
  });
  active.addEventListener('drop', function (e) {
    if (_draggingPaletteName !== name) return;
    e.preventDefault();
  });
}

function buildToolButton(tool, paletteName) {
  var btn = document.createElement('button');
  btn.id = tool.id;
  btn.type = 'button';
  btn.className = 'palette-tile';
  btn.title = tool.label;
  btn.setAttribute('aria-label', tool.label);
  btn.dataset.toolId = tool.id;
  btn.dataset.palette = paletteName;
  // Draggable at all times so users can reorder in place.
  btn.draggable = true;

  var icon = document.createElement('i');
  icon.setAttribute('data-lucide', tool.icon);
  btn.appendChild(icon);

  var labelEl = document.createElement('span');
  labelEl.className = 'tool-btn-label';
  labelEl.textContent = tool.label;
  btn.appendChild(labelEl);

  if (tool.countId) {
    var count = document.createElement('span');
    count.id = tool.countId;
    count.className = 'sidebar-badge hidden';
    btn.appendChild(count);
  }

  btn.addEventListener('dragstart', function (e) {
    var container = btn.parentNode;
    if (!container || container.id !== PALETTES[paletteName].activeContainerId) {
      e.preventDefault();
      return;
    }
    _draggingEl = btn;
    _draggingPaletteName = paletteName;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set for drag to start.
    try { e.dataTransfer.setData('text/plain', tool.id); } catch (err) { /* ignore */ }
    btn.classList.add('dragging');
  });
  btn.addEventListener('dragend', function () {
    btn.classList.remove('dragging');
    if (_draggingPaletteName) queueSave(_draggingPaletteName);
    _draggingEl = null;
    _draggingPaletteName = null;
  });

  return btn;
}

function getDragAfterElement(container, x, y) {
  var tiles = Array.prototype.slice.call(
    container.querySelectorAll('[data-tool-id]:not(.dragging)')
  );
  var closest = null;
  var closestDist = Number.POSITIVE_INFINITY;
  for (var i = 0; i < tiles.length; i++) {
    var rect = tiles[i].getBoundingClientRect();
    // Pointer is "before" the tile if it's left of the tile's horizontal
    // midpoint on the same row (or on a higher row).
    var rowDelta = y - (rect.top + rect.height / 2);
    var colDelta = x - (rect.left + rect.width / 2);
    // Weight row heavier than column so flowing between rows works.
    var dist = Math.abs(rowDelta) * 2 + Math.abs(colDelta);
    var before = rowDelta < -rect.height / 2
      || (Math.abs(rowDelta) <= rect.height / 2 && colDelta < 0);
    if (before && dist < closestDist) {
      closestDist = dist;
      closest = tiles[i];
    }
  }
  return closest;
}

// --- Persistence ---

function loadPreferences() {
  fetch('/api/user/tool-palettes', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data) return;
      applyPreferences('session', data.session || null);
      applyPreferences('mate', data.mate || null);
    })
    .catch(function () { /* first-time users have no saved prefs; ignore */ });
}

function applyPreferences(name, prefs) {
  if (!prefs) return;
  var palette = PALETTES[name];
  if (!palette) return;
  var active = document.getElementById(palette.activeContainerId);
  if (!active) return;

  var normalized = normalizeToolPreferences(name, prefs);
  var placed = {};
  function place(id) {
    if (placed[id]) return;
    var btn = document.getElementById(id);
    if (!btn) return;
    active.appendChild(btn);
    placed[id] = true;
  }

  // Saved order first, then tools the saved list predates in registry order,
  // then tools an older client had hidden. Hiding is no longer offered, so
  // those tools surface at the end instead of staying unreachable. Nothing
  // is written back here; the stored preference only changes on a reorder.
  var hiddenSet = {};
  for (var i = 0; i < normalized.hidden.length; i++) hiddenSet[normalized.hidden[i]] = true;
  for (var j = 0; j < normalized.order.length; j++) {
    if (!hiddenSet[normalized.order[j]]) place(normalized.order[j]);
  }
  for (var k = 0; k < palette.tools.length; k++) {
    if (!hiddenSet[palette.tools[k].id]) place(palette.tools[k].id);
  }
  for (var h = 0; h < normalized.hidden.length; h++) place(normalized.hidden[h]);
  for (var m = 0; m < palette.tools.length; m++) place(palette.tools[m].id);
}

function queueSave(name) {
  if (_saveTimers[name]) clearTimeout(_saveTimers[name]);
  _saveTimers[name] = setTimeout(function () {
    _saveTimers[name] = null;
    savePreferences(name);
  }, 250);
}

function savePreferences(name) {
  var palette = PALETTES[name];
  if (!palette) return;
  var active = document.getElementById(palette.activeContainerId);
  if (!active) return;

  var order = [];
  var activeTiles = active.querySelectorAll('[data-tool-id]');
  for (var i = 0; i < activeTiles.length; i++) order.push(activeTiles[i].dataset.toolId);

  // Every tool is visible, so the explicit order is the whole preference.
  fetch('/api/user/tool-palettes', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ palette: name, order: order, hidden: [] }),
  }).catch(function () { /* save best-effort */ });
}
