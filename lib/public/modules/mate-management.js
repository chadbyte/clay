// Shared Mate profile and removal flows used by project and Home surfaces.

import { getWs } from './ws-ref.js';
import { showMateProfilePopover } from './profile.js';
import { showToast } from './utils.js';
import { showConfirm, hideConfirm } from './app-misc.js';
import { iconHtml, refreshIcons } from './icons.js';

var mateMenu = null;

function send(message) {
  var ws = getWs();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
}

export function editMateProfile(anchorEl, mate) {
  if (!anchorEl || !mate || mate.primary) return;
  showMateProfilePopover(anchorEl, mate, function (updates) {
    send({ type: "mate_update", mateId: mate.id, updates: updates });
  });
}

export function confirmMateRemoval(anchorEl, mate, onRemoved) {
  if (!anchorEl || !mate || mate.primary) return;
  var name = (mate.profile || {}).displayName || mate.name || "this Mate";
  var modal = document.getElementById("confirm-modal");
  var panel = modal.querySelector(".confirm-dialog");
  var ok = document.getElementById("confirm-ok");
  var cancel = document.getElementById("confirm-cancel");
  var input;
  function cleanup() {
    modal.classList.remove("mate-delete-confirm");
    panel.removeAttribute("role"); panel.removeAttribute("aria-modal");
    panel.removeAttribute("aria-labelledby"); panel.removeAttribute("aria-describedby");
    var field = modal.querySelector(".mate-delete-challenge"); if (field) field.remove();
    ok.disabled = false;
    document.removeEventListener("keydown", onKey, true);
    if (anchorEl.isConnected) anchorEl.focus({preventScroll:true});
  }
  function onKey(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); hideConfirm(); return; }
    if (event.key !== "Tab") return;
    var controls = ok.disabled ? [input,cancel] : [input,cancel,ok];
    var index = controls.indexOf(document.activeElement);
    event.preventDefault(); event.stopImmediatePropagation();
    controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
  }
  showConfirm("", function () {
    if (input.value !== "understand") { cleanup(); return; }
    var ws = getWs();
    if (!ws || ws.readyState !== 1) { cleanup(); showToast("Clay is offline. The Mate was not deleted.", "error"); return; }
    try { ws.send(JSON.stringify({type:"mate_delete",mateId:mate.id})); }
    catch (error) { cleanup(); showToast("Could not send the deletion request. Try again.", "error"); return; }
    cleanup();
    if (onRemoved) onRemoved(true);
  }, mate.builtinKey ? "Remove permanently" : "Delete permanently", true, cleanup);
  modal.classList.add("mate-delete-confirm");
  panel.setAttribute("role","alertdialog"); panel.setAttribute("aria-modal","true");
  panel.setAttribute("aria-labelledby","mate-delete-title"); panel.setAttribute("aria-describedby","mate-delete-warning");
  var text = document.getElementById("confirm-text");
  var title = document.createElement("h3"); title.id = "mate-delete-title"; title.textContent = "Delete " + name + "?";
  var warning = document.createElement("p"); warning.id = "mate-delete-warning";
  warning.textContent = "This permanently deletes the Mate and the data stored in its workspace, including its prompt and files. This cannot be undone.";
  text.appendChild(title); text.appendChild(warning);
  if (mate.builtinKey) {
    var note = document.createElement("p"); note.textContent = "You can add this built-in Mate again, but its deleted data will not be restored."; text.appendChild(note);
  }
  var field = document.createElement("label"); field.className = "mate-delete-challenge";
  field.textContent = 'Type understand to confirm permanent deletion.';
  input = document.createElement("input"); input.type = "text"; input.autocomplete = "off"; input.spellcheck = false;
  input.setAttribute("autocapitalize","none"); input.setAttribute("aria-label","Type understand to confirm permanent deletion");
  field.appendChild(input); text.after(field);
  ok.disabled = true;
  input.addEventListener("input",function () { ok.disabled = input.value !== "understand"; });
  document.addEventListener("keydown",onKey,true);
  input.focus();
}

export function closeMateManagementMenu() {
  if (mateMenu) mateMenu.remove();
  mateMenu = null;
  document.removeEventListener("click", handleMateMenuOutside, true);
}

function handleMateMenuOutside(event) {
  if (mateMenu && !mateMenu.contains(event.target)) closeMateManagementMenu();
}

export function showMateManagementMenu(anchorEl, mate, options) {
  if (!anchorEl || !mate || mate.primary) return;
  options = options || {};
  closeMateManagementMenu();
  if (options.beforeOpen) options.beforeOpen();
  var menu = document.createElement("div");
  menu.className = "project-ctx-menu";
  var edit = document.createElement("button");
  edit.className = "project-ctx-item";
  edit.innerHTML = iconHtml("edit-2") + " <span>Edit Profile</span>";
  edit.addEventListener("click", function (event) {
    event.stopPropagation();
    closeMateManagementMenu();
    editMateProfile(anchorEl, mate);
  });
  var remove = document.createElement("button");
  remove.className = "project-ctx-item project-ctx-delete";
  remove.innerHTML = iconHtml(mate.builtinKey ? "minus-circle" : "trash-2")
    + " <span>" + (mate.builtinKey ? "Remove mate" : "Delete mate") + "</span>";
  remove.addEventListener("click", function (event) {
    event.stopPropagation();
    closeMateManagementMenu();
    confirmMateRemoval(anchorEl, mate, options.onRemoved);
  });
  menu.appendChild(edit);
  menu.appendChild(remove);
  document.body.appendChild(menu);
  mateMenu = menu;
  refreshIcons();
  requestAnimationFrame(function () {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = (rect.right + 6) + "px";
    menu.style.top = rect.top + "px";
    var menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) menu.style.left = (rect.left - menuRect.width - 6) + "px";
    if (menuRect.bottom > window.innerHeight - 8) menu.style.top = (window.innerHeight - menuRect.height - 8) + "px";
  });
  setTimeout(function () {
    document.addEventListener("click", handleMateMenuOutside, true);
  }, 0);
}
