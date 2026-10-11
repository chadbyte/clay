var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var root = path.join(__dirname, "..");
var indexSource = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var appSource = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
var dockSource = fs.readFileSync(path.join(root, "lib/public/modules/home-dock.js"), "utf8");
var resizeSource = fs.readFileSync(path.join(root, "lib/public/modules/home-dock-resize.js"), "utf8");
var sidebarSource = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
var librarySource = fs.readFileSync(path.join(root, "lib/public/modules/home-capsule-library.js"), "utf8");
var creationIntentSource = fs.readFileSync(path.join(root, "lib/public/modules/home-capsule-creation-intent.js"), "utf8");
var toolsSource = fs.readFileSync(path.join(root, "lib/public/modules/home-tools.js"), "utf8");
var chatSource = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
var cssSource = fs.readFileSync(path.join(root, "lib/public/css/home-capsule-library.css"), "utf8");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="sidebar-column"'));

test("Home board is absent while the reusable Capsule host remains inert", function () {
  assert.doesNotMatch(indexSource, /id="home-hub"|id="home-tools-btn"|id="home-sidebar-capsules"/);
  assert.match(indexSource, /<template id="retained-capsule-host-template">[\s\S]*id="home-tool-workbench"/);
  assert.match(indexSource, /id="home-dock-switcher"[\s\S]*id="home-dock-content"/);
  assert.doesNotMatch(appSource, /initHomeDock\(/);
  assert.match(appSource, /function showHomeHub\(fromHistory\) \{ showProjectsHub\(fromHistory\); \}/);
  assert.match(dockSource, /export function openHomeCapsules\(\)/);
});

test("Capsules resumes the last installed Capsule or opens Library without a fake persisted tool", function () {
  assert.match(dockSource, /export function openHomeCapsules\(\)/);
  assert.match(dockSource, /lastActiveId && toolsById\[lastActiveId\][\s\S]*openHomeDock\(lastActiveId\)/);
  assert.match(dockSource, /openHomeCapsuleLibrary\(\)/);
  assert.match(dockSource, /dockActiveToolId: null,[\s\S]*dockLibraryOpen: true/);
  assert.match(dockSource, /activeToolId: store\.get\('dockActiveToolId'\) \|\| null/);
  assert.doesNotMatch(dockSource, /activeToolId: ["']library["']/);
  assert.match(appSource, /dockActiveToolId: null/);
  assert.match(dockSource, /store\.get\('dockActiveToolId'\) === toolId[\s\S]*dockActiveToolId: null,[\s\S]*persistDock\(\)/);
});

test("complete registry sync clears a stale persisted Capsule and opens Library when needed", function () {
  assert.match(appSource, /homeToolRegistryLoaded: false/);
  assert.match(toolsSource, /var completeSync = !msg\.requestedToolId/);
  assert.match(toolsSource, /if \(completeSync\) \{[\s\S]*previousIds/);
  assert.match(toolsSource, /if \(completeSync\) store\.set\(\{ homeToolRegistryLoaded: true \}\)/);
  assert.match(toolsSource, /if \(completeSync && reconcileDockActiveTool\(\)\) return;/);
  assert.match(dockSource, /export function reconcileDockActiveTool\(\)/);
  assert.match(dockSource, /if \(!activeToolId \|\| toolsById\[activeToolId\]\) return false/);
  assert.match(dockSource, /dockActiveToolId: null,[\s\S]*dockLibraryOpen: store\.get\('dockOpen'\) === true/);
  assert.match(dockSource, /renderDock\(\);[\s\S]*persistDock\(\);[\s\S]*return true/);
});

test("valid saved Capsule IDs and incremental tool responses bypass reconciliation", function () {
  assert.match(dockSource, /toolsById\[activeToolId\]\) return false/);
  assert.match(toolsSource, /var completeSync = !msg\.requestedToolId/);
  assert.doesNotMatch(toolsSource, /if \(msg\.requestedToolId && reconcileDockActiveTool/);
  assert.match(toolsSource, /if \(completeSync && reconcileDockActiveTool\(\)\) return;[\s\S]*renderDock\(\)/);
});

test("dock preference arriving after registry load reconciles its saved Capsule", function () {
  assert.match(dockSource, /export function handleHomeDockState\(msg\)[\s\S]*dockActiveToolId: saved\.activeToolId \|\| null/);
  assert.match(dockSource, /syncDockState\(\);[\s\S]*store\.get\('homeToolRegistryLoaded'\) && reconcileDockActiveTool\(\)/);
  assert.match(dockSource, /reconcileDockActiveTool\(\)\) return;[\s\S]*renderDock\(\)/);
});

test("dock preference does not reconcile against an incomplete registry", function () {
  assert.match(appSource, /homeToolRegistryLoaded: false/);
  assert.match(toolsSource, /export function requestTools\(\)[\s\S]*store\.set\(\{ homeToolRegistryLoaded: false \}\)[\s\S]*type: "tools_list"/);
  assert.match(dockSource, /if \(store\.get\('homeToolRegistryLoaded'\) && reconcileDockActiveTool\(\)\) return;/);
  assert.doesNotMatch(dockSource, /if \(!store\.get\('homeToolRegistryLoaded'\)\) reconcileDockActiveTool/);
  assert.match(toolsSource, /if \(completeSync\) store\.set\(\{ homeToolRegistryLoaded: true \}\)/);
});

test("Capsule Library is a native host surface over shared installed-tool state", function () {
  assert.match(dockSource, /renderHomeCapsuleLibrary\(contentEl, store\.get\('installedTools'\) \|\| \[\], openLibraryCapsule\)/);
  assert.match(toolsSource, /store\.set\(\{ installedTools: tools \}\)/);
  assert.match(librarySource, /definition\.manifest/);
  assert.match(librarySource, /document\.createElement\("ul"\)/);
  assert.match(librarySource, /row\.addEventListener\("click", function \(\) \{ openCapsule\(manifest\.id\); \}\)/);
  assert.doesNotMatch(librarySource, /tool_install|tool_remove|uninstall|localStorage|alert\(|confirm\(|prompt\(/);
});

test("Capsule Home is the permanent leftmost Workbench tab", function () {
  assert.match(dockSource, /appendCapsuleHomeTab\(switcherEl, libraryOpen && !backstageOpen\);[\s\S]*for \(var i = 0; i < tools\.length; i\+\+\)/);
  assert.match(dockSource, /tab\.dataset\.dockHome = "true"/);
  assert.match(dockSource, /tab\.setAttribute\("aria-label", "Capsule Home"\)/);
  assert.match(dockSource, /renderToolIdentity\(\{ name: "Home", lucideIcon: "house" \}\)/);
  assert.match(dockSource, /tab\.addEventListener\("click", openHomeCapsuleLibrary\)/);
  assert.match(librarySource, /title\.textContent = "Capsule Home"/);
  assert.doesNotMatch(dockSource, /tools\.unshift|registerDockTool\([^)]*home/i);
});

test("Capsule Library starts with a Mate conversation composer in empty and populated states", function () {
  assert.match(librarySource, /definitionTitle\.textContent = "What is a Capsule\?"/);
  assert.match(librarySource, /A Capsule is a small, persistent app that a Mate creates with you/);
  assert.match(librarySource, /keeps its interface and data beyond the conversation/);
  assert.match(librarySource, /label\.textContent = "Create with Mate"/);
  assert.match(librarySource, /Your current Mate will open a new conversation and shape it with you/);
  assert.match(librarySource, /input\.placeholder = "Describe the interface you need"/);
  assert.match(librarySource, /root\.appendChild\(createComposer\(\)\)[\s\S]*if \(!capsules\.length\) \{ container\.appendChild\(root\); return; \}/);
  assert.match(librarySource, /inventoryTitle\.textContent = "Installed Capsules"/);
  assert.doesNotMatch(librarySource, /No Capsules are installed|example prompt|localStorage/);
  assert.match(librarySource, /event\.isComposing/);
  assert.match(cssSource, /\.home-capsule-library-definition[\s\S]*\.home-capsule-library-create-guidance[\s\S]*\.home-capsule-library-inventory/);
});

test("Capsule creation targets only the currently open visible Mate", function () {
  assert.match(creationIntentSource, /findHomeMate\(visible, currentMateId\)/);
  assert.match(creationIntentSource, /homeSurfaceLoaded/);
  assert.match(creationIntentSource, /homeChatMateId/);
  assert.match(creationIntentSource, /HOME_CAPSULE_CREATION_EVENT/);
  assert.doesNotMatch(creationIntentSource, /homePreferredMateId|resolveHomeMate|builtinKey === "clay"|keyword|locale|localStorage/);
});

test("Capsule creation never falls back from the currently open Mate", async function () {
  var module = await import(pathToFileURL(path.join(root, "lib/public/modules/home-capsule-creation-intent.js")).href);
  var mates = [
    { id: "mate-current", archived: false },
    { id: "mate-preferred", archived: false, builtinKey: "clay" },
  ];
  assert.equal(module.resolveCapsuleCreationMate(mates, "mate-current"), mates[0]);
  assert.equal(module.resolveCapsuleCreationMate(mates, "mate-missing"), null);
  mates[0].archived = true;
  assert.equal(module.resolveCapsuleCreationMate(mates, "mate-current"), null);
});

test("Capsule creation hands off through an exact fresh Home conversation", function () {
  var capsuleStart = chatSource.slice(chatSource.indexOf("export function startHomeCapsuleCreation"), chatSource.indexOf("function bindComposer"));
  assert.match(capsuleStart, /export function startHomeCapsuleCreation\(mateId, description\)/);
  assert.match(capsuleStart, /mateId !== store\.get\('homeChatMateId'\)/);
  assert.match(capsuleStart, /type: "home_mate_new_session"[\s\S]*mateId: mateId[\s\S]*type: "capsule_creation", description: description/);
  assert.match(capsuleStart, /rememberHomeMate\(mateId\)/);
  assert.doesNotMatch(capsuleStart, /store\.set\(\{ homeChatMateId: mateId \}\)/);
  assert.doesNotMatch(creationIntentSource + chatSource, /tool_install|tool_update|clay_tool_install|clay_tool_update/);
});

test("Library selection opens the real registered Capsule and keeps dock tabs", function () {
  assert.match(dockSource, /function openLibraryCapsule\(toolId\)[\s\S]*activateTool\(toolId\)[\s\S]*focusActiveCapsuleTab\(\)/);
  assert.match(dockSource, /for \(var i = 0; i < tools\.length; i\+\+\)[\s\S]*dataset\.dockToolId = tool\.id/);
  assert.match(dockSource, /tab\.addEventListener\("click", function \(\) \{ activateTool\(tool\.id\); \}\)/);
  assert.match(dockSource, /dockLibraryOpen: false/);
});

test("retained Capsule activity state stays reusable without a visible Home trigger", function () {
  assert.doesNotMatch(indexSource, /id="home-tools-activity"|id="home-tools-label"/);
  assert.match(dockSource, /dockHasActivity: true, dockActivityToolId: toolId \|\| null/);
  assert.match(dockSource, /dockHasActivity: false/);
  assert.doesNotMatch(appSource, /initHomeDock\(/);
});

test("Stage 7 preserves Workbench controls, runtime, and durable dock preference", function () {
  assert.match(dockSource, /initHomeDockResize\(\)/);
  assert.match(dockSource, /home-dock-collapse/);
  assert.match(dockSource, /home-dock-focus/);
  assert.match(dockSource, /home-dock-return/);
  assert.match(resizeSource, /home_dock_set|clay:home-dock-width-commit/);
  assert.match(toolsSource, /createToolRuntime/);
  assert.match(toolsSource, /handleToolStorageResult/);
  assert.match(dockSource, /dockOpen: store\.get\('dockOpen'\) === true,[\s\S]*dockWidth: store\.get\('dockWidth'\),[\s\S]*activeToolId:/);
});

test("Capsule Library is responsive and moves focus into visible Workbench content", function () {
  assert.match(librarySource, /aria-labelledby", "home-capsule-library-title"/);
  assert.match(librarySource, /title\.tabIndex = -1/);
  assert.match(librarySource, /row\.setAttribute\("aria-label", "Open " \+ \(manifest\.name \|\| manifest\.id\) \+ " Capsule"\)/);
  assert.match(dockSource, /home-capsule-library-title[\s\S]*title\.focus\(\)/);
  assert.match(dockSource, /home-dock-switcher \.home-dock-tool\.active[\s\S]*activeTab\.focus\(\)/);
  assert.match(cssSource, /@media \(max-width: 768px\)/);
  assert.match(dockSource, /export function toggleHomeCapsules\(\)[\s\S]*if \(store\.get\('dockOpen'\)\) closeHomeDock\(\);[\s\S]*else openHomeCapsules\(\)/);
  assert.match(sidebarSource, /closeNarrowDrawer\(!opening\)/);
});
