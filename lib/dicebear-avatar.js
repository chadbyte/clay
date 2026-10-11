var STYLE_PACKAGES = {
  thumbs: "@dicebear/thumbs",
  bottts: "@dicebear/bottts",
  "pixel-art": "@dicebear/pixel-art",
  adventurer: "@dicebear/adventurer",
  micah: "@dicebear/micah",
  "fun-emoji": "@dicebear/fun-emoji",
  icons: "@dicebear/icons",
};

var corePromise = null;
var stylePromises = Object.create(null);
var avatarCache = new Map();

function normalizeRequest(style, seed, size) {
  if (!Object.prototype.hasOwnProperty.call(STYLE_PACKAGES, style)) {
    throw new Error("Unknown avatar style");
  }
  var normalizedSeed = typeof seed === "string" ? seed.substring(0, 80) : "";
  if (!normalizedSeed) normalizedSeed = "anonymous";
  var normalizedSize = Number(size);
  if (!Number.isInteger(normalizedSize) || normalizedSize < 16 || normalizedSize > 256) normalizedSize = 64;
  return { style: style, seed: normalizedSeed, size: normalizedSize };
}

function loadCore() {
  if (!corePromise) corePromise = import("@dicebear/core");
  return corePromise;
}

function loadStyle(style) {
  if (!stylePromises[style]) stylePromises[style] = import(STYLE_PACKAGES[style]);
  return stylePromises[style];
}

function renderAvatar(style, seed, size) {
  var request = normalizeRequest(style, seed, size);
  var cacheKey = [request.style, request.seed, request.size].join("|");
  if (avatarCache.has(cacheKey)) return Promise.resolve(avatarCache.get(cacheKey));
  return Promise.all([loadCore(), loadStyle(request.style)]).then(function (modules) {
    var createAvatar = modules[0].createAvatar;
    var styleDefinition = modules[1];
    var svg = createAvatar(styleDefinition, {
      seed: [request.seed],
      size: request.size,
    }).toString();
    if (avatarCache.size >= 512) avatarCache.delete(avatarCache.keys().next().value);
    avatarCache.set(cacheKey, svg);
    return svg;
  });
}

function isSupportedStyle(style) {
  return Object.prototype.hasOwnProperty.call(STYLE_PACKAGES, style);
}

module.exports = {
  isSupportedStyle: isSupportedStyle,
  normalizeRequest: normalizeRequest,
  renderAvatar: renderAvatar,
  styles: Object.keys(STYLE_PACKAGES),
};
