var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }
var indexSource = read("lib/public/index.html");
var hubSource = read("lib/public/modules/app-home-hub.js");
var chatSource = read("lib/public/modules/home-mate-chat.js");
var sidebarSource = read("lib/public/modules/home-sidebar.js");
var settingsSource = read("lib/public/modules/home-mate-settings.js");
var menuSource = read("lib/public/modules/home-mate-settings-menu.js");
var modelPickerSource = read("lib/public/modules/home-mate-model-picker.js");
var routerSource = read("lib/public/modules/app-message-router.js");
var managementSource = read("lib/public/modules/mate-management.js");
var messagesSource = read("lib/public/modules/app-messages.js");
var serverSource = read("lib/server-home-chat.js");
var settingsCss = read("lib/public/css/home-mate-settings.css");
var styleSource = read("lib/public/style.css");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="sidebar-column"'));

test("first-depth keeps New Chat and Debates while creation leads the Mate list", function () {
  assert.match(homeMarkup, /id="home-sidebar-new"[\s\S]*id="home-sidebar-debate"/);
  assert.doesNotMatch(homeMarkup, /id="home-sidebar-(?:model|memory|knowledge|settings)"/);
  assert.match(hubSource, /createHomeMateSettingsTrigger\(mate\)/);
  assert.match(hubSource, /item\.appendChild\(row\);[\s\S]*item\.appendChild\(createHomeMateSettingsTrigger\(mate\)\)/);
  assert.match(chatSource, /if \(kind !== "debate" && kind !== "mate"\) return false/);
  assert.match(hubSource, /createNewMateRow[\s\S]*openHomeMateAction\("mate"\)/);
  assert.doesNotMatch(sidebarSource, /openMateActionFromSidebar\("(?:model|memory|knowledge|settings)"\)/);
});

test("per-row overflow is separate, accessible, and never selects its target Mate", function () {
  assert.match(menuSource, /className = "home-mate-list-overflow"/);
  assert.match(menuSource, /home-mate-list-overflow-mark[\s\S]*aria-hidden="true">•••<\/span>/);
  assert.doesNotMatch(menuSource.slice(menuSource.indexOf("export function createHomeMateSettingsTrigger")), /iconHtml\("ellipsis"\)|data-lucide="ellipsis"/);
  assert.match(menuSource, /aria-haspopup", "menu"/);
  assert.match(menuSource, /aria-expanded", "false"/);
  assert.match(menuSource, /setAttribute\("role", "menu"\)/);
  assert.match(menuSource, /setAttribute\("role", "menuitem"\)/);
  assert.match(menuSource, /event\.stopPropagation\(\)/);
  assert.match(menuSource, /openHomeMateSettings\(mate\.id, opener\)/);
  assert.doesNotMatch(menuSource, /openHomeChat|rememberHomeMate|homePreferredMateId|dockActiveToolId/);
  assert.match(hubSource, /row\.addEventListener\("click", function \(\) \{ selectHomeMate\(mate\.id\); \}\)/);
});

test("row menu supports keyboard, outside close, focus return, and rerender cleanup", function () {
  assert.match(menuSource, /event\.key !== "ArrowDown" && event\.key !== "ArrowUp" && event\.key !== "Home" && event\.key !== "End"/);
  assert.match(menuSource, /event\.key === "Escape"[\s\S]*closeMenu\(true\)/);
  assert.match(menuSource, /document\.addEventListener\("pointerdown", handleMenuOutside, true\)/);
  assert.match(menuSource, /document\.removeEventListener\("pointerdown", handleMenuOutside, true\)/);
  assert.match(menuSource, /trigger && trigger\.isConnected[\s\S]*trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(hubSource, /disposeHomeMateSettingsMenu\(\);[\s\S]*list\.innerHTML = ""/);
  assert.match(hubSource, /focusedOverflow[\s\S]*findMateOverflow/);
});

test("Mate settings is a centered modal with General, Model, Memory, and Knowledge", function () {
  assert.match(settingsSource, /setAttribute\("role", "dialog"\)/);
  assert.match(settingsSource, /setAttribute\("aria-modal", "true"\)/);
  assert.match(settingsSource, /var sections = \["general", "model", "memory", "knowledge"\]/);
  assert.match(settingsSource, /event\.key !== "Tab"/);
  assert.match(settingsSource, /event\.shiftKey[\s\S]*last\.focus\(\)/);
  assert.match(settingsSource, /!event\.shiftKey[\s\S]*first\.focus\(\)/);
  assert.match(settingsSource, /event\.target === overlay\) closeHomeMateSettings\(\)/);
  assert.match(settingsSource, /Close Mate settings/);
  assert.match(settingsSource, /opener && opener\.isConnected[\s\S]*opener\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(settingsSource, /openHomeBackstage|registerDockTool|localStorage|alert\(|confirm\(|prompt\(/);
});

test("Memory and Knowledge remain owned read-only protocols with exact correlation", function () {
  assert.match(settingsSource, /type: "home_mate_memory_list", mateId: dialogMateId, requestId: memoryRequestId/);
  assert.match(settingsSource, /type: "home_mate_knowledge_list", mateId: dialogMateId, requestId: knowledgeRequestId/);
  assert.match(settingsSource, /msg\.mateId !== dialogMateId \|\| msg\.requestId !== memoryRequestId/);
  assert.match(settingsSource, /msg\.mateId !== dialogMateId \|\| msg\.requestId !== knowledgeRequestId/);
  assert.match(messagesSource, /from '\.\/home-mate-settings\.js'/);
  assert.match(messagesSource, /case "home_mate_memory_state":[\s\S]*handleHomeMateMemoryState\(msg\)/);
  assert.match(messagesSource, /case "home_mate_knowledge_state":[\s\S]*handleHomeMateKnowledgeState\(msg\)/);
  assert.match(serverSource, /msg\.type === "home_mate_memory_list"[\s\S]*requestId: msg\.requestId \|\| null/);
  assert.match(serverSource, /msg\.type === "home_mate_knowledge_list"[\s\S]*requestId: msg\.requestId \|\| null/);
  assert.match(serverSource, /findMateProject\(userId, msg\.mateId, true\)/);
  assert.doesNotMatch(settingsSource, /home_mate_(?:memory|knowledge)_(?:save|update|delete|create)/);
});

test("General reuses shared profile and custom removal flows with primary restrictions", function () {
  assert.match(settingsSource, /mate && mate\.primary[\s\S]*This primary Mate is managed by Clay/);
  assert.match(settingsSource, /editMateProfile\(edit, mate\)/);
  assert.match(settingsSource, /confirmMateRemoval\(remove, mate, closeHomeMateSettings\)/);
  assert.match(settingsSource, /mate\.builtinKey \? "Remove Mate" : "Delete Mate"/);
  assert.match(managementSource, /showMateProfilePopover\(anchorEl, mate/);
  assert.match(managementSource, /showConfirm\(/);
  assert.match(managementSource, /type: "mate_update"/);
  assert.match(managementSource, /type: "mate_delete"/);
});

test("Model shares the settings dialog without Workbench property plumbing", function () {
  assert.match(settingsSource, /renderHomeMateModelPicker\(body, renderDialogContent\)/);
  assert.match(settingsSource, /resetHomeMateModelPicker\(mateId, getMateName\(mate\), mate, options && options\.sessionId\)/);
  assert.match(settingsSource, /requestHomeMateModels/);
  assert.match(settingsSource, /clearHomeMateModelPicker\(\)/);
  assert.match(routerSource, /from '\.\/home-mate-settings\.js'/);
  assert.doesNotMatch(settingsSource + chatSource, /openHomeBackstage|closeHomeBackstage|openHomeMateProperty|home-mate-properties/);
  assert.match(modelPickerSource, /type: "home_mate_models_get"/);
  assert.match(modelPickerSource, /type: "home_mate_model_set"/);
});

test("responsive dialog masks the mobile drawer transiently without persisting Home state", function () {
  assert.match(settingsCss, /\.home-mate-list-overflow \{[\s\S]*color: var\(--text-secondary\);[\s\S]*opacity: 0;[\s\S]*transition: opacity 120ms ease-out/);
  assert.match(settingsCss, /\.home-mate-list-item:hover \.home-mate-list-overflow,[\s\S]*\.home-mate-list-item:focus-within \.home-mate-list-overflow,[\s\S]*\.home-mate-list-overflow:focus-visible,[\s\S]*\.home-mate-list-overflow\[aria-expanded="true"\] \{ opacity: 1; \}/);
  assert.doesNotMatch(settingsCss, /\.home-mate-list-item\.is-active \.home-mate-list-overflow/);
  assert.match(settingsCss, /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*\.home-mate-list-overflow \{ opacity: 0\.68; \}/);
  assert.match(settingsCss, /@media \(max-width: 768px\)[\s\S]*\.home-mate-list-overflow \{ opacity: 1; \}/);
  assert.match(settingsCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.home-mate-list-overflow \{ transition: none; \}/);
  assert.match(settingsCss, /\.home-mate-list-overflow-mark \{[\s\S]*font-size: 9px;[\s\S]*font-weight: 700/);
  assert.doesNotMatch(settingsCss, /\.home-mate-list-overflow \.lucide/);
  assert.match(settingsCss, /\.home-mate-settings-overlay[\s\S]*place-items: center/);
  assert.match(settingsCss, /\.home-mate-settings-dialog[\s\S]*width: min\(720px/);
  assert.match(settingsCss, /@media \(max-width: 768px\)[\s\S]*\.home-mate-settings-dialog[\s\S]*width: 100%;[\s\S]*height: 100%/);
  assert.match(settingsCss, /home-settings-drawer-masked \.home-sidebar/);
  assert.match(settingsSource, /setTransientDrawerMask\(true\)/);
  assert.match(settingsSource, /setTransientDrawerMask\(false\)/);
  assert.doesNotMatch(settingsSource, /updateHomeSurfacePreference|sidebarCollapsed|dockActiveToolId/);
  assert.match(styleSource, /@import url\("css\/home-mate-settings\.css"\)/);
});

test("Mate settings modules stay direct-import, safe, and under 500 lines", function () {
  var files = [
    "lib/public/modules/app-home-hub.js",
    "lib/public/modules/home-mate-chat.js",
    "lib/public/modules/home-mate-settings.js",
    "lib/public/modules/home-mate-settings-menu.js",
  ];
  for (var i = 0; i < files.length; i++) {
    var source = read(files[i]);
    assert.ok(source.split("\n").length < 500, files[i] + " must remain under 500 lines");
    assert.doesNotMatch(source, /\b(?:const|let)\b|=>|localStorage/);
    assert.doesNotMatch(source, /init[A-Z][A-Za-z]+\(ctx\)|var _ctx/);
  }
  assert.ok(settingsCss.split("\n").length < 500);
  assert.doesNotMatch(settingsCss, /Source Serif|Georgia|#[0-9a-f]{3,8}/i);
});
