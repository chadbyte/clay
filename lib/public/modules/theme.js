import { store } from './store.js';
import { refreshIcons } from './icons.js';
import { setTerminalTheme } from './terminal.js';
import { setTuiSessionTheme } from './session-tui-view.js';
import { setTuiAttentionTheme } from './tui-attention.js';
import { updateMermaidTheme } from './markdown.js';

import { hexToRgb, rgbToHex, darken, lighten, mixColors, hexToRgba, luminance, computeVars, validateTheme, defaultDarkFallback, defaultLightFallback, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID } from './theme-palette.js';

var defaultExactVars = computeVars(defaultDarkFallback);

function computeTerminalTheme(theme) {
  var b = {};
  var keys = ["base00","base01","base02","base03","base04","base05","base06","base07",
              "base08","base09","base0A","base0B","base0C","base0D","base0E","base0F"];
  for (var i = 0; i < keys.length; i++) {
    b[keys[i]] = "#" + theme[keys[i]];
  }

  var isLight = theme.variant === "light";
  return {
    background: isLight ? darken(b.base00, 0.03) : darken(b.base00, 0.15),
    foreground: b.base05,
    cursor: b.base06,
    selectionBackground: hexToRgba(b.base02, 0.5),
    black: isLight ? b.base07 : b.base00,
    red: b.base08,
    green: b.base0B,
    yellow: b.base0A,
    blue: b.base0D,
    magenta: b.base0E,
    cyan: b.base0C,
    white: isLight ? b.base00 : b.base05,
    brightBlack: b.base03,
    brightRed: isLight ? darken(b.base08, 0.1) : lighten(b.base08, 0.1),
    brightGreen: isLight ? darken(b.base0B, 0.1) : lighten(b.base0B, 0.1),
    brightYellow: isLight ? darken(b.base0A, 0.1) : lighten(b.base0A, 0.1),
    brightBlue: isLight ? darken(b.base0D, 0.1) : lighten(b.base0D, 0.1),
    brightMagenta: isLight ? darken(b.base0E, 0.1) : lighten(b.base0E, 0.1),
    brightCyan: isLight ? darken(b.base0C, 0.1) : lighten(b.base0C, 0.1),
    brightWhite: b.base07
  };
}

function computeMermaidVars(theme) {
  var vars = currentThemeId === DEFAULT_DARK_THEME_ID ? defaultExactVars : computeVars(theme);
  var isLight = theme.variant === "light";
  return {
    darkMode: !isLight,
    background: vars["--code-bg"],
    primaryColor: vars["--accent"],
    primaryTextColor: vars["--text"],
    primaryBorderColor: vars["--border"],
    lineColor: vars["--text-muted"],
    secondaryColor: vars["--bg-alt"],
    tertiaryColor: vars["--bg"]
  };
}

// --- State ---
// All themes loaded from server: bundled + custom, keyed by id
var themes = {};
var customSet = {};   // ids that came from ~/.clay/themes/
var themesLoaded = false;
var currentThemeId = DEFAULT_DARK_THEME_ID;
var changeCallbacks = [];
var externalThemeId = null;  // set by the parent shell for pane iframes
var STORAGE_KEY = "clay-theme";
var MODE_KEY = "clay-mode";        // "light" | "dark" | null (system)
var SKIN_KEY = "clay-skin";        // theme id within current variant pair
var WIDE_KEY = "clay-wide-view";   // cached from server, "bubble" | "channel"

// --- Helpers ---

function getTheme(id) {
  if (themes[id]) return themes[id];
  if (id === DEFAULT_DARK_THEME_ID) return defaultDarkFallback;
  if (id === DEFAULT_LIGHT_THEME_ID) return defaultLightFallback;
  return null;
}

function isCustom(id) {
  return !!customSet[id];
}

// --- Public API ---

export function getCurrentTheme() {
  return getTheme(currentThemeId) || defaultDarkFallback;
}

export function getThemeId() {
  return currentThemeId;
}

export function getThemeColor(baseKey) {
  var theme = getCurrentTheme();
  return "#" + (theme[baseKey] || "000000");
}

export function getComputedVar(varName) {
  if (currentThemeId === DEFAULT_DARK_THEME_ID && !themesLoaded) return defaultExactVars[varName] || "";
  var theme = getCurrentTheme();
  var vars = computeVars(theme);
  return vars[varName] || "";
}

export function getTerminalTheme() {
  return computeTerminalTheme(getTheme(DEFAULT_DARK_THEME_ID) || defaultDarkFallback);
}

export function getMermaidThemeVars() {
  return computeMermaidVars(getCurrentTheme());
}

export function onThemeChange(fn) {
  changeCallbacks.push(fn);
}

// The appearance this frame currently shows, for the parent shell to hand to
// its pane iframes. Never persisted from here.
export function getAppearanceSnapshot() {
  var pref = store.get('appearanceDraft') || store.get('appearancePreference') || {};
  return { themeId: currentThemeId, userId: store.get('myUserId') || null,
    preference: { configured: !!pref.configured || !!pref.mode || !!pref.theme, theme: pref.theme || null, mode: pref.mode || null,
      lightTheme: pref.lightTheme || null, darkTheme: pref.darkTheme || null } };
}

// A pane iframe mirrors the parent's live appearance. The server remains the
// only persisted source, so this applies the view without saving anything.
export function applyExternalAppearance(snapshot) {
  externalThemeId = snapshot.themeId;
  store.set({ appearancePreference: snapshot.preference, appearanceDraft: null });
  applyTheme(snapshot.themeId);
}

export function getThemes() {
  // Return a copy
  var all = {};
  var k;
  for (k in themes) all[k] = themes[k];
  return all;
}

export function applyTheme(themeId, fromPicker) {
  var theme = getTheme(themeId);
  if (!theme) themeId = getEffectiveMode() === "light" ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID;
  theme = getTheme(themeId);
  currentThemeId = themeId;

  var vars = (themeId === DEFAULT_DARK_THEME_ID && !themesLoaded) ? defaultExactVars : computeVars(theme);
  var root = document.documentElement;
  var varNames = Object.keys(vars);
  for (var i = 0; i < varNames.length; i++) {
    root.style.setProperty(varNames[i], vars[varNames[i]]);
  }

  var isLight = theme.variant === "light";
  root.classList.toggle("light-theme", isLight);
  root.classList.toggle("dark-theme", !isLight);

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", vars["--bg"]);

  updatePickerActive(themeId);

  try { updateMascotSvgs(vars, isLight); } catch (e) {}

  // Terminals deliberately keep Clay Studio Dark for predictable ANSI
  // contrast, even while the surrounding workspace uses a light theme.
  var termTheme = getTerminalTheme();
  try { setTerminalTheme(); } catch (e) {}
  try { setTuiSessionTheme(termTheme); } catch (e) {}
  try { setTuiAttentionTheme(termTheme); } catch (e) {}

  var mermaidVars = computeMermaidVars(theme);
  try { updateMermaidTheme(mermaidVars); } catch (e) {}

  if (fromPicker) saveAppearance(themeId, isLight ? 'light' : 'dark');

  updateToggleIcon();

  for (var j = 0; j < changeCallbacks.length; j++) {
    try { changeCallbacks[j](themeId, vars); } catch (e) {}
  }
}

// --- Favicon update on theme change ---
function updateMascotSvgs(vars, isLight) {
  var faviconEl = document.querySelector('link[rel="icon"]');
  if (faviconEl) faviconEl.setAttribute("href", "clay-studio-favicon-32.png");
}

// --- Theme loading from server ---
function loadThemes() {
  return fetch("/api/themes").then(function (res) {
    if (!res.ok) throw new Error("fetch failed");
    return res.json();
  }).then(function (data) {
    if (!data) return;
    var bundled = data.bundled || {};
    var custom = data.custom || {};
    var id;

    // Bundled themes first
    for (id in bundled) {
      if (validateTheme(bundled[id])) {
        themes[id] = bundled[id];
      }
    }
    // Custom themes override bundled
    for (id in custom) {
      if (validateTheme(custom[id])) {
        themes[id] = custom[id];
        customSet[id] = true;
      }
    }

    // Keep both Clay Studio defaults available even if a bundled file is missing.
    if (!themes[DEFAULT_DARK_THEME_ID]) themes[DEFAULT_DARK_THEME_ID] = defaultDarkFallback;
    if (!themes[DEFAULT_LIGHT_THEME_ID]) themes[DEFAULT_LIGHT_THEME_ID] = defaultLightFallback;

    themesLoaded = true;

    // Rebuild picker if already created
    if (pickerEl) rebuildPicker();

    // Always apply the current theme now that real data is loaded
    // (before this, only defaultExactVars was used as fallback)
    applyTheme(externalThemeId && getTheme(externalThemeId) ? externalThemeId : currentThemeId);
  }).catch(function () {
    // API unavailable — keep the embedded Clay Studio pair.
    themes[DEFAULT_DARK_THEME_ID] = defaultDarkFallback;
    themes[DEFAULT_LIGHT_THEME_ID] = defaultLightFallback;
    themesLoaded = true;
    if (pickerEl) rebuildPicker();
    applyTheme(currentThemeId);
  });
}

// --- Light / Dark mode toggle ---

// Returns the system preferred mode
function getSystemMode() {
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

// Returns the effective mode: user override or system
function getEffectiveMode() {
  var saved = null;
  saved = (store.get('appearanceDraft') || store.get('appearancePreference') || {}).mode;
  if (saved === "light" || saved === "dark") return saved;
  return getSystemMode();
}

// Map a mode to the appropriate theme id
// If user has a custom skin selected, find its dark/light counterpart
function themeIdForMode(mode) {
  var skin = null;
  var preference = store.get('appearanceDraft') || store.get('appearancePreference') || {};
  var paired = preference[mode + 'Theme'];
  if (paired && getTheme(paired) && getTheme(paired).variant === mode) return paired;
  skin = preference.theme;

  // Default Clay Studio skin pair.
  if (!skin) {
    return mode === "light" ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID;
  }

  // Custom skin — try to find the counterpart
  var current = getTheme(skin);
  if (!current) return mode === "light" ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID;

  // Already the right variant?
  if (current.variant === mode) return skin;

  // Find the counterpart by looking for a theme with matching colors but opposite variant
  // Convention: id / id-light  or  id-dark / id
  var base = skin.replace(/-light$/, "").replace(/-dark$/, "");
  var darkId = themes[base] && themes[base].variant === "dark" ? base : base + "-dark";
  var lightId = themes[base + "-light"] ? base + "-light" : (themes[base] && themes[base].variant === "light" ? base : null);

  if (mode === "light") {
    if (lightId && themes[lightId]) return lightId;
    return DEFAULT_LIGHT_THEME_ID;
  } else {
    if (darkId && themes[darkId]) return darkId;
    return DEFAULT_DARK_THEME_ID;
  }
}

// --- Wide view ---

export function isWideView() { return getChatLayout() === 'channel'; }
export function getChatLayout() { return store.get('personalChatLayout') || 'channel'; }
export function setChatLayout(layout) {
  var val = layout === 'bubble' ? 'bubble' : 'channel';
  store.set({ personalChatLayout: val });
  document.body.classList.toggle('wide-view', val === 'channel');
}

export function setWideView(enabled) {
  setChatLayout(enabled ? "channel" : "bubble");
}

// Toggle between light and dark
export function toggleDarkMode() {
  var current = getEffectiveMode();
  var next = current === "dark" ? "light" : "dark";

  var tid = themeIdForMode(next);
  applyTheme(tid);
  saveAppearance(tid, next);
  updateToggleIcon();
}

// Update all theme toggle checkboxes
function updateToggleIcon() {
  var mode = getEffectiveMode();
  var isLight = mode === "light";
  // Legacy top-bar toggle (may not exist)
  var checkbox = document.getElementById("theme-toggle-check");
  if (checkbox) checkbox.checked = isLight;
  // User settings toggle
  var usToggle = document.getElementById("us-theme-toggle");
  if (usToggle) usToggle.checked = isLight;
  var quickToggle = document.getElementById("appearance-mode-toggle");
  if (quickToggle) {
    var label = isLight ? "Switch to dark mode" : "Switch to light mode";
    quickToggle.setAttribute("aria-label", label);
    quickToggle.title = label;
    quickToggle.innerHTML = '<i data-lucide="' + (isLight ? "moon" : "sun") + '" class="cursor-share-icon" aria-hidden="true"></i>';
  }
  refreshIcons();
}

// --- Theme picker UI ---
var pickerEl = null;

function updatePickerActive(themeId) {
  if (!pickerEl) return;
  var items = pickerEl.querySelectorAll(".theme-picker-item");
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.dataset.theme === themeId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  }
}

function createThemeItem(id, theme) {
  var item = document.createElement("button");
  item.className = "theme-picker-item";
  if (id === currentThemeId) item.className += " active";
  item.dataset.theme = id;

  var swatches = document.createElement("span");
  swatches.className = "theme-swatches";
  var previewKeys = ["base00", "base01", "base09", "base0B", "base0D"];
  for (var j = 0; j < previewKeys.length; j++) {
    var dot = document.createElement("span");
    dot.className = "theme-swatch";
    dot.style.background = "#" + theme[previewKeys[j]];
    swatches.appendChild(dot);
  }
  item.appendChild(swatches);

  var label = document.createElement("span");
  label.className = "theme-picker-label";
  label.textContent = theme.name;
  item.appendChild(label);

  var check = document.createElement("span");
  check.className = "theme-picker-check";
  check.textContent = "\u2713";
  item.appendChild(check);

  item.addEventListener("click", function (e) {
    e.stopPropagation();
    applyTheme(id, true);
  });

  return item;
}

function buildPickerContent() {
  pickerEl.innerHTML = "";

  var darkIds = [];
  var lightIds = [];
  var customIds = [];
  var themeIds = Object.keys(themes);
  for (var i = 0; i < themeIds.length; i++) {
    var id = themeIds[i];
    if (isCustom(id)) {
      customIds.push(id);
    } else if (themes[id].variant === "light") {
      lightIds.push(id);
    } else {
      darkIds.push(id);
    }
  }

  // Clay Studio default themes always first in their section.
  function pinFirst(arr, pinId) {
    var idx = arr.indexOf(pinId);
    if (idx > 0) { arr.splice(idx, 1); arr.unshift(pinId); }
  }
  pinFirst(darkIds, DEFAULT_DARK_THEME_ID);
  pinFirst(lightIds, DEFAULT_LIGHT_THEME_ID);

  function appendThemeGroup(label, ids) {
    if (ids.length === 0) return;
    var group = document.createElement("div");
    group.className = "theme-picker-group";

    var header = document.createElement("div");
    header.className = "theme-picker-header";
    header.textContent = label;
    group.appendChild(header);

    var list = document.createElement("div");
    list.className = "theme-picker-section";
    for (var j = 0; j < ids.length; j++) {
      list.appendChild(createThemeItem(ids[j], themes[ids[j]]));
    }
    group.appendChild(list);
    pickerEl.appendChild(group);
  }

  appendThemeGroup("Dark", darkIds);
  appendThemeGroup("Light", lightIds);
  appendThemeGroup("Custom", customIds);
}

function createThemePicker() {
  if (pickerEl) return pickerEl;

  pickerEl = document.createElement("div");
  pickerEl.className = "theme-picker";
  pickerEl.id = "theme-picker";

  buildPickerContent();
  return pickerEl;
}

export function mountThemePicker(container) {
  if (!container) return;
  var picker = createThemePicker();
  picker.classList.add("theme-picker-embedded");
  if (picker.parentNode !== container) container.appendChild(picker);
  rebuildPicker();
}

function rebuildPicker() {
  if (!pickerEl) return;
  buildPickerContent();
}

// --- Init ---
export function initTheme() {
  var seed = window.__clayAppearanceSeed;
  if (seed && seed.configured) store.set({ appearancePreference: seed });
  var initialMode = seed && seed.configured && (seed.mode === 'light' || seed.mode === 'dark')
    ? seed.mode
    : getSystemMode();
  currentThemeId = seed && seed.configured && seed[initialMode + 'Theme']
    ? seed[initialMode + 'Theme']
    : (initialMode === 'light' ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID);
  document.body.classList.toggle('wide-view', isWideView());

  // Load all themes from server, then apply properly
  loadThemes().then(loadAppearance);

  // The theme picker is mounted in User Settings by user-settings.js.

  // Listen for system preference changes (only applies if user has no manual override)
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var handler = function () {
      var userMode = null;
      userMode = (store.get('appearanceDraft') || store.get('appearancePreference') || {}).mode;
      if (!userMode) {
        // No manual override — follow system
        var sysMode = getSystemMode();
        var tid = themeIdForMode(sysMode);
        applyTheme(tid);
      }
    };
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
    } else if (mq.addListener) {
      mq.addListener(handler);
    }
  }

  var quickToggle = document.getElementById("appearance-mode-toggle");
  if (quickToggle) quickToggle.addEventListener("click", toggleDarkMode);

  // Set initial toggle icon
  updateToggleIcon();

}

function appearanceStatus(text, error) {
  store.set({ appearanceSaveStatus: text, appearanceSaveError: !!error });
  var status = document.getElementById('us-appearance-status');
  if (status) { status.textContent = text; status.dataset.state = error ? 'error' : ''; }
}
export function getAppearanceChoices() {
  return { mode: (store.get('appearanceDraft') || store.get('appearancePreference') || {}).mode || 'system', lightTheme: themeIdForMode('light'), darkTheme: themeIdForMode('dark') };
}
export function retryAppearanceSave() {
  var draft = store.get('appearanceDraft');
  if (draft) saveAppearance(draft.theme, draft.mode, draft);
}
export function selectAppearanceMode(mode) {
  var effective = mode === 'system' ? getSystemMode() : mode;
  var id = themeIdForMode(effective);
  saveAppearance(id, mode === 'system' ? null : mode);
  applyTheme(id);
}
export function selectAppearanceTheme(mode, id) {
  if (!getTheme(id) || getTheme(id).variant !== mode) return;
  var effective = getEffectiveMode();
  var current = store.get('appearanceDraft') || store.get('appearancePreference') || {};
  var change = {}; change[mode + 'Theme'] = id;
  saveAppearance(mode === effective ? id : currentThemeId, current.mode || null, change);
  if (mode === effective) applyTheme(id);
}
function saveAppearance(theme, mode, overrides) {
  var values = Object.assign({}, store.get('appearanceDraft') || store.get('appearancePreference') || {}, {theme:theme, mode:mode}, overrides || {});
  delete values.configured;
  var selected = getTheme(theme);
  if (selected) values[selected.variant + 'Theme'] = theme;
  store.set({appearanceDraft:values});
  var queue = store.get('appearanceSaveQueue') || Promise.resolve();
  var next = queue.catch(function () {}).then(function () {return persistAppearance(values);});
  store.set({appearanceSaveQueue:next});
  return next;
}
async function persistAppearance(values) {
  var request = (store.get('appearanceSaveRequest') || 0) + 1;
  store.set({ appearanceSaveRequest: request });
  appearanceStatus('Saving appearance…');
  try {
    var response = await fetch('/api/user/appearance', {method:'PUT',headers:{'Content-Type':'application/json','X-Clay-Settings':'1'},body:JSON.stringify(values)});
    if (!response.ok) throw new Error('Could not save appearance. Your preview remains. Retry to save it.');
    if (store.get('appearanceSaveRequest') !== request) return;
    var saved = await response.json();
    store.set({ appearancePreference: saved, appearanceDraft: store.get('appearanceDraft') === values ? null : store.get('appearanceDraft') });
    [STORAGE_KEY,SKIN_KEY,MODE_KEY,STORAGE_KEY+'-vars',STORAGE_KEY+'-variant'].forEach(function (key) {try {localStorage.removeItem(key);}catch(error){}});
    appearanceStatus('Saved. Applied to this view; other devices use it when they reload.');
  } catch(error) {if(store.get('appearanceSaveRequest') === request) appearanceStatus(error.message,true);}
}
async function loadAppearance() {
  try {
    var response = await fetch('/api/user/appearance');
    if (!response.ok) throw new Error('Appearance preferences unavailable.');
    var data = await response.json();
    if(store.get('appearanceSaveRequest'))return;
    // A pane that already mirrors its parent's live view is newer than this GET, which may predate a pending save.
    if(externalThemeId)return;
    if (data.configured) {store.set({appearancePreference:data});applyTheme(themeIdForMode(data.mode || getSystemMode()));}
    else {
      var legacy = null;try {legacy = localStorage.getItem(STORAGE_KEY);}catch(error){}
      if(legacy && getTheme(legacy))store.set({legacyAppearanceAvailable:legacy});
    }
  } catch(error) {appearanceStatus(error.message,true);}
}

export function importLegacyAppearance() {
  var legacy=store.get('legacyAppearanceAvailable');
  if(legacy) {applyTheme(legacy,true);store.set({legacyAppearanceAvailable:null});}
}
