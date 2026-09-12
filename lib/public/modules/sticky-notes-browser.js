// Sticky Notes browser: the bounded right workbench window over the board.
//
// This is the index/viewer surface, not the floating cards. The cards stay on
// the canvas over the conversation; this pane lists them, splits them into Open
// and Closed, and is where a note is completed or brought back.
//
// Completion here is Close, never delete. A closed note leaves the active
// canvas and moves to the Closed tab, where it stays readable and reversible.
// There is deliberately no destructive control on this surface at all.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { renderMiniMarkdown, getTitle } from './sticky-note-markdown.js';
import { enhanceClayLogLinks } from './clay-log-links.js';
import { send } from './sticky-notes-shared.js';
import { listNoteData, focusNoteOnCanvas, hideNotes, showNotes } from './sticky-notes.js';

var panel = null;
var gridEl = null;
var tabsEl = null;

// Registered by app.js so this module never imports the other right-pane tools
// and cannot form an import cycle with them.
var exclusiveClosers = [];

export function registerExclusiveClosers(fns) {
  exclusiveClosers = (fns || []).filter(function (fn) { return typeof fn === "function"; });
}

function closeOtherRightTools() {
  for (var i = 0; i < exclusiveClosers.length; i++) {
    try { exclusiveClosers[i](); } catch (e) { /* a missing tool must not block opening */ }
  }
}

function isClosed(data) {
  if (!data) return false;
  if (data.state === "closed") return true;
  if (data.state === "open") return false;
  // Legacy notes predate the state field; `hidden` was the old spelling.
  return data.hidden === true;
}

export function openNotes(all) {
  return (all || []).filter(function (data) { return !isClosed(data); });
}

export function closedNotes(all) {
  return (all || []).filter(isClosed);
}

function currentTab() {
  return store.get('notesBrowserTab') === "closed" ? "closed" : "open";
}

// --- Panel ---------------------------------------------------------------

function ensurePanel() {
  if (panel) return;
  var panels = document.getElementById("main-panels");
  if (!panels) return;
  panel = document.createElement("section");
  panel.id = "notes-browser";
  panel.className = "notes-browser hidden";
  panel.setAttribute("aria-label", "Sticky Notes");
  panel.innerHTML =
    '<header class="notes-browser-topbar">' +
      '<span class="notes-browser-title">' + iconHtml("sticky-note") + 'Sticky Notes</span>' +
      '<span class="notes-browser-subtitle">Open items on the board, and what has been closed</span>' +
      '<div class="notes-browser-window-actions" aria-label="Sticky Notes window controls">' +
        '<button id="notes-browser-wide" class="notes-browser-icon-btn" type="button" title="Widen panel" aria-label="Widen Sticky Notes panel" aria-pressed="false">' + iconHtml("chevrons-left-right") + '</button>' +
        '<button id="notes-browser-fullscreen" class="notes-browser-icon-btn" type="button" title="Toggle fullscreen" aria-label="Toggle Sticky Notes fullscreen" aria-pressed="false">' + iconHtml("maximize-2") + '</button>' +
        '<button id="notes-browser-close" class="notes-browser-icon-btn" type="button" title="Close Sticky Notes" aria-label="Close Sticky Notes">' + iconHtml("x") + '</button>' +
      '</div>' +
    '</header>' +
    '<div id="notes-browser-tabs" class="notes-browser-tabs" role="tablist" aria-label="Sticky Notes state"></div>' +
    '<div id="notes-browser-grid" class="notes-browser-grid" role="list"></div>';
  panels.appendChild(panel);

  gridEl = panel.querySelector("#notes-browser-grid");
  tabsEl = panel.querySelector("#notes-browser-tabs");

  panel.querySelector("#notes-browser-close").addEventListener("click", closeNotesBrowser);
  panel.querySelector("#notes-browser-wide").addEventListener("click", function () {
    applyWindowState(!store.get('notesBrowserWide'), store.get('notesBrowserFullscreen'));
  });
  panel.querySelector("#notes-browser-fullscreen").addEventListener("click", function () {
    applyWindowState(store.get('notesBrowserWide'), !store.get('notesBrowserFullscreen'));
  });
  refreshIcons();
}

// Width and fullscreen are transient view state, so they live in the store.
// `panel-fullscreen` is the shared class the document viewer, terminal, and
// Logs already use, so the geometry is the established one.
function applyWindowState(wide, fullscreen) {
  store.set({ notesBrowserWide: !!wide, notesBrowserFullscreen: !!fullscreen });
  if (!panel) return;
  panel.classList.toggle("notes-browser-wide", !!wide && !fullscreen);
  panel.classList.toggle("panel-fullscreen", !!fullscreen);
  var wideBtn = panel.querySelector("#notes-browser-wide");
  var fullBtn = panel.querySelector("#notes-browser-fullscreen");
  if (wideBtn) {
    wideBtn.setAttribute("aria-pressed", wide ? "true" : "false");
    wideBtn.disabled = !!fullscreen;
  }
  if (fullBtn) fullBtn.setAttribute("aria-pressed", fullscreen ? "true" : "false");
}

// --- Tabs ----------------------------------------------------------------

function renderTabs(openCount, closedCount) {
  if (!tabsEl) return;
  var active = currentTab();
  tabsEl.innerHTML = "";
  var specs = [
    { key: "open", label: "Open", count: openCount },
    { key: "closed", label: "Closed", count: closedCount },
  ];
  for (var i = 0; i < specs.length; i++) {
    (function (spec) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "notes-browser-tab" + (spec.key === active ? " active" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", spec.key === active ? "true" : "false");
      tab.tabIndex = spec.key === active ? 0 : -1;
      tab.dataset.tab = spec.key;
      tab.innerHTML = '<span>' + spec.label + '</span><span class="notes-browser-tab-count">' + spec.count + '</span>';
      tab.addEventListener("click", function () { selectTab(spec.key); });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        selectTab(spec.key === "open" ? "closed" : "open");
        var next = tabsEl.querySelector('.notes-browser-tab.active');
        if (next) next.focus();
      });
      tabsEl.appendChild(tab);
    })(specs[i]);
  }
}

function selectTab(key) {
  store.set({ notesBrowserTab: key === "closed" ? "closed" : "open" });
  renderNotesBrowser();
}

// --- Cards ---------------------------------------------------------------

function closedMeta(data) {
  var parts = [];
  if (data.closedAt) {
    var when = new Date(data.closedAt);
    if (!isNaN(when.getTime())) parts.push("Closed " + when.toLocaleDateString());
  } else {
    parts.push("Closed");
  }
  var by = data.closedBy;
  if (by && by.type === "user" && by.displayName) parts.push("by " + by.displayName);
  else if (by && by.type === "session") parts.push("by an agent session");
  return parts.join(" · ");
}

function buildCard(data) {
  var card = document.createElement("article");
  var closed = isClosed(data);
  card.className = "notes-browser-card" + (closed ? " closed" : "");
  card.setAttribute("role", "listitem");
  card.dataset.color = data.color || "purple";
  card.dataset.noteId = data.id;

  var header = document.createElement("div");
  header.className = "notes-browser-card-header";

  var title = document.createElement("h3");
  title.className = "notes-browser-card-title";
  title.textContent = getTitle(data.text) || "Untitled";
  header.appendChild(title);

  // Exactly one lifecycle action per card, and it is never destructive.
  var action = document.createElement("button");
  action.type = "button";
  action.className = "notes-browser-card-action";
  if (closed) {
    action.innerHTML = iconHtml("rotate-ccw") + "<span>Reopen</span>";
    action.title = "Reopen this note and return it to the board";
    action.setAttribute("aria-label", "Reopen note: " + title.textContent);
    action.addEventListener("click", function (e) {
      e.stopPropagation();
      send({ type: "note_reopen", id: data.id });
    });
  } else {
    action.innerHTML = iconHtml("check") + "<span>Close</span>";
    action.title = "Close this note; it stays on record and can be reopened";
    action.setAttribute("aria-label", "Close note: " + title.textContent);
    action.addEventListener("click", function (e) {
      e.stopPropagation();
      send({ type: "note_close", id: data.id });
    });
  }
  header.appendChild(action);
  card.appendChild(header);

  var body = document.createElement("div");
  body.className = "notes-browser-card-body";
  var bodyLines = (data.text || "").split("\n").slice(1).join("\n").trim();
  if (bodyLines) {
    body.innerHTML = renderMiniMarkdown("_\n" + bodyLines).replace('<div class="sn-title">_</div>', "");
    enhanceClayLogLinks(body);
  }
  card.appendChild(body);

  if (closed) {
    var meta = document.createElement("p");
    meta.className = "notes-browser-card-meta";
    meta.textContent = closedMeta(data);
    card.appendChild(meta);
  }

  var strip = document.createElement("div");
  strip.className = "notes-browser-card-color";
  card.appendChild(strip);

  // An open note can be jumped to on the canvas. A closed note has no card on
  // the canvas, so reopening is the only way back and the body is read-only.
  if (!closed) {
    card.tabIndex = 0;
    card.addEventListener("click", function () { focusNoteOnCanvas(data.id); });
    card.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      focusNoteOnCanvas(data.id);
    });
  }
  return card;
}

function emptyState(tab) {
  var empty = document.createElement("div");
  empty.className = "notes-browser-empty";
  if (tab === "closed") {
    empty.innerHTML = iconHtml("check") +
      "<p>Nothing closed yet</p>" +
      "<p class=\"notes-browser-empty-sub\">Closing a note takes it off the board without deleting it. Anything you close shows up here and can be reopened.</p>";
  } else {
    empty.innerHTML = iconHtml("sticky-note") +
      "<p>Keep what matters across sessions</p>" +
      "<p class=\"notes-browser-empty-sub\">Use sticky notes for checklists, goals, handoffs, and durable project knowledge. You and every Clay agent can find them in future sessions.</p>";
  }
  return empty;
}

export function renderNotesBrowser() {
  if (!gridEl) return;
  var all = listNoteData();
  var open = openNotes(all);
  var closed = closedNotes(all);
  renderTabs(open.length, closed.length);

  var tab = currentTab();
  var shown = tab === "closed" ? closed : open;
  // Newest first. The id is timestamp-prefixed, so it orders by creation.
  shown = shown.slice().sort(function (a, b) {
    var left = String(a.id || "");
    var right = String(b.id || "");
    return left < right ? 1 : left > right ? -1 : 0;
  });

  gridEl.innerHTML = "";
  if (shown.length === 0) {
    gridEl.appendChild(emptyState(tab));
    refreshIcons();
    return;
  }
  for (var i = 0; i < shown.length; i++) gridEl.appendChild(buildCard(shown[i]));
  refreshIcons();
}

// --- Lifecycle -----------------------------------------------------------

// The conversation, composer, and title bar stay mounted and visible: the
// browser opens beside them in the single right workbench slot.
export function openNotesBrowser() {
  ensurePanel();
  if (!panel) return;
  closeOtherRightTools();
  // The floating canvas would otherwise sit on top of the pane.
  hideNotes();
  panel.classList.remove("hidden");
  applyWindowState(store.get('notesBrowserWide'), false);
  store.set({ notesBrowserOpen: true });
  var sidebarBtn = document.getElementById("sticky-notes-sidebar-btn");
  if (sidebarBtn) sidebarBtn.classList.add("active");
  renderNotesBrowser();
}

export function closeNotesBrowser() {
  if (!store.get('notesBrowserOpen')) return;
  if (panel) panel.classList.add("hidden");
  // Fullscreen is always dropped on close so the next open is a bounded pane.
  applyWindowState(store.get('notesBrowserWide'), false);
  store.set({ notesBrowserOpen: false });
  var sidebarBtn = document.getElementById("sticky-notes-sidebar-btn");
  if (sidebarBtn) sidebarBtn.classList.remove("active");
  // The canvas comes back so the open notes are reachable again.
  showNotes(false);
}

export function isNotesBrowserOpen() {
  return !!store.get('notesBrowserOpen');
}

export function initNotesBrowser() {
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!store.get('notesBrowserOpen')) return;
    closeNotesBrowser();
  });
  store.subscribe(function (state, previous) {
    if (state.currentSlug === previous.currentSlug) return;
    // A different project starts from a closed, bounded, Open-tab pane.
    closeNotesBrowser();
    applyWindowState(false, false);
    store.set({ notesBrowserTab: "open" });
  });
}
