var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var root = path.join(__dirname, "..");
var indexSource = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
var sidebarSource = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
var hubSource = fs.readFileSync(path.join(root, "lib/public/modules/app-home-hub.js"), "utf8");
var sheetSource = fs.readFileSync(path.join(root, "lib/public/modules/home-conversations-sheet.js"), "utf8");
var actionsSource = fs.readFileSync(path.join(root, "lib/public/modules/home-session-actions.js"), "utf8");
var chatListSource = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar-chat-list.js"), "utf8");
var chatSource = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
var surfaceSource = fs.readFileSync(path.join(root, "lib/public/modules/home-surface.js"), "utf8");
var serverChatSource = fs.readFileSync(path.join(root, "lib/server-home-chat.js"), "utf8");
var cssSource = fs.readFileSync(path.join(root, "lib/public/css/home-sidebar.css"), "utf8");
var actionsCss = fs.readFileSync(path.join(root, "lib/public/css/home-session-actions.css"), "utf8");
var wordmarkPath = path.join(root, "lib/public/clay-studio-wordmark.svg");
var fontPath = path.join(root, "lib/public/fonts/source-serif-4/SourceSerif4Caption-Semibold.ttf.woff2");
var fontLicenseSource = fs.readFileSync(path.join(root, "lib/public/fonts/source-serif-4/LICENSE.md"), "utf8");
var homeMarkup = indexSource.slice(indexSource.indexOf('<div id="home-hub"'), indexSource.indexOf('<div id="whats-new-article"'));

test("Home sidebar follows a continuous action, Mate, and conversation hierarchy", function () {
  assert.match(homeMarkup, /home-sidebar-brand[\s\S]*id="home-sidebar-all"[\s\S]*id="home-sidebar-collapse"[\s\S]*id="home-sidebar-new"[\s\S]*id="home-sidebar-debate"[\s\S]*id="home-tools-btn"[\s\S]*home-sidebar-mate-label[\s\S]*home-mate-list[\s\S]*home-sidebar-recent-label/);
  assert.doesNotMatch(homeMarkup, /home-sidebar-capsules/);
  assert.doesNotMatch(cssSource, /home-sidebar-activity/);
  assert.match(homeMarkup, /id="home-mate-list"[^>]*role="list"/);
  assert.doesNotMatch(homeMarkup, /id="home-sidebar-(?:model|memory|knowledge|settings)"|All conversations<\/span>/);
  assert.equal((homeMarkup.match(/id="home-sidebar-all"/g) || []).length, 1);
  assert.doesNotMatch(homeMarkup, /home-mate-chat-actions/);
});

test("Home actions and the first Mate-list creation row use consistent Lucide geometry", function () {
  assert.match(homeMarkup, /id="home-sidebar-new"[^>]*title="New Chat"[^>]*aria-label="Start a new chat with the current Mate"[\s\S]*home-sidebar-action-icon[^>]*aria-hidden="true"[\s\S]*data-lucide="message-square-plus"[\s\S]*>New Chat<\/span>/);
  assert.doesNotMatch(homeMarkup, /id="home-sidebar-new-mate"/);
  assert.match(hubSource, /function createNewMateRow\(disabled\)[\s\S]*row\.id = "home-sidebar-new-mate"[\s\S]*row\.setAttribute\("aria-label", "Create a new Mate with Clay"\)[\s\S]*iconHtml\("user-round-plus"\)[\s\S]*name\.textContent = "Create new Mate"/);
  assert.match(hubSource, /list\.innerHTML = "";[\s\S]*list\.appendChild\(createNewMateRow\(false\)\);[\s\S]*for \(var i = 0; i < visibleMates\.length; i\+\+\)/);
  assert.match(hubSource, /openHomeMateAction\("mate"\);[\s\S]*closeHomeSidebarAfterSelection\(\)/);
  assert.match(homeMarkup, /id="home-sidebar-debate"[^>]*title="Browse debates"[^>]*aria-label="Browse debates"[^>]*aria-pressed="false"[\s\S]*home-sidebar-action-icon[^>]*aria-hidden="true"[\s\S]*data-lucide="messages-square"[\s\S]*>Debates<\/span>/);
  assert.match(homeMarkup, /id="home-tools-btn"[^>]*title="Capsules"[^>]*aria-label="Capsules"[^>]*aria-expanded="false"[\s\S]*home-sidebar-action-icon[^>]*aria-hidden="true"[\s\S]*data-lucide="box"[\s\S]*id="home-tools-label">Capsules<\/span>/);
  assert.doesNotMatch(homeMarkup.slice(homeMarkup.indexOf('id="home-sidebar-new"'), homeMarkup.indexOf('id="home-sidebar-mate-label"')), /data-lucide="(?:square-pen|mic)"|New conversation|Start debate/);
  assert.match(cssSource, /\.home-sidebar-primary-actions \{[\s\S]*gap: 2px;[\s\S]*padding: 4px 4px 0;/);
  assert.match(cssSource, /\.home-sidebar-action \{[\s\S]*gap: 8px;[\s\S]*min-height: 34px;[\s\S]*padding: 5px 8px;[\s\S]*font-size: 12px;[\s\S]*font-weight: 530;[\s\S]*line-height: 1\.35;/);
  assert.match(cssSource, /\.home-sidebar-action-icon \{[\s\S]*width: 18px;[\s\S]*height: 18px;/);
  assert.match(cssSource, /\.home-sidebar-action-icon \.lucide \{[\s\S]*width: 15px;[\s\S]*height: 15px;[\s\S]*stroke-width: 1\.9;/);
  assert.doesNotMatch(cssSource, /\.home-sidebar-(?:new|debate)\s*\{/);
  assert.match(cssSource, /\.home-sidebar-action:focus-visible,[\s\S]*\.home-sidebar-recent-row:focus-visible[\s\S]*outline: 2px solid var\(--accent\)/);
  assert.match(sidebarSource, /renderSidebarState\(\);[\s\S]*refreshIcons\(\);/);
});

test("Home sidebar uses locally bundled Source Serif live text for Clay Studio", function () {
  assert.match(homeMarkup, /home-sidebar-brand[^>]*>[\s\S]*home-sidebar-brand-wordmark">Clay Studio<\/span>/);
  assert.match(homeMarkup, /id="home-sidebar-mate-label"[^>]*type="button"[^>]*aria-expanded="true"[^>]*aria-controls="home-mate-list"[\s\S]*>Mates<\/span>/);
  assert.match(homeMarkup, /id="home-mate-list"/);
  assert.match(homeMarkup, /id="home-sidebar-expand"[^>]*title="Show sidebar"[^>]*aria-label="Show Home sidebar"[^>]*aria-describedby="home-sidebar-expand-brand-label"[\s\S]*id="home-sidebar-expand-brand-label" class="home-sidebar-brand-wordmark home-sidebar-expand-wordmark">Clay Studio<\/span>/);
  assert.match(indexSource, /rel="preload" href="\/fonts\/source-serif-4\/SourceSerif4Caption-Semibold\.ttf\.woff2" as="font" type="font\/woff2" crossorigin/);
  assert.equal(fs.statSync(fontPath).size, 77024);
  assert.match(fontLicenseSource, /Copyright 2014 - 2023 Adobe/);
  assert.match(fontLicenseSource, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(cssSource, /\.home-sidebar-brand \{[\s\S]*color: var\(--text\);/);
  assert.match(cssSource, /@font-face \{[\s\S]*font-family: "Source Serif 4";[\s\S]*url\("\/fonts\/source-serif-4\/SourceSerif4Caption-Semibold\.ttf\.woff2"\) format\("woff2"\);[\s\S]*font-weight: 600;[\s\S]*font-display: swap;/);
  assert.match(cssSource, /\.home-sidebar-brand-wordmark \{[\s\S]*font-family: "Source Serif 4", Georgia, serif;[\s\S]*font-size: 17px;[\s\S]*font-weight: 600;[\s\S]*font-synthesis: none;/);
  assert.match(cssSource, /\.home-sidebar-expand-wordmark \{[\s\S]*flex: 0 0 auto;[\s\S]*font-size: 15px;/);
  assert.doesNotMatch(cssSource, /\.home-sidebar-brand-row \{[^}]*border-bottom:/);
  assert.doesNotMatch(cssSource, /\.home-sidebar-(?:mate-section|recents|new) \{[^}]*border-(?:top|bottom):/);
  assert.match(cssSource, /\.home-mate-list-row\.is-active \{[\s\S]*background: rgba\(var\(--overlay-rgb\), 0\.055\);[\s\S]*color: var\(--text\);/);
  assert.doesNotMatch(cssSource, /\.home-mate-list-row\.is-active \{[^}]*box-shadow/);
  assert.match(cssSource, /\.home-mate-list-row:focus-visible \{[\s\S]*outline: 2px solid var\(--accent\)/);
  assert.doesNotMatch(homeMarkup + cssSource, /clay-studio-wordmark\.svg|mask-image/);
  assert.doesNotMatch(cssSource, /url\([^)]*https?:/);
  assert.equal(fs.existsSync(wordmarkPath), true);
});

test("desktop Home sidebar boundary reaches the frame edges without mobile bleed", function () {
  assert.match(cssSource, /@media \(min-width: 769px\) \{[\s\S]*\.home-sidebar::after \{[\s\S]*top: -100vh;[\s\S]*right: -1px;[\s\S]*bottom: -100vh;[\s\S]*background: var\(--border-subtle\);/);
  assert.doesNotMatch(cssSource.slice(cssSource.indexOf("@media (max-width: 768px)")), /home-sidebar::after/);
  assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.home-sidebar \{[\s\S]*border: 1px solid var\(--border-subtle\);[\s\S]*border-radius: 12px;/);
});

test("Home sidebar presents a complete global Mate-attributed Chats archive", function () {
  assert.match(homeMarkup, /id="home-sidebar-recent-label"[^>]*>Chats<\/div>/);
  assert.match(homeMarkup, /class="home-chat-scope" role="group" aria-label="Chat scope"[\s\S]*data-home-chat-scope="current"[^>]*aria-pressed="false"[^>]*aria-controls="home-sidebar-recent-list">Current<[\s\S]*data-home-chat-scope="all"[^>]*aria-pressed="true"[^>]*aria-controls="home-sidebar-recent-list">All</);
  assert.match(chatListSource, /var chats = getHomeSessionConversations\(\)/);
  assert.doesNotMatch(sidebarSource + chatListSource, /slice\(0,\s*5\)|MAX_(?:RECENT|CHAT)|recentLimit/i);
  assert.match(actionsSource, /function mateNames\(\)[\s\S]*!mates\[i\] \|\| mates\[i\]\.archived/);
  assert.match(actionsSource, /mateName: names\[mateIds\[i\]\]/);
  assert.match(actionsSource, /result\.sort\(function \(a, b\) \{ return b\.lastActivity - a\.lastActivity; \}\)/);
  var serverListSource = serverChatSource.slice(serverChatSource.indexOf("function listHomeSessions"), serverChatSource.indexOf("function getLatestHomeSession"));
  assert.match(serverListSource, /sessionManager\.sessions\.forEach/);
  assert.match(serverListSource, /result\.sort\(function \(a, b\) \{ return b\.lastActivity - a\.lastActivity; \}\)/);
  assert.doesNotMatch(serverListSource, /\.slice\(|limit|MAX_/i);
  assert.match(chatListSource, /home-sidebar-recent-copy/);
  assert.match(chatListSource, /home-sidebar-recent-title/);
  assert.match(chatListSource, /home-sidebar-recent-mate/);
  assert.match(chatListSource, /className = "home-sidebar-recent-item"[\s\S]*chat\.mateId === store\.get\('homeChatMateId'\) && chat\.sessionId === store\.get\('homeChatSessionId'\)[\s\S]*row\.setAttribute\("aria-current", "page"\)/);
  assert.match(chatListSource, /createHomeSessionActionsTrigger\(chat\)/);
  assert.match(actionsCss, /\.home-sidebar-recent-item\.is-active[\s\S]*background: rgba\(var\(--overlay-rgb\), 0\.05\)/);
  assert.doesNotMatch(cssSource, /home-sidebar-recent-row\.is-active/);
  assert.match(chatListSource, /openConversation\(chat\.mateId, chat\.sessionId\)/);
  assert.match(sidebarSource, /openHomeConversation\(mateId, sessionId\)/);
  assert.match(chatSource, /export function openHomeConversation\(mateId, sessionId\)/);
  assert.match(chatSource, /homeChatSessionId: sessionId/);
  assert.match(cssSource, /\.home-sidebar-recents \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*margin: 16px 4px 0;[\s\S]*overflow: hidden;/);
  assert.match(cssSource, /\.home-sidebar-recent-list \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;[\s\S]*scrollbar-width: thin;/);
  assert.match(cssSource, /\.home-sidebar-mate-section \{[\s\S]*flex: 0 0 auto;[\s\S]*display: flex;[\s\S]*overflow: hidden;/);
  assert.doesNotMatch(cssSource, /\.home-sidebar-recents \{[^}]*border-top:/);
  assert.match(cssSource, /\.home-sidebar-recent-mate \{[\s\S]*color: var\(--text-dimmer\);[\s\S]*font-size: 9px/);
  assert.match(cssSource, /\.home-sidebar-recents-heading \{[\s\S]*display: flex;[\s\S]*justify-content: space-between;[\s\S]*gap: 8px;[\s\S]*min-height: 25px;/);
  assert.match(cssSource, /\.home-chat-scope \{[\s\S]*flex: 0 0 auto;[\s\S]*display: inline-flex;[\s\S]*border: 1px solid var\(--border-subtle\);/);
  assert.match(cssSource, /\.home-chat-scope-option\[aria-pressed="true"\] \{[\s\S]*background: var\(--bg-hover\);[\s\S]*color: var\(--text\);/);
  assert.match(cssSource, /\.home-chat-scope-option:focus-visible \{[\s\S]*outline: 2px solid var\(--accent\)/);
});

test("Mate browsing preserves five visible Mates beside its fixed creation row", function () {
  var heightContracts = Array.from(cssSource.matchAll(/--home-mate-list-height:\s*calc\(([\s\S]*?)\n\s*\);/g));
  assert.equal(heightContracts.length, 2);
  assert.equal((heightContracts[0][1].match(/var\(--home-mate-row-height\)/g) || []).length, 6);
  assert.equal((heightContracts[0][1].match(/var\(--home-mate-row-gap\)/g) || []).length, 5);
  assert.equal((heightContracts[0][1].match(/var\(--home-mate-list-edge\)/g) || []).length, 2);
  assert.equal((heightContracts[1][1].match(/var\(--home-mate-row-height\)/g) || []).length, 4);
  assert.match(cssSource, /--home-mate-row-height: 40px;[\s\S]*--home-mate-row-gap: 2px;[\s\S]*--home-mate-list-edge: 1px;/);
  assert.match(cssSource, /--home-mate-list-height: calc\([\s\S]*var\(--home-mate-row-height\)[\s\S]*var\(--home-mate-row-gap\)[\s\S]*var\(--home-mate-list-edge\)/);
  assert.match(cssSource, /\.home-mate-list \{[\s\S]*flex: 0 0 var\(--home-mate-list-height\);[\s\S]*gap: var\(--home-mate-row-gap\);[\s\S]*min-height: var\(--home-mate-list-height\);[\s\S]*max-height: var\(--home-mate-list-height\);[\s\S]*overflow-y: auto;/);
  assert.match(cssSource, /\.home-mate-list-row \{[\s\S]*min-height: var\(--home-mate-row-height\);/);
  assert.match(cssSource, /@media \(max-width: 768px\) and \(max-height: 520px\) \{[\s\S]*--home-mate-list-height: calc\([\s\S]*\.home-sidebar-mate-section \{ margin-top: 8px; \}[\s\S]*\.home-sidebar-recents \{ margin-top: 8px; \}/);
  assert.match(cssSource, /\.home-sidebar-recent-list \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;/);
});

test("Home requests user-filtered conversation lists for every visible Mate", function () {
  assert.match(sidebarSource, /for \(var i = 0; i < mates\.length; i\+\+\)/);
  assert.match(sidebarSource, /type: "home_mate_sessions_list", mateId: mates\[i\]\.id/);
  assert.match(sidebarSource, /state\.connected !== prev\.connected/);
});

test("Home sidebar renders every currently projected chat in global activity order", async function () {
  function FakeElement(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.textContent = "";
    var element = this;
    this.classList = { add: function (name) { element.className += (element.className ? " " : "") + name; } };
    Object.defineProperty(this, "innerHTML", { get: function () { return ""; }, set: function () { element.children = []; } });
  }
  FakeElement.prototype.appendChild = function (child) { this.children.push(child); child.parentNode = this; return child; };
  FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
  FakeElement.prototype.addEventListener = function (name, handler) { this.listeners[name] = handler; };
  FakeElement.prototype.click = function () { if (this.listeners.click) this.listeners.click({ preventDefault: function () {}, stopPropagation: function () {} }); };
  var originalDocument = global.document;
  var originalWindow = global.window;
  var list = new FakeElement("div");
  global.document = {
    createElement: function (tag) { return new FakeElement(tag); },
    getElementById: function (id) { return id === "home-sidebar-recent-list" ? list : null; },
    removeEventListener: function () {},
  };
  global.window = { removeEventListener: function () {} };
  try {
    var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
    var listModule = await import(pathToFileURL(path.join(root, "lib/public/modules/home-sidebar-chat-list.js")).href);
    storeModule.createStore({
      cachedMatesList: [{ id: "mate-a", name: "Clay" }, { id: "mate-b", name: "Analyst" }],
      homeChatMateId: "mate-b",
      homeChatSessionId: "b-60",
      homeMateSessions: {
        "mate-a": [
          { id: "a-10", title: "10", lastActivity: 10 },
          { id: "a-70", title: "70", lastActivity: 70 },
          { id: "a-30", title: "30", lastActivity: 30 },
          { id: "a-50", title: "50", lastActivity: 50 },
        ],
        "mate-b": [
          { id: "b-20", title: "20", lastActivity: 20 },
          { id: "b-60", title: "60", lastActivity: 60 },
          { id: "b-40", title: "40", lastActivity: 40 },
        ],
      },
      homeChatScope: "all",
    });
    var opened = [];
    assert.equal(listModule.renderHomeSidebarChats(function (mateId, sessionId) { opened.push([mateId, sessionId]); }), 7);
    assert.equal(list.children.length, 7);
    var titles = list.children.map(function (item) { return item.children[0].children[0].children[0].textContent; });
    assert.deepEqual(titles, ["70", "60", "50", "40", "30", "20", "10"]);
    assert.equal(list.children[1].children[0].attributes["aria-current"], "page");
    assert.equal(list.children[1].children[0].attributes["aria-label"], "60, with Analyst");
    list.children[6].children[0].click();
    assert.deepEqual(opened, [["mate-a", "a-10"]]);

    storeModule.store.set({ homeChatScope: "current" });
    assert.equal(listModule.renderHomeSidebarChats(function () {}), 3);
    assert.deepEqual(list.children.map(function (item) { return item.children[0].children[0].children[0].textContent; }), ["60", "40", "20"]);
    assert.equal(list.children[0].children[0].attributes["aria-current"], "page");

    storeModule.store.set({ homeChatMateId: "mate-a", homeChatSessionId: "a-50" });
    assert.equal(listModule.renderHomeSidebarChats(function () {}), 4);
    assert.deepEqual(list.children.map(function (item) { return item.children[0].children[0].children[0].textContent; }), ["70", "50", "30", "10"]);
    assert.equal(list.children[1].children[0].attributes["aria-current"], "page");

    storeModule.store.set({ homeChatMateId: "mate-empty", homeChatSessionId: "b-60" });
    assert.equal(listModule.renderHomeSidebarChats(function () {}), 0);
    assert.equal(list.children[0].textContent, "No chats with this Mate yet.");
  } finally {
    global.document = originalDocument;
    global.window = originalWindow;
  }
});

test("All chats is a searchable custom sheet", function () {
  assert.match(homeMarkup, /home-sidebar-brand-actions[\s\S]*id="home-sidebar-all"[^>]*title="Search chats"[^>]*aria-label="Search chats"[\s\S]*id="home-sidebar-collapse"/);
  assert.match(sidebarSource, /home-sidebar-all"\)\.addEventListener\("click", openAllConversations\)/);
  assert.match(sidebarSource, /openHomeConversationsSheet\(openConversationFromSidebar, event\.currentTarget\)/);
  assert.match(sheetSource, /role", "dialog"/);
  assert.match(sheetSource, /searchInput\.type = "search"/);
  assert.match(sheetSource, /conversation\.title\.toLowerCase/);
  assert.match(sheetSource, /onSelect\(conversation\.mateId, conversation\.sessionId\)/);
  assert.match(sheetSource, /createHomeSessionActionsTrigger\(conversation,[\s\S]*detailsOpener: detailsReturn,[\s\S]*beforeOpenDetails: function \(\) \{ closeSheet\(false\); \}/);
  assert.match(sheetSource, /className = "home-conversations-sheet-item"/);
  assert.match(sheetSource, /title\.textContent = "All chats"/);
  assert.match(sheetSource, /searchInput\.placeholder = "Search chats"/);
  assert.match(sheetSource, /buildSessionHierarchy\(getHomeSessionConversations\(\)\)/);
  assert.match(sheetSource, /conversationMatches\(root\.workers\[i\], query\)/);
  assert.doesNotMatch(sheetSource, /homeChatScope|data-home-chat-scope/);
  assert.doesNotMatch(sheetSource, /All conversations|Search conversations|No conversations/);
  assert.doesNotMatch(sheetSource, /alert\(|confirm\(|prompt\(/);
});

test("All chats traps focus and restores its opener on every close path", function () {
  assert.match(sheetSource, /sheetOpener = opener \|\| document\.activeElement/);
  assert.match(sheetSource, /document\.removeEventListener\("keydown", handleKeydown, true\)/);
  assert.match(sheetSource, /event\.key !== "Tab"/);
  assert.match(sheetSource, /event\.shiftKey[\s\S]*last\.focus\(\)/);
  assert.match(sheetSource, /!event\.shiftKey[\s\S]*first\.focus\(\)/);
  assert.match(sheetSource, /restoreFocus !== false[\s\S]*opener\.focus\(\)/);
  assert.match(sheetSource, /backdrop\.addEventListener\("click", closeSheet\)/);
  assert.match(sheetSource, /close\.addEventListener\("click", closeSheet\)/);
  assert.match(sheetSource, /event\.key === "Escape"[\s\S]*closeSheet\(\)/);
  assert.match(sheetSource, /var onSelect = selectConversation;[\s\S]*closeSheet\(\);[\s\S]*onSelect/);
});

test("complete sidebar collapse persists without an icon rail", function () {
  assert.match(sidebarSource, /updateHomeSurfacePreference\(\{ sidebarCollapsed: collapsed \}\)/);
  assert.match(surfaceSource, /sidebarCollapsed/);
  assert.match(cssSource, /flex: 0 0 240px/);
  assert.match(cssSource, /flex-basis: 232px/);
  assert.match(cssSource, /#home-hub\.home-sidebar-collapsed \.home-sidebar \{ display: none; \}/);
  assert.match(cssSource, /#home-hub\.home-sidebar-collapsed \.home-sidebar-expand \{ display: inline-flex; \}/);
  assert.doesNotMatch(homeMarkup, /home-sidebar-icon-rail/);
});

test("Chats scope uses the existing durable Home preference and rerenders on Mate changes", function () {
  assert.match(sidebarSource, /function setChatScope\(event\)[\s\S]*dataset\.homeChatScope[\s\S]*updateHomeSurfacePreference\(\{ chatScope: scope \}\)/);
  assert.match(sidebarSource, /querySelectorAll\("\[data-home-chat-scope\]"\)[\s\S]*addEventListener\("click", setChatScope\)/);
  assert.match(sidebarSource, /state\.homeChatMateId !== prev\.homeChatMateId[\s\S]*state\.homeChatScope !== prev\.homeChatScope[\s\S]*renderSidebarState\(\)/);
  assert.match(chatListSource, /scope === "current"[\s\S]*chat\.mateId === activeMateId/);
  assert.match(chatListSource, /scope === "current" \? "No chats with this Mate yet\." : "Chats will appear here\."/);
  assert.match(surfaceSource, /chatScope: normalizeChatScope\(state\.homeChatScope\)/);
  assert.match(surfaceSource, /outgoing\.chatScope = next\.chatScope/);
});

test("Mates section is an accessible durable collapse toggle", function () {
  assert.match(homeMarkup, /id="home-sidebar-mate-label"[^>]*type="button"[^>]*aria-expanded="true"[^>]*aria-controls="home-mate-list"/);
  assert.match(sidebarSource, /function toggleMates\(\)[\s\S]*updateHomeSurfacePreference\(\{ matesCollapsed:/);
  assert.match(sidebarSource, /home-sidebar-mate-label"\)\.addEventListener\("click", toggleMates\)/);
  assert.match(sidebarSource, /homeMatesCollapsed !== prev\.homeMatesCollapsed/);
  assert.match(surfaceSource, /matesCollapsed: state\.homeMatesCollapsed === true/);
  assert.match(surfaceSource, /homeMatesCollapsed: preference\.matesCollapsed === true/);
  assert.match(cssSource, /\.home-sidebar-mates-collapsed \.home-mate-list \{[\s\S]*display: none;/);
  assert.match(cssSource, /\.home-sidebar-mate-toggle\[aria-expanded="false"\] \.lucide/);
  assert.match(cssSource, /\.home-sidebar-mate-toggle \{[\s\S]*font: inherit;[\s\S]*font-size: 9px;[\s\S]*font-weight: 680;[\s\S]*letter-spacing: 0\.09em;[\s\S]*text-transform: uppercase;/);
  assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.home-sidebar-mate-toggle \{[\s\S]*width: 100%;[\s\S]*min-height: 36px;/);
});

test("mobile Home sidebar becomes an overlay drawer", function () {
  assert.match(cssSource, /@media \(max-width: 768px\)[\s\S]*\.home-sidebar \{[\s\S]*position: absolute;[\s\S]*width: min\(320px, calc\(100vw - 24px\)\)/);
  assert.match(cssSource, /\.home-sidebar-backdrop \{[\s\S]*display: block;/);
});

test("mobile navigation closes the drawer while Escape stays on Home", function () {
  assert.match(sidebarSource, /window\.matchMedia\("\(max-width: 768px\)"\)\.matches/);
  assert.match(sidebarSource, /openHomeConversation\(mateId, sessionId\);[\s\S]*closeNarrowDrawer\(true\)/);
  assert.match(sidebarSource, /startNewHomeConversation\(\);[\s\S]*closeNarrowDrawer\(true\)/);
  assert.match(sidebarSource, /export function closeHomeSidebarAfterSelection\(\)[\s\S]*closeNarrowDrawer\(true\)/);
  assert.match(sidebarSource, /function openDebatesFromSidebar\(\)[\s\S]*openHomeDebatesArchive\(\);[\s\S]*closeNarrowDrawer\(false\)/);
  assert.match(sidebarSource, /openHomeConversationsSheet\(openConversationFromSidebar, event\.currentTarget\)/);
  assert.match(sidebarSource, /event\.key !== "Escape"[\s\S]*document\.body\.classList\.contains\("home-active"\)[\s\S]*closeNarrowDrawer\(true\)/);
  assert.doesNotMatch(sidebarSource, /showProject|history\.back|location\./);
});

test("active Mate visibility scrolls only the Mate list and preserves keyboard focus", function () {
  var hubSource = fs.readFileSync(path.join(root, "lib/public/modules/app-home-hub.js"), "utf8");
  assert.match(hubSource, /var lastRenderedMateId = null/);
  assert.match(hubSource, /var selectionChanged = activeMateId !== lastRenderedMateId/);
  assert.match(hubSource, /function keepMateRowVisible\(list, row\)[\s\S]*list\.getBoundingClientRect\(\)[\s\S]*row\.getBoundingClientRect\(\)[\s\S]*list\.scrollTop -=[\s\S]*list\.scrollTop \+=/);
  assert.doesNotMatch(hubSource, /scrollIntoView/);
  assert.match(hubSource, /focusedRow\.focus\(\{ preventScroll: true \}\)/);
  assert.match(hubSource, /keepMateRowVisible\(list, selectionChanged \? activeRow : focusedRow \|\| activeRow\)/);
  assert.match(hubSource, /lastRenderedMateId = activeMateId/);
  assert.match(hubSource, /state\.homeSidebarCollapsed !== prev\.homeSidebarCollapsed && !state\.homeSidebarCollapsed[\s\S]*requestAnimationFrame\(renderHomeMateSwitcher\)/);
  assert.match(hubSource, /function selectHomeMate\(mateId\)[\s\S]*openHomeChat\(mateId\)/);
});

test("narrow sheet selection moves focus out of the collapsed sidebar", function () {
  assert.match(sidebarSource, /function focusNarrowNavigationTarget\(\)[\s\S]*getElementById\("home-mate-chat-input"\)/);
  assert.match(sidebarSource, /composer && !composer\.disabled && composer\.getClientRects\(\)\.length[\s\S]*composer\.focus\(\);[\s\S]*return;/);
  assert.match(sidebarSource, /getElementById\("home-sidebar-expand"\)[\s\S]*expand\.getClientRects\(\)\.length[\s\S]*expand\.focus\(\)/);
  assert.match(sidebarSource, /function closeNarrowDrawer\(focusConversation\)[\s\S]*setCollapsed\(true\);[\s\S]*focusNarrowNavigationTarget\(\)/);
  assert.match(sheetSource, /var onSelect = selectConversation;[\s\S]*closeSheet\(\);[\s\S]*onSelect/);
});
