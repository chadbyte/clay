// Local pixel identities: deterministic SVG avatars derived from a stable seed.

var PAPER = "#f1efe8";
var INK = "#1b1b1a";
var MUTED_INDIGO = "#72778f";
var IDENTICON_PALETTE = ["#333330", MUTED_INDIGO, "#6f8382", "#887b91", "#8a806a"];
var MATE_MARK_PALETTE = [
  { background: "#6f7489", foreground: PAPER },
  { background: "#78816c", foreground: PAPER },
  { background: "#92756d", foreground: PAPER },
  { background: "#6f8382", foreground: PAPER },
  { background: "#887b91", foreground: PAPER },
  { background: "#8a806a", foreground: PAPER },
];

function hashString(value) {
  var text = String(value || "anonymous");
  var hash = 2166136261;
  for (var index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function xmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function legacyIdentity(style, seed) {
  var sourceStyle = String(style || "imprint").toLowerCase();
  var sourceSeed = String(seed || "anonymous");
  if (sourceStyle === "imprint") return sourceSeed;
  return "legacy:" + sourceStyle + ":" + sourceSeed;
}

export function imprintSvg(options) {
  var settings = options || {};
  var size = Math.max(12, Math.min(256, Number(settings.size) || 64));
  var identity = legacyIdentity(settings.style, settings.seed);
  var hash = hashString(identity);
  var cells = identiconCells(hash);
  var foreground = IDENTICON_PALETTE[hash % IDENTICON_PALETTE.length];
  var pixels = "";
  for (var i = 0; i < cells.length; i++) {
    pixels += '<rect x="' + (cells[i][0] + 1) + '" y="' + (cells[i][1] + 1) + '" width="1" height="1"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 7 7" shape-rendering="crispEdges"><rect width="7" height="7" fill="' + PAPER +
    '"/><g fill="' + foreground + '">' + pixels + '</g><rect x="0.5" y="0.5" width="6" height="6" fill="none" stroke="' +
    INK + '" stroke-opacity="0.14" stroke-width="0.08"/></svg>';
}

// Generate the left three columns and mirror them into a compact 5x5 grid.
export function identiconCells(hash) {
  var value = hash >>> 0;
  var cells = [];
  for (var row = 0; row < 5; row++) {
    for (var column = 0; column < 3; column++) {
      value = Math.imul(value ^ (value >>> 13), 16777619) >>> 0;
      if ((value & 1) || (row === 2 && column === 1)) {
        cells.push([column, row]);
        if (column < 2) cells.push([4 - column, row]);
      }
    }
  }
  return cells;
}

export function imprintDataUrl(options) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(imprintSvg(options));
}

export function mateMarkSvg(options) {
  var settings = options || {};
  var size = Math.max(12, Math.min(256, Number(settings.size) || 64));
  var identity = String(settings.seed || "M").trim();
  var initial = Array.from(identity || "M")[0].toUpperCase();
  var palette = MATE_MARK_PALETTE[initial.codePointAt(0) % MATE_MARK_PALETTE.length];
  var clipId = "mate-mark";

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 96 96"><defs><clipPath id="' + clipId +
    '"><rect width="96" height="96" rx="24"/></clipPath></defs><g clip-path="url(#' + clipId +
    ')"><rect width="96" height="96" fill="' + palette.background + '"/><text x="48" y="50" fill="' + palette.foreground +
    '" font-family="Arial, Helvetica, sans-serif" font-size="43" font-weight="600" text-anchor="middle" dominant-baseline="middle">' +
    xmlText(initial) + '</text></g><rect x="0.5" y="0.5" width="95" height="95" rx="23.5" fill="none" stroke="#000000" stroke-opacity="0.18"/></svg>';
}

export function mateMarkDataUrl(options) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(mateMarkSvg(options));
}
