// Material Icon Theme file & folder icons
// Files:   material-file-icons via esm.sh (dynamic import, ~475KB lazy-loaded)
// Folders: material-icon-theme SVGs via jsdelivr CDN (fetched & cached)

var materialIcons = null;
var folderSvgCache = {};
var loadPromise = null;

var FOLDER_CDN = "https://cdn.jsdelivr.net/npm/material-icon-theme@5/icons/";

var FOLDER_MAP = {
  "src":            "folder-src",
  "lib":            "folder-lib",
  "dist":           "folder-dist",
  "build":          "folder-dist",
  "out":            "folder-dist",
  "output":         "folder-dist",
  "node_modules":   "folder-node",
  "test":           "folder-test",
  "tests":          "folder-test",
  "__tests__":      "folder-test",
  "spec":           "folder-test",
  "docs":           "folder-docs",
  "doc":            "folder-docs",
  "config":         "folder-config",
  ".config":        "folder-config",
  "public":         "folder-public",
  "static":         "folder-public",
  "assets":         "folder-images",
  "images":         "folder-images",
  "img":            "folder-images",
  "icons":          "folder-images",
  "media":          "folder-images",
  "components":     "folder-components",
  "hooks":          "folder-hook",
  "utils":          "folder-utils",
  "util":           "folder-utils",
  "helpers":        "folder-helper",
  "helper":         "folder-helper",
  "api":            "folder-api",
  "routes":         "folder-routes",
  "router":         "folder-routes",
  "pages":          "folder-layout",
  "views":          "folder-views",
  "styles":         "folder-css",
  "css":            "folder-css",
  "scss":           "folder-sass",
  "sass":           "folder-sass",
  "scripts":        "folder-scripts",
  "bin":            "folder-scripts",
  ".git":           "folder-git",
  ".github":        "folder-github",
  ".vscode":        "folder-vscode",
  "docker":         "folder-docker",
  ".docker":        "folder-docker",
  "database":       "folder-database",
  "db":             "folder-database",
  "server":         "folder-server",
  "client":         "folder-client",
  "types":          "folder-typescript",
  "typings":        "folder-typescript",
  "@types":         "folder-typescript",
  "modules":        "folder-node",
  "packages":       "folder-packages",
  "vendor":         "folder-lib",
  "env":            "folder-environment",
  ".env":           "folder-environment",
  "mock":           "folder-mock",
  "mocks":          "folder-mock",
  "__mocks__":      "folder-mock",
  "middleware":      "folder-middleware",
  "i18n":           "folder-i18n",
  "locale":         "folder-i18n",
  "locales":        "folder-i18n",
  "fonts":          "folder-font",
  "font":           "folder-font",
  "logs":           "folder-log",
  "log":            "folder-log",
  "tmp":            "folder-temp",
  "temp":           "folder-temp",
  "templates":      "folder-template",
  "template":       "folder-template",
  "ref":            "folder-resource",
  "resources":      "folder-resource",
  "res":            "folder-resource",
  "themes":         "folder-theme",
  "theme":          "folder-theme",
  "plugins":        "folder-plugin",
  "plugin":         "folder-plugin",
  "context":        "folder-context",
  "contexts":       "folder-context",
  "redux":          "folder-redux-store",
  "store":          "folder-redux-store",
  "stores":         "folder-redux-store",
  "controllers":    "folder-controller",
  "controller":     "folder-controller",
  "models":         "folder-database",
  "model":          "folder-database",
  "services":       "folder-server",
  "service":        "folder-server",
  ".claude":        "folder-config"
};

// --- Public API ---

export function initFileIcons() {
  if (loadPromise) return loadPromise;
  loadPromise = import("https://esm.sh/material-file-icons@2").then(function (mod) {
    materialIcons = mod;
  }).catch(function (err) {
    console.warn("[fileicons] Failed to load material-file-icons:", err);
  });
  // Pre-fetch default folder icons
  fetchFolderSvg("folder.svg");
  fetchFolderSvg("folder-open.svg");
  return loadPromise;
}

export function getFileIconSvg(filename) {
  if (!materialIcons) return "";
  try {
    var icon = materialIcons.getIcon(filename);
    return icon && icon.svg ? icon.svg : "";
  } catch (e) {
    return "";
  }
}

export function getFolderIconSvg(folderName, isOpen, callback) {
  var lower = folderName.toLowerCase();
  var base = FOLDER_MAP[lower] || "folder";
  var svgName = isOpen ? (base + "-open.svg") : (base + ".svg");

  // Cache hit
  if (folderSvgCache[svgName]) {
    callback(folderSvgCache[svgName]);
    return;
  }

  fetchFolderSvg(svgName).then(function (svg) {
    if (svg) {
      callback(svg);
    } else {
      // Fallback to default folder icon
      var fallback = isOpen ? "folder-open.svg" : "folder.svg";
      if (folderSvgCache[fallback]) {
        callback(folderSvgCache[fallback]);
      } else {
        fetchFolderSvg(fallback).then(function (fb) {
          callback(fb || "");
        });
      }
    }
  });
}

// --- Internal ---

function fetchFolderSvg(svgName) {
  if (folderSvgCache[svgName]) {
    return Promise.resolve(folderSvgCache[svgName]);
  }
  return fetch(FOLDER_CDN + svgName).then(function (res) {
    if (!res.ok) return null;
    return res.text();
  }).then(function (text) {
    if (text) folderSvgCache[svgName] = text;
    return text;
  }).catch(function () {
    return null;
  });
}
