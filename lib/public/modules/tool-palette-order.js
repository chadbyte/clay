// tool-palette-order.js — the tool registry and the pure ordering rules.
//
// Extracted from tool-palette.js, which owns the DOM. Everything here is
// pure data and pure functions over id lists: what tools exist, and what a
// stored preference means today. Keeping it separate keeps the palette module
// under the size limit and makes the ordering rules directly testable without
// a browser.
//
// Two kinds of rule act on a stored preference, in this order:
//   - legacy remap:  an id that was replaced by another tool
//   - retirement:    an id whose tool was withdrawn with no replacement
//
// Neither rule ever overrides a live choice. A preference naming a tool that
// still exists is honored exactly as saved; registry order is only the default
// for a fresh palette and the append order for tools a saved list predates.

// Registry order = default order for users who haven't customized. Users
// with saved preferences keep their own order (applyPreferences uses
// saved order first, then appends any registry entries the user's saved
// list doesn't mention). So changes here only affect fresh palettes.
var SESSION_TOOLS = [
  { id: "file-browser-btn",        icon: "folder-tree",    label: "File browser" },
  { id: "terminal-sidebar-btn",    icon: "square-terminal", label: "Terminal",        countId: "terminal-sidebar-count" },
  { id: "sticky-notes-sidebar-btn", icon: "sticky-note",   label: "Sticky Notes",    countId: "sticky-notes-sidebar-count" },
  { id: "project-logs-btn",        icon: "notebook-tabs",  label: "Logs",            countId: "project-logs-count" },
  { id: "mcp-btn",                 icon: "cable",          label: "MCP Servers",     countId: "mcp-sidebar-count" },
  { id: "skills-btn",              icon: "puzzle",         label: "Skills" },
  { id: "scheduler-btn",           icon: "calendar-clock", label: "Scheduled" },
];

var MATE_TOOLS = [
  { id: "mate-memory-btn",       icon: "brain",          label: "Memory",          countId: "mate-memory-count" },
  { id: "mate-knowledge-btn",    icon: "book-open",      label: "Knowledge",       countId: "mate-knowledge-count" },
  { id: "mate-sticky-notes-btn", icon: "sticky-note",    label: "Sticky Notes" },
  { id: "mate-debate-btn",       icon: "mic",            label: "Debate" },
  { id: "mate-mcp-btn",          icon: "cable",          label: "MCP Servers",     countId: "mate-mcp-sidebar-count" },
  { id: "mate-skills-btn",       icon: "puzzle",         label: "Skills" },
];

export var PALETTES = {
  session: {
    tools: SESSION_TOOLS,
    activeContainerId: "session-actions",
    hiddenSectionId: "session-actions-hidden",
  },
  mate: {
    tools: MATE_TOOLS,
    activeContainerId: "mate-sidebar-tools",
    hiddenSectionId: "mate-sidebar-tools-hidden",
  },
};

// Tools that were replaced in the session palette. A saved preference naming
// the old id would otherwise silently drop out (its element no longer exists)
// and the replacement would append to the end of the palette instead of
// inheriting the slot the user had chosen.
//
// There is no active remap. "scheduler-btn" used to map to "project-logs-btn"
// from when Logs took the Scheduled Tasks slot; that remap is retired because
// Scheduled Tasks is a live tool again, so a stored "scheduler-btn" once more
// means exactly what it says and rewriting it would destroy the user's own
// choice. The mechanism stays as the seam for the next replacement.
var LEGACY_SESSION_TOOL_IDS = {};

// Tools withdrawn from the session palette with no replacement. Git moved to
// the always-visible repository placard below the tool strip, so it no longer
// consumes an icon slot. A saved preference naming it is dropped rather than
// left to linger in stored order forever.
var RETIRED_SESSION_TOOL_IDS = ["git-sidebar-btn", "loop-tool-btn"];

function indexOfId(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] === id) return i;
  }
  return -1;
}

// Rewrite a saved preference so a replaced tool keeps its slot.
//
// If the user already has an explicit preference for the replacement, that
// choice wins and the legacy id is simply dropped: their position, and whether
// they hid it, are never overridden. Otherwise the legacy id is replaced in
// place, at the exact index it occupied, in whichever list it appeared in.
//
// Exported for tests; returns new arrays and never mutates the input.
export function normalizeToolPreferences(name, prefs) {
  var order = (prefs && prefs.order) || [];
  var hidden = (prefs && prefs.hidden) || [];
  var result = { order: order.slice(), hidden: hidden.slice(), migrated: false };
  if (name !== "session") return result;

  var legacyIds = Object.keys(LEGACY_SESSION_TOOL_IDS);
  for (var i = 0; i < legacyIds.length; i++) {
    var legacyId = legacyIds[i];
    var replacementId = LEGACY_SESSION_TOOL_IDS[legacyId];
    var inOrder = indexOfId(result.order, legacyId) !== -1;
    var inHidden = indexOfId(result.hidden, legacyId) !== -1;
    if (!inOrder && !inHidden) continue;

    var explicit = indexOfId(result.order, replacementId) !== -1
      || indexOfId(result.hidden, replacementId) !== -1;
    result.order = rewriteList(result.order, legacyId, replacementId, explicit);
    result.hidden = rewriteList(result.hidden, legacyId, replacementId, explicit);
    result.migrated = true;
  }

  for (var r = 0; r < RETIRED_SESSION_TOOL_IDS.length; r++) {
    var retiredId = RETIRED_SESSION_TOOL_IDS[r];
    if (indexOfId(result.order, retiredId) === -1 && indexOfId(result.hidden, retiredId) === -1) continue;
    result.order = dropId(result.order, retiredId);
    result.hidden = dropId(result.hidden, retiredId);
    result.migrated = true;
  }
  return result;
}

function dropId(list, id) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] !== id) out.push(list[i]);
  }
  return out;
}

// Drop the legacy id when the replacement is already chosen explicitly;
// otherwise swap it in place. Any duplicate of the replacement introduced by
// the swap is removed, keeping the first occurrence.
function rewriteList(list, legacyId, replacementId, dropLegacy) {
  var out = [];
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var id = list[i];
    if (id === legacyId) {
      if (dropLegacy) continue;
      id = replacementId;
    }
    if (seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}
