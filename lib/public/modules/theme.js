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

// --- Claude default: exact CSS values for initial render (before API loads) ---
var claudeExactVars = {
  "--bg": "#2F2E2B",
  "--bg-alt": "#35332F",
  "--text": "#E8E5DE",
  "--text-secondary": "#B5B0A6",
  "--text-muted": "#908B81",
  "--text-dimmer": "#6D6860",
  "--accent": "#DA7756",
  "--accent-hover": "#E5886A",
  "--accent-bg": "rgba(218, 119, 86, 0.12)",
  "--code-bg": "#1E1D1A",
  "--border": "#3E3C37",
  "--border-subtle": "#36342F",
  "--input-bg": "#393733",
  "--user-bubble": "#46423A",
  "--error": "#E5534B",
  "--success": "#57AB5A",
  "--warning": "#E5A84B",
  "--sidebar-bg": "#262522",
  "--sidebar-hover": "#302E2A",
  "--sidebar-active": "#3A3834",
  "--accent-8": "rgba(218, 119, 86, 0.08)",
  "--accent-12": "rgba(218, 119, 86, 0.12)",
  "--accent-15": "rgba(218, 119, 86, 0.15)",
  "--accent-20": "rgba(218, 119, 86, 0.20)",
  "--accent-25": "rgba(218, 119, 86, 0.25)",
  "--accent-30": "rgba(218, 119, 86, 0.30)",
  "--error-8": "rgba(229, 83, 75, 0.08)",
  "--error-12": "rgba(229, 83, 75, 0.12)",
  "--error-15": "rgba(229, 83, 75, 0.15)",
  "--error-25": "rgba(229, 83, 75, 0.25)",
  "--success-8": "rgba(87, 171, 90, 0.08)",
  "--success-12": "rgba(87, 171, 90, 0.12)",
  "--success-15": "rgba(87, 171, 90, 0.15)",
  "--success-25": "rgba(87, 171, 90, 0.25)",
  "--warning-bg": "rgba(229, 168, 75, 0.12)",
  "--overlay-rgb": "255,255,255",
  "--shadow-rgb": "0,0,0",
  "--hl-comment": "#6D6860",
  "--hl-keyword": "#C586C0",
  "--hl-string": "#57AB5A",
  "--hl-number": "#DA7756",
  "--hl-function": "#569CD6",
  "--hl-variable": "#E5534B",
  "--hl-type": "#E5A84B",
  "--hl-constant": "#DA7756",
  "--hl-tag": "#E5534B",
  "--hl-attr": "#569CD6",
  "--hl-regexp": "#4EC9B0",
  "--hl-meta": "#D7BA7D",
  "--hl-builtin": "#DA7756",
  "--hl-symbol": "#D7BA7D",
  "--hl-addition": "#57AB5A",
  "--hl-deletion": "#E5534B"
};

// Minimal claude palette for getThemeColor before API loads
var claudeFallback = {
  name: "Claude Dark", variant: "dark",
  base00: "2F2E2B", base01: "35332F", base02: "3E3C37", base03: "6D6860",
  base04: "908B81", base05: "B5B0A6", base06: "E8E5DE", base07: "FFFFFF",
  base08: "E5534B", base09: "DA7756", base0A: "E5A84B", base0B: "57AB5A",
  base0C: "4EC9B0", base0D: "569CD6", base0E: "C586C0", base0F: "D7BA7D"
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
  var vars = currentThemeId === "claude" ? claudeExactVars : computeVars(theme);
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
var customSet = {};   // ids that came from ~/.claude-relay/themes/
var themesLoaded = false;
var currentThemeId = "claude";
var changeCallbacks = [];
var STORAGE_KEY = "claude-relay-theme";

// --- Helpers ---

function getTheme(id) {
  return themes[id] || (id === "claude" ? claudeFallback : null);
}

function isCustom(id) {
  return !!customSet[id];
}

// --- Public API ---

export function getCurrentTheme() {
  return getTheme(currentThemeId) || claudeFallback;
}

export function getThemeId() {
  return currentThemeId;
}

export function getThemeColor(baseKey) {
  var theme = getCurrentTheme();
  return "#" + (theme[baseKey] || "000000");
}

export function getComputedVar(varName) {
  if (currentThemeId === "claude" && !themesLoaded) return claudeExactVars[varName] || "";
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

export function applyTheme(themeId) {
  var theme = getTheme(themeId);
  if (!theme) themeId = "claude";
  theme = getTheme(themeId);
  currentThemeId = themeId;

  var vars = (themeId === "claude" && !themesLoaded) ? claudeExactVars : computeVars(theme);
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

  try { updateMascotSvgs(vars); } catch (e) {}

  var termTheme = computeTerminalTheme(theme);
  try { setTerminalTheme(termTheme); } catch (e) {}

  var mermaidVars = computeMermaidVars(theme);
  try { updateMermaidTheme(mermaidVars); } catch (e) {}

  try {
    localStorage.setItem(STORAGE_KEY, themeId);
    localStorage.setItem(STORAGE_KEY + "-vars", JSON.stringify(vars));
    localStorage.setItem(STORAGE_KEY + "-variant", theme.variant || "dark");
  } catch (e) {}

  for (var j = 0; j < changeCallbacks.length; j++) {
    try { changeCallbacks[j](themeId, vars); } catch (e) {}
  }
}

// --- Mascot SVG update ---
var prevMascotColors = {
  border: "#3E3C37",
  dimmer: "#6D6860",
  muted: "#908B81",
  sidebar: "#262522"
};

function updateMascotSvgs(vars) {
  var mascots = document.querySelectorAll(".footer-mascot");
  for (var i = 0; i < mascots.length; i++) {
    var svg = mascots[i];
    var rects = svg.querySelectorAll("rect");
    for (var j = 0; j < rects.length; j++) {
      var fill = rects[j].getAttribute("fill");
      if (fill === prevMascotColors.border) rects[j].setAttribute("fill", vars["--border"]);
      else if (fill === prevMascotColors.dimmer) rects[j].setAttribute("fill", vars["--text-dimmer"]);
      else if (fill === prevMascotColors.muted) rects[j].setAttribute("fill", vars["--text-muted"]);
      else if (fill === prevMascotColors.sidebar) rects[j].setAttribute("fill", vars["--sidebar-bg"]);
    }
  }
  prevMascotColors.border = vars["--border"];
  prevMascotColors.dimmer = vars["--text-dimmer"];
  prevMascotColors.muted = vars["--text-muted"];
  prevMascotColors.sidebar = vars["--sidebar-bg"];
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

    // Ensure claude always exists
    if (!themes.claude) themes.claude = claudeFallback;

    themesLoaded = true;

    // Rebuild picker if already created
    if (pickerEl) rebuildPicker();

    // Always apply the current theme now that real data is loaded
    // (before this, only claudeExactVars was used as fallback)
    applyTheme(currentThemeId);
  }).catch(function () {
    // API unavailable — keep claude fallback
    themes.claude = claudeFallback;
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
    applyTheme(id);
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

  // Claude themes always first in their section
  function pinFirst(arr, pinId) {
    var idx = arr.indexOf(pinId);
    if (idx > 0) { arr.splice(idx, 1); arr.unshift(pinId); }
  }
  pinFirst(darkIds, "claude");
  pinFirst(lightIds, "claude-light");

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
  if (!pickerEl) {
    createThemePicker();
    document.body.appendChild(pickerEl);
  }

  pickerVisible = !pickerVisible;
  if (pickerVisible) {
    var footer = document.getElementById("sidebar-footer");
    if (footer) {
      var rect = footer.getBoundingClientRect();
      pickerEl.style.bottom = (window.innerHeight - rect.top + 4) + "px";
      pickerEl.style.left = rect.left + "px";
    }
    pickerEl.classList.add("visible");

    setTimeout(function () {
      document.addEventListener("click", closePicker);
    }, 0);
  } else {
    pickerEl.classList.remove("visible");
    document.removeEventListener("click", closePicker);
  }
}

function closePicker(e) {
  if (pickerVisible) {
    if (e && pickerEl && pickerEl.contains(e.target)) return;
    pickerVisible = false;
    if (pickerEl) pickerEl.classList.remove("visible");
    document.removeEventListener("click", closePicker);
  }
}

// --- Init ---
export function initTheme() {
  // Apply saved theme immediately if not claude (use claudeExactVars fallback)
  var saved = "claude";
  try { saved = localStorage.getItem(STORAGE_KEY) || "claude"; } catch (e) {}
  currentThemeId = saved;

  // Load all themes from server, then apply properly
  loadThemes();

  // Wire up footer theme button
  var btn = document.getElementById("footer-theme");
  if (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var footerMenu = document.getElementById("sidebar-footer-menu");
      if (footerMenu) footerMenu.classList.add("hidden");
      togglePicker();
    });
  }
}
