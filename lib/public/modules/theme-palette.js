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


export { hexToRgb, rgbToHex, darken, lighten, mixColors, hexToRgba, luminance, computeVars, validateTheme, defaultDarkFallback, defaultLightFallback, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID };
