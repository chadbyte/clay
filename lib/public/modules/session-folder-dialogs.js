// Custom modal dialogs for session folders (rename entry and the folder picker). Built on the existing confirm-dialog look; no browser-native
// prompt, confirm or alert. The open dialog is tracked in the store
// (sessionFolderModal); this module only owns the functions.

import { store } from './store.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { FAVORITES_ID, UNFILED_ID } from './session-folder-layout.js';

var FOCUSABLE = "button:not([disabled]), input, [tabindex]:not([tabindex='-1'])";

function modalState() {
  return store.get('sessionFolderModal');
}

export function closeFolderModal() {
  var modal = modalState();
  if (!modal) return;
  store.set({ sessionFolderModal: null });
  document.removeEventListener("keydown", onModalKey, true);
  modal.root.remove();
  if (modal.restoreFocus && document.body.contains(modal.restoreFocus)) modal.restoreFocus.focus();
}

export function isFolderModalOpen() {
  return !!modalState();
}

function onModalKey(event) {
  var modal = modalState();
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeFolderModal();
    return;
  }
  if (event.key !== "Tab") return;
  var focusable = modal.root.querySelectorAll(FOCUSABLE);
  if (!focusable.length) return;
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  var active = document.activeElement;
  if (!modal.root.contains(active)) { event.preventDefault(); first.focus(); }
  else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

function createModal(kind, title, bodyEl, actions) {
  closeFolderModal();
  var restoreFocus = document.activeElement;
  var root = document.createElement("div");
  root.className = "session-folder-modal";
  root.dataset.modalKind = kind;
  var backdrop = document.createElement("div");
  backdrop.className = "confirm-backdrop";
  backdrop.addEventListener("click", closeFolderModal);
  var dialog = document.createElement("div");
  dialog.className = "confirm-dialog session-folder-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);
  var heading = document.createElement("div");
  heading.className = "session-folder-dialog-title";
  heading.textContent = title;
  dialog.appendChild(heading);
  dialog.appendChild(bodyEl);
  var bar = document.createElement("div");
  bar.className = "confirm-actions";
  for (var i = 0; i < actions.length; i++) bar.appendChild(actions[i]);
  dialog.appendChild(bar);
  root.appendChild(backdrop);
  root.appendChild(dialog);
  store.set({ sessionFolderModal: { root: root, kind: kind, restoreFocus: restoreFocus } });
  document.addEventListener("keydown", onModalKey, true);
  document.body.appendChild(root);
  refreshIcons();
  return dialog;
}

function button(label, className, onClick) {
  var el = document.createElement("button");
  el.type = "button";
  el.className = "confirm-btn " + className;
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
}

export function openFolderNameDialog(options) {
  var body = document.createElement("div");
  body.className = "session-folder-dialog-body";
  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-folder-input";
  input.maxLength = 60;
  input.value = options.initial || "";
  input.setAttribute("aria-label", "Folder name");
  input.placeholder = "Folder name";
  var hint = document.createElement("div");
  hint.className = "session-folder-input-hint";
  hint.setAttribute("role", "alert");
  body.appendChild(input);
  body.appendChild(hint);
  function submit() {
    var name = input.value.replace(/\s+/g, " ").trim();
    if (!name) { hint.textContent = "Enter a folder name."; input.focus(); return; }
    var lower = name.toLowerCase();
    if (lower === "favorites" || lower === "unfiled") { hint.textContent = "That name is reserved."; input.focus(); return; }
    var taken = options.existing || [];
    for (var i = 0; i < taken.length; i++) {
      if (taken[i].id !== options.selfId && taken[i].name.toLowerCase() === lower) { hint.textContent = "A folder with that name already exists."; input.focus(); return; }
    }
    closeFolderModal();
    options.onSubmit(name);
  }
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") { event.preventDefault(); submit(); }
  });
  createModal("name", options.title, body, [
    button("Cancel", "confirm-cancel", closeFolderModal),
    button(options.submitLabel || "Save", "confirm-ok", submit),
  ]);
  input.focus();
  input.select();
}

// Lists Favorites, every custom folder and Unfiled; the current one is marked.
// "New folder" hands off to the caller, which creates and then moves.
export function openFolderPicker(options) {
  var body = document.createElement("div");
  body.className = "session-folder-picker";
  body.setAttribute("role", "listbox");
  body.setAttribute("aria-label", "Folders");
  var choices = [{ id: FAVORITES_ID, label: "Favorites", icon: "star" }];
  for (var i = 0; i < options.folders.length; i++) choices.push({ id: options.folders[i].id, label: options.folders[i].name, icon: "folder" });
  choices.push({ id: UNFILED_ID, label: "Unfiled", icon: "inbox" });
  choices.forEach(function (choice) {
    var row = document.createElement("button");
    row.type = "button";
    row.className = "session-folder-choice" + (choice.id === options.current ? " current" : "");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(choice.id === options.current));
    row.innerHTML = iconHtml(choice.icon) + '<span class="session-folder-choice-label">' + escapeHtml(choice.label) + "</span>" + (choice.id === options.current ? iconHtml("check") : "");
    row.addEventListener("click", function () {
      closeFolderModal();
      if (choice.id !== options.current) options.onPick(choice.id === UNFILED_ID ? null : choice.id);
    });
    body.appendChild(row);
  });
  if (options.onNewFolder) {
    var add = document.createElement("button");
    add.type = "button";
    add.className = "session-folder-choice session-folder-choice-new";
    add.innerHTML = iconHtml("folder-plus") + '<span class="session-folder-choice-label">New folder</span>';
    add.addEventListener("click", function () {
      closeFolderModal();
      options.onNewFolder();
    });
    body.appendChild(add);
  }
  createModal("picker", options.title, body, [button("Cancel", "confirm-cancel", closeFolderModal)]);
  var current = body.querySelector(".current") || body.firstChild;
  if (current) current.focus();
}
