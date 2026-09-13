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

test("Home exposes every visible Mate first-depth only in the sidebar", function () {
  var markup = source("lib/public/index.html");
  var hub = source("lib/public/modules/app-home-hub.js");
  var sidebarCss = source("lib/public/css/home-sidebar.css");
  var hubCss = source("lib/public/css/home-hub.css");
  assert.match(markup, /id="home-sidebar-mate-label"[^>]*type="button"[^>]*aria-expanded="true"[^>]*aria-controls="home-mate-list"[\s\S]*>Mates<\/span>[\s\S]*id="home-mate-list"[^>]*role="list"[^>]*aria-label="Mates"/);
  assert.doesNotMatch(markup, /home-mate-chat-switcher|data-home-mate-switcher/);
  assert.doesNotMatch(hubCss, /home-mate-inline-switcher/);
  assert.match(hub, /function getVisibleMates\(\)[\s\S]*!mate\.archived/);
  assert.match(hub, /for \(var i = 0; i < visibleMates\.length; i\+\+\)[\s\S]*createMateListRow\(visibleMates\[i\]/);
  assert.match(hub, /row\.type = "button"[\s\S]*home-mate-list-avatar[\s\S]*home-mate-list-name/);
  assert.match(sidebarCss, /\.home-mate-list \{[\s\S]*min-height: var\(--home-mate-list-height\);[\s\S]*max-height: var\(--home-mate-list-height\);[\s\S]*overflow-y: auto;/);
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

test("new conversation belongs to the selected Mate context", function () {
  var markup = source("lib/public/index.html");
  var hub = source("lib/public/modules/app-home-hub.js");
  var sidebar = source("lib/public/modules/home-sidebar.js");
  var chat = source("lib/public/modules/home-mate-chat.js");
  var mateListIndex = markup.indexOf('id="home-mate-list"');
  var newIndex = markup.indexOf('id="home-sidebar-new"');
  var conversationsIndex = markup.indexOf('id="home-sidebar-recent-label"');
  assert.ok(newIndex < mateListIndex && mateListIndex < conversationsIndex);
  assert.match(markup, /id="home-sidebar-new"[^>]*home-sidebar-new[^>]*title="New Chat"[^>]*aria-label="Start a new chat with the current Mate"[^>]*disabled/);
  assert.match(hub, /var newChat = document\.getElementById\("home-sidebar-new"\)/);
  assert.match(hub, /newChat\.disabled = !mate;[\s\S]*newChat\.setAttribute\("aria-label", mate \? "Start a new chat with " \+ name/);
  assert.match(sidebar, /home-sidebar-new"\)\.addEventListener\("click", startConversationFromSidebar\)/);
  assert.match(sidebar, /startNewHomeConversation\(\);[\s\S]*closeNarrowDrawer\(true\)/);
  assert.match(chat, /export function startNewHomeConversation\(\)[\s\S]*homeChatMateId[\s\S]*home_mate_new_session/);
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
