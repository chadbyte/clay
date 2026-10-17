import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { initProjectEnvironment, openProjectEnvironment, projectEnvironmentDirty, discardProjectEnvironment } from './project-settings-environment.js';
import { enhanceSettingsSelects } from './settings-select.js';
// Project identity, access and environment: the Project pane of the unified
// settings shell. The shell owns the selected target; this pane only renders
// and edits the project it was last bound to.
import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { parseEmojis } from './markdown.js';
import { registerSettingsScope, openSettings, closeSettings, isSettingsShellOpen, activeSettingsScope } from './settings-shell.js';
import { initProjectSessionVisibilitySettings, populateProjectSessionVisibilitySettings } from './project-session-visibility-settings.js';

var panelEl = null;
var sections = null;
function settingsSlug() { return store.get("projectSettingsSlug"); }
function settingsProject() { return store.get("projectSettingsProject"); }

// Emoji categories (reuse from sidebar)
var EMOJI_CATEGORIES = null;

function renameDirty() {
  var rename = document.getElementById("ps-rename-form");
  var project = settingsProject();
  return !!(rename && project && !rename.classList.contains("hidden") && document.getElementById("ps-rename-input").value.trim() !== (project.name || ""));
}

function discardDrafts() {
  discardProjectEnvironment();
  cancelRename();
}

var controller = {
  enter: function () {},
  activate: function (page) { switchSection(page); },
  leave: function () { closePsEmojiPicker(); },
  busy: function (kind) { return kind !== "page" && (store.get("projectEnvironmentEditor") || {}).saving ? "Wait for the environment save to finish." : ""; },
  leavePrompt: function (kind) {
    var env = projectEnvironmentDirty();
    var rename = renameDirty();
    if (!env && !rename) return null;
    if (kind === "close") return { message: "Your changes have not been saved. Discard them and close?", action: "Discard changes", apply: discardDrafts };
    if (kind === "page") return null;
    if (kind === "project" && rename) return { message: "Your unsaved project name change will be discarded when you switch projects. An unsaved environment draft stays in this tab.", action: "Discard name and switch", apply: cancelRename };
    return { message: "Your unsaved project changes will remain in this tab. Leave this editor and keep the draft?", action: "Keep draft and leave" };
  },
  retarget: bindProjectSettings,
  refreshTarget: refreshProjectSettings,
  clearTarget: clearProjectSettings,
  setEmpty: setPaneEmpty
};

export function initProjectSettings(emojiCategories) {
  EMOJI_CATEGORIES = emojiCategories;
  panelEl = document.getElementById("project-settings");
  if (!panelEl) return;
  controller.pane = panelEl;
  registerSettingsScope("project", controller);
  initProjectEnvironment();
  sections = panelEl.querySelectorAll(".ps-section");

  // Profile: rename
  var renameBtn = document.getElementById("ps-rename-btn");
  var renameForm = document.getElementById("ps-rename-form");
  var renameInput = document.getElementById("ps-rename-input");
  var renameSave = document.getElementById("ps-rename-save");
  var renameCancel = document.getElementById("ps-rename-cancel");

  if (renameBtn) {
    renameBtn.addEventListener("click", function () {
      renameForm.classList.remove("hidden");
      renameInput.value = settingsProject() ? settingsProject().name || "" : "";
      renameBtn.classList.add("hidden");
      renameInput.focus();
      renameInput.select();
    });
  }
  if (renameSave) {
    renameSave.addEventListener("click", function () { commitRename(); });
  }
  if (renameCancel) {
    renameCancel.addEventListener("click", function () { cancelRename(); });
  }
  if (renameInput) {
    renameInput.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
      if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
    });
  }

  // Profile: icon
  var iconBtn = document.getElementById("ps-icon-btn");
  var iconRemoveBtn = document.getElementById("ps-icon-remove-btn");
  if (iconBtn) {
    iconBtn.addEventListener("click", function () {
      showPsEmojiPicker();
    });
  }
  if (iconRemoveBtn) {
    iconRemoveBtn.addEventListener("click", function () {
      var slug = settingsSlug();
      var previous = { icon: settingsProject() ? settingsProject().icon || null : null };
      if (slug && sendEdit("set_project_icon", { slug: slug, icon: null }, previous)) updateIconPreview(null);
    });
  }

  initProjectSessionVisibilitySettings();
}

// Entry for the project context menu and mobile sheet: show this exact
// project's settings without changing the open workspace.
export function openProjectSettings(slug) {
  return openSettings({ scope: "project", page: "profile", slug: slug });
}

// Bind the pane to one project. Called by the shell for every target change.
function bindProjectSettings(slug, project) {
  var same = settingsSlug() === slug;
  store.set({ projectSettingsSlug: slug, projectSettingsProject: Object.assign({}, project, { name: project.title || project.project || project.name || slug }) });
  var env = store.get("projectEnvironmentEditor");
  if (env && !env.dirty && !env.saving) store.set({ projectEnvironmentEditor: Object.assign({}, env, { loaded: false, loading: false }) });
  if (same) refreshProjectSettings(slug, project);
  else { closePsEmojiPicker(); populateProfile(); }
  var active = panelEl.querySelector(".ps-section.active");
  if (active && active.dataset.section === "environment") openProjectEnvironment(slug);
}

function refreshProjectSettings(slug, project) {
  if (settingsSlug() !== slug) return;
  var name = project.title || project.project || project.name || slug;
  store.set({ projectSettingsProject: Object.assign({}, project, { name: name }) });
  var nameEl = document.getElementById("ps-project-name");
  if (nameEl) nameEl.textContent = name || "-";
  updateIconPreview(project.icon || null);
  populateProjectSessionVisibilitySettings(slug, settingsProject());
  document.getElementById('ps-project-path').textContent = project.path || (slug === store.get('currentSlug') ? store.get('cwd') : '') || 'Folder information unavailable';
}

// The selected project is gone or no longer authorised.
function clearProjectSettings(slug) {
  var env = store.get("projectEnvironmentEditor") || {};
  var drafts = Object.assign({}, store.get("projectEnvironmentDrafts") || {});
  delete drafts[slug];
  store.set({ projectSettingsSlug: null, projectSettingsProject: null, projectEnvironmentDrafts: drafts });
  if (env.slug === slug) { store.set({ projectEnvironmentEditor: {} }); }
  closePsEmojiPicker();
  cancelRename();
}

var EMPTY_HEADINGS = { loading: "Loading projects", empty: "No project selected", error: "Projects unavailable", lost: "Project unavailable" };
function setPaneEmpty(text, kind) {
  var empty = document.getElementById("ps-empty");
  if (empty) {
    empty.hidden = !text;
    document.getElementById("ps-empty-text").textContent = text || "";
    empty.querySelector("h2").textContent = EMPTY_HEADINGS[kind] || EMPTY_HEADINGS.empty;
  }
  panelEl.classList.toggle("ps-no-target", !!text);
}

// Rename and icon edits are bound to the exact project, request and (for the
// reply) the slug the server echoes; a reply for another project never
// changes the view.
var pendingEdits = {};
var editSequence = 0;
function sendEdit(type, fields, previous) {
  var ws = getWs();
  if (!ws || !store.get("connected")) return false;
  editSequence += 1;
  var requestId = "project-settings-" + Date.now() + "-" + editSequence;
  pendingEdits[requestId] = { slug: fields.slug, type: type, previous: previous };
  ws.send(JSON.stringify(Object.assign({ type: type, requestId: requestId }, fields)));
  return true;
}

export function handleProjectSettingsEditResult(msg) {
  var pending = msg && msg.requestId && pendingEdits[msg.requestId];
  if (!pending) return;
  delete pendingEdits[msg.requestId];
  if (msg.slug !== pending.slug || msg.ok || settingsSlug() !== pending.slug) return;
  if (pending.type === "set_project_title") updateProjectSettingsName(pending.previous.name);
  else updateProjectSettingsIcon(pending.previous.icon);
}

export function closeProjectSettings(opts) {
  closeSettings({ cleanup: !!(opts && opts.cleanup), onlyScope: "project" });
}

export function isProjectSettingsOpen() {
  return isSettingsShellOpen() && activeSettingsScope() === "project";
}

function switchSection(name) {
  for (var j = 0; j < sections.length; j++) {
    sections[j].classList.toggle("active", sections[j].dataset.section === name);
  }
  if (name === "environment" && settingsSlug()) openProjectEnvironment(settingsSlug());
  enhanceSettingsSelects(panelEl);
  refreshIcons();
}

function populateProfile() {
  var nameEl = document.getElementById("ps-project-name");
  if (nameEl) nameEl.textContent = settingsProject() ? settingsProject().name || "-" : "-";

  // Reset rename form
  var renameForm = document.getElementById("ps-rename-form");
  var renameBtn = document.getElementById("ps-rename-btn");
  if (renameForm) renameForm.classList.add("hidden");
  if (renameBtn) renameBtn.classList.remove("hidden");

  // Icon
  updateIconPreview(settingsProject() ? settingsProject().icon : null);

  populateProjectSessionVisibilitySettings(settingsSlug(), settingsProject());
  document.getElementById("ps-access-note").textContent = store.get("isMultiUserMode") ? "Choose who can see new conversations in this project. Existing conversations keep their visibility." : "This server is in single-user mode. Project membership and shared session defaults are available in multi-user mode.";

  var project = settingsProject() || {};
  document.getElementById('ps-project-path').textContent = project.path || (settingsSlug() === store.get('currentSlug') ? store.get('cwd') : '') || 'Folder information unavailable';
}

function commitRename() {
  var renameInput = document.getElementById("ps-rename-input");
  var nameEl = document.getElementById("ps-project-name");
  var newName = renameInput ? renameInput.value.trim() : "";
  var slug = settingsSlug();
  var previous = { name: settingsProject() ? settingsProject().name : "" };
  if (newName && slug && sendEdit("set_project_title", { slug: slug, title: newName }, previous)) {
    if (nameEl) nameEl.textContent = newName;
    if (settingsProject()) settingsProject().name = newName;
    cancelRename();
  } else showToast("Enter a name and connect to the server before saving.");
}

function cancelRename() {
  var renameForm = document.getElementById("ps-rename-form");
  var renameBtn = document.getElementById("ps-rename-btn");
  if (renameForm) renameForm.classList.add("hidden");
  if (renameBtn) renameBtn.classList.remove("hidden");
}

function updateIconPreview(icon) {
  var preview = document.getElementById("ps-icon-preview");
  var removeBtn = document.getElementById("ps-icon-remove-btn");
  if (preview) {
    preview.textContent = icon || "";
    if (icon) parseEmojis(preview);
    else { preview.innerHTML = '<i data-lucide="folder"></i>'; refreshIcons(); }
  }
  if (removeBtn) {
    removeBtn.classList.toggle("hidden", !icon);
  }
}

var psEmojiPickerEl = null;

function closePsEmojiPicker() {
  if (psEmojiPickerEl) {
    psEmojiPickerEl.remove();
    psEmojiPickerEl = null;
  }
}

function showPsEmojiPicker() {
  closePsEmojiPicker();
  if (!EMOJI_CATEGORIES) return;

  var anchor = document.getElementById("ps-emoji-picker-anchor");
  if (!anchor) return;

  var picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.style.position = "relative";
  picker.style.left = "0";
  picker.style.top = "0";
  picker.style.marginTop = "8px";
  picker.addEventListener("click", function (e) { e.stopPropagation(); });

  // Header
  var header = document.createElement("div");
  header.className = "emoji-picker-header";
  header.textContent = "Choose Icon";
  picker.appendChild(header);

  // Category tabs
  var tabBar = document.createElement("div");
  tabBar.className = "emoji-picker-tabs";
  var tabBtns = [];

  for (var t = 0; t < EMOJI_CATEGORIES.length; t++) {
    (function (cat, idx) {
      var tab = document.createElement("button");
      tab.className = "emoji-picker-tab" + (idx === 0 ? " active" : "");
      tab.textContent = cat.icon;
      tab.title = cat.label;
      tab.addEventListener("click", function (e) {
        e.stopPropagation();
        switchCategory(idx);
      });
      tabBar.appendChild(tab);
      tabBtns.push(tab);
    })(EMOJI_CATEGORIES[t], t);
  }
  parseEmojis(tabBar);
  picker.appendChild(tabBar);

  // Grid
  var scrollArea = document.createElement("div");
  scrollArea.className = "emoji-picker-scroll";
  var grid = document.createElement("div");
  grid.className = "emoji-picker-grid";
  scrollArea.appendChild(grid);
  picker.appendChild(scrollArea);

  function buildGrid(emojis) {
    grid.innerHTML = "";
    for (var i = 0; i < emojis.length; i++) {
      (function (emoji) {
        var btn = document.createElement("button");
        btn.className = "emoji-picker-item";
        btn.textContent = emoji;
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          closePsEmojiPicker();
          var slug = settingsSlug();
          var previous = { icon: settingsProject() ? settingsProject().icon || null : null };
          if (slug && sendEdit("set_project_icon", { slug: slug, icon: emoji }, previous)) updateIconPreview(emoji);
        });
        grid.appendChild(btn);
      })(emojis[i]);
    }
    parseEmojis(grid);
    scrollArea.scrollTop = 0;
  }

  function switchCategory(idx) {
    for (var j = 0; j < tabBtns.length; j++) {
      tabBtns[j].classList.toggle("active", j === idx);
    }
    buildGrid(EMOJI_CATEGORIES[idx].emojis);
  }

  buildGrid(EMOJI_CATEGORIES[0].emojis);

  anchor.innerHTML = "";
  anchor.appendChild(picker);
  psEmojiPickerEl = picker;
}

export function updateProjectSettingsIcon(icon) {
  if (settingsProject()) settingsProject().icon = icon;
  updateIconPreview(icon);
}

export function updateProjectSettingsName(name) {
  if (settingsProject()) settingsProject().name = name;
  var nameEl = document.getElementById("ps-project-name");
  if (nameEl) nameEl.textContent = name || "-";
}

export function handleProjectOwnerChanged(msg) {
  if (settingsProject()) {
    settingsProject().projectOwnerId = msg.ownerId;
  }
  var ownerNameEl = document.getElementById("ps-owner-name");
  if (ownerNameEl) ownerNameEl.textContent = msg.ownerName || msg.ownerId || "Not set";
  showToast("Project ownership transferred to " + (msg.ownerName || "new owner"));
}
