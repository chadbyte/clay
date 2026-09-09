var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var attachHomeClayEntry = require("../lib/server-home-clay-entry").attachHomeClayEntry;
var attachHomeClaySessionLinks = require("../lib/server-home-clay-session-links").attachHomeClaySessionLinks;
var transformEvent = require("../lib/server-home-chat-events").transformEvent;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

function fixture(modelError) {
  var sessions = new Map();
  var nextId = 1;
  var calls = { starts: [], histories: [], taps: [], lists: 0, errors: [] };
  var manager = {
    sessions: sessions,
    createSession: function (options) {
      var session = { localId: nextId++, ownerId: options.ownerId, vendor: options.vendor, model: options.model, history: [], isProcessing: false };
      sessions.set(session.localId, session);
      return session;
    },
    sendAndRecord: function (session, event) { session.history.push(event); },
    saveSessionFile: function () {},
  };
  var found = { mate: { id: "clay-id", builtinKey: "clay" }, ctx: { getSessionManager: function () { return manager; }, sdk: { startQuery: function (session, text) { calls.starts.push({ session: session, text: text }); } } } };
  var entry = attachHomeClayEntry({
    findMateProject: function (userId, mateId) { assert.equal(mateId, null); return found; },
    ownsSession: function (session, userId) { return session.ownerId === userId; },
    sessionReference: function (session) { return session.cliSessionId || "local:" + session.localId; },
    setupSearchTap: function (ws, selected, localId, requestId) { calls.taps.push({ localId: localId, requestId: requestId }); },
    sendHistory: function (ws, selected, session, requestId) { calls.histories.push({ session: session, requestId: requestId, processing: session.isProcessing }); },
    sendSessionList: function () { calls.lists++; },
    sendError: function () { calls.errors.push(Array.prototype.slice.call(arguments)); },
    sendModelError: function (ws, selected, msg, error, sessionId) { calls.errors.push({ error: error.message, sessionId: sessionId }); },
    homeModels: { resolveMateModel: function () { if (modelError) return Promise.reject(new Error("Choose a model")); return Promise.resolve({ vendor: "codex", model: "gpt-5.6-sol" }); } },
  });
  return { entry: entry, manager: manager, calls: calls };
}

test("global Ask Clay creates one exact owned session and records the visible user query before execution", async function () {
  var value = fixture(false);
  var ws = { readyState: 1 };
  await value.entry.start(ws, "user-1", { requestId: "request-1", text: "Find my conversation about fruit", mateId: "forged" });
  assert.equal(value.manager.sessions.size, 1);
  var session = Array.from(value.manager.sessions.values())[0];
  assert.equal(session.ownerId, "user-1");
  assert.equal(session.vendor, "codex");
  assert.equal(session.model, "gpt-5.6-sol");
  assert.equal(session.homeClayEntryMode, "search");
  assert.equal(session.homeClayEntryRequestId, "request-1");
  assert.deepEqual(session.history, [{ type: "user_message", text: "Find my conversation about fruit" }]);
  assert.equal(value.calls.histories[0].processing, true);
  assert.equal(value.calls.starts[0].session, session);
  assert.match(value.calls.starts[0].text, /global search[\s\S]*Search by meaning[\s\S]*User request:\nFind my conversation about fruit/);
  assert.match(value.calls.starts[0].text, /use search_workspace_history before any other investigation/);
  assert.match(value.calls.starts[0].text, /search_project_logs before answering/);
  assert.match(value.calls.starts[0].text, /Do not force a workspace or Logs search when the request is a general question or task/);
  assert.match(value.calls.starts[0].text, /at most three focused search passes/);
  assert.match(value.calls.starts[0].text, /Do not use Bash, filesystem scans, or generic agents/);
});

test("global Ask Clay is idempotent per owner and request while new requests create distinct chats", async function () {
  var value = fixture(false);
  var msg = { requestId: "request-1", text: "Find apples" };
  await value.entry.start({ readyState: 1 }, "user-1", msg);
  await value.entry.start({ readyState: 1 }, "user-1", msg);
  assert.equal(value.manager.sessions.size, 1);
  assert.equal(value.calls.starts.length, 1);
  await value.entry.start({ readyState: 1 }, "user-2", msg);
  assert.equal(value.manager.sessions.size, 2);
  assert.equal(value.calls.starts.length, 2);
  await value.entry.start({ readyState: 1 }, "user-1", { requestId: "request-2", text: "Find pears" });
  assert.equal(value.manager.sessions.size, 3);
  assert.equal(value.calls.starts.length, 3);
});

test("model failure does not strand an empty Ask Clay session", async function () {
  var value = fixture(true);
  await value.entry.start({ readyState: 1 }, "user-1", { requestId: "request-1", text: "Find fruit" });
  assert.equal(value.manager.sessions.size, 0);
  assert.equal(value.calls.starts.length, 0);
  assert.match(value.calls.errors[0].error, /Choose a model/);
});

test("rendered session links resolve through exact search and ordinary Home Mate sources", function () {
  var searchSource = { localId: 7, ownerId: "user-1" };
  var homeSource = { localId: 8, ownerId: "user-1" };
  var projects = new Map([
    ["mate-clay", { getSessionManager: function () { return { sessions: new Map([[7, searchSource]]) }; } }],
    ["mate-research", { getSessionManager: function () { return { sessions: new Map([[8, homeSource]]) }; } }],
  ]);
  var sent = [];
  var bindings = [];
  var links = attachHomeClaySessionLinks({
    projects: projects,
    workspaceQueryService: {
      bindProjectSession: function (binding) {
        bindings.push(binding);
        return { resolveSessionNavigation: function (args) { assert.equal(args.sessionRef, "session:AAAAAAAAAAAAAAAAAAAAAAAA"); return { projectSlug: "owned", sessionId: 11, isMate: false }; } };
      },
    },
    sendMessage: function (ws, payload) { sent.push(payload); },
  });
  var ws = { _searchClayTap: { mateSlug: "mate-clay", sessionId: 7 } };
  links.resolve(ws, { surface: "search", requestId: "link-1", sessionRef: "session:AAAAAAAAAAAAAAAAAAAAAAAA" });
  assert.equal(sent[0].status, "ready");
  assert.deepEqual(sent[0].target, { projectSlug: "owned", sessionId: 11, isMate: false });
  var homeWs = { _homeChatTap: { mateSlug: "mate-research", sessionId: 8 } };
  links.resolve(homeWs, { surface: "home", requestId: "link-2", sessionRef: "session:AAAAAAAAAAAAAAAAAAAAAAAA" });
  assert.equal(sent[1].status, "ready");
  assert.deepEqual(bindings, [
    { projectSlug: "mate-clay", session: searchSource },
    { projectSlug: "mate-research", session: homeSource },
  ]);
  links.resolve({}, { surface: "home", requestId: "link-3", sessionRef: "session:AAAAAAAAAAAAAAAAAAAAAAAA" });
  assert.equal(sent[2].status, "error");
  assert.match(sent[2].error, /source conversation/);
});

test("rendered Project Log links resolve through the exact authoritative Clay source", function () {
  var sourceSession = { localId: 7, ownerId: "user-1" };
  var sourceStatus = { slug: "mate-clay", projectOwnerId: "user-1", isMate: true, mateId: "clay-id" };
  var sourceProject = {
    getStatus: function () { return sourceStatus; },
    getSessionManager: function () { return { sessions: new Map([[7, sourceSession]]) }; },
  };
  var sent = [];
  var binding = null;
  var links = attachHomeClaySessionLinks({
    projects: new Map([["mate-clay", sourceProject]]),
    projectLogsService: {
      bindMate: function (value) {
        binding = value;
        return { resolveLogNavigation: function (args) {
          assert.deepEqual(args, { ref: "log:AAAAAAAAAAAAAAAAAAAAAAAA" });
          return { projectSlug: "owned", ref: args.ref };
        } };
      },
    },
    sendMessage: function (ws, payload) { sent.push(payload); },
  });
  var ws = { _searchClayTap: { mateSlug: "mate-clay", mateId: "clay-id", sessionId: 7 } };
  links.resolveLog(ws, { surface: "search", requestId: "log-link-1", ref: "log:AAAAAAAAAAAAAAAAAAAAAAAA" });
  assert.deepEqual(binding, {
    projectSlug: "mate-clay", projectOwnerId: "user-1", isMate: true, mateId: "clay-id", session: sourceSession,
  });
  assert.equal(sent[0].status, "ready");
  assert.deepEqual(sent[0].target, { projectSlug: "owned", ref: "log:AAAAAAAAAAAAAAAAAAAAAAAA" });

  links.resolveLog({}, { surface: "home", requestId: "log-link-2", ref: "log:AAAAAAAAAAAAAAAAAAAAAAAA" });
  assert.equal(sent[1].status, "error");
  assert.match(sent[1].error, /source conversation/);
});

test("Project Log reference parsing accepts exact refs and rejects lookalikes", function () {
  var sourceText = fs.readFileSync(path.join(__dirname, "../lib/public/modules/clay-log-links.js"), "utf8");
  var start = sourceText.indexOf("export function parseClayLogReferences(text)");
  var end = sourceText.indexOf("\n\nexport function isExactClayLogReference", start);
  var parseClayLogReferences = Function(sourceText.slice(start, end).replace("export ", "") + "\nreturn parseClayLogReferences;")();
  var explicit = parseClayLogReferences("See [clayos/log:AAAAAAAAAAAAAAAAAAAAAAAA — Release decision].");
  assert.deepEqual(explicit.map(function (item) { return { ref: item.ref, label: item.label }; }), [
    { ref: "log:AAAAAAAAAAAAAAAAAAAAAAAA", label: "Release decision" },
  ]);
  var bare = parseClayLogReferences("Open log:BBBBBBBBBBBBBBBBBBBBBBBB now.");
  assert.equal(bare.length, 1);
  assert.equal(bare[0].ref, "log:BBBBBBBBBBBBBBBBBBBBBBBB");
  assert.equal(parseClayLogReferences("log:CCCCCCCCCCCCCCCCCCCCCCCCC").length, 0, "a 25-character lookalike is rejected");
  assert.equal(parseClayLogReferences("prefixlog:DDDDDDDDDDDDDDDDDDDDDDDD").length, 0, "an embedded identifier is rejected");
  assert.equal(parseClayLogReferences("https://example.test/log:EEEEEEEEEEEEEEEEEEEEEEEE").length, 0, "a URL path is not converted");

  var exactStart = sourceText.indexOf("export function isExactClayLogReference(text)");
  var exactEnd = sourceText.indexOf("\n\nfunction createLogLink", exactStart);
  var isExactClayLogReference = Function(sourceText.slice(exactStart, exactEnd).replace("export ", "") + "\nreturn isExactClayLogReference;")();
  assert.equal(isExactClayLogReference("log:FFFFFFFFFFFFFFFFFFFFFFFF"), true);
  assert.equal(isExactClayLogReference("prefix log:FFFFFFFFFFFFFFFFFFFFFFFF"), false);
});

test("Ask Clay projects changing sanitized search stages without leaking tool details", function () {
  var session = { homeClayEntryMode: "search", model: "gpt-5.6-sol", vendor: "codex" };
  var thinking = transformEvent({ type: "thinking_start" }, "clay-id", session, "request-1", "session-1");
  var thought = transformEvent({ type: "thinking_stop", duration: 1.25 }, "clay-id", session, "request-1", "session-1");
  var searching = transformEvent({ type: "tool_start", name: "search_workspace_history" }, "clay-id", session, "request-1", "session-1");
  var specific = transformEvent({ type: "tool_executing", name: "search_workspace_history", input: { query: "fruit\u0000 notes" } }, "clay-id", session, "request-1", "session-1");
  var reviewing = transformEvent({ type: "tool_result", content: "private transcript" }, "clay-id", session, "request-1", "session-1");
  transformEvent({ type: "tool_start", name: "search_project_logs" }, "clay-id", session, "request-1", "session-1");
  var logSearch = transformEvent({ type: "tool_executing", name: "search_project_logs", input: { query: "release status" } }, "clay-id", session, "request-1", "session-1");
  assert.deepEqual([thinking.phase, searching.phase, reviewing.phase], ["thinking", "searching", "reviewing"]);
  assert.deepEqual([thinking.status, thought.status, searching.status, reviewing.status], ["active", "done", "active", "done"]);
  assert.equal(thought.label, "Thought through the request in 1.3s");
  assert.equal(specific.label, "Searching conversations for \u201cfruit notes\u201d");
  assert.equal(logSearch.label, "Searching project logs for \u201crelease status\u201d");
  assert.equal(specific.activityId, searching.activityId);
  assert.equal(searching.step, 1);
  assert.equal(reviewing.step, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(searching, "name"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(searching, "input"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(reviewing, "content"), false);
  assert.equal(transformEvent({ type: "result" }, "clay-id", session, "request-1", "session-1").type, "home_mate_done");
  assert.equal(transformEvent({ type: "done" }, "clay-id", session, "request-1", "session-1"), null);
});

test("Ask Clay uses the canonical exact read-only allowlist without admitting mutations", function () {
  var bridge = createSDKBridge({ cwd: process.cwd(), sessionManager: {}, adapter: { vendor: "claude" }, send: function () {} });
  assert.equal(bridge.checkToolWhitelist("Read", { file_path: "/repo/a.js" }).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("Grep", { pattern: "needle" }).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("mcp__clay-workspace__read_project_session", {}).behavior, "allow");
  assert.equal(bridge.checkToolWhitelist("Edit", { file_path: "/repo/a.js" }), null);
  assert.equal(bridge.checkToolWhitelist("Bash", { command: "rm a.js" }), null);
});

test("global search is deterministic first and exposes an explicit branded Clay chat handoff", function () {
  var root = path.join(__dirname, "..");
  var palette = fs.readFileSync(path.join(root, "lib/public/modules/command-palette.js"), "utf8");
  var widget = fs.readFileSync(path.join(root, "lib/public/modules/search-clay-chat.js"), "utf8");
  var styles = fs.readFileSync(path.join(root, "lib/public/css/command-palette.css"), "utf8");
  var styleImports = fs.readFileSync(path.join(root, "lib/public/style.css"), "utf8");
  var markup = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var schema = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  var markdown = fs.readFileSync(path.join(root, "lib/public/modules/markdown.js"), "utf8");
  var logLinks = fs.readFileSync(path.join(root, "lib/public/modules/clay-log-links.js"), "utf8");
  var projectLogs = fs.readFileSync(path.join(root, "lib/public/modules/project-logs.js"), "utf8");
  var router = fs.readFileSync(path.join(root, "lib/public/modules/app-message-router.js"), "utf8");
  var sessionLinks = fs.readFileSync(path.join(root, "lib/server-home-clay-session-links.js"), "utf8");
  assert.match(markup, /cmd-palette-searchbar[\s\S]*data-lucide="search"[\s\S]*Search or ask Clay/);
  assert.doesNotMatch(markup, /cmd-palette-searchbar-brand/);
  assert.match(markup, /icon-strip-logo[\s\S]*clay-studio-symbol\.png/);
  assert.match(palette, /fetch\("\/api\/palette\/search\?q=" \+ encodeURIComponent\(query\)/);
  assert.match(palette, /type: "ask-clay"/);
  assert.match(palette, /No exact matches\. Clay can search by meaning\./);
  assert.match(palette, /if \(attachSearchClayChat\(resultsEl, showSearch, closeCommandPalette\)\)/);
  assert.doesNotMatch(palette, /if \(chatMode && attachSearchClayChat/);
  assert.match(palette, /type: "resume-clay"/);
  assert.match(palette, /Current Clay chat/);
  assert.match(palette, /Return to Clay/);
  assert.match(palette, /Start a new Clay chat about/);
  assert.match(palette, /function resumeClayChat\(\)[\s\S]*attachSearchClayChat/);
  assert.match(widget, /export function getSearchClayChatSummary\(\)/);
  assert.doesNotMatch(palette, /New Mate|group-label">Mates|group-label">Commands|group-label">Users/);
  assert.doesNotMatch(palette, /group-label">Projects|type: "project"/);
  assert.match(widget, /type: "home_clay_ask"/);
  assert.match(widget, /store\.subscribe\(function \(appState, previous\)/);
  assert.match(widget, /if \(!appState\.connected\)[\s\S]*replaceSearchPermissions\(state, \[\]\)/);
  assert.match(widget, /if \(state\.processing\) send\(\{ type: "home_clay_ask", requestId: state\.requestId, text: state\.query \}\)/);
  assert.match(widget, /openHomeConversation\(mateId, sessionId\)/);
  assert.match(widget, /Open this conversation in Home/);
  assert.match(widget, /Search pass " \+ state\.step/);
  assert.match(widget, /Trying another search route/);
  assert.match(widget, /transcript\.scrollHeight - transcript\.scrollTop/);
  assert.match(widget, /createAssistantBubble\(\{ name: "Clay", avatarUrl: mateAvatarUrl\(clayMate\(\), 28\) \}\)/);
  assert.match(widget, /createUserBubble\(\{ text: message\.text \|\| "" \}\)/);
  assert.match(widget, /finalizeAssistantBubble\(row, message\.text \|\| "", false\)/);
  assert.match(fs.readFileSync(path.join(root, "lib/public/modules/chat-bubble-renderer.js"), "utf8"), /renderAssistantBubbleText[\s\S]*enhanceClaySessionLinks\(content\)/);
  assert.match(widget, /function appendActivityList\(content, items, expanded, onToggle\)/);
  assert.match(widget, /items\.length <= 2/);
  assert.match(widget, /panel\.classList\.toggle\("is-expanded", expanded\)/);
  assert.match(styles, /\.search-clay-activity-panel\.is-collapsed \.search-clay-activity-list \{ height: 42px; justify-content: flex-start/);
  assert.match(styles, /\.search-clay-activity-item:nth-last-child\(-n \+ 2\)/);
  assert.match(styles, /\.is-collapsed \.search-clay-activity-item > span \{ flex-direction: row/);
  assert.match(styles, /\.search-clay-activity-panel\.is-expanded \.search-clay-activity-list \{ max-height: 220px/);
  assert.match(widget, /activities: completedActivities/);
  assert.match(widget, /if \(!state\.awaitingCompletion\) return true;/);
  assert.match(widget, /takeActivities\("Response complete", "done"\)/);
  assert.match(widget, /state\.queuedUsers\.push\(\{ role: "user", text: text \}\)/);
  assert.match(widget, /state\.pendingTurns\+\+/);
  assert.match(widget, /state\.messages\.push\(state\.queuedUsers\.shift\(\)\)/);
  assert.match(widget, /input\.disabled = !state\.sessionId/);
  assert.doesNotMatch(widget, /input\.disabled = !state\.sessionId \|\| state\.processing/);
  assert.match(widget, /if \(!shell\)[\s\S]*freshInput\.addEventListener\("input"/);
  assert.match(widget, /transcript\.innerHTML = ""/);
  assert.doesNotMatch(widget, /function archiveActivities|role: "activity"/);
  assert.match(styles, /\.search-clay-transcript \.search-clay-message-user[\s\S]*align-items: flex-end/);
  assert.match(styles, /body\.wide-view \.search-clay-transcript \.search-clay-message-user \.bubble[\s\S]*background: var\(--user-bubble\)/);
  assert.match(styles, /body\.mate-dm-active \.search-clay-transcript \.search-clay-message-user \.bubble/);
  assert.match(widget, /content\.appendChild\(panel\)/);
  assert.match(styles, /\.md-content:not\(:empty\) \+ \.search-clay-activity-panel/);
  assert.match(styles, /\.search-clay-transcript[\s\S]*padding: 16px 12px/);
  assert.match(markup, /style\.css\?v=20260910-ask-clay-controls1/);
  assert.match(widget, /identity\.innerHTML = '<span><strong>Clay<\/strong><small>Workspace search<\/small><\/span>'/);
  assert.doesNotMatch(widget, /identity\.innerHTML = '<img/);
  assert.match(palette, /class="cmd-palette-brand">Clay Studio/);
  assert.doesNotMatch(palette, /class="cmd-palette-brand"><img/);
  assert.match(styles, /\.cmd-palette\.is-chatting \.cmd-palette-footer-shortcuts \{ display: none; \}/);
  assert.match(styleImports, /command-palette\.css\?v=20260910-ask-clay-controls1/);
  assert.match(markup, /app\.js\?v=20260910-ask-clay-controls1/);
  assert.match(markdown, /replace\(\/\\\*\\\*\[ \\t\]\+/);
  assert.match(markdown, /function normalizeAdjacentEmphasis\(text\)/);
  assert.match(markdown, /\\p\{L\}\\p\{N\}/);
  assert.match(markdown, /\$1\$2\$1<wbr>/);
  assert.match(markdown, /```\[\\s\\S\]\*\?```/);
  var normalizeStart = markdown.indexOf("function normalizeAdjacentEmphasis(text)");
  var normalizeEnd = markdown.indexOf("\n\nexport function renderMarkdown", normalizeStart);
  var normalizeAdjacentEmphasis = Function(markdown.slice(normalizeStart, normalizeEnd) + "\nreturn normalizeAdjacentEmphasis;")();
  var markedParser = require("marked").marked;
  var adjacent = '**"내가 맞다고 느낄 때 무엇을 놓치고 있나?"**에 가까워 보여.';
  var renderedAdjacent = markedParser.parse(normalizeAdjacentEmphasis(adjacent));
  assert.match(renderedAdjacent, /<strong>&quot;내가 맞다고 느낄 때 무엇을 놓치고 있나\?&quot;<\/strong><wbr>에/);
  assert.equal(normalizeAdjacentEmphasis('`**code**suffix`'), '`**code**suffix`');
  assert.match(markdown, /function enhanceClaySessionLinks\(root\)/);
  assert.match(markdown, /clayos\\\/\(session:\[A-Za-z0-9_-\]\{24\}\)/);
  assert.match(palette, /request\.type = "home_clay_session_resolve"/);
  assert.match(palette, /function handleClaySessionLinkClick\(event\)/);
  assert.match(palette, /addEventListener\("click", handleClaySessionLinkClick, true\)/);
  assert.match(palette, /openHomeConversation\(msg\.target\.mateId, msg\.target\.homeSessionId\)/);
  assert.match(router, /handleClaySessionTarget\(msg\)/);
  assert.match(sessionLinks, /bindProjectSession\(\{ projectSlug: selected\.tap\.mateSlug, session: selected\.session \}\)/);
  assert.match(sessionLinks, /resolveSessionNavigation\(\{ sessionRef: msg\.sessionRef \}\)/);
  assert.match(schema, /"home_clay_session_resolve"[\s\S]*"home_clay_session_target"/);
  assert.match(markdown, /enhanceClayLogLinks\(root\)/);
  assert.match(logLinks, /clayos\\\/\(log:\[A-Za-z0-9_-\]\{24\}\)/);
  assert.match(logLinks, /className = "clayos-log-link"/);
  assert.match(logLinks, /closest\("code, pre, a, button"\)/);
  assert.match(logLinks, /querySelectorAll\("code"\)/);
  assert.match(logLinks, /code\.closest\("pre"\)/);
  assert.match(logLinks, /contentEditable = "false"/);
  assert.match(palette, /request\.type = "home_clay_log_resolve"/);
  assert.match(palette, /msg\.type !== "home_clay_log_target"/);
  assert.match(palette, /openProjectLog\(target\.ref\)/);
  assert.match(projectLogs, /export function openProjectLog\(ref\)/);
  assert.match(sessionLinks, /bindMate\([\s\S]*resolveLogNavigation\(\{ ref: msg\.ref \}\)/);
  assert.match(schema, /"home_clay_log_resolve"[\s\S]*"home_clay_log_target"/);
  assert.doesNotMatch(widget, /search-clay-message-label|textContent = message\.role === "user" \? "You"/);
  assert.match(project, /msg\.type === "home_clay_ask"[\s\S]*opts\.onDmMessage\(ws, msg, slug\)/);
  assert.match(schema, /"home_clay_ask"[\s\S]*direction: "c2s"/);
});
