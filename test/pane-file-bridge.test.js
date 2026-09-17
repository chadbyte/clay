var test = require("node:test");
var assert = require("node:assert");
var path = require("node:path");

function loadBridge() {
  return import("file://" + path.join(__dirname, "../lib/public/modules/pane-file-bridge.js"));
}

function frame(projectSlug, sessionId, source) {
  return { contentWindow: source, src: "https://clay.test/p/" + encodeURIComponent(projectSlug) + "/?pane=1&session=" + encodeURIComponent(sessionId), dataset: { projectSlug: projectSlug, sessionId: String(sessionId) } };
}

function host(frames) {
  return { querySelectorAll: function () { return frames; } };
}

function setupStore(values) {
  return import("file://" + path.join(__dirname, "../lib/public/modules/store.js")).then(function (module) {
    module.createStore(values);
    return module;
  });
}

test("pane file bridge accepts only the live pane frame and current split context", async function () {
  var bridge = await loadBridge();
  global.window = { location: { origin: "https://clay.test", href: "https://clay.test/p/project-a/" } };
  await setupStore({ connected: true, currentSlug: "project-a", activeSessionId: 12, splitPanes: { panes: [{ slug: "project-a", sessionId: 11 }, { slug: "project-a", sessionId: 12 }] } });
  var source = {};
  var live = frame("project-a", 11, source);
  var opened = [];
  var filesOpened = 0;
  var accepted = bridge.handlePaneFileMessage({ origin: "https://clay.test", source: source, data: { type: "clay-pane-open-file", path: "folder/my file.js", line: 4, column: 2, projectSlug: "project-a", sessionId: "11" } }, host([live]), function (filePath, opts) { opened.push([filePath, opts]); }, function () { filesOpened++; });
  assert.equal(accepted, true);
  assert.deepEqual(opened, [["folder/my file.js", { line: 4, column: 2, projectSlug: "project-a" }]]);
  assert.equal(filesOpened, 1);
  delete global.window;
});

test("pane file bridge reveals Files idempotently and only after a connected open succeeds", async function () {
  var bridge = await loadBridge();
  global.window = { location: { origin: "https://clay.test", href: "https://clay.test/p/project-a/" } };
  var panelHidden = true;
  var clicks = 0;
  global.document = {
    getElementById: function (id) {
      if (id === "sidebar-panel-files") return { classList: { contains: function () { return panelHidden; } } };
      if (id === "file-browser-btn") return { click: function () { clicks++; panelHidden = false; } };
      return null;
    }
  };
  assert.equal(bridge.revealFilesPanel(), true);
  assert.equal(bridge.revealFilesPanel(), false);
  assert.equal(clicks, 1);

  await setupStore({ connected: false, currentSlug: "project-a", activeSessionId: 11, splitPanes: { panes: [{ slug: "project-a", sessionId: 11 }] } });
  var source = {};
  var live = frame("project-a", 11, source);
  var opened = 0;
  var revealed = 0;
  bridge.handlePaneFileMessage({ origin: "https://clay.test", source: source, data: { type: "clay-pane-open-file", path: "app.js", projectSlug: "project-a", sessionId: "11" } }, host([live]), function () { opened++; }, function () { revealed++; });
  assert.equal(opened, 0);
  assert.equal(revealed, 0);
  delete global.document;
  delete global.window;
});

test("pane file bridge consumes invalid origin, source, project, session, and stale messages", async function () {
  var bridge = await loadBridge();
  global.window = { location: { origin: "https://clay.test", href: "https://clay.test/p/project-a/" } };
  await setupStore({ currentSlug: "project-a", activeSessionId: 11, splitPanes: { panes: [{ slug: "project-a", sessionId: 11 }, { slug: "project-a", sessionId: 12 }] } });
  var source = {};
  var live = frame("project-a", 11, source);
  var opened = 0;
  function call(origin, eventSource, data, frames) {
    return bridge.handlePaneFileMessage({ origin: origin, source: eventSource, data: Object.assign({ type: "clay-pane-open-file", path: "app.js", projectSlug: "project-a", sessionId: "11" }, data || {}) }, host(frames || [live]), function () { opened++; });
  }
  assert.equal(call("https://evil.test", source), false);
  assert.equal(call("https://clay.test", {}, null), true);
  assert.equal(call("https://clay.test", source, { projectSlug: "project-b" }), true);
  assert.equal(call("https://clay.test", source, { sessionId: "12" }), true);
  assert.equal(call("https://clay.test", source, {}, []), true);
  var wrongSource = frame("project-a", 11, source);
  wrongSource.src = "https://clay.test/p/project-a/?pane=1&session=12";
  assert.equal(call("https://clay.test", source, {}, [wrongSource]), true);
  assert.equal(call("https://clay.test", source, { line: 0 }), true);
  assert.equal(opened, 0);
  delete global.window;
});

test("pane file forwarding retains path and navigation coordinates", async function () {
  var bridge = await loadBridge();
  var store = await setupStore({ paneMode: true, currentSlug: "project-a", activeSessionId: 11 });
  var posted = [];
  global.window = { parent: { postMessage: function (message, origin) { posted.push([message, origin]); } }, location: { origin: "https://clay.test" } };
  assert.equal(bridge.forwardPaneFileReference("folder/my file.js", { line: 8, column: 3, projectSlug: "project-a", sessionId: 11 }), true);
  assert.deepEqual(posted[0], [{ type: "clay-pane-open-file", path: "folder/my file.js", line: 8, column: 3, projectSlug: "project-a", sessionId: "11" }, "https://clay.test"]);
  assert.equal(store.store.get("paneMode"), true);
  delete global.window;
});
