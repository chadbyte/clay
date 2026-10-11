var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loadSelectionModule() {
  var moduleSource = source("lib/public/modules/home-mate-selection.js");
  return import("data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64"));
}

test("Home keeps a valid current or server-preferred Mate", async function () {
  var module = await loadSelectionModule();
  var mates = [
    { id: "clay-id", builtinKey: "clay" },
    { id: "saved-id", builtinKey: "arch" },
  ];
  assert.equal(module.resolveHomeMate(mates, "saved-id", "clay-id").id, "saved-id");
  assert.equal(module.resolveHomeMate(mates, "missing-id", "saved-id").id, "saved-id");
  var surface = source("lib/public/modules/home-surface.js");
  assert.match(surface, /homePreferredMateId = store\.get\('homePreferredMateId'\) \|\| preference\.activeMateId \|\| store\.get\('homeChatMateId'\)/);
});

test("Home falls back specifically to the Clay builtin", async function () {
  var module = await loadSelectionModule();
  var mates = [
    { id: "arch-id", builtinKey: "arch" },
    { id: "clay-id", builtinKey: "clay" },
  ];
  assert.equal(module.resolveHomeMate(mates, null, null).id, "clay-id");
  assert.equal(module.resolveHomeMate(mates, "missing-id", "also-missing").id, "clay-id");
  var hub = source("lib/public/modules/app-home-hub.js");
  assert.match(hub, /homeHubVisible && !store\.get\('homeSurfaceLoaded'\) && !activeMate[\s\S]*renderMateListLoading\(list\)[\s\S]*homeHubVisible && store\.get\('homeSurfaceLoaded'\) && !activeMate[\s\S]*resolveHomeMate\(visibleMates, activeMateId, store\.get\('homePreferredMateId'\)\)/);
});

test("project navigation exposes visible Mates without restoring the Home board", function () {
  var markup = source("lib/public/index.html");
  var navigation = source("lib/public/modules/project-mate-navigation.js");
  assert.doesNotMatch(markup, /id="home-hub"|id="home-mate-list"/);
  assert.match(navigation, /cachedMatesList/);
  assert.match(navigation, /!mate\.archived/);
  assert.match(navigation, /openMateWorkspace/);
});

test("first-depth Mate selection reuses Home chat preference and mobile close paths", function () {
  var hub = source("lib/public/modules/app-home-hub.js");
  var chat = source("lib/public/modules/home-mate-chat.js");
  var sidebar = source("lib/public/modules/home-sidebar.js");
  assert.match(hub, /function selectHomeMate\(mateId\)[\s\S]*mateId !== store\.get\('homeChatMateId'\)[\s\S]*openHomeChat\(mateId\)[\s\S]*closeHomeSidebarAfterSelection\(\)/);
  assert.match(chat, /export function openHomeChat\(mateId\)[\s\S]*homeActiveSessionByMate[\s\S]*rememberHomeMate\(mateId\)[\s\S]*resumeHomeChat\(\)/);
  assert.match(sidebar, /export function closeHomeSidebarAfterSelection\(\)[\s\S]*closeNarrowDrawer\(true\)/);
  assert.match(hub, /setAttribute\("aria-current", "true"\)/);
  assert.match(hub, /handleMateListKeydown[\s\S]*"ArrowDown"[\s\S]*"ArrowUp"[\s\S]*"Home"[\s\S]*"End"/);
});

test("new Mate conversations are created in the selected project context", function () {
  var navigation = source("lib/public/modules/project-mate-navigation.js");
  var sessionNavigation = source("lib/public/modules/project-session-navigation.js");
  assert.match(navigation, /openMateWorkspace/);
  assert.match(sessionNavigation, /switchProject\(projectSlug\)/);
  assert.match(sessionNavigation, /type: 'switch_session', id: pending\.sessionId/);
});

test("Home never instructs the user to choose a Mate", function () {
  var homeSource = source("lib/public/modules/app-home-hub.js")
    + source("lib/public/modules/home-mate-chat.js")
    + source("lib/public/modules/home-chat-empty-state.js")
    + source("lib/public/index.html");
  assert.doesNotMatch(homeSource, /Choose a mate to begin|Select someone to start|Select a mate/);
  assert.match(homeSource, /Getting Home ready/);
  assert.match(homeSource, /Loading your Mate and recent conversation/);
});

test("Mate introduction keeps server-controlled conversation privacy copy", function () {
  var markup = source("lib/public/index.html");
  assert.match(markup, /Clay keeps your conversation history on your server, under your control\./);
});
