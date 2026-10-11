import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { trapSettingsFocus, isolateSettingsDialog, confirmSettingsAction } from './server-settings-state.js';
import { initProjectEnvironment, openProjectEnvironment, projectEnvironmentDirty, discardProjectEnvironment } from './project-settings-environment.js';
import { enhanceSettingsSelects } from './settings-select.js';
// Project identity and access in a focused settings dialog.
import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { parseEmojis } from './markdown.js';
import { holdNotesForSettings, releaseNotesForSettings } from './sticky-notes.js';
import { openNotesBrowser, closeNotesBrowser, isNotesBrowserOpen } from './sticky-notes-browser.js';
import { initProjectSessionVisibilitySettings, populateProjectSessionVisibilitySettings } from './project-session-visibility-settings.js';

var panelEl = null;
var navItems = null;
var sections = null;
var notesBrowserReopen = false;
var restoreBackground = null;
var returnFocus = null;
function settingsSlug() { return store.get("projectSettingsSlug"); }
function settingsProject() { return store.get("projectSettingsProject"); }

// Emoji categories (reuse from sidebar)
var EMOJI_CATEGORIES = null;


export function initProjectSettings(emojiCategories) {
  EMOJI_CATEGORIES = emojiCategories;
  panelEl = document.getElementById("project-settings");
  if (!panelEl) return;

  document.body.appendChild(panelEl);
  var destinations = [{id: 'profile', label: 'General'}, {id: 'access', label: 'Access'}, {id: 'environment', label: 'Environment'}];
  var nav = panelEl.querySelector('.server-settings-nav-items');
  var dropdown = document.getElementById('ps-nav-dropdown');
  destinations.forEach(function (page) {
    var button = document.createElement('button');
    button.className = 'settings-nav-item'; button.dataset.section = page.id; button.textContent = page.label;
    nav.appendChild(button);
    var option = document.createElement('option'); option.value = page.id; option.textContent = page.label; dropdown.appendChild(option);
  });
  initProjectEnvironment();
  panelEl.addEventListener('click', function (event) { if (event.target === panelEl) closeProjectSettings(); });
  panelEl.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); closeProjectSettings(); }
    trapSettingsFocus(event, panelEl);
  });
  navItems = panelEl.querySelectorAll(".settings-nav-item");
  sections = panelEl.querySelectorAll(".ps-section");

  // Nav clicks
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener("click", function () {
      switchSection(this.dataset.section);
    });
  }

  // Mobile dropdown nav
  var psNavDropdown = document.getElementById("ps-nav-dropdown");
  if (psNavDropdown) {
    psNavDropdown.addEventListener("change", function () {
      switchSection(psNavDropdown.value);
    });
  }

  // Close button
  var closeBtn = document.getElementById("project-settings-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closeProjectSettings();
    });
  }

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
      if (getWs() && store.get('connected')) {
        getWs().send(JSON.stringify({ type: "set_project_icon", slug: settingsSlug(), icon: null }));
      }
      updateIconPreview(null);
    });
  }

  initProjectSessionVisibilitySettings();
  store.subscribe(function (next, previous) { if (next.myUserId !== previous.myUserId) closeProjectSettings({ cleanup: true }); });
}

export function openProjectSettings(slug, project) {
  if (!panelEl) return;
  returnFocus = document.activeElement;
  if (!returnFocus || returnFocus === document.body) returnFocus = document.getElementById("title-bar-project-dropdown");
  store.set({ projectSettingsSlug: slug, projectSettingsProject: project });
  var env = store.get("projectEnvironmentEditor");
  if (env && !env.dirty && !env.saving) store.set({ projectEnvironmentEditor: Object.assign({}, env, { loaded: false, loading: false }) });

  // Set nav title
  var navTitle = document.getElementById("ps-nav-title");
  if (navTitle) navTitle.textContent = project.name || slug;

  // Reset to first section
  switchSection("profile");

  // Populate profile
  populateProfile();


  // Sticky notes must not sit over settings; remember what to restore.
  if (panelEl.classList.contains("hidden")) {
    notesBrowserReopen = isNotesBrowserOpen();
    if (notesBrowserReopen) closeNotesBrowser();
    holdNotesForSettings();
  }

  // Show panel
  panelEl.classList.remove("hidden");
  if (!restoreBackground) restoreBackground = isolateSettingsDialog(panelEl);
  document.getElementById("project-settings-close").focus();
  enhanceSettingsSelects(panelEl);
  refreshIcons();
}

// `cleanup` is for teardown while leaving the project: the notes workbench is
// not reopened over whatever screen comes next.
export function closeProjectSettings(opts) {
  if (!panelEl) return;
  if (!(opts && opts.cleanup) && (store.get("projectEnvironmentEditor") || {}).saving) { showToast("Wait for the environment save to finish."); return; }
  var rename = document.getElementById("ps-rename-form");
  var renameDirty = rename && !rename.classList.contains("hidden") && document.getElementById("ps-rename-input").value.trim() !== (settingsProject().name || "");
  if (!(opts && (opts.cleanup || opts.confirmed)) && (projectEnvironmentDirty() || renameDirty)) {
    confirmSettingsAction('Your changes have not been saved. Discard them and close?', 'Discard changes', function () {
      discardProjectEnvironment(); closeProjectSettings({ confirmed: true });
    });
    return;
  }
  var wasOpen = !panelEl.classList.contains("hidden");
  panelEl.classList.add("hidden");
  closePsEmojiPicker();
  if (restoreBackground) { restoreBackground(); restoreBackground = null; }
  if (returnFocus && returnFocus.isConnected && !(opts && opts.cleanup)) returnFocus.focus();
  if (wasOpen) {
    releaseNotesForSettings();
    if (notesBrowserReopen && !(opts && opts.cleanup)) openNotesBrowser();
    notesBrowserReopen = false;
  }
}

export function isProjectSettingsOpen() {
  return panelEl && !panelEl.classList.contains("hidden");
}

function switchSection(name) {
  for (var i = 0; i < navItems.length; i++) {
    var active = navItems[i].dataset.section === name;
    navItems[i].classList.toggle("active", active);
    navItems[i].setAttribute("aria-current", active ? "page" : "false");
  }
  for (var j = 0; j < sections.length; j++) {
    var active2 = sections[j].dataset.section === name;
    sections[j].classList.toggle("active", active2);
  }

  // Sync mobile dropdown
  var psNavDropdown = document.getElementById("ps-nav-dropdown");
  if (psNavDropdown && psNavDropdown.value !== name) {
    psNavDropdown.value = name;
  }

  if (name === "environment") openProjectEnvironment(settingsSlug());
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
  if (newName && getWs() && store.get('connected')) {
    getWs().send(JSON.stringify({ type: "set_project_title", slug: settingsSlug(), title: newName }));
    if (nameEl) nameEl.textContent = newName;
    if (settingsProject()) settingsProject().name = newName;
    var navTitle = document.getElementById("ps-nav-title");
    if (navTitle) navTitle.textContent = newName;
  }
  if (newName && getWs() && store.get("connected")) cancelRename();
  else showToast("Enter a name and connect to the server before saving.");
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
          if (getWs() && store.get('connected')) {
            getWs().send(JSON.stringify({ type: "set_project_icon", slug: settingsSlug(), icon: emoji }));
          }
          updateIconPreview(emoji);
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
  var navTitle = document.getElementById("ps-nav-title");
  if (navTitle) navTitle.textContent = name || "-";
}

export function handleProjectOwnerChanged(msg) {
  if (settingsProject()) {
    settingsProject().projectOwnerId = msg.ownerId;
  }
  var ownerNameEl = document.getElementById("ps-owner-name");
  if (ownerNameEl) ownerNameEl.textContent = msg.ownerName || msg.ownerId || "Not set";
  showToast("Project ownership transferred to " + (msg.ownerName || "new owner"));
}
