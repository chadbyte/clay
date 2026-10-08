// Delete-folder dialog. The user chooses what happens to the folder's
// sessions: move them to Unfiled (the default), move them to another folder, or
// delete them together with the folder. Counts and the snapshot token come from
// the server's authoritative membership (never from the possibly search
// filtered sidebar), and the delete request carries that token so the server
// refuses it if the folder changed while the dialog was open. All dialog state
// lives in the store (sessionFolderDelete); the DOM is repainted from it.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';
import { currentFolderState } from './session-folders.js';
import { createModal, button, closeFolderModal } from './session-folder-dialogs.js';

// The dialog's elements are found through the modal recorded in the store, so
// nothing here outlives the dialog: closing it drops the store state and the
// only reference to its DOM.
function parts() {
  var modal = store.get('sessionFolderModal');
  if (!modal || modal.kind !== "delete-folder") return null;
  var buttons = modal.root.querySelectorAll(".confirm-actions .confirm-btn");
  return { body: modal.root.querySelector(".session-folder-delete"), cancel: buttons[0], primary: buttons[buttons.length - 1] };
}

function state() {
  return store.get('sessionFolderDelete');
}

function patch(next) {
  var current = state();
  if (current) store.set({ sessionFolderDelete: Object.assign({}, current, next) });
}

function newRequestId() {
  return "fdel-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function send(message) {
  var ws = getWs();
  if (!ws || !store.get('connected')) return false;
  // A socket that closed between the check and the send throws; treat it like
  // any other failed send so the caller's recovery state runs.
  try {
    ws.send(JSON.stringify(Object.assign({ slug: store.get('currentSlug') }, message)));
  } catch (e) {
    return false;
  }
  return true;
}

function phrase(count, noun) {
  return count + " " + noun + (count === 1 ? "" : "s");
}

// Other folders a move can target: every custom folder except the source, and
// Unfiled is the first choice, not a destination here, and Favorites is a tag,
// never a destination.
export function moveDestinations(sourceId) {
  var out = [];
  var folders = currentFolderState().folders;
  for (var i = 0; i < folders.length; i++) if (folders[i].id !== sourceId) out.push({ id: folders[i].id, label: folders[i].name });
  return out;
}

export function openFolderDelete(folderId, label) {
  // Replace any dialog that is already open first: closing it clears the
  // deletion state, so the new state must be set afterwards.
  closeFolderModal();
  store.set({ sessionFolderDelete: {
    folderId: folderId, label: label, phase: "loading", requestId: "", preview: null,
    mode: "unfiled", destinationId: "", confirmDelete: false, error: "", focused: false,
  } });
  buildDialog();
  requestPreview();
}

// Asks the server for the folder's membership. A failed send ends the loading
// state with a retryable error instead of leaving a dialog with nothing to do.
function requestPreview() {
  var current = state();
  if (!current) return;
  var requestId = newRequestId();
  patch({ phase: "loading", requestId: requestId, error: "" });
  if (!send({ type: "session_folders_delete_preview", folderId: current.folderId, requestId: requestId })) {
    patch({ phase: "error", error: "Not connected. Check the connection and retry." });
  }
}

function buildDialog() {
  var body = document.createElement("div");
  body.className = "session-folder-dialog-body session-folder-delete";
  var cancel = button("Cancel", "confirm-cancel", function () { closeFolderModal(); });
  var primary = button("Delete folder", "confirm-ok", submit);
  createModal("delete-folder", "Delete folder", body, [cancel, primary], function () {
    var current = state();
    return !current || current.phase !== "pending";
  });
  body.addEventListener("keydown", onBodyKey);
}

function onBodyKey(event) {
  var current = state();
  if (!current || current.phase === "pending") return;
  var target = event.target;
  if (target && target.getAttribute && target.getAttribute("role") === "radio") {
    var step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : (event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0);
    if (!step) return;
    event.preventDefault();
    var radios = Array.prototype.filter.call(parts().body.querySelectorAll('[role="radio"]'), function (r) { return !r.disabled; });
    var at = radios.indexOf(target);
    var next = radios[(at + step + radios.length) % radios.length];
    next.focus();
    choose(next.dataset.mode);
  }
}

function choose(mode) {
  var current = state();
  if (!current || current.phase === "pending" || current.phase === "loading") return;
  patch({ mode: mode, confirmDelete: false, error: "" });
}

function canSubmit(current) {
  if (!current || !current.preview || current.phase === "pending" || current.phase === "loading") return false;
  if (current.preview.sessionCount === 0) return true;
  if (current.mode === "move") return !!current.destinationId;
  if (current.mode === "delete") return current.preview.canDeleteSessions && current.confirmDelete;
  return true;
}

function submit() {
  var current = state();
  if (current && current.phase === "error" && !current.preview) { requestPreview(); return; }
  if (!canSubmit(current)) return;
  var requestId = newRequestId();
  var message = { type: "session_folders_delete", folderId: current.folderId, mode: current.preview.sessionCount === 0 ? "unfiled" : current.mode, token: current.preview.token, requestId: requestId };
  if (message.mode === "move") message.destinationId = current.destinationId;
  if (message.mode === "delete") message.confirmDelete = true;
  patch({ phase: "pending", requestId: requestId, error: "" });
  if (!send(message)) patch({ phase: "ready", requestId: current.requestId, error: "Not connected. Try again." });
}

function radioRow(mode, labelText, hint, current, extraClass) {
  var row = document.createElement("button");
  row.type = "button";
  var selected = current.mode === mode;
  row.className = "session-folder-radio session-folder-delete-option" + (selected ? " selected" : "") + (extraClass ? " " + extraClass : "");
  row.dataset.mode = mode;
  row.dataset.focusKey = "mode:" + mode;
  row.setAttribute("role", "radio");
  row.setAttribute("aria-checked", String(selected));
  row.tabIndex = selected ? 0 : -1;
  row.innerHTML = '<span class="session-folder-radio-dot" aria-hidden="true"></span><span class="session-folder-delete-option-text"><span>' + escapeHtml(labelText) + "</span>" +
    (hint ? '<span class="session-folder-delete-hint">' + escapeHtml(hint) + "</span>" : "") + "</span>";
  row.addEventListener("click", function () { choose(mode); });
  return row;
}

function describe(current) {
  var preview = current.preview;
  if (preview.sessionCount === 0) return 'The folder "' + current.label + '" is empty. Deleting it does not affect any sessions.';
  var text = 'The folder "' + current.label + '" contains ' + phrase(preview.sessionCount, "session") + ".";
  if (preview.workerCount > 0) {
    text += " " + phrase(preview.workerCount, "Split Worker session") + " owned by those Drivers would be deleted with them, including hidden sessions and previous generations.";
  }
  return text;
}

function paint() {
  var current = state();
  var dialog = parts();
  if (!dialog || !current) return;
  var body = dialog.body;
  var active = document.activeElement;
  var focusKey = active && body.contains(active) ? active.dataset.focusKey : null;
  var pending = current.phase === "pending";
  body.innerHTML = "";
  body.setAttribute("aria-busy", String(pending || current.phase === "loading"));

  if (current.phase === "loading") {
    var loading = document.createElement("div");
    loading.className = "session-folder-delete-status";
    loading.textContent = "Checking what is in this folder";
    body.appendChild(loading);
  } else if (current.preview) {
    var intro = document.createElement("div");
    intro.className = "session-folder-delete-intro";
    intro.textContent = describe(current);
    body.appendChild(intro);
    if (current.preview.sessionCount > 0) paintChoices(body, current, pending);
  }

  var alert = document.createElement("div");
  alert.className = "session-folder-input-hint session-folder-delete-error";
  alert.setAttribute("role", "alert");
  alert.textContent = current.error || "";
  body.appendChild(alert);

  var destructive = current.preview && current.preview.sessionCount > 0 && current.mode === "delete";
  dialog.primary.className = "confirm-btn " + (destructive ? "confirm-delete" : "confirm-ok");
  var retry = current.phase === "error" && !current.preview;
  dialog.primary.disabled = retry ? !store.get('connected') : !canSubmit(current);
  dialog.cancel.disabled = pending;
  dialog.primary.textContent = retry ? "Retry" : (pending ? (destructive ? "Deleting" : "Working") : primaryLabel(current));

  if (focusKey) {
    var target = body.querySelector('[data-focus-key="' + focusKey + '"]');
    if (target && !target.disabled) target.focus();
  } else if (!current.focused && (current.preview || current.phase === "error")) {
    var first = body.querySelector('[role="radio"][aria-checked="true"]') || dialog.primary;
    first.focus();
    patch({ focused: true });
  }
}

function primaryLabel(current) {
  if (!current.preview || current.preview.sessionCount === 0) return "Delete folder";
  if (current.mode === "move") return "Move and delete folder";
  if (current.mode === "delete") return "Delete folder and " + phrase(current.preview.totalCount, "session");
  return "Delete folder";
}

function paintChoices(body, current, pending) {
  var preview = current.preview;
  var group = document.createElement("div");
  group.className = "session-folder-radio-group session-folder-delete-choices";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "What should happen to the sessions");
  var unfiled = radioRow("unfiled", "Move sessions to Unfiled", "Nothing is deleted.", current);
  var move = radioRow("move", "Move sessions to another folder", "", current);
  var del = radioRow("delete", "Delete folder and sessions", preview.canDeleteSessions ? "Permanently deletes " + phrase(preview.totalCount, "session") + " and their history." : (preview.deleteBlockedReason || "Not available."), current, "danger");
  if (!preview.canDeleteSessions) { del.disabled = true; del.setAttribute("aria-disabled", "true"); }
  [unfiled, move, del].forEach(function (row) { if (pending) row.disabled = true; group.appendChild(row); });
  body.appendChild(group);

  if (current.mode === "move") {
    var label = document.createElement("label");
    label.className = "session-folder-delete-destination";
    label.textContent = "Destination";
    var select = document.createElement("select");
    select.className = "session-folder-input session-folder-delete-select";
    select.dataset.focusKey = "destination";
    select.disabled = pending;
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a folder";
    select.appendChild(placeholder);
    moveDestinations(current.folderId).forEach(function (dest) {
      var option = document.createElement("option");
      option.value = dest.id;
      option.textContent = dest.label;
      select.appendChild(option);
    });
    select.value = current.destinationId || "";
    select.addEventListener("change", function () { patch({ destinationId: select.value, error: "" }); });
    label.appendChild(select);
    body.appendChild(label);
  }

  if (current.mode === "delete" && preview.canDeleteSessions) {
    var confirmRow = document.createElement("label");
    confirmRow.className = "session-folder-delete-confirm";
    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = current.confirmDelete;
    box.disabled = pending;
    box.dataset.focusKey = "confirm";
    box.addEventListener("change", function () { patch({ confirmDelete: box.checked, error: "" }); });
    var text = document.createElement("span");
    text.textContent = "I understand these " + phrase(preview.totalCount, "session") + " will be permanently deleted.";
    confirmRow.appendChild(box);
    confirmRow.appendChild(text);
    body.appendChild(confirmRow);
  }
}

// The server's authoritative count and snapshot token.
export function handleFolderDeletePreview(msg) {
  var current = state();
  if (!current || msg.requestId !== current.requestId || msg.folderId !== current.folderId) return;
  var preview = {
    sessionCount: msg.sessionCount | 0, workerCount: msg.workerCount | 0, totalCount: msg.totalCount | 0, token: msg.token,
    canDeleteSessions: msg.canDeleteSessions === true, deleteBlockedReason: msg.deleteBlockedReason || "",
  };
  var mode = current.mode === "delete" && !preview.canDeleteSessions ? "unfiled" : current.mode;
  patch({ preview: preview, phase: current.phase === "pending" ? "ready" : "ready", mode: mode, confirmDelete: false });
}

// Acknowledgement or refusal of the delete request. A stale snapshot arrives
// as an error followed by a fresh preview; the dialog stays open on any error.
export function handleFolderDeleteState(msg) {
  var current = state();
  if (!current || !msg.requestId || msg.requestId !== current.requestId) return false;
  if (msg.error) {
    patch({ phase: current.preview ? "ready" : "error", error: msg.error, confirmDelete: false });
    return true;
  }
  if (msg.folderDeleted === current.folderId) closeFolderModal();
  return true;
}

store.subscribe(function (next, previous) {
  if (next.sessionFolderDelete !== previous.sessionFolderDelete) paint();
  // Retry depends on the connection, so a change in it repaints the dialog.
  else if (next.connected !== previous.connected && next.sessionFolderDelete) paint();
  var current = next.sessionFolderDelete;
  if (!current || !previous.connected || next.connected) return;
  if (current.phase === "pending") {
    patch({ phase: "ready", error: "Connection lost. Check the folder before trying again." });
  } else if (current.phase === "loading") {
    patch({ phase: "error", error: "Connection lost while checking the folder. Retry once you are back online." });
  }
});
