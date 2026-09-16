var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

function loadModule() {
  global.navigator = { userAgent: "node", platform: "", maxTouchPoints: 0 };
  global.document = {};
  global.requestAnimationFrame = function () {};
  global.lucide = { createIcons: function () {} };
  return import("file://" + path.join(__dirname, "../lib/public/modules/clay-file-links.js") + "?test=" + Date.now());
}

function cleanup() {
  delete global.navigator;
  delete global.document;
  delete global.requestAnimationFrame;
  delete global.lucide;
}

test("local file targets decode paths and line fragments while preserving external URLs", async function () {
  var links = await loadModule();
  assert.deepEqual(links.localFileTarget("docs/My%20File.md#L12C4"), {
    path: "docs/My File.md", line: 12, column: 4, href: "docs/My%20File.md#L12C4"
  });
  assert.deepEqual(links.localFileTarget("foo.js:12"), {
    path: "foo.js", line: 12, column: null, href: "foo.js:12"
  });
  assert.deepEqual(links.localFileTarget("docs/a%23b.js#L3"), {
    path: "docs/a#b.js", line: 3, column: null, href: "docs/a%23b.js#L3"
  });
  assert.deepEqual(links.localFileTarget("file:///workspace/src/app.js:9:2"), {
    path: "/workspace/src/app.js", line: 9, column: 2, href: "file:///workspace/src/app.js:9:2"
  });
  assert.strictEqual(links.localFileTarget("https://example.com/docs"), null);
  assert.strictEqual(links.localFileTarget("mailto:hello@example.com"), null);
  assert.strictEqual(links.localFileTarget("tel:123"), null);
  assert.strictEqual(links.localFileTarget("mailto:123"), null);
  assert.strictEqual(links.localFileTarget("log:123"), null);
  assert.strictEqual(links.localFileTarget("#section"), null);
  cleanup();
});

test("local file links render as accessible buttons with path metadata", async function () {
  var links = await loadModule();
  var html = links.renderLocalFileLink("./src/app.js#L18", "", "app.js");
  assert.match(html, /class="clay-file-link"/);
  assert.match(html, /data-file-path="\.\/src\/app\.js"/);
  assert.match(html, /data-file-line="18"/);
  assert.match(html, /aria-label="Open file \.\/src\/app\.js:18"/);
  assert.strictEqual(links.renderLocalFileLink("https://example.com", "", "Example"), null);
  cleanup();
});

function loadFileBrowserBehavior() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var openStart = source.indexOf("export function openFile");
  var openEnd = source.indexOf("export function openWorkingTreeDiff");
  var readStart = source.indexOf("export function handleFsRead");
  var readEnd = source.indexOf("// --- Tree rendering ---", readStart);
  var code = "var pendingRenderedOpen = false; var pendingOpenMode = null;" +
    source.slice(openStart, openEnd).replace(/export function /g, "function ") +
    source.slice(readStart, readEnd).replace(/export function /g, "function ");
  var state = { connected: true, currentSlug: "project-a", activeSessionId: 7, myUserId: "user-a", fileReadRequest: null };
  var shown = 0;
  var sideEffects = { closeIssues: 0, cancelFollow: 0, openTab: 0, request: 0 };
  var sandbox = {
    store: { snap: function() { return state; }, get: function(key) { return state[key]; }, set: function(partial) { Object.assign(state, partial); } },
    closeIssues: function() { sideEffects.closeIssues++; },
    followedFileChanged: function() { return true; },
    isFollowingMarkdown: function() { return false; },
    cancelMarkdownFollow: function() { sideEffects.cancelFollow++; },
    openFileViewerTab: function() { sideEffects.openTab++; },
    requestFileContent: function() { sideEffects.request++; },
    showFileContent: function() { shown++; },
  };
  vm.runInNewContext(code, sandbox);
  return { openFile: sandbox.openFile, handleFsRead: sandbox.handleFsRead, state: state, shown: function() { return shown; }, sideEffects: sideEffects };
}

test("filebrowser behavior ignores stale reads and keeps rejected opens side-effect free", function() {
  var browser = loadFileBrowserBehavior();
  browser.state.fileReadRequest = { requestId: "r1", path: "app.js", projectSlug: "project-a", sessionId: "7", accountId: "user-a" };
  browser.handleFsRead({ requestId: "r1", path: "app.js", projectSlug: "project-a", sessionId: "7", accountId: "user-a" });
  assert.equal(browser.shown(), 1);

  browser.state.activeSessionId = 8;
  browser.handleFsRead({ requestId: "r1", path: "app.js", projectSlug: "project-a", sessionId: "7", accountId: "user-a" });
  browser.state.activeSessionId = 7;
  browser.state.connected = false;
  browser.handleFsRead({ requestId: "r1", path: "app.js", projectSlug: "project-a", sessionId: "7", accountId: "user-a" });
  browser.state.connected = true;
  browser.state.fileReadRequest = { requestId: "reset", path: null, projectSlug: "project-a", sessionId: "7", accountId: "user-a" };
  browser.handleFsRead({ requestId: "r1", path: "app.js", projectSlug: "project-a", sessionId: "7", accountId: "user-a" });
  assert.equal(browser.shown(), 1);

  var before = Object.assign({}, browser.sideEffects);
  browser.openFile("app.js", { projectSlug: "other-project", sessionId: "7" });
  browser.openFile("app.js", { projectSlug: "project-a", sessionId: "8" });
  browser.state.connected = false;
  browser.openFile("app.js", { projectSlug: "project-a", sessionId: "7" });
  assert.deepEqual(browser.sideEffects, before);

  browser.state.connected = true;
  browser.state.fileReadRequest = { requestId: "r2", path: "app.js", projectSlug: "project-a", sessionId: "7", accountId: "user-a" };
  browser.handleFsRead({ requestId: "r2", path: "app.js", projectSlug: "project-a", sessionId: "7", accountId: "user-a" });
  assert.equal(browser.shown(), 2);
});
