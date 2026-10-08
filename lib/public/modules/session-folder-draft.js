// The temporary "new folder" draft: a folder header row in the continuous folder
// list (after the custom folders, before Unfiled) with an editable name. It is not
// a folder until the server acknowledges the creation, so it is never part of
// drag-and-drop, ordering or counts. The draft lives in the store
// (sessionFolderCreate) and survives list rerenders and server updates.

import { store } from './store.js';
import { iconHtml } from './icons.js';
import { currentFolderState, cancelFolderCreate, updateFolderCreateDraft, submitFolderCreate } from './session-folders.js';

// The desktop list and the mobile sheet can both be in the DOM, but only the
// visible one is the user's; a hidden copy must never be captured or focused.
function findDraftInput() {
  var inputs = document.querySelectorAll(".session-folder-create-input");
  for (var i = 0; i < inputs.length; i++) {
    if (inputs[i] === document.activeElement || inputs[i].getClientRects().length) return inputs[i];
  }
  return null;
}

// Called right before a list rerender discards the row: remembers the draft,
// the caret and whether the input had focus, so the rebuilt row can restore them.
export function captureFolderDraft() {
  var create = store.get('sessionFolderCreate');
  var input = findDraftInput();
  if (!create || !input) return;
  // A row built moments ago still has its focus restore queued; it says nothing yet.
  if (input.dataset.focusPending === "1") return;
  var focused = document.activeElement === input;
  if (create.draft === input.value && create.focus === focused && create.selStart === input.selectionStart && create.selEnd === input.selectionEnd) return;
  store.set({ sessionFolderCreate: Object.assign({}, create, { draft: input.value, focus: focused, selStart: input.selectionStart, selEnd: input.selectionEnd }) });
}

// Only changes the user can see need a rebuild; typing, caret, focus and scroll do not.
export function folderDraftNeedsRender(state, previous) {
  var a = state.sessionFolderCreate;
  var b = previous.sessionFolderCreate;
  if (!a !== !b) return true;
  return !!(a && b && (a.pendingId !== b.pendingId || a.error !== b.error || a.sessionId !== b.sessionId));
}

export function focusFolderDraft() {
  var input = findDraftInput();
  if (input) {
    input.focus();
    if (input.scrollIntoView) input.scrollIntoView({ block: "nearest" });
  }
}

function validate(name) {
  if (!name) return "Enter a folder name.";
  var lower = name.toLowerCase();
  if (lower === "favorites" || lower === "unfiled") return "That name is reserved.";
  var folders = currentFolderState().folders;
  for (var i = 0; i < folders.length; i++) {
    if (folders[i].name.toLowerCase() === lower) return "A folder with that name already exists.";
  }
  return "";
}

function submit(input) {
  var create = store.get('sessionFolderCreate');
  if (!create || create.pendingId) return;
  var name = input.value.replace(/\s+/g, " ").trim();
  var problem = validate(name);
  if (problem) {
    updateFolderCreateDraft({ draft: input.value, error: problem, focus: true, selStart: input.selectionStart, selEnd: input.selectionEnd });
    return;
  }
  updateFolderCreateDraft({ draft: input.value, selStart: input.selectionStart, selEnd: input.selectionEnd });
  submitFolderCreate(name);
}

function cancel(surface) {
  cancelFolderCreate();
  queueMicrotask(function () {
    var button = document.querySelector('[data-new-folder-button="' + surface + '"]');
    if (button && button.getClientRects().length) button.focus();
  });
}

function iconButton(label, icon, primary, onClick, disabled) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "session-folder-create-btn" + (primary ? " primary" : "");
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.disabled = disabled;
  btn.innerHTML = iconHtml(icon);
  btn.addEventListener("click", onClick);
  return btn;
}

export function renderFolderDraft(surface) {
  var create = store.get('sessionFolderCreate');
  if (!create) return null;
  var busy = !!create.pendingId;
  var root = document.createElement("section");
  root.className = "session-folder session-folder-draft" + (surface === "mobile" ? " is-mobile" : "");
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "New folder");
  root.setAttribute("aria-busy", String(busy));

  var header = document.createElement("div");
  header.className = "session-folder-header";
  var main = document.createElement("div");
  main.className = "session-folder-draft-main";
  var spacer = document.createElement("span");
  spacer.className = "session-folder-chevron session-folder-draft-spacer";
  var icon = document.createElement("span");
  icon.className = "session-folder-icon";
  icon.innerHTML = iconHtml("folder");

  var input = document.createElement("input");
  input.type = "text";
  input.className = "session-folder-create-input";
  input.maxLength = 60;
  input.value = create.draft;
  input.readOnly = busy;
  input.placeholder = "New folder";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Folder name");
  input.setAttribute("aria-invalid", String(!!create.error));
  var errorId = "session-folder-create-error-" + surface;
  input.setAttribute("aria-describedby", errorId);
  if (create.focus) input.dataset.focusPending = "1";
  var remember = function () {
    updateFolderCreateDraft({ draft: input.value, selStart: input.selectionStart, selEnd: input.selectionEnd });
  };
  input.addEventListener("input", function () {
    updateFolderCreateDraft({ draft: input.value, error: "", selStart: input.selectionStart, selEnd: input.selectionEnd });
  });
  input.addEventListener("keyup", remember);
  input.addEventListener("mouseup", remember);
  input.addEventListener("keydown", function (event) {
    // Enter and Escape belong to the input method while it is composing (Korean,
    // Japanese, Chinese); keyCode 229 covers browsers that omit isComposing.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") { event.preventDefault(); submit(input); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(surface); }
  });

  main.appendChild(spacer);
  main.appendChild(icon);
  main.appendChild(input);
  header.appendChild(main);
  var actions = document.createElement("div");
  actions.className = "session-folder-create-actions";
  actions.appendChild(iconButton("Create folder", "check", true, function () { submit(input); }, busy));
  actions.appendChild(iconButton("Cancel new folder", "x", false, function () { cancel(surface); }, false));
  header.appendChild(actions);
  root.appendChild(header);

  var error = document.createElement("div");
  error.id = errorId;
  error.className = "session-folder-create-error";
  error.setAttribute("role", "alert");
  error.textContent = create.error || "";
  root.appendChild(error);

  // The row is attached by the caller; restore focus, caret and (once) scroll afterwards.
  queueMicrotask(function () {
    input.removeAttribute("data-focus-pending");
    var latest = store.get('sessionFolderCreate');
    if (!latest) return;
    if (latest.focus) {
      var live = findDraftInput();
      if (live) {
        // Restoring focus after a rerender must not scroll; opening scrolls once, below.
        live.focus({ preventScroll: true });
        var end = live.value.length;
        var start = typeof latest.selStart === "number" ? Math.min(latest.selStart, end) : end;
        var stop = typeof latest.selEnd === "number" ? Math.min(latest.selEnd, end) : end;
        live.setSelectionRange(start, stop);
      }
    }
    if (latest.scroll) {
      if (root.scrollIntoView && root.getClientRects().length) root.scrollIntoView({ block: "nearest" });
      store.set({ sessionFolderCreate: Object.assign({}, latest, { scroll: false }) });
    }
  });
  return root;
}
