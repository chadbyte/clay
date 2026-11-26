// Search and top-level session creation replace the toolbar controls in place.

import { store } from './store.js';
import { iconHtml } from './icons.js';
import { openFolderCreate } from './session-folders.js';
import { toggleViewMenu, positionViewMenu } from './session-folder-view-menu.js';
import { captureCreateFocus, renderCreateRow, renderNewSessionButton } from './session-create-form.js';
import { captureFolderDraft, folderDraftNeedsRender, focusFolderDraft } from './session-folder-draft.js';
import {
  openListSearch, closeListSearch, clearListSearchText, setListSearchQuery, rememberListSearchCaret,
  getListSearchQuery, getListSearchMatchIds, getListSearchScopes, toggleListSearchScope, listSearchNeedsRender
} from './session-list-search.js';
import { renderSidebarCount } from './sidebar-session-counts.js';

// Visible one wins: the desktop list and the mobile sheet can both be in the DOM.
function visible(selector) {
  var nodes = document.querySelectorAll(selector);
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i] === document.activeElement || nodes[i].getClientRects().length) return nodes[i];
  }
  return null;
}

function focusMagnifier() {
  queueMicrotask(function () {
    var button = visible("[data-search-button]");
    if (button) button.focus();
  });
}

// Called right before a list rerender discards the toolbar and the draft row.
export function captureFolderInputs() {
  captureFolderDraft();
  captureCreateFocus();
  var state = store.get('sessionSearch');
  var input = visible(".session-search-input");
  if (!state || !state.open || !input || input.dataset.focusPending === "1") return;
  var active = document.activeElement;
  var scope = active && input.closest(".session-folder-tools").contains(active) && active.dataset.searchScope;
  rememberListSearchCaret(active === input, input.selectionStart, input.selectionEnd, scope);
}

export function folderToolbarNeedsRender(state, previous) {
  return folderDraftNeedsRender(state, previous) || listSearchNeedsRender(state, previous);
}

function renderSearchFilters() {
  var scopes = getListSearchScopes();
  var group = document.createElement("div");
  group.className = "session-search-filters";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Search scopes");
  [
    ["title", "Title", "Match session titles"],
    ["chat", "Chat content", "Match text in conversations"],
    ["pr", "PR", "GitHub pull request number, such as 123 or owner/repo#123"],
    ["issue", "Issue", "GitHub issue number, such as 123 or owner/repo#123", "GitHub issue"],
    ["linear", "Linear", "Linear issue ID, such as CLAY-123"],
  ].forEach(function (filter) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "session-folder-tool";
    button.textContent = filter[1];
    if (filter[3]) button.setAttribute("aria-label", filter[3]);
    button.dataset.searchScope = filter[0];
    button.dataset.tip = filter[2];
    button.setAttribute("aria-description", filter[2] + ".");
    button.setAttribute("aria-pressed", String(scopes.includes(filter[0])));
    button.addEventListener("click", function () {
      button.focus({ preventScroll: true });
      toggleListSearchScope(filter[0]);
    });
    group.appendChild(button);
  });
  return group;
}

function renderSearchBar(wrap, bar, surface, displayCounts) {
  var state = store.get('sessionSearch');
  var query = getListSearchQuery();
  var matches = getListSearchMatchIds();
  bar.classList.add("is-searching");

  var close = document.createElement("button");
  close.type = "button";
  close.className = "session-folder-tool session-search-close";
  close.setAttribute("aria-label", "Close search");
  close.dataset.tip = "Close search (Esc)";
  close.innerHTML = iconHtml("arrow-left");
  close.addEventListener("click", function () { closeListSearch(); focusMagnifier(); });

  var field = document.createElement("form");
  field.className = "session-search-field";
  field.autocomplete = "off";
  field.setAttribute("role", "search");
  field.setAttribute("aria-label", "Session search");
  field.addEventListener("submit", function (event) { event.preventDefault(); });
  var input = document.createElement("input");
  input.type = "search";
  input.name = "session-query";
  input.className = "session-search-input";
  input.dataset.surface = surface;
  input.placeholder = "pr:123 or linear:CLAY-123";
  input.value = query;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search sessions");
  input.setAttribute("aria-description", "Search any selected scope. A prefix such as pr: or linear: searches that link type directly.");
  if (state.focus || state.focusedScope) input.dataset.focusPending = "1";
  var remember = function () { rememberListSearchCaret(true, input.selectionStart, input.selectionEnd); };
  input.addEventListener("input", function () {
    setListSearchQuery(input.value);
    remember();
    syncClear();
  });
  input.addEventListener("keyup", remember);
  input.addEventListener("mouseup", remember);
  wrap.addEventListener("keydown", function (event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeListSearch(); focusMagnifier(); }
  });
  input.addEventListener("blur", function () {
    // Leaving an empty search closes it, as before; a rebuilt toolbar is not "leaving".
    setTimeout(function () {
      if (!document.contains(input) || getListSearchQuery()) return;
      var active = document.activeElement;
      if (wrap.contains(active)) return;
      closeListSearch();
    }, 0);
  });

  var count = renderSidebarCount("session-search-count", displayCounts || { roots: matches ? matches.size : 0, workers: 0 }, true);
  if (!query || matches === null) count.textContent = "";
  var clear = document.createElement("button");
  clear.type = "button";
  clear.className = "session-search-clear";
  clear.setAttribute("aria-label", "Clear search text");
  clear.dataset.tip = "Clear search text";
  clear.innerHTML = iconHtml("x");
  clear.hidden = !query;
  clear.addEventListener("click", function () {
    input.value = "";
    input.focus();
    syncClear();
    clearListSearchText();
  });
  function syncClear() { clear.hidden = !input.value; }

  field.appendChild(input);
  field.appendChild(count);
  field.appendChild(clear);
  bar.appendChild(close);
  bar.appendChild(field);
  wrap.appendChild(renderSearchFilters());
  if (!getListSearchScopes().length) {
    var hint = document.createElement("div");
    hint.className = "session-search-scope-hint";
    hint.setAttribute("role", "status");
    hint.textContent = "Select a scope or type a link prefix.";
    wrap.appendChild(hint);
  }

  queueMicrotask(function () {
    input.removeAttribute("data-focus-pending");
    var latest = store.get('sessionSearch');
    if (!latest || !latest.open || (!latest.focus && !latest.focusedScope)) return;
    var live = visible(".session-search-input");
    if (!live) return;
    if (latest.focusedScope) {
      var button = live.closest(".session-folder-tools").querySelector('[data-search-scope="' + latest.focusedScope + '"]');
      if (button) button.focus({ preventScroll: true });
      return;
    }
    live.focus({ preventScroll: true });
    var end = live.value.length;
    var start = typeof latest.selStart === "number" ? Math.min(latest.selStart, end) : end;
    var stop = typeof latest.selEnd === "number" ? Math.min(latest.selEnd, end) : end;
    live.setSelectionRange(start, stop);
  });
}

export function renderFolderToolbar(surface, displayCounts) {
  var create = store.get('sessionFolderCreate');
  var search = store.get('sessionSearch');
  var wrap = document.createElement("div");
  wrap.className = "session-folder-tools" + (surface === "mobile" ? " is-mobile" : "");
  var bar = document.createElement("div");
  bar.className = "session-folder-toolbar" + (surface === "mobile" ? " is-mobile" : "");
  wrap.appendChild(bar);

  var createRow = renderCreateRow("unfiled", "", surface);
  if (createRow) {
    bar.classList.add("is-creating");
    bar.appendChild(createRow);
    return wrap;
  }
  if (search && search.open) {
    renderSearchBar(wrap, bar, surface, displayCounts);
    return wrap;
  }

  var add = document.createElement("button");
  add.type = "button";
  add.className = "session-folder-tool session-toolbar-new-folder";
  add.dataset.newFolderButton = surface;
  add.setAttribute("aria-label", "New folder");
  add.dataset.tip = "New folder";
  add.setAttribute("aria-expanded", String(!!create));
  add.innerHTML = iconHtml("folder-plus") + "<span>New folder</span>";
  add.addEventListener("click", function () {
    if (store.get('sessionFolderCreate')) {
      focusFolderDraft();
      return;
    }
    openFolderCreate();
  });

  var view = document.createElement("button");
  view.type = "button";
  view.className = "session-folder-tool session-folder-tool-icon";
  view.dataset.viewButton = surface;
  view.setAttribute("aria-label", "View options");
  view.dataset.tip = "View options";
  view.setAttribute("aria-haspopup", "true");
  var viewState = store.get('sessionFolderViewMenu');
  view.setAttribute("aria-expanded", String(!!(viewState && viewState.surface === surface)));
  view.innerHTML = iconHtml("sliders-horizontal");
  view.addEventListener("click", function () { toggleViewMenu(surface); });

  var magnifier = document.createElement("button");
  magnifier.type = "button";
  magnifier.className = "session-folder-tool session-folder-tool-icon";
  magnifier.dataset.searchButton = surface;
  magnifier.setAttribute("aria-label", "Search sessions");
  magnifier.dataset.tip = "Search sessions";
  magnifier.innerHTML = iconHtml("search");
  magnifier.addEventListener("click", function () { openListSearch(); });

  bar.appendChild(renderNewSessionButton("unfiled", "", surface));
  bar.appendChild(add);
  bar.appendChild(view);
  bar.appendChild(magnifier);
  if (viewState && viewState.surface === surface) queueMicrotask(positionViewMenu);
  return wrap;
}
