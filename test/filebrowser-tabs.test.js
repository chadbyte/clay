var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

test("document viewer tabs route click focus through the exported tab function", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js"), "utf8");
  assert.match(source, /focusFileViewerTab\(path\)/);
  assert.doesNotMatch(source, /function\(\) \{ focus\(path\); \}/);
});

test("cached focused tab data remains available for generic viewer reopening", async function() {
  function element() {
    var node = { children: [], addEventListener: function () {}, appendChild: function (child) { this.children.push(child); }, setAttribute: function () {} };
    Object.defineProperty(node, "innerHTML", { get: function () { return ""; }, set: function () { node.children = []; } });
    return node;
  }
  var root = element();
  global.document = { getElementById: function (id) { return id === "file-viewer-tabs" ? root : null; }, createElement: element };
  var tabs = await import("file://" + path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js") + "?reopen=" + Date.now());
  tabs.initFileViewerTabs({});
  tabs.openFileViewerTab("first.js", { content: "first" });
  tabs.openFileViewerTab("second.js", { content: "second" });
  assert.equal(tabs.focusedFileViewerTab(), "second.js");
  assert.equal(tabs.focusedFileViewerTabData().content, "second");
  delete global.document;
});

test("document viewer tab close control routes through the exported close function", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js"), "utf8");
  assert.match(source, /closeFileViewerTab\(path\)/);
  assert.doesNotMatch(source, /closeTab\(path\)/);
});

test("document viewer reset clears every tab before full teardown", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var reset = source.slice(source.indexOf("export function resetFileBrowser"), source.indexOf("var pendingOpenMode"));
  assert.match(reset, /clearFileViewerTabs\(\);/);
  assert.match(reset, /teardownFileViewer\(\);/);
});

test("document viewer window close hides without closing the focused tab", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var init = source.slice(source.indexOf("// Close button"), source.indexOf("// Full-viewport presentation toggle"));
  assert.match(init, /file-viewer-close[\s\S]*closeFileViewer\(\)/);
  assert.doesNotMatch(init, /file-viewer-close[\s\S]*closeFileViewerTab/);
  var close = source.slice(source.indexOf("export function closeFileViewer"), source.indexOf("function teardownFileViewer"));
  assert.doesNotMatch(close, /closeFileViewerTab/);
  assert.match(close, /teardownFileViewer\(\);/);
});

test("only correlated file reads gate visibility; direct renders remain current", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var viewer = source.slice(source.indexOf("function showFileContent"), source.indexOf("function renderFileBreadcrumb"));
  var reader = source.slice(source.indexOf("export function handleFsRead"), source.indexOf("// --- Tree rendering ---"));
  assert.match(viewer, /function showFileContent\(msg, expectedRevision\)/);
  assert.match(viewer, /expectedRevision != null && !isRightWorkbenchCurrent\("file-viewer", expectedRevision\)/);
  assert.doesNotMatch(viewer, /activeRead[\s\S]*isRightWorkbenchCurrent/);
  assert.match(reader, /showFileContent\(msg, request\.workbenchRevision\)/);
  assert.match(source.slice(source.indexOf("export function handleFileChanged"), source.indexOf("function showInlineDiff")), /showFileContent\(msg\.path === currentFilePath \? msg/);
  assert.match(source.slice(source.indexOf("export function openWorkingTreeDiff"), source.indexOf("export function presentMarkdownEdit")), /showFileContent\([\s\S]*\);/);
  assert.match(source.slice(source.indexOf("export function reopenFileViewer"), source.indexOf("export function openWorkingTreeDiff")), /sendWatch\(currentFilePath\)/);
});

test("right workbench arbitration records the latest owner and revision", async function() {
  var storeModule = await import("file://" + path.join(__dirname, "../lib/public/modules/store.js"));
  var workbench = await import("file://" + path.join(__dirname, "../lib/public/modules/right-workbench.js") + "?workbench=" + Date.now());
  storeModule.createStore({});
  var closed = [];
  workbench.registerRightWorkbench("behavior-a", function () { closed.push("a"); });
  workbench.registerRightWorkbench("behavior-b", function () { closed.push("b"); });
  workbench.registerRightWorkbench("behavior-c", function () { closed.push("c"); });
  var first = workbench.claimRightWorkbench("behavior-a");
  var second = workbench.claimRightWorkbench("behavior-b");
  assert.equal(storeModule.store.get("rightWorkbenchOwner"), "behavior-b");
  assert.equal(storeModule.store.get("rightWorkbenchRevision"), second);
  assert.ok(second > first);
  assert.deepEqual(closed, ["b", "c", "a", "c"]);
  assert.equal(workbench.isRightWorkbenchCurrent("behavior-a", first), false);
  workbench.releaseRightWorkbench("behavior-b");
  assert.equal(storeModule.store.get("rightWorkbenchOwner"), null);
});

test("right workbench identity changes invalidate pending revisions", async function() {
  var storeModule = await import("file://" + path.join(__dirname, "../lib/public/modules/store.js"));
  var workbench = await import("file://" + path.join(__dirname, "../lib/public/modules/right-workbench.js") + "?identity=" + Date.now());
  storeModule.createStore({ currentSlug: "one", myUserId: "user" });
  var revision = workbench.claimRightWorkbench("identity-panel");
  storeModule.store.set({ currentSlug: "two" });
  assert.equal(workbench.isRightWorkbenchCurrent("identity-panel", revision), false);
  assert.equal(storeModule.store.get("rightWorkbenchOwner"), null);
  assert.ok(storeModule.store.get("rightWorkbenchRevision") > revision);
});

test("right workbench openings use one shared arbitration point", function() {
  var modules = ["filebrowser.js", "issues.js", "project-logs.js", "scheduled-tasks.js", "sticky-notes-browser.js", "terminal.js"];
  for (var i = 0; i < modules.length; i++) {
    var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/" + modules[i]), "utf8");
    assert.match(source, /claimRightWorkbench/);
    assert.match(source, /registerRightWorkbench/);
  }
});

test("file link fixture exposes production-module controls for tabs and stale reads", function() {
  var fixture = fs.readFileSync(path.join(__dirname, "fixtures/file-links-browser.html"), "utf8");
  assert.match(fixture, /import \{ initFileBrowser, handleFsRead, openFile, closeFileViewer, reopenFileViewer \}/);
  assert.match(fixture, /fixture-race/);
  assert.match(fixture, /fixture-open-issues/);
  assert.match(fixture, /fixture-open-logs/);
  assert.match(fixture, /fixture-click-viewer-close/);
  assert.match(fixture, /fixture-reopen-files/);
  assert.match(fixture, /reopenFileViewer/);
  assert.match(fixture, /initIssues\(\)/);
  assert.match(fixture, /initProjectLogs\(\)/);
  assert.match(fixture, /message\.path === "first\.js" \? 45 : 10/);
  assert.match(fixture, /github\.com\/ThroughLineCare\/fs-handler-interviewer\/pull\/123/);
});

test("generic Files opening uses the production reopen helper once", function() {
  var app = fs.readFileSync(path.join(__dirname, "../lib/public/app.js"), "utf8");
  var callback = app.slice(app.indexOf("onFilesTabOpen:"), app.indexOf("requestKnowledgeList:"));
  assert.match(callback, /reopenFileViewer\(\);/);
  assert.match(callback, /loadRootDirectory\(\);/);
  assert.equal((app.match(/fileBrowserBtn\.addEventListener/g) || []).length, 0);
});

test("reopen fixture covers hidden two-tab restoration with the second tab active", function() {
  var fixture = fs.readFileSync(path.join(__dirname, "fixtures/file-links-browser.html"), "utf8");
  var first = fixture.indexOf("fixture-open-first");
  var second = fixture.indexOf("fixture-open-second");
  var hide = fixture.indexOf("fixture-hide-viewer");
  var reopen = fixture.indexOf("fixture-reopen-files");
  assert.ok(first >= 0 && first < second && second < hide && hide < reopen);
  assert.match(fixture, /fixtureOpenFile\("second\.js"\)/);
  assert.match(fixture, /reopenFileViewer\(\)/);
});

test("file tree clicks preview files while double clicks pin them", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  assert.strictEqual((source.match(/previewFileViewerTab\(filePath\)/g) || []).length, 2);
  assert.strictEqual((source.match(/rowEl\.addEventListener\("dblclick"/g) || []).length, 2);
});

test("all file-tree file entry points claim Files before reads", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var filtered = source.slice(source.indexOf("function renderFilteredTree"), source.indexOf("function highlightMatch"));
  var normal = source.slice(source.indexOf("function renderEntries"), source.indexOf("// --- File viewer ---"));
  assert.match(filtered, /click[\s\S]*claimRightWorkbench\("file-viewer"\)[\s\S]*requestFileContent\(filePath\)/);
  assert.match(normal, /click[\s\S]*claimRightWorkbench\("file-viewer"\)[\s\S]*requestFileContent\(filePath\)/);
  assert.match(filtered, /dblclick[\s\S]*openFile\(filePath\)/);
  assert.match(normal, /dblclick[\s\S]*openFile\(filePath\)/);
  assert.doesNotMatch(filtered, /dblclick[\s\S]*claimRightWorkbench/);
  assert.doesNotMatch(normal, /dblclick[\s\S]*claimRightWorkbench/);
});

test("document viewer uses an editor tab strip with a separate breadcrumb row", function() {
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");
  assert.match(html, /file-viewer-tabbar[\s\S]*file-viewer-breadcrumbs[\s\S]*file-viewer-path[\s\S]*file-viewer-toolbar/);
  assert.ok(html.indexOf('class="file-viewer-window-actions"') < html.indexOf('class="file-viewer-breadcrumbs"'));
  assert.ok(html.indexOf('id="file-viewer-fullscreen"') < html.indexOf('id="file-viewer-close"'));
  assert.ok(html.indexOf('class="file-viewer-tabbar"') < html.indexOf('id="file-viewer-close"'));
  assert.ok(html.indexOf('id="file-viewer-close"') < html.indexOf('class="file-viewer-breadcrumbs"'));
  assert.match(css, /\.file-viewer-tab\.active::before\s*\{[^}]*var\(--accent\)/s);
  assert.match(css, /\.file-viewer-breadcrumbs\s*\{/);
  assert.match(css, /\.file-viewer-toolbar\s*\{[^}]*margin-left:\s*auto/s);
});

test("document viewer renders SVG files safely with a source toggle", function() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");
  assert.match(source, /currentIsSvg = !lightweightPreview && ext === "svg"/);
  assert.match(source, /image\.src = "api\/file\?path=" \+ encodeURIComponent\(currentFilePath\)/);
  assert.doesNotMatch(source, /file-viewer-svg-preview[^\n]*currentContent/);
  assert.match(css, /\.file-viewer-svg-preview\s*\{/);
});

test("document and terminal viewers float above the workspace", function() {
  var browser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/filebrowser.css"), "utf8");
  var init = browser.slice(browser.indexOf("export function initFileBrowser"), browser.indexOf("// Load material file icons"));
  assert.match(init, /mainPanels\.appendChild\(ctx\.fileViewerEl\)/);
  assert.doesNotMatch(init, /mainPanels\.insertBefore/);
  assert.match(css, /#file-viewer\s*\{[^}]*margin:\s*8px 8px 8px 10px[^}]*border-radius:\s*12px[^}]*box-shadow:/s);
  assert.match(css, /#terminal-container\s*\{[^}]*margin:\s*8px 8px 8px 10px[^}]*border-radius:\s*12px[^}]*box-shadow:/s);
  assert.match(css, /@keyframes workbench-panel-in/);
});

test("split and pane markdown presents use the parent-owned viewer path", function() {
  var messages = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  var bridge = fs.readFileSync(path.join(__dirname, "../lib/public/modules/pane-bridge.js"), "utf8");
  assert.match(messages, /store\.get\('paneMode'\).*forwardPaneMarkdownPresentation/);
  assert.match(messages, /else if \(!store\.get\('splitPanes'\)\) presentMarkdownEdit/);
  assert.match(bridge, /type: "clay-pane-present-markdown"/);
});

test("split panes attach live project and session identity for file-chip routing", function() {
  var split = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");
  var bridge = fs.readFileSync(path.join(__dirname, "../lib/public/modules/pane-file-bridge.js"), "utf8");
  var links = fs.readFileSync(path.join(__dirname, "../lib/public/modules/clay-file-links.js"), "utf8");

  assert.match(split, /frame\.dataset\.projectSlug = pane\.slug/);
  assert.match(split, /frame\.dataset\.sessionId = String\(pane\.sessionId\)/);
  assert.match(split, /handlePaneFileMessage\(event, host, openFile/);
  assert.match(bridge, /event\.origin !== window\.location\.origin/);
  assert.match(bridge, /paneFrame\(host, event\.source\)/);
  assert.match(bridge, /String\(pane\.slug\) !== String\(state\.currentSlug\)/);
  assert.match(bridge, /openFiles\(\)/);
  assert.match(links, /store\.get\('paneMode'\).*forwardPaneFileReference/);
});

test("document viewer tabs execute focus and close click handlers", async function() {
  function element() {
    var node = {
      children: [],
      handlers: {},
      classList: { add: function() {}, remove: function() {}, toggle: function() {} },
      appendChild: function(child) { this.children.push(child); },
      addEventListener: function(type, handler) { this.handlers[type] = handler; },
      setAttribute: function() {},
    };
    Object.defineProperty(node, "innerHTML", {
      get: function() { return ""; },
      set: function() { node.children = []; },
    });
    return node;
  }
  var root = element();
  global.document = {
    getElementById: function(id) { return id === "file-viewer-tabs" ? root : null; },
    createElement: element,
  };
  var moduleUrl = "file://" + path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js") + "?behavior=" + Date.now();
  var tabs = await import(moduleUrl);
  var focused = [];
  var emptied = 0;
  tabs.initFileViewerTabs({ onFocus: function(tabPath) { focused.push(tabPath); }, onEmpty: function() { emptied++; } });
  tabs.openFileViewerTab("one.md");
  tabs.openFileViewerTab("two.md");
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(tabs.focusedFileViewerTab(), "two.md");
  tabs.openFileViewerTab("one.md");
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(tabs.focusedFileViewerTab(), "one.md");
  root.children[0].handlers.click({ stopPropagation: function() {} });
  assert.strictEqual(focused[0], "one.md");
  root.children[0].children[2].handlers.click({ stopPropagation: function() {} });
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(tabs.focusedFileViewerTab(), "two.md");
  assert.strictEqual(focused[1], "two.md");
  tabs.closeFileViewerTab("two.md");
  assert.strictEqual(emptied, 1);
  delete global.document;
});

test("document viewer reuses one preview tab until the file is explicitly opened", async function() {
  function element() {
    var node = {
      children: [], handlers: {},
      appendChild: function(child) { this.children.push(child); },
      addEventListener: function(type, handler) { this.handlers[type] = handler; },
      setAttribute: function() {},
    };
    Object.defineProperty(node, "innerHTML", {
      get: function() { return ""; },
      set: function() { node.children = []; },
    });
    return node;
  }
  var root = element();
  global.document = {
    getElementById: function(id) { return id === "file-viewer-tabs" ? root : null; },
    createElement: element,
  };
  var moduleUrl = "file://" + path.join(__dirname, "../lib/public/modules/filebrowser-tabs.js") + "?preview=" + Date.now();
  var tabs = await import(moduleUrl);
  tabs.initFileViewerTabs({});
  tabs.previewFileViewerTab("one.md");
  tabs.previewFileViewerTab("two.md");
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(tabs.focusedFileViewerTab(), "two.md");
  tabs.openFileViewerTab("two.md");
  tabs.previewFileViewerTab("three.md");
  assert.strictEqual(root.children.length, 2);
  tabs.previewFileViewerTab("four.md");
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(tabs.focusedFileViewerTab(), "four.md");
  tabs.updateFileViewerTab("four.md", { content: "updated" });
  assert.strictEqual(root.children.length, 2);
  assert.strictEqual(tabs.updateFileViewerTab("stale.md", { content: "late" }), false);
  assert.strictEqual(root.children.length, 2);
  delete global.document;
});
