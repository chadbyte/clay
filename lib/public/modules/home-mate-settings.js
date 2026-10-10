// Centered General/Prompt settings dialog.

import { resetMateProfile, hasMateProfileDraft, mateProfileSaving, applyMateProfile, renderMateProfile } from './home-mate-profile-editor.js';
import { showConfirm } from './app-misc.js';
import { resetMateInstructions, loadMateInstructions, renderMateInstructions, applyMateInstructions, hasMateInstructionDraft } from './home-mate-instructions.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { confirmMateRemoval } from './mate-management.js';
import { renderHomeMateAvatarEditor, confirmHomeMateAvatar, failHomeMateAvatar, clearHomeMateAvatarEditor } from './home-mate-avatar-editor.js';
import { resetHomeMateModelPicker, clearHomeMateModelPicker, hasHomeMateModelDraft, requestHomeMateModels, renderHomeMateModelPicker, applyHomeMateModelsState, applyHomeMateModelResult } from './home-mate-model-picker.js';

var dialog = null;
var dialogOpener = null;
var dialogMateId = null;
var dialogSection = "general";
var modelRequested = false;
var memoryState = null;
var knowledgeState = null;
var memoryRequestId = null;
var knowledgeRequestId = null;
var requestSequence = 0;

function getMate(mateId) {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && mates[i].id === mateId) return mates[i];
  }
  return null;
}

function getMateName(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.displayName || (mate && (mate.displayName || mate.name)) || "Mate";
}

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function nextRequestId(kind) {
  requestSequence++;
  return "home-mate-settings-" + kind + "-" + Date.now() + "-" + requestSequence;
}

function isNarrow() {
  return !!window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
}

function setTransientDrawerMask(masked) {
  var hub = document.getElementById("home-hub");
  if (hub) hub.classList.toggle("home-settings-drawer-masked", masked && isNarrow());
}

function focusableElements(root) {
  return root ? Array.from(root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (el) { return el.getClientRects().length && el.tabIndex >= 0; }) : [];
}

function addEmpty(container, text) {
  var empty = document.createElement("div");
  empty.className = "home-mate-settings-empty";
  empty.textContent = text;
  container.appendChild(empty);
}

function renderGeneral(body, mate) {
  var description = document.createElement("p");
  description.className = "mate-settings-help";
  description.textContent = "Manage " + getMateName(mate) + "’s identity, appearance, and default model.";
  body.appendChild(description);
  renderMateProfile(body, mate, renderDialogContent, function () {
    store.set({mateSettingsAvatarOpen: !store.get('mateSettingsAvatarOpen')});
    renderDialogContent();
  });
  if (store.get('mateSettingsAvatarOpen')) {
    var appearance = document.createElement("section");
    appearance.className = "mate-settings-appearance";
    renderHomeMateAvatarEditor(appearance, mate, renderDialogContent);
    var done = document.createElement('button'); done.type = 'button'; done.className = 'mate-settings-button'; done.textContent = 'Done';
    done.addEventListener('click',function () { store.set({mateSettingsAvatarOpen:false}); renderDialogContent(); document.getElementById('mate-profile-avatar').focus(); });
    appearance.appendChild(done);
    body.appendChild(appearance);
  }
  var model = document.createElement("section");
  model.className = "mate-settings-model-section";
  model.innerHTML = "<h4>Model</h4>";
  renderHomeMateModelPicker(model, renderDialogContent);
  body.appendChild(model);
  if (!mate || mate.primary) {
    addEmpty(body, "Clay manages this Mate’s core profile.");
    return;
  }
  var actions = document.createElement("div");
  actions.className = "home-mate-settings-actions";
  var remove = document.createElement("button");
  remove.type = "button";
  remove.className = "home-mate-settings-action is-danger";
  remove.innerHTML = iconHtml(mate.builtinKey ? "minus-circle" : "trash-2");
  var removeLabel = document.createElement("span");
  removeLabel.textContent = mate.builtinKey ? "Remove Mate" : "Delete Mate";
  remove.appendChild(removeLabel);
  remove.addEventListener("click", function () { confirmMateRemoval(remove, mate, closeHomeMateSettings); });
  var dangerCopy = document.createElement("div");
  dangerCopy.className = "mate-settings-danger-copy";
  dangerCopy.innerHTML = "<h4>Danger zone</h4><p>Permanently delete this Mate and its workspace data. This cannot be undone.</p>";
  actions.appendChild(dangerCopy);
  actions.appendChild(remove);
  body.appendChild(actions);
}

function requestSection(section) {
  if (section === "general" && !modelRequested) {
    modelRequested = true;
    requestHomeMateModels((getMate(dialogMateId) || {}).vendor || "", renderDialogContent);
  }
}

function savePending() {
  var prompt = store.get('mateInstructionsDraft');
  var model = store.get('mateModelDraft');
  return mateProfileSaving() || !!((prompt && prompt.status === 'saving') || (model && model.saveId));
}

function renderDialogContent() {
  if (!dialog) return;
  dialog.dataset.section = dialogSection;
  var body = dialog.querySelector(".home-mate-settings-body");
  if (!body) return;
  var focus = document.activeElement;
  var focusId = focus && focus.id;
  var ownedFocus = focus && body.contains(focus);
  var selection = focus && focus.tagName === 'TEXTAREA' ? [focus.selectionStart, focus.selectionEnd] : null;
  var scroll = body.parentElement.scrollTop;
  var expanded = body.querySelector('.mate-settings-appearance');
  var appearanceOpen = expanded && expanded.open;
  body.innerHTML = "";
  var mate = getMate(dialogMateId);
  var contentTitle = dialog.querySelector(".home-mate-settings-content-title");
  if (contentTitle) contentTitle.textContent = dialogSection.charAt(0).toUpperCase() + dialogSection.slice(1);
  if (dialogSection === "general") renderGeneral(body, mate);
  else renderMateInstructions(body, renderDialogContent);
  var nav = dialog.querySelectorAll("[data-home-mate-settings-section]");
  for (var i = 0; i < nav.length; i++) {
    var active = nav[i].dataset.homeMateSettingsSection === dialogSection;
    nav[i].classList.toggle("is-active", active);
    if (active) nav[i].setAttribute("aria-current", "page");
    else nav[i].removeAttribute("aria-current");
  }
  refreshIcons();
  dialog.querySelector('.home-mate-settings-close').disabled = savePending();
  var appearance = body.querySelector('.mate-settings-appearance');
  if (appearance && appearanceOpen) appearance.open = true;
  body.parentElement.scrollTop = scroll;
  var nextFocus = focusId && document.getElementById(focusId);
  if (nextFocus && !nextFocus.disabled) {
    nextFocus.focus({preventScroll:true});
    if (selection) nextFocus.setSelectionRange(selection[0], selection[1]);
  } else if (ownedFocus) {
    var fallback = body.querySelector('#mate-prompt-input:not(:disabled), #mate-settings-model-trigger:not(:disabled)') || contentTitle;
    if (fallback) fallback.focus({preventScroll:true});
  }
}

function selectSection(section, focusContent) {
  if (section !== "general" && section !== "prompt") return;
  dialogSection = section;
  requestSection(section);
  renderDialogContent();
  if (focusContent && dialog) {
    var heading = dialog.querySelector(".home-mate-settings-content-title");
    if (heading) heading.focus({ preventScroll: true });
  }
}

function handleDialogKeydown(event) {
  if (!dialog) return;
  if (document.querySelector(".profile-popover") || document.querySelector("#confirm-modal:not(.hidden)")) return;
  if (event.target.closest && event.target.closest(".worker-runtime-options")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeHomeMateSettings();
    return;
  }
  if (event.key !== "Tab") return;
  var focusable = focusableElements(dialog);
  if (!focusable.length) return;
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function closeHomeMateSettings(force) {
  if (force !== true && savePending()) return false;
  if (force !== true && (hasMateProfileDraft() || hasMateInstructionDraft() || hasHomeMateModelDraft())) {
    var previous = document.activeElement;
    showConfirm("Discard unsaved Mate settings?", function () { closeHomeMateSettings(true); }, "Discard changes", false, function () { if (previous && previous.isConnected) previous.focus(); });
    document.getElementById("confirm-cancel").focus();
    return false;
  }
  var opener = dialogOpener;
  if (dialog) dialog.remove();
  dialog = null;
  dialogMateId = null;
  dialogOpener = null;
  memoryRequestId = null;
  knowledgeRequestId = null;
  memoryState = null;
  knowledgeState = null;
  modelRequested = false;
  store.set({mateSettingsAvatarOpen:false});
  resetMateProfile();
  clearHomeMateModelPicker();
  resetMateInstructions(null);
  clearHomeMateAvatarEditor();
  document.removeEventListener("keydown", handleDialogKeydown, true);
  document.body.classList.remove("home-mate-settings-open");
  setTransientDrawerMask(false);
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
}

export function openHomeMateSettings(mateId, opener, options) {
  var mate = getMate(mateId);
  if (!mate || (dialog && savePending())) return false;
  if (dialog && (hasMateProfileDraft() || hasMateInstructionDraft() || hasHomeMateModelDraft())) {
    showConfirm("Discard unsaved Mate settings?", function () { closeHomeMateSettings(true); openHomeMateSettings(mateId, opener, options); }, "Discard changes", false);
    return false;
  }
  closeHomeMateSettings(true);
  resetMateInstructions(mateId);
  dialogMateId = mateId;
  dialogOpener = opener || document.activeElement;
  dialogSection = options && options.section === "prompt" ? "prompt" : "general";
  modelRequested = false;
  resetHomeMateModelPicker(mateId, getMateName(mate), mate, options && options.sessionId);
  var overlay = document.createElement("div");
  overlay.className = "home-mate-settings-overlay";
  var panel = document.createElement("section");
  panel.className = "home-mate-settings-dialog";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "home-mate-settings-title");
  var header = document.createElement("header");
  header.className = "home-mate-settings-header";
  var titleWrap = document.createElement("div");
  var eyebrow = document.createElement("span");
  eyebrow.textContent = getMateName(mate);
  var title = document.createElement("h2");
  title.id = "home-mate-settings-title";
  title.textContent = "Mate settings";
  titleWrap.appendChild(eyebrow);
  titleWrap.appendChild(title);
  var close = document.createElement("button");
  close.type = "button";
  close.className = "home-mate-settings-close";
  close.setAttribute("aria-label", "Close Mate settings");
  close.setAttribute("title", "Close");
  close.innerHTML = iconHtml("x");
  close.addEventListener("click", closeHomeMateSettings);
  header.appendChild(titleWrap);
  header.appendChild(close);
  var layout = document.createElement("div");
  layout.className = "home-mate-settings-layout";
  var nav = document.createElement("nav");
  nav.className = "home-mate-settings-nav";
  nav.setAttribute("aria-label", "Mate settings sections");
  var sections = ["general", "prompt"];
  for (var i = 0; i < sections.length; i++) {
    (function (section) {
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.homeMateSettingsSection = section;
      button.textContent = section.charAt(0).toUpperCase() + section.slice(1);
      button.addEventListener("click", function () { selectSection(section, true); });
      nav.appendChild(button);
    })(sections[i]);
  }
  var content = document.createElement("section");
  content.className = "home-mate-settings-content";
  var contentTitle = document.createElement("h3");
  contentTitle.className = "home-mate-settings-content-title";
  contentTitle.tabIndex = -1;
  contentTitle.textContent = "Mate settings content";
  var body = document.createElement("div");
  body.className = "home-mate-settings-body";
  content.appendChild(contentTitle);
  content.appendChild(body);
  layout.appendChild(nav);
  layout.appendChild(content);
  panel.appendChild(header);
  panel.appendChild(layout);
  overlay.appendChild(panel);
  overlay.addEventListener("click", function (event) { if (event.target === overlay) closeHomeMateSettings(); });
  document.body.appendChild(overlay);
  dialog = overlay;
  document.body.classList.add("home-mate-settings-open");
  setTransientDrawerMask(true);
  document.addEventListener("keydown", handleDialogKeydown, true);
  renderDialogContent();
  requestSection(dialogSection);
  loadMateInstructions(renderDialogContent);
  refreshIcons();
  requestAnimationFrame(function () { close.focus({ preventScroll: true }); });
  return true;
}

export function handleHomeMateMemoryState(msg) {
  if (!dialog || dialogSection !== "memory" || msg.mateId !== dialogMateId || msg.requestId !== memoryRequestId) return false;
  memoryState = { summary: msg.summary || "", entries: msg.entries || [] };
  renderDialogContent();
  return true;
}

export function handleHomeMateKnowledgeState(msg) {
  if (!dialog || dialogSection !== "knowledge" || msg.mateId !== dialogMateId || msg.requestId !== knowledgeRequestId) return false;
  knowledgeState = { files: msg.files || [] };
  renderDialogContent();
  return true;
}

export function handleHomeMateModelsState(msg) {
  if (!dialog || !applyHomeMateModelsState(msg)) return false;
  if (dialogSection === "general") {
    renderDialogContent();
  }
  return true;
}

export function handleHomeMateModelResult(msg) {
  if (!dialog || !applyHomeMateModelResult(msg)) return false;
  if (msg.ok) {
    var mates = store.get('cachedMatesList') || [];
    store.set({ cachedMatesList: mates.map(function (mate) {
      return mate && mate.id === msg.mateId ? Object.assign({}, mate, { vendor: msg.vendor, model: msg.model }) : mate;
    }) });
  }
  if (dialogSection === "general") {
    renderDialogContent();
  }
  return true;
}

export function syncHomeMateSettingsTarget(msg) {
  if (msg) applyMateProfile(msg);
  if (!dialogMateId) return;
  var mate = getMate(dialogMateId);
  if (!mate) closeHomeMateSettings();
  else {
    confirmHomeMateAvatar(mate);
    dialog.querySelector(".home-mate-settings-header span").textContent = getMateName(mate);
    renderDialogContent();
  }
}

export function handleHomeMateAvatarError(msg) {
  if (!dialog || !msg) return false;
  var profileHandled = applyMateProfile(msg);
  if (!profileHandled && !failHomeMateAvatar(msg.mateId, msg.error)) return false;
  renderDialogContent();
  return true;
}

export function handleMateInstructionsResult(msg) {
  if (!dialog || !applyMateInstructions(msg)) return false;
  if (dialogSection === 'prompt') renderDialogContent();
  return true;
}
