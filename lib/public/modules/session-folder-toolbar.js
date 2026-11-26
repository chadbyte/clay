// Search and top-level session creation replace the toolbar controls in place.

import { store } from './store.js';
import { iconHtml } from './icons.js';
import { openFolderCreate } from './session-folders.js';
import { toggleViewMenu, positionViewMenu } from './session-folder-view-menu.js';
import { captureCreateFocus, renderCreateRow, renderNewSessionButton } from './session-create-form.js';
import { captureFolderDraft, folderDraftNeedsRender, focusFolderDraft } from './session-folder-draft.js';
import {
  openListSearch, closeListSearch, clearListSearchText, setListSearchQuery, rememberListSearchCaret,
  getListSearchQuery, getListSearchMatchIds, getListSearchScopes, listSearchNeedsRender
} from './session-list-search.js';
import { renderSidebarCount } from './sidebar-session-counts.js';
import { renderSearchScopeTrigger, closeSearchScopePicker, searchScopePickerContains } from './session-search-scope-picker.js';

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
  var scope = active && input.closest(".session-folder-tools").contains(active) && active.dataset.searchScopeControl;
  rememberListSearchCaret(active === input, input.selectionStart, input.selectionEnd, scope);
}

export function folderToolbarNeedsRender(state, previous) {
  return folderDraftNeedsRender(state, previous) || listSearchNeedsRender(state, previous);
}

function renderSearchBar(wrap, bar, surface, displayCounts) {
  var state = store.get('sessionSearch');
  var query = getListSearchQuery();
  var matches = getListSearchMatchIds();
  var scopes = getListSearchScopes();
  bar.classList.add("is-searching");

  var close = document.createElement("button");
  close.type = "button";
  close.className = "session-folder-tool session-search-close";
  close.setAttribute("aria-label", "Close search");
  close.dataset.tip = "Close search (Esc)";
  close.innerHTML = iconHtml("arrow-left");
  close.addEventListener("click", function () { closeSearchScopePicker(false); closeListSearch(); focusMagnifier(); });

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
  input.placeholder = scopes ? "Search sessions" : "Search titles and messages";
  input.value = query;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search sessions");
  input.setAttribute("aria-description", "Search any selected scope. Before choosing a scope, search uses titles and messages.");
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
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!closeSearchScopePicker(true)) { closeListSearch(); focusMagnifier(); } }
  });
  input.addEventListener("blur", function (event) {
    if (wrap.contains(event.relatedTarget) || searchScopePickerContains(event.relatedTarget)) return;
    // Leaving an empty search closes it, as before; a rebuilt toolbar is not "leaving".
    setTimeout(function () {
      if (!document.contains(input) || getListSearchQuery()) return;
      var active = document.activeElement;
      if (wrap.contains(active) || searchScopePickerContains(active)) return;
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
  wrap.appendChild(renderSearchScopeTrigger(surface, scopes, input));

  queueMicrotask(function () {
    input.removeAttribute("data-focus-pending");
    var latest = store.get('sessionSearch');
    if (!latest || !latest.open || (!latest.focus && !latest.focusedScope)) return;
    var live = visible(".session-search-input");
    if (!live) return;
    if (latest.focusedScope) {
      var button = live.closest(".session-folder-tools").querySelector('[data-search-scope-control="' + latest.focusedScope + '"]');
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
