var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var vm = require("node:vm");
var element = require("./fixtures/popup-tool-dom.cjs").element;
var result = require("../lib/history-tool-result");

test("history previews leave small and live entries intact and defer the bulk of large results", function () {
  var small = { type: "tool_result", id: "small", content: "found" };
  var images = [{ mediaType: "image/png", data: "a".repeat(500000) }];
  var large = { type: "tool_result", id: "large", content: "some output", images: images };
  assert.strictEqual(result.preview(small), small);
  assert.deepEqual(result.preview(large), { type: "tool_result", id: "large", content: "some output", deferredHistoryResult: true });
  assert.strictEqual(large.images, images);
  var text = { type: "tool_result", id: "text", content: "<system-reminder>internal</system-reminder>" + "я".repeat(9000) };
  assert.equal(result.preview(text).content, "я".repeat(1000));
});

test("the complete result is only returned for the exact session origin, index and tool", function () {
  var images = [{ mediaType: "image/jpeg", data: "x".repeat(20000) }];
  var session = { localId: 2, sessionOriginId: "origin", history: [
    { type: "tool_start", id: "tool" },
    { type: "tool_result", id: "tool", content: "full output", images: images },
  ] };
  var request = { sessionId: 2, sessionOriginId: "origin", index: 1, toolId: "tool" };
  assert.deepEqual(result.read(session, request), { content: "full output", images: images });
  [{ sessionId: 3 }, { sessionOriginId: "replaced" }, { index: 0 }, { index: -1 }, { index: 1.1 }, { toolId: "other" }].forEach(function (change) {
    assert.equal(result.read(session, Object.assign({}, request, change)), null);
  });
});

function transcriptFixture(name, input, preview) {
  var messages = element("div");
  var sent = [];
  var openedFiles = [];
  function createElement(tag) {
    var node = element(tag);
    Object.defineProperty(node, "firstChild", { get: function () { return this.children[0]; } });
    Object.defineProperty(node, "isConnected", { get: function () { return messages.contains(this); } });
    node.prepend = function (child) { this.insertBefore(child, this.firstChild); };
    node.removeChild = function (child) { child.remove(); return child; };
    return node;
  }
  messages.querySelector = function (selector) {
    var index = /data-history-tool-result="(\d+)"/.exec(selector);
    function find(node) {
      if (node.dataset.historyToolResult === index[1]) return node;
      for (var child of node.children) {
        var found = find(child);
        if (found) return found;
      }
      return null;
    }
    return find(this);
  };
  var state = { activeSessionId: 2, sessionOriginId: "origin" };
  var context = vm.createContext({
    store: { get: function (key) { return state[key]; }, set: function (values) { Object.assign(state, values); } },
    document: { createElement: createElement },
    window: {},
    openFile: function (file, options) { openedFiles.push({ file: file, options: options }); },
    getWs: function () { return { readyState: 1, send: function (text) { sent.push(JSON.parse(text)); } }; },
    setTimeout: function () {}, clearTimeout: function () {},
    iconHtml: function () { return ""; }, refreshIcons: function () {}, syncPopupActivityGroup: function () {},
  });
  ["clay-tool-presentation", "clay-tool-activity", "session-tool-item", "diff", "tools"].forEach(function (name) {
    var code = fs.readFileSync("lib/public/modules/" + name + ".js", "utf8");
    vm.runInContext(code.replace(/^import .*;\n/gm, "").replace(/^export \{[^}]+\};\n/gm, "").replace(/^export /gm, ""), context);
  });
  context.initTools({ messagesEl: messages });
  var item = context.createSessionToolItem("tool", name);
  var groupEl = context.createSessionToolGroup();
  var tool = { el: item, name: name, input: input === undefined ? {} : input, groupId: "group" };
  context.tools.tool = tool;
  context.toolGroups.group = { id: "group", el: groupEl, toolNames: [name], toolCount: 1, doneCount: 0,
    errorCount: 0, toolIds: ["tool"], toolRecords: { tool: tool } };
  groupEl.querySelector(".tool-group-items").appendChild(item);
  messages.appendChild(groupEl);
  context.applyClayToolItem(tool);
  if (preview !== false) {
    context.showDeferredHistoryToolResult(Object.assign({ id: "tool", _historyIndex: 1, content: "short preview" }, preview));
  }
  return { context: context, item: item, sent: sent, groupEl: groupEl, openedFiles: openedFiles };
}

test("Enter and Space reveal deferred Clay evidence and restore its canonical outcome", function () {
  [
    { key: "Enter", content: { body: "x".repeat(20000) }, phase: "done", label: "Project log read" },
    { key: " ", content: { error: "failed", body: "x".repeat(20000) }, phase: "error", label: "Project log failed" },
    { key: "Enter", content: { status: "pending", body: "x".repeat(20000) }, phase: "pending", label: "Project log pending" },
  ].forEach(function (example) {
    var fixture = transcriptFixture("read_log");
    var header = fixture.item.querySelector(".tool-header");
    assert.deepEqual(fixture.sent, []);
    header.listeners.keydown[0]({ key: example.key, preventDefault: function () {} });
    assert.equal(header.getAttribute("aria-expanded"), "true");
    assert.equal(fixture.sent.length, 1);
    var content = JSON.stringify(example.content);
    var reply = Object.assign({}, fixture.sent[0], { detail: { content: content, images: [] } });
    // Historical cards still resolve after the live tool registry is cleared.
    fixture.context.tools = {};
    fixture.context.toolGroups = {};
    fixture.context.deliverDeferredHistoryToolResult(reply);
    assert.equal(fixture.item.dataset.activityPhase, example.phase);
    assert.equal(fixture.groupEl.dataset.activityPhase, example.phase);
    assert.equal(fixture.item.querySelector(".tool-name").textContent, example.label);
    var evidence = fixture.item.querySelector(".clay-tool-evidence");
    assert.ok(evidence.querySelectorAll("pre").some(function (pre) { return pre.textContent === content; }));
    assert.equal(evidence.querySelector("button"), null);
  });
});

test("Space loads a generic historical tool result and displays its image", function () {
  var fixture = transcriptFixture("Read");
  var header = fixture.item.querySelector(".tool-header");
  header.listeners.keydown[0]({ key: " ", preventDefault: function () {} });
  assert.equal(header.getAttribute("aria-expanded"), "true");
  assert.equal(fixture.sent.length, 1);
  var reply = Object.assign({}, fixture.sent[0], { detail: {
    content: "full output", images: [{ mediaType: "image/png", data: "aGVsbG8=" }],
  } });
  fixture.context.deliverDeferredHistoryToolResult(reply);
  assert.equal(fixture.item.querySelector("pre").textContent, "full output");
  assert.equal(fixture.item.querySelector("img").src, "data:image/png;base64,aGVsbG8=");
});

test("a deferred non-Clay result replaces the running subtitle before the details are loaded", function () {
  var name = "mcp__example__check";
  [true, false].forEach(function (isError) {
    var fixture = transcriptFixture(name, isError ? null : {}, { is_error: isError });
    var subtitle = fixture.item.querySelector(".tool-subtitle-text");
    var terminalText = isError ? name + " failed" : name;
    assert.equal(subtitle.textContent, terminalText);
    assert.deepEqual(fixture.sent, []);
    assert.equal(fixture.item.classList.contains("error"), isError);
    fixture.item.querySelector(".tool-header").click();
    fixture.context.deliverDeferredHistoryToolResult(Object.assign({}, fixture.sent[0], { detail: {
      content: "x".repeat(20000),
    } }));
    assert.equal(subtitle.textContent, terminalText);
  });
});

test("a late deferred preview updates an already-finished Clay group before details are fetched", function () {
  var fixture = transcriptFixture("read_log", {}, false);
  var context = fixture.context;
  var group = context.toolGroups.group;
  context.markAllToolsDone();
  assert.equal(group.doneCount, 1);
  assert.equal(group.errorCount, 0);
  var other = { el: context.createSessionToolItem("second", "read_log"), groupId: group.id, name: "read_log", input: {} };
  group.el.querySelector(".tool-group-items").appendChild(other.el);
  group.toolNames.push(other.name);
  group.toolIds.push("second");
  group.toolRecords.second = context.tools.second = other;
  group.toolCount++;
  context.applyClayToolItem(other);
  context.showDeferredHistoryToolResult({ id: "second", _historyIndex: 2 });
  assert.equal(group.el.dataset.activityPhase, "returned");
  context.showDeferredHistoryToolResult({ id: "tool", _historyIndex: 1, is_error: true });
  assert.deepEqual(fixture.sent, []);
  assert.equal(group.doneCount, 2);
  assert.equal(group.errorCount, 1);
  assert.equal(group.el.dataset.activityPhase, "error");
  assert.match(group.el.querySelector(".tool-group-label").textContent, /1 failed or cancelled/);

  fixture.item.querySelector(".tool-header").click();
  context.deliverDeferredHistoryToolResult(Object.assign({}, fixture.sent[0], { detail: { content: "Error: log failed" } }));
  assert.equal(group.doneCount, 2);
  assert.equal(group.errorCount, 1);
  assert.equal(group.el.dataset.activityPhase, "error");
});

test("an ordinary replayed tool still receives the error icon after early completion", function () {
  var fixture = transcriptFixture("mcp__example__check", {}, false);
  fixture.context.markAllToolsDone();
  fixture.context.showDeferredHistoryToolResult({ id: "tool", _historyIndex: 1, is_error: true });
  var group = fixture.context.toolGroups.group;
  assert.equal(group.doneCount, 1);
  assert.equal(group.errorCount, 1);
  assert.equal(fixture.item.classList.contains("error"), true);
  assert.ok(fixture.item.querySelector(".tool-status-icon").querySelector(".err-icon"));
});

test("a deferred Codex Edit keeps its complete diff, view toggle and historical file link", function () {
  var file = "src/example.js";
  var fixture = transcriptFixture("Edit", { file_path: file });
  var header = fixture.item.querySelector(".tool-header");
  assert.equal(fixture.item.querySelector(".edit-diff"), null);
  header.click();
  assert.equal(fixture.sent.length, 1);

  var unchanged = Array.from({ length: 180 }, function (_, index) { return " const line" + index + " = '" + "x".repeat(100) + "';"; });
  var patch = ["--- a/" + file, "+++ b/" + file, "@@ -1,181 +1,181 @@"].concat(
    unchanged, ["-const before = true;", "+const after = true;"]
  ).join("\n");
  assert.ok(Buffer.byteLength(patch) > 16 * 1024);
  fixture.context.tools = {};
  fixture.context.deliverDeferredHistoryToolResult(Object.assign({}, fixture.sent[0], { detail: { content: patch } }));
  var diff = fixture.item.querySelector(".edit-diff");
  assert.ok(diff.querySelector(".diff-unified"));
  assert.equal(diff.querySelector(".diff-row-add").querySelector(".diff-code").textContent, "const after = true;");

  var link = diff.querySelector(".edit-diff-path-link");
  assert.equal(link.textContent, file);
  link.click();
  assert.equal(fixture.openedFiles[0].file, file);
  assert.match(fixture.openedFiles[0].options.diff.newStr, /const after = true;$/);

  fixture.context.diffLines = function () { throw new Error("an existing patch must not be diffed again"); };
  var toggles = diff.querySelectorAll(".edit-diff-toggle");
  toggles[1].click();
  assert.ok(diff.querySelector(".diff-split-view"));
  assert.match(diff.querySelector(".diff-row-change").textContent, /const after = true;/);
  toggles[0].click();
  assert.ok(diff.querySelector(".diff-unified"));
  header.click();
  assert.equal(header.getAttribute("aria-expanded"), "false");
  header.click();
  assert.equal(fixture.sent.length, 1);
});
