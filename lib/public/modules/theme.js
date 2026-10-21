import { store } from './store.js';
import { refreshIcons } from './icons.js';
import { setTerminalTheme } from './terminal.js';
import { setTuiSessionTheme } from './session-tui-view.js';
import { setTuiAttentionTheme } from './tui-attention.js';
import { updateMermaidTheme } from './markdown.js';

// --- Color utilities ---

function hexToRgb(hex) {
  var h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(function (v) {
    var c = Math.max(0, Math.min(255, Math.round(v)));
    return c.toString(16).padStart(2, "0");
  }).join("");
}

function darken(hex, amount) {
  var c = hexToRgb(hex);
  var f = 1 - amount;
  return rgbToHex(c.r * f, c.g * f, c.b * f);
}

function lighten(hex, amount) {
  var c = hexToRgb(hex);
  return rgbToHex(
    c.r + (255 - c.r) * amount,
    c.g + (255 - c.g) * amount,
    c.b + (255 - c.b) * amount
  );
}

function mixColors(hex1, hex2, weight) {
  var c1 = hexToRgb(hex1);
  var c2 = hexToRgb(hex2);
  var w = weight;
  return rgbToHex(
    c1.r * w + c2.r * (1 - w),
    c1.g * w + c2.g * (1 - w),
    c1.b * w + c2.b * (1 - w)
  );
}

function hexToRgba(hex, alpha) {
  var c = hexToRgb(hex);
  return "rgba(" + c.r + ", " + c.g + ", " + c.b + ", " + alpha + ")";
}

function luminance(hex) {
  var c = hexToRgb(hex);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

var DEFAULT_DARK_THEME_ID = "clay-dark";
var DEFAULT_LIGHT_THEME_ID = "clay-light";

// Embedded defaults keep the first render branded before /api/themes loads.
var defaultDarkFallback = {
  name: "Clay Studio Dark", variant: "dark",
  base00: "171715", base01: "20201D", base02: "393934", base03: "686861",
  base04: "A0A098", base05: "D1D1CA", base06: "E8E8E2", base07: "FAFAF5",
  base08: "FF7479", base09: "7776FF", base0A: "E0B45B", base0B: "07E5A3",
  base0C: "5FD2C0", base0D: "8AA7FF", base0E: "C39AF3", base0F: "D69A7D",
  accent2: "07E5A3", link: "7F7EC8"
};

var defaultLightFallback = {
  name: "Clay Studio Light", variant: "light",
  base00: "F7F7F3", base01: "EEEEEA", base02: "D7D7D0", base03: "A2A29B",
  base04: "73736C", base05: "44443F", base06: "252522", base07: "151513",
  base08: "C84B50", base09: "5857FC", base0A: "956A19", base0B: "087B59",
  base0C: "187A7C", base0D: "3F62B4", base0E: "7A52A8", base0F: "9A5A46",
  accent2: "07E5A3", link: "4948B8"
};

// --- Compute CSS variables from a base16 palette ---
function computeVars(theme) {
  var b = {};
  var keys = ["base00","base01","base02","base03","base04","base05","base06","base07",
              "base08","base09","base0A","base0B","base0C","base0D","base0E","base0F"];
  for (var i = 0; i < keys.length; i++) {
    b[keys[i]] = "#" + theme[keys[i]];
  }

  var isLight = theme.variant === "light";
  var accent2 = theme.accent2 ? "#" + theme.accent2 : b.base0D;
  var link = theme.link ? "#" + theme.link : b.base0D;

  return {
    "--bg":             b.base00,
    "--bg-alt":         b.base01,
    "--text":           b.base06,
    "--text-secondary": b.base05,
    "--text-muted":     b.base04,
    "--text-dimmer":    b.base03,
    "--accent":         b.base09,
    "--accent-hover":   isLight ? darken(b.base09, 0.12) : lighten(b.base09, 0.12),
    "--accent-bg":      hexToRgba(b.base09, 0.12),
    "--link":           link,
    "--link-hover":     isLight ? darken(link, 0.10) : lighten(link, 0.10),
    "--code-bg":        isLight ? darken(b.base00, 0.03) : darken(b.base00, 0.15),
    "--border":         b.base02,
    "--border-subtle":  mixColors(b.base00, b.base02, 0.6),
    "--input-bg":       isLight ? darken(b.base00, 0.04) : mixColors(b.base01, b.base02, 0.5),
    "--ask-mate-bg":    isLight ? mixColors("#ffffff", darken(b.base00, 0.04), 0.6) : mixColors(b.base00, mixColors(b.base01, b.base02, 0.5), 0.6),
    "--user-bubble":    isLight ? darken(b.base01, 0.03) : mixColors(b.base01, b.base02, 0.3),
    "--error":          b.base08,
    "--success":        b.base0B,
    "--warning":        b.base0A,
    "--sidebar-bg":     isLight ? darken(b.base00, 0.02) : darken(b.base00, 0.10),
    "--sidebar-hover":  isLight ? darken(b.base00, 0.06) : mixColors(b.base00, b.base01, 0.5),
    "--sidebar-active": isLight ? darken(b.base01, 0.05) : mixColors(b.base01, b.base02, 0.5),
    "--filebrowser-bg": isLight ? lighten(b.base00, 0.03) : lighten(b.base00, 0.04),
    "--filebrowser-border": isLight ? darken(b.base00, 0.08) : mixColors(b.base02, b.base00, 0.5),
    "--accent-8":       hexToRgba(b.base09, 0.08),
    "--accent-12":      hexToRgba(b.base09, 0.12),
    "--accent-15":      hexToRgba(b.base09, 0.15),
    "--accent-20":      hexToRgba(b.base09, 0.20),
    "--accent-25":      hexToRgba(b.base09, 0.25),
    "--accent-30":      hexToRgba(b.base09, 0.30),
    "--accent2":        accent2,
    "--accent2-hover":  isLight ? darken(accent2, 0.12) : lighten(accent2, 0.12),
    "--accent2-bg":     hexToRgba(accent2, 0.12),
    "--accent2-8":      hexToRgba(accent2, 0.08),
    "--accent2-12":     hexToRgba(accent2, 0.12),
    "--accent2-15":     hexToRgba(accent2, 0.15),
    "--accent2-20":     hexToRgba(accent2, 0.20),
    "--accent2-25":     hexToRgba(accent2, 0.25),
    "--accent2-30":     hexToRgba(accent2, 0.30),
    "--error-8":        hexToRgba(b.base08, 0.08),
    "--error-12":       hexToRgba(b.base08, 0.12),
    "--error-15":       hexToRgba(b.base08, 0.15),
    "--error-25":       hexToRgba(b.base08, 0.25),
    "--success-8":      hexToRgba(b.base0B, 0.08),
    "--success-12":     hexToRgba(b.base0B, 0.12),
    "--success-15":     hexToRgba(b.base0B, 0.15),
    "--success-25":     hexToRgba(b.base0B, 0.25),
    "--warning-bg":     hexToRgba(b.base0A, 0.12),
    "--overlay-rgb":    isLight ? "0,0,0" : "255,255,255",
    "--shadow-rgb":     "0,0,0",
    "--hl-comment":     b.base03,
    "--hl-keyword":     b.base0E,
    "--hl-string":      b.base0B,
    "--hl-number":      b.base09,
    "--hl-function":    b.base0D,
    "--hl-variable":    b.base08,
    "--hl-type":        b.base0A,
    "--hl-constant":    b.base09,
    "--hl-tag":         b.base08,
    "--hl-attr":        b.base0D,
    "--hl-regexp":      b.base0C,
    "--hl-meta":        b.base0F,
    "--hl-builtin":     b.base09,
    "--hl-symbol":      b.base0F,
    "--hl-addition":    b.base0B,
    "--hl-deletion":    b.base08
  };
}

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

function validateTheme(t) {
  if (!t || typeof t !== "object") return false;
  if (!t.name || typeof t.name !== "string") return false;
  var keys = ["base00","base01","base02","base03","base04","base05","base06","base07",
              "base08","base09","base0A","base0B","base0C","base0D","base0E","base0F"];
  for (var i = 0; i < keys.length; i++) {
    if (!t[keys[i]] || !/^[0-9a-fA-F]{6}$/.test(t[keys[i]])) return false;
  }
  if (t.variant && t.variant !== "dark" && t.variant !== "light") return false;
  if (!t.variant) {
    t.variant = luminance("#" + t.base00) > 0.5 ? "light" : "dark";
  }
  return true;
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
