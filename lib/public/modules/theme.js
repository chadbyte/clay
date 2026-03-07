import { setTerminalTheme } from './terminal.js';
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

// --- Dracula default: exact CSS values for initial render (before API loads) ---
var defaultExactVars = {
  "--bg": "#282a36",
  "--bg-alt": "#363447",
  "--text": "#f0f1f4",
  "--text-secondary": "#f8f8f2",
  "--text-muted": "#9ea8c7",
  "--text-dimmer": "#6272a4",
  "--accent": "#ffb86c",
  "--accent-hover": "#ffc17e",
  "--accent-bg": "rgba(255, 184, 108, 0.12)",
  "--code-bg": "#22242e",
  "--border": "#44475a",
  "--border-subtle": "#333644",
  "--input-bg": "#3d3e51",
  "--user-bubble": "#404154",
  "--error": "#ff5555",
  "--success": "#50fa7b",
  "--warning": "#f1fa8c",
  "--sidebar-bg": "#242631",
  "--sidebar-hover": "#2f2f3f",
  "--sidebar-active": "#3d3e51",
  "--accent-8": "rgba(255, 184, 108, 0.08)",
  "--accent-12": "rgba(255, 184, 108, 0.12)",
  "--accent-15": "rgba(255, 184, 108, 0.15)",
  "--accent-20": "rgba(255, 184, 108, 0.20)",
  "--accent-25": "rgba(255, 184, 108, 0.25)",
  "--accent-30": "rgba(255, 184, 108, 0.30)",
  "--accent2": "#80bfff",
  "--accent2-hover": "#8fc7ff",
  "--accent2-bg": "rgba(128, 191, 255, 0.12)",
  "--accent2-8": "rgba(128, 191, 255, 0.08)",
  "--accent2-12": "rgba(128, 191, 255, 0.12)",
  "--accent2-15": "rgba(128, 191, 255, 0.15)",
  "--accent2-20": "rgba(128, 191, 255, 0.20)",
  "--accent2-25": "rgba(128, 191, 255, 0.25)",
  "--accent2-30": "rgba(128, 191, 255, 0.30)",
  "--error-8": "rgba(255, 85, 85, 0.08)",
  "--error-12": "rgba(255, 85, 85, 0.12)",
  "--error-15": "rgba(255, 85, 85, 0.15)",
  "--error-25": "rgba(255, 85, 85, 0.25)",
  "--success-8": "rgba(80, 250, 123, 0.08)",
  "--success-12": "rgba(80, 250, 123, 0.12)",
  "--success-15": "rgba(80, 250, 123, 0.15)",
  "--success-25": "rgba(80, 250, 123, 0.25)",
  "--warning-bg": "rgba(241, 250, 140, 0.12)",
  "--overlay-rgb": "255,255,255",
  "--shadow-rgb": "0,0,0",
  "--hl-comment": "#6272a4",
  "--hl-keyword": "#ff79c6",
  "--hl-string": "#50fa7b",
  "--hl-number": "#ffb86c",
  "--hl-function": "#80bfff",
  "--hl-variable": "#ff5555",
  "--hl-type": "#f1fa8c",
  "--hl-constant": "#ffb86c",
  "--hl-tag": "#ff5555",
  "--hl-attr": "#80bfff",
  "--hl-regexp": "#8be9fd",
  "--hl-meta": "#bd93f9",
  "--hl-builtin": "#ffb86c",
  "--hl-symbol": "#bd93f9",
  "--hl-addition": "#50fa7b",
  "--hl-deletion": "#ff5555"
};

// Minimal Dracula palette for getThemeColor before API loads
var defaultFallback = {
  name: "Dracula", variant: "dark",
  base00: "282a36", base01: "363447", base02: "44475a", base03: "6272a4",
  base04: "9ea8c7", base05: "f8f8f2", base06: "f0f1f4", base07: "ffffff",
  base08: "ff5555", base09: "ffb86c", base0A: "f1fa8c", base0B: "50fa7b",
  base0C: "8be9fd", base0D: "80bfff", base0E: "ff79c6", base0F: "bd93f9"
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
    "--code-bg":        isLight ? darken(b.base00, 0.03) : darken(b.base00, 0.15),
    "--border":         b.base02,
    "--border-subtle":  mixColors(b.base00, b.base02, 0.6),
    "--input-bg":       mixColors(b.base01, b.base02, 0.5),
    "--user-bubble":    isLight ? darken(b.base01, 0.03) : mixColors(b.base01, b.base02, 0.3),
    "--error":          b.base08,
    "--success":        b.base0B,
    "--warning":        b.base0A,
    "--sidebar-bg":     isLight ? darken(b.base00, 0.02) : darken(b.base00, 0.10),
    "--sidebar-hover":  isLight ? darken(b.base00, 0.06) : mixColors(b.base00, b.base01, 0.5),
    "--sidebar-active": isLight ? darken(b.base01, 0.05) : mixColors(b.base01, b.base02, 0.5),
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
  var vars = currentThemeId === "dracula" ? defaultExactVars : computeVars(theme);
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
var currentThemeId = "dracula";
var changeCallbacks = [];
var STORAGE_KEY = "clay-theme";
var MODE_KEY = "clay-mode";        // "light" | "dark" | null (system)
var SKIN_KEY = "clay-skin";        // theme id within current variant pair

// --- Helpers ---

function getTheme(id) {
  return themes[id] || (id === "dracula" ? defaultFallback : null);
}

function isCustom(id) {
  return !!customSet[id];
}

// --- Public API ---

export function getCurrentTheme() {
  return getTheme(currentThemeId) || defaultFallback;
}

export function getThemeId() {
  return currentThemeId;
}

export function getThemeColor(baseKey) {
  var theme = getCurrentTheme();
  return "#" + (theme[baseKey] || "000000");
}

export function getComputedVar(varName) {
  if (currentThemeId === "dracula" && !themesLoaded) return defaultExactVars[varName] || "";
  var theme = getCurrentTheme();
  var vars = computeVars(theme);
  return vars[varName] || "";
}

export function getTerminalTheme() {
  return computeTerminalTheme(getCurrentTheme());
}

export function getMermaidThemeVars() {
  return computeMermaidVars(getCurrentTheme());
}

export function onThemeChange(fn) {
  changeCallbacks.push(fn);
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
  if (!theme) themeId = "dracula";
  theme = getTheme(themeId);
  currentThemeId = themeId;

  var vars = (themeId === "dracula" && !themesLoaded) ? defaultExactVars : computeVars(theme);
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

  var termTheme = computeTerminalTheme(theme);
  try { setTerminalTheme(termTheme); } catch (e) {}

  var mermaidVars = computeMermaidVars(theme);
  try { updateMermaidTheme(mermaidVars); } catch (e) {}

  try {
    localStorage.setItem(STORAGE_KEY, themeId);
    localStorage.setItem(STORAGE_KEY + "-vars", JSON.stringify(vars));
    localStorage.setItem(STORAGE_KEY + "-variant", theme.variant || "dark");
  } catch (e) {}

  // When picked from skin selector, save as skin preference and sync mode
  if (fromPicker) {
    try {
      localStorage.setItem(SKIN_KEY, themeId);
      localStorage.setItem(MODE_KEY, isLight ? "light" : "dark");
    } catch (e) {}
  }

  updateToggleIcon();

  for (var j = 0; j < changeCallbacks.length; j++) {
    try { changeCallbacks[j](themeId, vars); } catch (e) {}
  }
}

// --- Mascot icon update (swap light/dark src) ---
function updateMascotSvgs(vars, isLight) {
  var lightSrc = "favicon.svg";
  var darkSrc = "favicon-dark.svg";
  var src = isLight ? lightSrc : darkSrc;
  var mascots = document.querySelectorAll("img.footer-mascot");
  for (var i = 0; i < mascots.length; i++) {
    mascots[i].setAttribute("src", src);
  }
  var faviconEl = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
  if (faviconEl) faviconEl.setAttribute("href", src);
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

    // Ensure dracula always exists
    if (!themes.dracula) themes.dracula = defaultFallback;

    themesLoaded = true;

    // Rebuild picker if already created
    if (pickerEl) rebuildPicker();

    // Always apply the current theme now that real data is loaded
    // (before this, only defaultExactVars was used as fallback)
    applyTheme(currentThemeId);
  }).catch(function () {
    // API unavailable — keep dracula fallback
    themes.dracula = defaultFallback;
    themesLoaded = true;
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
  try { saved = localStorage.getItem(MODE_KEY); } catch (e) {}
  if (saved === "light" || saved === "dark") return saved;
  return getSystemMode();
}

// Map a mode to the appropriate theme id
// If user has a custom skin selected, find its dark/light counterpart
function themeIdForMode(mode) {
  var skin = null;
  try { skin = localStorage.getItem(SKIN_KEY); } catch (e) {}

  // Default skin pair: clay (dark) / clay-light (light)
  if (!skin) {
    return mode === "light" ? "ayu-light" : "dracula";
  }

  // Custom skin — try to find the counterpart
  var current = getTheme(skin);
  if (!current) return mode === "light" ? "ayu-light" : "dracula";

  // Already the right variant?
  if (current.variant === mode) return skin;

  // Find the counterpart by looking for a theme with matching colors but opposite variant
  // Convention: id / id-light  or  id-dark / id
  var base = skin.replace(/-light$/, "").replace(/-dark$/, "");
  var darkId = themes[base] && themes[base].variant === "dark" ? base : base + "-dark";
  var lightId = themes[base + "-light"] ? base + "-light" : (themes[base] && themes[base].variant === "light" ? base : null);

  if (mode === "light") {
    if (lightId && themes[lightId]) return lightId;
    return "ayu-light";
  } else {
    if (darkId && themes[darkId]) return darkId;
    return "dracula";
  }
}

// Toggle between light and dark
export function toggleDarkMode() {
  var current = getEffectiveMode();
  var next = current === "dark" ? "light" : "dark";
  try { localStorage.setItem(MODE_KEY, next); } catch (e) {}
  var tid = themeIdForMode(next);
  applyTheme(tid);
  updateToggleIcon();
}

// Update the toggle switch checkbox state
function updateToggleIcon() {
  var checkbox = document.getElementById("theme-toggle-check");
  if (!checkbox) return;
  var mode = getEffectiveMode();
  // checked = light mode (thumb slides right, covering moon)
  checkbox.checked = (mode === "light");
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

  // Clay default themes always first in their section
  function pinFirst(arr, pinId) {
    var idx = arr.indexOf(pinId);
    if (idx > 0) { arr.splice(idx, 1); arr.unshift(pinId); }
  }
  pinFirst(darkIds, "dracula");
  pinFirst(lightIds, "ayu-light");

  // Dark section
  if (darkIds.length > 0) {
    var darkHeader = document.createElement("div");
    darkHeader.className = "theme-picker-header";
    darkHeader.textContent = "Dark";
    pickerEl.appendChild(darkHeader);

    var darkList = document.createElement("div");
    darkList.className = "theme-picker-section";
    for (var d = 0; d < darkIds.length; d++) {
      darkList.appendChild(createThemeItem(darkIds[d], themes[darkIds[d]]));
    }
    pickerEl.appendChild(darkList);
  }

  // Light section
  if (lightIds.length > 0) {
    var lightHeader = document.createElement("div");
    lightHeader.className = "theme-picker-header";
    lightHeader.textContent = "Light";
    pickerEl.appendChild(lightHeader);

    var lightList = document.createElement("div");
    lightList.className = "theme-picker-section";
    for (var l = 0; l < lightIds.length; l++) {
      lightList.appendChild(createThemeItem(lightIds[l], themes[lightIds[l]]));
    }
    pickerEl.appendChild(lightList);
  }

  // Custom section
  if (customIds.length > 0) {
    var customHeader = document.createElement("div");
    customHeader.className = "theme-picker-header";
    customHeader.textContent = "Custom";
    pickerEl.appendChild(customHeader);

    var customList = document.createElement("div");
    customList.className = "theme-picker-section";
    for (var c = 0; c < customIds.length; c++) {
      customList.appendChild(createThemeItem(customIds[c], themes[customIds[c]]));
    }
    pickerEl.appendChild(customList);
  }
}

function createThemePicker() {
  if (pickerEl) return pickerEl;

  pickerEl = document.createElement("div");
  pickerEl.className = "theme-picker";
  pickerEl.id = "theme-picker";

  buildPickerContent();
  return pickerEl;
}

function rebuildPicker() {
  if (!pickerEl) return;
  buildPickerContent();
}

var pickerVisible = false;

function togglePicker() {
  // Legacy — no longer used as floating popover
  // Picker is now embedded in server settings
}

function closePicker() {
  // Legacy — no longer needed
}

// --- Init ---
export function initTheme() {
  // Determine initial theme from saved mode + skin, or system preference
  var saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}

  if (saved) {
    currentThemeId = saved;
  } else {
    // No saved theme — use system mode
    var mode = getSystemMode();
    currentThemeId = mode === "light" ? "ayu-light" : "dracula";
  }

  // Load all themes from server, then apply properly
  loadThemes();

  // Wire up title bar toggle switch
  var toggleCheck = document.getElementById("theme-toggle-check");
  if (toggleCheck) {
    toggleCheck.addEventListener("change", function () {
      toggleDarkMode();
    });
  }

  // Listen for system preference changes (only applies if user has no manual override)
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var handler = function () {
      var userMode = null;
      try { userMode = localStorage.getItem(MODE_KEY); } catch (e) {}
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

  // Set initial toggle icon
  updateToggleIcon();
}

// --- Settings picker (for appearance section in server settings) ---
export function openSettingsThemePicker(containerEl) {
  if (!containerEl) return;

  if (!pickerEl) {
    createThemePicker();
  }

  // Move picker into settings container if not already there
  if (pickerEl.parentNode !== containerEl) {
    containerEl.innerHTML = "";
    containerEl.appendChild(pickerEl);
  }
  pickerEl.classList.add("visible");
}
