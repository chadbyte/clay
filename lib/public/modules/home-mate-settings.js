// Centered General/Model/Memory/Knowledge settings dialog.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { editMateProfile, confirmMateRemoval } from './mate-management.js';
import { resetHomeMateModelPicker, clearHomeMateModelPicker, requestHomeMateModels, renderHomeMateModelPicker, applyHomeMateModelsState, applyHomeMateModelResult } from './home-mate-model-picker.js';

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
  return root ? root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') : [];
}

function restoreModelFocusAfterRender() {
  var active = document.activeElement;
  var focusedModel = active && active.dataset ? active.dataset.homeMateModel : null;
  var focusedVendor = active && active.dataset ? active.dataset.homeMateVendor : null;
  var focusedControl = active && active.dataset ? active.dataset.homeModelFocus : null;
  return function () {
    if (!dialog) return;
    var selectors = [
      { selector: "[data-home-mate-model]", key: "homeMateModel", value: focusedModel },
      { selector: "[data-home-mate-vendor]", key: "homeMateVendor", value: focusedVendor },
      { selector: "[data-home-model-focus]", key: "homeModelFocus", value: focusedControl },
    ];
    for (var i = 0; i < selectors.length; i++) {
      if (!selectors[i].value) continue;
      var nodes = dialog.querySelectorAll(selectors[i].selector);
      for (var j = 0; j < nodes.length; j++) {
        if (nodes[j].dataset[selectors[i].key] !== selectors[i].value) continue;
        nodes[j].focus({ preventScroll: true });
        return;
      }
    }
  };
}

function addEmpty(container, text) {
  var empty = document.createElement("div");
  empty.className = "home-mate-settings-empty";
  empty.textContent = text;
  container.appendChild(empty);
}

function renderGeneral(body, mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  var identity = document.createElement("section");
  identity.className = "home-mate-settings-identity";
  var eyebrow = document.createElement("span");
  eyebrow.textContent = mate && mate.primary ? "Primary Mate" : mate && mate.builtinKey ? "Built-in Mate" : "Custom Mate";
  var name = document.createElement("h3");
  name.textContent = getMateName(mate);
  var bio = document.createElement("p");
  bio.textContent = profile.bio || (mate && mate.bio) || "Profile and management controls for this Mate.";
  identity.appendChild(eyebrow);
  identity.appendChild(name);
  identity.appendChild(bio);
  body.appendChild(identity);
  if (!mate || mate.primary) {
    addEmpty(body, "This primary Mate is managed by Clay.");
    return;
  }
  var actions = document.createElement("div");
  actions.className = "home-mate-settings-actions";
  var edit = document.createElement("button");
  edit.type = "button";
  edit.className = "home-mate-settings-action";
  edit.innerHTML = iconHtml("edit-2") + "<span>Edit profile</span>";
  edit.addEventListener("click", function () { editMateProfile(edit, mate); });
  var remove = document.createElement("button");
  remove.type = "button";
  remove.className = "home-mate-settings-action is-danger";
  remove.innerHTML = iconHtml(mate.builtinKey ? "minus-circle" : "trash-2");
  var removeLabel = document.createElement("span");
  removeLabel.textContent = mate.builtinKey ? "Remove Mate" : "Delete Mate";
  remove.appendChild(removeLabel);
  remove.addEventListener("click", function () { confirmMateRemoval(remove, mate, closeHomeMateSettings); });
  actions.appendChild(edit);
  actions.appendChild(remove);
  body.appendChild(actions);
}

function renderMemory(body) {
  if (!memoryState) {
    addEmpty(body, "Loading memory…");
    return;
  }
  if (memoryState.summary) {
    var summary = document.createElement("section");
    summary.className = "home-mate-settings-summary";
    var heading = document.createElement("h3");
    heading.textContent = "Working summary";
    var text = document.createElement("p");
    text.textContent = memoryState.summary;
    summary.appendChild(heading);
    summary.appendChild(text);
    body.appendChild(summary);
  }
  var entries = memoryState.entries || [];
  for (var i = 0; i < entries.length; i++) {
    var item = document.createElement("article");
    item.className = "home-mate-settings-memory";
    var title = document.createElement("h3");
    title.textContent = entries[i].topic || entries[i].date || "Memory";
    var detail = document.createElement("p");
    detail.textContent = entries[i].my_position || entries[i].decisions || entries[i].outcome || "";
    item.appendChild(title);
    if (detail.textContent) item.appendChild(detail);
    body.appendChild(item);
  }
  if (!memoryState.summary && !entries.length) addEmpty(body, "No memories yet.");
}

function renderKnowledge(body) {
  if (!knowledgeState) {
    addEmpty(body, "Loading knowledge…");
    return;
  }
  var files = knowledgeState.files || [];
  for (var i = 0; i < files.length; i++) {
    var item = document.createElement("div");
    item.className = "home-mate-settings-file";
    item.innerHTML = iconHtml("file-text");
    var name = document.createElement("span");
    name.textContent = typeof files[i] === "string" ? files[i] : files[i].name || "Untitled";
    item.appendChild(name);
    body.appendChild(item);
  }
  if (!files.length) addEmpty(body, "No knowledge files yet.");
}

function requestSection(section) {
  if (section === "model" && !modelRequested) {
    modelRequested = true;
    var mate = getMate(dialogMateId);
    requestHomeMateModels((mate || {}).vendor || "", renderDialogContent, false);
  }
  if (section === "memory") {
    memoryState = null;
    memoryRequestId = nextRequestId("memory");
    send({ type: "home_mate_memory_list", mateId: dialogMateId, requestId: memoryRequestId });
  }
  if (section === "knowledge") {
    knowledgeState = null;
    knowledgeRequestId = nextRequestId("knowledge");
    send({ type: "home_mate_knowledge_list", mateId: dialogMateId, requestId: knowledgeRequestId });
  }
}

function renderDialogContent() {
  if (!dialog) return;
  var body = dialog.querySelector(".home-mate-settings-body");
  if (!body) return;
  body.innerHTML = "";
  var mate = getMate(dialogMateId);
  var contentTitle = dialog.querySelector(".home-mate-settings-content-title");
  if (contentTitle) contentTitle.textContent = dialogSection.charAt(0).toUpperCase() + dialogSection.slice(1) + " settings";
  if (dialogSection === "general") renderGeneral(body, mate);
  else if (dialogSection === "model") renderHomeMateModelPicker(body, renderDialogContent);
  else if (dialogSection === "memory") renderMemory(body);
  else renderKnowledge(body);
  var nav = dialog.querySelectorAll("[data-home-mate-settings-section]");
  for (var i = 0; i < nav.length; i++) {
    var active = nav[i].dataset.homeMateSettingsSection === dialogSection;
    nav[i].classList.toggle("is-active", active);
    if (active) nav[i].setAttribute("aria-current", "page");
    else nav[i].removeAttribute("aria-current");
  }
  refreshIcons();
}

function selectSection(section, focusContent) {
  if (section !== "general" && section !== "model" && section !== "memory" && section !== "knowledge") return;
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

export function closeHomeMateSettings() {
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
  clearHomeMateModelPicker();
  document.removeEventListener("keydown", handleDialogKeydown, true);
  document.body.classList.remove("home-mate-settings-open");
  setTransientDrawerMask(false);
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
}

export function openHomeMateSettings(mateId, opener, options) {
  var mate = getMate(mateId);
  if (!mate) return false;
  closeHomeMateSettings();
  dialogMateId = mateId;
  dialogOpener = opener || document.activeElement;
  dialogSection = options && options.section === "model" ? "model" : "general";
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
  var sections = ["general", "model", "memory", "knowledge"];
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
  contentTitle.className = "home-mate-settings-content-title sr-only";
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
  if (dialogSection === "model") {
    var restoreFocus = restoreModelFocusAfterRender();
    renderDialogContent();
    restoreFocus();
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
  if (dialogSection === "model") {
    var restoreFocus = restoreModelFocusAfterRender();
    renderDialogContent();
    restoreFocus();
  }
  return true;
}

export function syncHomeMateSettingsTarget() {
  if (dialogMateId && !getMate(dialogMateId)) closeHomeMateSettings();
}
