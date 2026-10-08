// The folders toolbar: New folder, View and a magnifier. Search replaces the
// controls in the same footprint (same row, same height) with a full-width input
// and an explicit close button; closing restores the controls and focus. State
// lives in the store (sessionSearch, sessionFolderCreate, sessionFolderViewMenu).

import { store } from './store.js';
import { iconHtml } from './icons.js';
import { openFolderCreate } from './session-folders.js';
import { toggleViewMenu, positionViewMenu } from './session-folder-view-menu.js';
import { captureCreateFocus } from './session-create-form.js';
import { captureFolderDraft, folderDraftNeedsRender, focusFolderDraft } from './session-folder-draft.js';
import {
  openListSearch, closeListSearch, clearListSearchText, setListSearchQuery, rememberListSearchCaret,
  getListSearchQuery, getListSearchMatchIds, listSearchNeedsRender
} from './session-list-search.js';

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
  rememberListSearchCaret(document.activeElement === input, input.selectionStart, input.selectionEnd);
}

export function folderToolbarNeedsRender(state, previous) {
  return folderDraftNeedsRender(state, previous) || listSearchNeedsRender(state, previous);
}

function renderSearchBar(bar, surface) {
  var state = store.get('sessionSearch');
  var query = getListSearchQuery();
  var matches = getListSearchMatchIds();
  bar.classList.add("is-searching");

  var close = document.createElement("button");
  close.type = "button";
  close.className = "session-folder-tool session-search-close";
  close.setAttribute("aria-label", "Close search");
  close.title = "Close search (Esc)";
  close.innerHTML = iconHtml("arrow-left");
  close.addEventListener("click", function () { closeListSearch(); focusMagnifier(); });

  var field = document.createElement("div");
  field.className = "session-search-field";
  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-search-input";
  input.dataset.surface = surface;
  input.placeholder = "Search sessions";
  input.value = query;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search sessions");
  if (state.focus) input.dataset.focusPending = "1";
  var remember = function () { rememberListSearchCaret(true, input.selectionStart, input.selectionEnd); };
  input.addEventListener("input", function () {
    setListSearchQuery(input.value);
    remember();
    syncClear();
  });
  input.addEventListener("keyup", remember);
  input.addEventListener("mouseup", remember);
  input.addEventListener("keydown", function (event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeListSearch(); focusMagnifier(); }
  });
  input.addEventListener("blur", function () {
    // Leaving an empty search closes it, as before; a rebuilt toolbar is not "leaving".
    setTimeout(function () {
      if (!document.contains(input) || getListSearchQuery()) return;
      var active = document.activeElement;
      if (active && active.closest && active.closest(".session-folder-toolbar")) return;
      closeListSearch();
    }, 0);
  });

  var count = document.createElement("span");
  count.className = "session-search-count";
  if (query && matches !== null) count.textContent = String(matches.size);
  var clear = document.createElement("button");
  clear.type = "button";
  clear.className = "session-search-clear";
  clear.setAttribute("aria-label", "Clear search text");
  clear.title = "Clear text";
  clear.innerHTML = iconHtml("x");
  clear.hidden = !query;
  clear.addEventListener("click", function () {
    clearListSearchText();
    input.value = "";
    clear.hidden = true;
    input.focus();
  });
  function syncClear() { clear.hidden = !input.value; }

  field.appendChild(input);
  field.appendChild(count);
  field.appendChild(clear);
  bar.appendChild(close);
  bar.appendChild(field);

  queueMicrotask(function () {
    input.removeAttribute("data-focus-pending");
    var latest = store.get('sessionSearch');
    if (!latest || !latest.open || !latest.focus) return;
    var live = visible(".session-search-input");
    if (!live) return;
    live.focus({ preventScroll: true });
    var end = live.value.length;
    var start = typeof latest.selStart === "number" ? Math.min(latest.selStart, end) : end;
    var stop = typeof latest.selEnd === "number" ? Math.min(latest.selEnd, end) : end;
    live.setSelectionRange(start, stop);
  });
}

export function renderFolderToolbar(surface) {
  var create = store.get('sessionFolderCreate');
  var search = store.get('sessionSearch');
  var wrap = document.createElement("div");
  wrap.className = "session-folder-tools" + (surface === "mobile" ? " is-mobile" : "");
  var bar = document.createElement("div");
  bar.className = "session-folder-toolbar" + (surface === "mobile" ? " is-mobile" : "");
  wrap.appendChild(bar);

  if (search && search.open) {
    renderSearchBar(bar, surface);
    return wrap;
  }

  var add = document.createElement("button");
  add.type = "button";
  add.className = "session-folder-tool";
  add.dataset.newFolderButton = surface;
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
  view.className = "session-folder-tool";
  view.dataset.viewButton = surface;
  view.setAttribute("aria-haspopup", "true");
  var viewState = store.get('sessionFolderViewMenu');
  view.setAttribute("aria-expanded", String(!!(viewState && viewState.surface === surface)));
  view.innerHTML = iconHtml("sliders-horizontal") + "<span>View</span>";
  view.addEventListener("click", function () { toggleViewMenu(surface); });

  var magnifier = document.createElement("button");
  magnifier.type = "button";
  magnifier.className = "session-folder-tool session-folder-tool-icon";
  magnifier.dataset.searchButton = surface;
  magnifier.setAttribute("aria-label", "Search sessions");
  magnifier.title = "Search sessions";
  magnifier.innerHTML = iconHtml("search");
  magnifier.addEventListener("click", function () { openListSearch(); });

  bar.appendChild(add);
  bar.appendChild(view);
  bar.appendChild(magnifier);
  if (viewState && viewState.surface === surface) queueMicrotask(positionViewMenu);
  return wrap;
}
