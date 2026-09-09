var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var root = path.join(__dirname, "..");

test("Home boot precedence keeps explicit projects authoritative and legacy root safe", async function () {
  var boot = await import(pathToFileURL(path.join(root, "lib/public/modules/home-surface-boot.js")).href);
  assert.equal(boot.resolveHomeBootDestination({ surfaceLoaded: false }), "wait");
  assert.equal(boot.resolveHomeBootDestination({ surfaceLoaded: true, dockLoaded: true, surface: "home", currentSlug: "alpha", pathname: "/p/alpha/" }), "project");
  assert.equal(boot.resolveHomeBootDestination({ surfaceLoaded: true, dockLoaded: true, surface: "home", currentSlug: "alpha", pathname: "/", paneMode: true }), "project");
  assert.equal(boot.resolveHomeBootDestination({ surfaceLoaded: true, dockLoaded: true, surface: "project", currentSlug: "alpha", pathname: "/" }), "project");
  assert.equal(boot.resolveHomeBootDestination({ surfaceLoaded: true, dockLoaded: false, surface: "home", currentSlug: "alpha", pathname: "/" }), "wait");
  assert.equal(boot.resolveHomeBootDestination({ surfaceLoaded: true, dockLoaded: true, surface: "home", currentSlug: "alpha", pathname: "/" }), "home");
  assert.equal(boot.resolveHomeBootDestination({ surfaceLoaded: true, dockLoaded: true, surface: null, currentSlug: "alpha", pathname: "/" }), "home");
});

test("hard-refresh Home boot waits for durable state then restores once without clobbering it", async function () {
  var originals = { document: global.document, location: global.location, history: global.history };
  var bodyClasses = new Set();
  var overlayClasses = new Set(["hidden"]);
  var overlayMessage = { textContent: "Connecting…" };
  global.document = {
    body: { classList: { add: function (name) { bodyClasses.add(name); }, remove: function (name) { bodyClasses.delete(name); } } },
    getElementById: function (id) {
      if (id === "connect-overlay") return { classList: { add: function (name) { overlayClasses.add(name); } } };
      if (id === "connect-overlay-msg") return overlayMessage;
      return null;
    },
  };
  global.location = { pathname: "/" };
  var routes = [];
  global.history = { replaceState: function (state, title, route) { routes.push(route); } };
  try {
    var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
    var surface = await import(pathToFileURL(path.join(root, "lib/public/modules/home-surface.js")).href);
    var boot = await import(pathToFileURL(path.join(root, "lib/public/modules/home-surface-boot.js")).href);
    storeModule.createStore({
      connected: true,
      paneMode: false,
      currentSlug: "alpha",
      homeSurfaceLoaded: false,
      homeDockPreferenceLoaded: false,
      homePrimarySurface: null,
      homeSurfaceProjectSlug: null,
      homeSurfaceIntent: null,
      homeChatMateId: null,
      homePreferredMateId: null,
      homeActiveSessionByMate: {},
      homeSidebarCollapsed: false,
      homeChatScope: "all",
      dockOpen: true,
      dockFocus: true,
      dockActiveToolId: "translator",
      dockLibraryOpen: false,
    });
    boot.initHomeSurfaceBoot();
    assert.equal(bodyClasses.has("home-surface-boot-pending"), true);
    assert.equal(overlayMessage.textContent, "Restoring your workspace…");
    surface.handleHomeSurfaceState({ preference: {
      surface: "home",
      projectSlug: "alpha",
      activeMateId: "mate-a",
      activeSessionByMate: { "mate-a": "session-a" },
      sidebarCollapsed: true,
      chatScope: "current",
    } });
    assert.equal(storeModule.store.get('homeSurfaceRestoreRequested'), undefined);
    storeModule.store.set({ homeDockPreferenceLoaded: true });
    assert.equal(storeModule.store.get('homeSurfaceBootResolved'), true);
    assert.equal(storeModule.store.get('homeSurfaceRestoreRequested'), true);
    assert.equal(storeModule.store.get('homePreferredMateId'), "mate-a");
    assert.deepEqual(storeModule.store.get('homeActiveSessionByMate'), { "mate-a": "session-a" });
    assert.equal(storeModule.store.get('homeSidebarCollapsed'), true);
    assert.equal(storeModule.store.get('homeChatScope'), "current");
    assert.equal(storeModule.store.get('dockOpen'), true);
    assert.equal(storeModule.store.get('dockFocus'), true);
    assert.equal(storeModule.store.get('dockActiveToolId'), "translator");
    assert.equal(bodyClasses.has("home-surface-boot-pending"), false);
    assert.deepEqual(routes, []);
    surface.handleHomeSurfaceState({ preference: {
      surface: "home", projectSlug: "alpha", activeMateId: "mate-a",
      activeSessionByMate: { "mate-a": "session-a" }, sidebarCollapsed: true,
      chatScope: "current",
    } });
    assert.equal(storeModule.store.get('homeSurfaceBootResolved'), true);
    assert.equal(storeModule.store.get('homeSurfaceRestoreRequested'), true);
    assert.deepEqual(routes, []);
  } finally {
    global.document = originals.document;
    global.location = originals.location;
    global.history = originals.history;
  }
});

test("Home entry, Return, and initial restoration use the existing preference path", function () {
  var app = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
  var hub = fs.readFileSync(path.join(root, "lib/public/modules/app-home-hub.js"), "utf8");
  var surface = fs.readFileSync(path.join(root, "lib/public/modules/home-surface.js"), "utf8");
  var dock = fs.readFileSync(path.join(root, "lib/public/modules/home-dock.js"), "utf8");
  var server = fs.readFileSync(path.join(root, "lib/server.js"), "utf8");
  assert.match(hub, /export function showHomeHub\(fromHistory\)[\s\S]*rememberHomePrimarySurface\("home"\)/);
  assert.match(hub, /export function minimizeHomeHub\(\)[\s\S]*switchProject\(slug\)/);
  assert.match(fs.readFileSync(path.join(root, "lib/public/modules/app-projects.js"), "utf8"), /completePendingProjectActivation[\s\S]*rememberHomePrimarySurface\("project", slug\)/);
  assert.doesNotMatch(hub.slice(hub.indexOf("export function hideHomeHub"), hub.indexOf("export function minimizeHomeHub")), /rememberHomePrimarySurface/);
  assert.match(app, /rememberHomePrimarySurface\("project", newSlug\);[\s\S]*if \(isHomeHubVisible\(\)\) hideHomeHub\(\)/);
  assert.match(app, /initHomeHub\(\);[\s\S]*initHomeSidebar\(\);[\s\S]*initHomeSurfaceBoot\(\);[\s\S]*connect\(\);/);
  assert.doesNotMatch(app, /if \(!slugMatch\) \{\s*showHomeHub\(true\)/);
  assert.match(hub, /homeSurfaceRestoreRequested'\) !== true[\s\S]*requestTools\(\)[\s\S]*requestHomeDockPreference\(\)[\s\S]*requestHomeSurfacePreference\(\)/);
  assert.match(surface, /homeActiveSessionByMate: normalizeSessions\(preference\.activeSessionByMate\)/);
  assert.match(surface, /homeChatScope: normalizeChatScope\(preference\.chatScope\)/);
  assert.match(dock, /homeDockPreferenceLoaded: true[\s\S]*dockActiveToolId: saved\.activeToolId \|\| null[\s\S]*dockFocus: saved\.dockOpen === true && saved\.dockFocus === true/);
  assert.match(server, /getHomeSurfacePreference[\s\S]*preferredContextSlug[\s\S]*projects\.has\(preferredContextSlug\)[\s\S]*if \(!targetSlug && lastProject/);
});
