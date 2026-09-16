// project-settings.js — Project settings panel (profile, defaults, instructions, env)
import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { parseEmojis } from './markdown.js';
import { closeFileViewer } from './filebrowser.js';
import { renderModelList, renderModeList, renderEffortBar, renderThinkingBar, renderBetaCard } from './settings-defaults.js';
import { initProjectSessionVisibilitySettings, populateProjectSessionVisibilitySettings } from './project-session-visibility-settings.js';

var ctx = null;
var panelEl = null;
var navItems = null;
var sections = null;
var currentSlug = null;
var currentProject = null; // { slug, name, icon }

// Emoji categories (reuse from sidebar)
var EMOJI_CATEGORIES = null;


// ===== Init =====
export function initProjectSettings(appCtx, emojiCategories) {
  ctx = appCtx;
  EMOJI_CATEGORIES = emojiCategories;
  panelEl = document.getElementById("project-settings");
  if (!panelEl) return;

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

  // ESC key
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panelEl && !panelEl.classList.contains("hidden")) {
      closeProjectSettings();
    }
  });

  // Profile: rename
  var renameBtn = document.getElementById("ps-rename-btn");
  var renameForm = document.getElementById("ps-rename-form");
  var renameInput = document.getElementById("ps-rename-input");
  var renameSave = document.getElementById("ps-rename-save");
  var renameCancel = document.getElementById("ps-rename-cancel");

  if (renameBtn) {
    renameBtn.addEventListener("click", function () {
      renameForm.classList.remove("hidden");
      renameInput.value = currentProject ? currentProject.name || "" : "";
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
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "set_project_icon", slug: currentSlug, icon: null }));
      }
      updateIconPreview(null);
    });
  }

  // Instructions: save
  var instrSave = document.getElementById("ps-instructions-save");
  if (instrSave) {
    instrSave.addEventListener("click", function () { saveInstructions(); });
  }

  // Environment: add button
  var envAddBtn = document.getElementById("ps-env-add-btn");
  if (envAddBtn) {
    envAddBtn.addEventListener("click", function () {
      addEnvRow("", "", true);
      autoSaveEnv();
    });
  }

  // Environment: tab switching
  var envTabs = panelEl.querySelectorAll(".ps-env-tab");
  var envTabContents = panelEl.querySelectorAll(".ps-env-tab-content");
  for (var ti = 0; ti < envTabs.length; ti++) {
    envTabs[ti].addEventListener("click", function () {
      var tab = this.dataset.tab;
      for (var a = 0; a < envTabs.length; a++) {
        envTabs[a].classList.toggle("active", envTabs[a].dataset.tab === tab);
      }
      for (var b = 0; b < envTabContents.length; b++) {
        envTabContents[b].classList.toggle("active", envTabContents[b].dataset.tab === tab);
      }
      if (tab === "shared") loadSharedEnv();
    });
  }

  // Environment: shared env add button
  var sharedEnvAddBtn = document.getElementById("ps-shared-env-add-btn");
  if (sharedEnvAddBtn) {
    sharedEnvAddBtn.addEventListener("click", function () {
      addSharedEnvRow("", "", true);
      autoSaveSharedEnv();
    });
  }

  // Owner: transfer
  var transferBtn = document.getElementById("ps-transfer-btn");
  if (transferBtn) {
    transferBtn.addEventListener("click", function () {
      showTransferForm();
    });
  }
  var transferSave = document.getElementById("ps-transfer-save");
  if (transferSave) {
    transferSave.addEventListener("click", function () {
      commitTransfer();
    });
  }
  var transferCancel = document.getElementById("ps-transfer-cancel");
  if (transferCancel) {
    transferCancel.addEventListener("click", function () {
      hideTransferForm();
    });
  }

  initProjectSessionVisibilitySettings();
}

// ===== Open / Close =====
export function openProjectSettings(slug, project) {
  if (!panelEl) return;
  currentSlug = slug;
  currentProject = project;

  // Set nav title
  var navTitle = document.getElementById("ps-nav-title");
  if (navTitle) navTitle.textContent = project.name || slug;

  // Reset to first section
  switchSection("profile");

  // Populate profile
  populateProfile();

  // Close file viewer if open (prevent split-screen)
  closeFileViewer();

  // Show panel
  panelEl.classList.remove("hidden");
  refreshIcons();
}

export function closeProjectSettings() {
  if (!panelEl) return;
  panelEl.classList.add("hidden");
  closePsEmojiPicker();
}

export function isProjectSettingsOpen() {
  return panelEl && !panelEl.classList.contains("hidden");
}

// ===== Section switching =====
function switchSection(name) {
  for (var i = 0; i < navItems.length; i++) {
    var active = navItems[i].dataset.section === name;
    navItems[i].classList.toggle("active", active);
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

  // Lazy-load section data
  if (name === "defaults") populateDefaults();
  if (name === "instructions") loadInstructions();
  if (name === "environment") {
    // Reset tabs to "project" tab
    var envTabs = panelEl.querySelectorAll(".ps-env-tab");
    var envTabContents = panelEl.querySelectorAll(".ps-env-tab-content");
    for (var t = 0; t < envTabs.length; t++) {
      envTabs[t].classList.toggle("active", envTabs[t].dataset.tab === "project");
    }
    for (var u = 0; u < envTabContents.length; u++) {
      envTabContents[u].classList.toggle("active", envTabContents[u].dataset.tab === "project");
    }
    loadEnvironment();
  }
}

// ===== Profile =====
function populateProfile() {
  var nameEl = document.getElementById("ps-project-name");
  if (nameEl) nameEl.textContent = currentProject ? currentProject.name || "-" : "-";

  // Reset rename form
  var renameForm = document.getElementById("ps-rename-form");
  var renameBtn = document.getElementById("ps-rename-btn");
  if (renameForm) renameForm.classList.add("hidden");
  if (renameBtn) renameBtn.classList.remove("hidden");

  // Icon
  updateIconPreview(currentProject ? currentProject.icon : null);

  populateProjectSessionVisibilitySettings(currentSlug, currentProject);

  // Owner (only in multi-user mode)
  var ownerField = document.getElementById("ps-owner-field");
  if (ownerField) {
    var ownerId = currentProject ? currentProject.projectOwnerId : null;
    var isOwnerLocked = currentProject ? currentProject.ownerLocked : false;
    var isMultiUser = ctx.multiUser;
    if (isMultiUser) {
      ownerField.style.display = "";
      var ownerNameEl = document.getElementById("ps-owner-name");
      var transferBtn = document.getElementById("ps-transfer-btn");
      var ownerLockedHint = document.getElementById("ps-owner-locked-hint");
      if (transferBtn) transferBtn.style.display = "none";
      if (ownerLockedHint) {
        if (isOwnerLocked) { ownerLockedHint.classList.remove("hidden"); } else { ownerLockedHint.classList.add("hidden"); }
      }
      // Fetch user list (only succeeds for admin)
      fetch("/api/admin/users").then(function (r) {
        if (!r.ok) throw new Error("not admin");
        return r.json();
      }).then(function (data) {
        var users = data.users || [];
        // Show owner name
        if (ownerId) {
          var owner = null;
          for (var i = 0; i < users.length; i++) {
            if (users[i].id === ownerId) { owner = users[i]; break; }
          }
          if (ownerNameEl) ownerNameEl.textContent = owner ? (owner.displayName || owner.username) : ownerId;
        } else {
          if (ownerNameEl) ownerNameEl.textContent = "Not set";
        }
        // Admin can transfer unless ownership is locked (home directory projects)
        if (transferBtn && !isOwnerLocked) transferBtn.style.display = "";
      }).catch(function () {
        // Not admin, show owner name from limited info
        if (ownerId) {
          if (ownerNameEl) ownerNameEl.textContent = ownerId;
          // Project owner can also transfer unless locked
          if (!isOwnerLocked && ctx.myUserId && ctx.myUserId === ownerId && transferBtn) {
            transferBtn.style.display = "";
          }
        } else {
          if (ownerNameEl) ownerNameEl.textContent = "Not set";
        }
      });
      hideTransferForm();
    } else {
      ownerField.style.display = "none";
    }
  }
}

function commitRename() {
  var renameInput = document.getElementById("ps-rename-input");
  var nameEl = document.getElementById("ps-project-name");
  var newName = renameInput ? renameInput.value.trim() : "";
  if (newName && ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "set_project_title", slug: currentSlug, title: newName }));
    if (nameEl) nameEl.textContent = newName;
    if (currentProject) currentProject.name = newName;
    var navTitle = document.getElementById("ps-nav-title");
    if (navTitle) navTitle.textContent = newName;
  }
  cancelRename();
}

function cancelRename() {
  var renameForm = document.getElementById("ps-rename-form");
  var renameBtn = document.getElementById("ps-rename-btn");
  if (renameForm) renameForm.classList.add("hidden");
  if (renameBtn) renameBtn.classList.remove("hidden");
}

// ===== Owner transfer =====
function showTransferForm() {
  var form = document.getElementById("ps-transfer-form");
  var btn = document.getElementById("ps-transfer-btn");
  var select = document.getElementById("ps-transfer-select");
  if (!form || !select) return;

  // Fetch user list and populate select
  select.innerHTML = '<option value="">Loading...</option>';
  fetch("/api/admin/users").then(function (r) { return r.json(); }).then(function (data) {
    var users = data.users || [];
    select.innerHTML = "";
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = (u.displayName || u.username) + (u.linuxUser ? " (" + u.linuxUser + ")" : "");
      if (currentProject && u.id === currentProject.projectOwnerId) opt.selected = true;
      select.appendChild(opt);
    }
  }).catch(function () {
    select.innerHTML = '<option value="">Failed to load users</option>';
  });

  form.classList.remove("hidden");
  if (btn) btn.classList.add("hidden");
}

function hideTransferForm() {
  var form = document.getElementById("ps-transfer-form");
  var btn = document.getElementById("ps-transfer-btn");
  if (form) form.classList.add("hidden");
  if (btn) btn.classList.remove("hidden");
}

function commitTransfer() {
  var select = document.getElementById("ps-transfer-select");
  var userId = select ? select.value : "";
  if (!userId || !ctx.ws || !ctx.connected) return;
  ctx.ws.send(JSON.stringify({ type: "transfer_project_owner", slug: currentSlug, userId: userId }));
  hideTransferForm();
}

function updateIconPreview(icon) {
  var preview = document.getElementById("ps-icon-preview");
  var removeBtn = document.getElementById("ps-icon-remove-btn");
  if (preview) {
    preview.textContent = icon || "";
    if (icon) parseEmojis(preview);
  }
  if (removeBtn) {
    removeBtn.classList.toggle("hidden", !icon);
  }
}

// ===== Emoji picker (inline in settings) =====
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
          if (ctx.ws && ctx.connected) {
            ctx.ws.send(JSON.stringify({ type: "set_project_icon", slug: currentSlug, icon: emoji }));
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

// ===== Defaults =====
function psSendMsg(type, data) {
  var ws = ctx.ws;
  if (ws && ws.readyState === 1) {
    var msg = Object.assign({ type: type }, data);
    ws.send(JSON.stringify(msg));
  }
}

function psDefaultsOpts() {
  return {
    models: ctx.currentModels || [],
    currentModel: ctx.currentModel || "",
    currentMode: ctx.currentMode || "default",
    currentEffort: ctx.currentEffort || "medium",
    currentThinking: ctx.currentThinking || "adaptive",
    currentThinkingBudget: ctx.currentThinkingBudget || 10000,
    currentBetas: ctx.currentBetas || [],
    sendMsg: psSendMsg,
    modelMsgType: "set_project_default_model",
    modeMsgType: "set_project_default_mode",
    effortMsgType: "set_project_default_effort",
    onModelSelect: function (model) {
      renderBetaCard("ps", Object.assign({}, psDefaultsOpts(), { overrideModel: model }));
    },
  };
}

function populateDefaults() {
  var opts = psDefaultsOpts();
  renderModelList("ps", opts);
  renderBetaCard("ps", opts);
  renderModeList("ps", opts);
  renderEffortBar("ps", opts);
  renderThinkingBar("ps", opts);
}

// ===== Instructions (CLAUDE.md) =====
function loadInstructions() {
  var editor = document.getElementById("ps-instructions-editor");
  var status = document.getElementById("ps-instructions-status");
  var saveStatus = document.getElementById("ps-instructions-save-status");
  if (saveStatus) saveStatus.textContent = "";

  if (status) status.textContent = "Loading...";

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_read", path: "CLAUDE.md" }));
  }
}

export function handleInstructionsRead(msg) {
  var editor = document.getElementById("ps-instructions-editor");
  var status = document.getElementById("ps-instructions-status");
  if (!editor) return;

  if (msg.error) {
    editor.value = "";
    if (status) status.textContent = "No CLAUDE.md file found. Save to create one.";
  } else {
    editor.value = msg.content || "";
    if (status) status.textContent = "";
  }
}

function saveInstructions() {
  var editor = document.getElementById("ps-instructions-editor");
  var saveStatus = document.getElementById("ps-instructions-save-status");
  if (!editor) return;

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "fs_write", path: "CLAUDE.md", content: editor.value }));
    if (saveStatus) saveStatus.textContent = "Saving...";
  }
}

export function handleInstructionsWrite(msg) {
  var saveStatus = document.getElementById("ps-instructions-save-status");
  if (!saveStatus) return;
  if (msg.ok) {
    saveStatus.textContent = "Saved";
    setTimeout(function () { saveStatus.textContent = ""; }, 2000);
  } else {
    saveStatus.textContent = "Error: " + (msg.error || "Failed to save");
  }
}

// ===== Environment (key-value list) =====
var envSaveTimer = null;
var envStatusTimer = null;

function showEnvSaveStatus(elementId, text, duration) {
  var saveStatus = document.getElementById(elementId);
  if (!saveStatus) return;
  if (envStatusTimer) clearTimeout(envStatusTimer);
  saveStatus.textContent = text;
  envStatusTimer = setTimeout(function () { saveStatus.textContent = ""; }, duration);
}

function loadEnvironment() {
  var saveStatus = document.getElementById("ps-env-save-status");
  if (saveStatus) saveStatus.textContent = "";

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "get_project_env", slug: currentSlug }));
  }
}

export function handleProjectEnv(msg) {
  // Parse envrc string into key-value pairs
  var list = document.getElementById("ps-env-list");
  if (!list) return;
  list.innerHTML = "";

  var pairs = parseEnvString(msg.envrc || "");
  for (var i = 0; i < pairs.length; i++) {
    addEnvRow(pairs[i].key, pairs[i].value, false);
  }
  refreshIcons();
}

// Check if text looks like env format: first line starts with a valid VAR_NAME=
export function looksLikeEnv(text) {
  var first = text.split("\n")[0].trim();
  if (first.indexOf("export ") === 0) first = first.substring(7);
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(first);
}

export function parseEnvString(str) {
  var pairs = [];
  if (!str) return pairs;
  var lines = str.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === "#") continue;
    // Strip leading "export "
    if (line.indexOf("export ") === 0) line = line.substring(7);
    var eq = line.indexOf("=");
    if (eq === -1) continue;
    var key = line.substring(0, eq).trim();
    var val = line.substring(eq + 1).trim();
    // Saved values are JSON-quoted so shell metacharacters remain data.
    if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
      try { val = JSON.parse(val); } catch (e) { val = val.substring(1, val.length - 1); }
    } else if (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'") {
      val = val.substring(1, val.length - 1);
    }
    if (key) pairs.push({ key: key, value: val });
  }
  return pairs;
}

export function serializeEnvValue(value) {
  return JSON.stringify(value == null ? "" : String(value));
}

function buildEnvString() {
  var list = document.getElementById("ps-env-list");
  if (!list) return "";
  var rows = list.querySelectorAll(".ps-env-row");
  var lines = [];
  for (var i = 0; i < rows.length; i++) {
    var keyInput = rows[i].querySelector(".ps-env-key");
    var valInput = rows[i].querySelector(".ps-env-val");
    var key = keyInput ? keyInput.value.trim() : "";
    var val = valInput ? valInput.value : "";
    if (key) lines.push("export " + key + "=" + serializeEnvValue(val));
  }
  return lines.join("\n");
}

function addEnvRow(key, value, focus) {
  var list = document.getElementById("ps-env-list");
  if (!list) return;

  var row = document.createElement("div");
  row.className = "ps-env-row";

  var keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "ps-env-key";
  keyInput.placeholder = "KEY";
  keyInput.value = key;
  keyInput.spellcheck = false;
  keyInput.autocomplete = "off";

  var valInput = document.createElement("input");
  valInput.type = "text";
  valInput.className = "ps-env-val";
  valInput.placeholder = "value";
  valInput.value = value;
  valInput.spellcheck = false;
  valInput.autocomplete = "off";

  var delBtn = document.createElement("button");
  delBtn.className = "ps-env-del";
  delBtn.title = "Remove";
  delBtn.innerHTML = '<i data-lucide="x"></i>';

  delBtn.addEventListener("click", function () {
    row.remove();
    autoSaveEnv();
  });

  // Auto-save on change
  keyInput.addEventListener("input", function () { autoSaveEnv(); });
  valInput.addEventListener("input", function () { autoSaveEnv(); });

  // Paste detection: if pasting KEY=VALUE content into key field, parse it
  keyInput.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text && looksLikeEnv(text)) {
      e.preventDefault();
      var pairs = parseEnvString(text);
      if (pairs.length > 0) {
        // Fill current row with first pair
        keyInput.value = pairs[0].key;
        valInput.value = pairs[0].value;
        // Add remaining as new rows
        for (var p = 1; p < pairs.length; p++) {
          addEnvRow(pairs[p].key, pairs[p].value, false);
        }
        autoSaveEnv();
      }
    }
  });

  // Also handle paste into value field
  valInput.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text && text.indexOf("\n") !== -1 && text.indexOf("=") !== -1) {
      e.preventDefault();
      var pairs = parseEnvString(text);
      if (pairs.length > 0) {
        keyInput.value = pairs[0].key;
        valInput.value = pairs[0].value;
        for (var p = 1; p < pairs.length; p++) {
          addEnvRow(pairs[p].key, pairs[p].value, false);
        }
        autoSaveEnv();
      }
    }
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(delBtn);
  list.appendChild(row);
  refreshIcons();

  if (focus) keyInput.focus();
}

function autoSaveEnv() {
  if (envSaveTimer) clearTimeout(envSaveTimer);
  envSaveTimer = setTimeout(function () {
    var envrc = buildEnvString();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "set_project_env", slug: currentSlug, envrc: envrc }));
      showEnvSaveStatus("ps-env-save-status", "Saving...", 2000);
    }
  }, 800);
}

export function handleProjectEnvSaved(msg) {
  if (msg.ok) {
    showEnvSaveStatus("ps-env-save-status", msg.timing || "Saved", 5000);
  } else {
    showEnvSaveStatus("ps-env-save-status", "Error: " + (msg.error || "Failed to save"), 5000);
  }
}

// ===== Shared Environment (via tabs) =====
var sharedEnvSaveTimer = null;
var sharedEnvStatusTimer = null;

function showSharedEnvSaveStatus(text, duration) {
  var saveStatus = document.getElementById("ps-shared-env-save-status");
  if (!saveStatus) return;
  if (sharedEnvStatusTimer) clearTimeout(sharedEnvStatusTimer);
  saveStatus.textContent = text;
  sharedEnvStatusTimer = setTimeout(function () { saveStatus.textContent = ""; }, duration);
}

function loadSharedEnv() {
  var saveStatus = document.getElementById("ps-shared-env-save-status");
  if (saveStatus) saveStatus.textContent = "";

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "get_shared_env" }));
  }
}

export function handleProjectSharedEnv(msg) {
  var list = document.getElementById("ps-shared-env-list");
  if (!list) return;
  list.innerHTML = "";

  var pairs = parseEnvString(msg.envrc || "");
  for (var i = 0; i < pairs.length; i++) {
    addSharedEnvRow(pairs[i].key, pairs[i].value, false);
  }
  refreshIcons();
}

export function handleProjectSharedEnvSaved(msg) {
  if (msg.ok) {
    showSharedEnvSaveStatus(msg.timing || "Saved", 5000);
  } else {
    showSharedEnvSaveStatus("Error: " + (msg.error || "Failed to save"), 5000);
  }
}

function buildSharedEnvString() {
  var list = document.getElementById("ps-shared-env-list");
  if (!list) return "";
  var rows = list.querySelectorAll(".ps-env-row");
  var lines = [];
  for (var i = 0; i < rows.length; i++) {
    var keyInput = rows[i].querySelector(".ps-env-key");
    var valInput = rows[i].querySelector(".ps-env-val");
    var key = keyInput ? keyInput.value.trim() : "";
    var val = valInput ? valInput.value : "";
    if (key) lines.push("export " + key + "=" + serializeEnvValue(val));
  }
  return lines.join("\n");
}

function addSharedEnvRow(key, value, focus) {
  var list = document.getElementById("ps-shared-env-list");
  if (!list) return;

  var row = document.createElement("div");
  row.className = "ps-env-row";

  var keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "ps-env-key";
  keyInput.placeholder = "KEY";
  keyInput.value = key;
  keyInput.spellcheck = false;
  keyInput.autocomplete = "off";

  var valInput = document.createElement("input");
  valInput.type = "text";
  valInput.className = "ps-env-val";
  valInput.placeholder = "value";
  valInput.value = value;
  valInput.spellcheck = false;
  valInput.autocomplete = "off";

  var delBtn = document.createElement("button");
  delBtn.className = "ps-env-del";
  delBtn.title = "Remove";
  delBtn.innerHTML = '<i data-lucide="x"></i>';

  delBtn.addEventListener("click", function () {
    row.remove();
    autoSaveSharedEnv();
  });

  keyInput.addEventListener("input", function () { autoSaveSharedEnv(); });
  valInput.addEventListener("input", function () { autoSaveSharedEnv(); });

  // Paste detection
  keyInput.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text && looksLikeEnv(text)) {
      e.preventDefault();
      var pairs = parseEnvString(text);
      if (pairs.length > 0) {
        keyInput.value = pairs[0].key;
        valInput.value = pairs[0].value;
        for (var p = 1; p < pairs.length; p++) {
          addSharedEnvRow(pairs[p].key, pairs[p].value, false);
        }
        autoSaveSharedEnv();
      }
    }
  });

  valInput.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text && text.indexOf("\n") !== -1 && text.indexOf("=") !== -1) {
      e.preventDefault();
      var pairs = parseEnvString(text);
      if (pairs.length > 0) {
        keyInput.value = pairs[0].key;
        valInput.value = pairs[0].value;
        for (var p = 1; p < pairs.length; p++) {
          addSharedEnvRow(pairs[p].key, pairs[p].value, false);
        }
        autoSaveSharedEnv();
      }
    }
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(delBtn);
  list.appendChild(row);
  refreshIcons();

  if (focus) keyInput.focus();
}

function autoSaveSharedEnv() {
  if (sharedEnvSaveTimer) clearTimeout(sharedEnvSaveTimer);
  sharedEnvSaveTimer = setTimeout(function () {
    var envrc = buildSharedEnvString();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "set_shared_env", envrc: envrc }));
      showSharedEnvSaveStatus("Saving...", 2000);
    }
  }, 800);
}

// ===== Update from external events =====
export function updateProjectSettingsIcon(icon) {
  if (currentProject) currentProject.icon = icon;
  updateIconPreview(icon);
}

export function updateProjectSettingsName(name) {
  if (currentProject) currentProject.name = name;
  var nameEl = document.getElementById("ps-project-name");
  if (nameEl) nameEl.textContent = name || "-";
  var navTitle = document.getElementById("ps-nav-title");
  if (navTitle) navTitle.textContent = name || "-";
}

export function handleProjectOwnerChanged(msg) {
  if (currentProject) {
    currentProject.projectOwnerId = msg.ownerId;
  }
  var ownerNameEl = document.getElementById("ps-owner-name");
  if (ownerNameEl) ownerNameEl.textContent = msg.ownerName || msg.ownerId || "Not set";
  showToast("Project ownership transferred to " + (msg.ownerName || "new owner"));
}
