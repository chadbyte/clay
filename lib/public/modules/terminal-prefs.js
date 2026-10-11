export var TERMINAL_FONT_OPTIONS = [
  { label: "SF Mono",         family: "'SF Mono', Menlo, Monaco, 'Courier New', monospace" },
  { label: "JetBrains Mono",  family: "'JetBrains Mono', 'SF Mono', Menlo, monospace" },
  { label: "Fira Code",       family: "'Fira Code', 'SF Mono', Menlo, monospace" },
  { label: "Cascadia Code",   family: "'Cascadia Code', 'SF Mono', Menlo, monospace" },
  { label: "IBM Plex Mono",   family: "'IBM Plex Mono', 'SF Mono', Menlo, monospace" },
  { label: "Source Code Pro", family: "'Source Code Pro', 'SF Mono', Menlo, monospace" },
  { label: "Roboto Mono",     family: "'Roboto Mono', 'SF Mono', Menlo, monospace" },
  { label: "D2 Coding",       family: "'D2 coding', 'D2Coding', 'SF Mono', Menlo, monospace" },
  { label: "System mono",     family: "ui-monospace, monospace" },
];

// terminal-prefs.js
//
// Single source of truth for terminal font preferences (family + size).
// Every xterm in Clay (bottom shell panel, Claude TUI session view, TUI
// attention modal) reads from here on create and re-applies on the
// `font-change` event so live updates are seamless.
//
// Persistence lives server-side under the user's profile. This module
// keeps a synchronized in-memory copy that the rest of the client reads
// without round-trips.

var DEFAULT_FAMILY = "'SF Mono', Menlo, Monaco, 'Courier New', monospace";
var DEFAULT_SIZE = 14;

var currentFamily = DEFAULT_FAMILY;
var currentSize = DEFAULT_SIZE;
var listeners = [];

// D2 Coding ships ~1.4MB of CJK glyphs per weight, so we avoid loading
// it eagerly on every page. The link is injected on demand the first
// time the user actually picks the font (or boots with it saved). The
// @font-face in this CSS registers under the family 'D2 coding' and
// also picks up a locally-installed 'D2Coding' via local() fallback.
//
// xterm's WebGL renderer measures cell metrics synchronously when the
// font family option changes, so the first atlas build right after
// selection happens against the *fallback* (SF Mono for Latin, a system
// Hangul font for Korean). Each is measured with its own width, so
// Latin and Hangul cells fall out of the expected 1:2 ratio and lines
// stop lining up. After the woff2 actually arrives we replay the
// font-change notification so every listener rebuilds its atlas with
// the proper D2 Coding metrics for both scripts.
var d2CodingInjected = false;
function notifyFontListeners() {
  for (var i = 0; i < listeners.length; i++) {
    try { listeners[i](currentFamily, currentSize); } catch (e) {}
  }
}
function ensureD2CodingWebfont() {
  if (d2CodingInjected) return;
  d2CodingInjected = true;
  if (typeof document === "undefined" || !document.head) return;
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://cdn.jsdelivr.net/gh/Joungkyun/font-d2coding/d2coding.css";
  link.onload = function () {
    if (document.fonts && typeof document.fonts.load === "function") {
      Promise.all([
        document.fonts.load('400 16px "D2 coding"'),
        document.fonts.load('700 16px "D2 coding"'),
      ]).then(notifyFontListeners).catch(function () {});
    } else {
      notifyFontListeners();
    }
  };
  document.head.appendChild(link);
}

function maybeLazyLoadWebfont(family) {
  if (typeof family !== "string") return;
  var lower = family.toLowerCase();
  if (lower.indexOf("d2 coding") !== -1 || lower.indexOf("d2coding") !== -1) {
    ensureD2CodingWebfont();
  }
}

export function getTerminalFontFamily() {
  return currentFamily || DEFAULT_FAMILY;
}

export function getTerminalFontSize() {
  var n = Number(currentSize);
  return (n >= 9 && n <= 32) ? n : DEFAULT_SIZE;
}

export function getDefaultTerminalFontFamily() {
  return DEFAULT_FAMILY;
}

// Set the in-memory values and notify subscribers. Pass null/undefined
// for any field that should stay unchanged. Persisting to the server
// is the caller's responsibility - this only updates local UI.
export function applyTerminalFont(family, size) {
  var changed = false;
  if (typeof family === "string" && family.trim() && family !== currentFamily) {
    currentFamily = family;
    changed = true;
  }
  if (typeof size === "number" && size >= 9 && size <= 32 && size !== currentSize) {
    currentSize = Math.round(size);
    changed = true;
  }
  if (!changed) return;
  maybeLazyLoadWebfont(currentFamily);
  notifyFontListeners();
}

export function onTerminalFontChange(fn) {
  if (typeof fn === "function") listeners.push(fn);
}

// Publish only acknowledged values, shared by settings and the terminal toolbar.
export async function saveTerminalFont(family, size) {
  var response = await fetch('/api/user/terminal-font', {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({family: family, size: size})
  });
  if (!response.ok) throw new Error('Could not save terminal typography. Try again.');
  applyTerminalFont(family, size);
}
