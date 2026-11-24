// A tool call that has produced a result must not keep the present-progressive
// sublabel it had while running.
//
// updateToolResult re-renders the sublabel from the now-complete input, which
// is right (streaming can have built it from a partial one), but it used
// toolActivityText — written for a call in flight. A failed custom tool
// therefore rendered "Running send_to_partner..." next to its own error output.
// Still-running calls must keep the running label, so the terminal form is only
// ever used where a result exists.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var source = fs.readFileSync(path.join(root, "lib/public/modules/tools.js"), "utf8");

// toolActivityText, toolTerminalText and shortPath are self-contained, so they
// are evaluated directly rather than asserted against their own source text.
function loadLabels() {
  var start = source.indexOf("export function toolActivityText(name, input)");
  var end = source.indexOf("\nfunction shortPath(p)");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  var body = source.slice(start, end).replace(/^export function/gm, "function");
  var shortPathStart = source.indexOf("function shortPath(p)");
  var shortPathEnd = source.indexOf("\n}", shortPathStart) + 2;
  body += "\n" + source.slice(shortPathStart, shortPathEnd);
  var factory = new Function(body +
    "\nreturn { toolActivityText: toolActivityText, toolTerminalText: toolTerminalText };");
  return factory();
}

var labels = loadLabels();

// --- The reported defect --------------------------------------------------

test("a failed custom tool call renders a terminal failure, not a running label", function () {
  var running = labels.toolActivityText("send_to_partner", { message: "do the thing" });
  assert.equal(running, "Running send_to_partner...", "the in-flight label, for reference");

  var terminal = labels.toolTerminalText("send_to_partner", { message: "do the thing" }, true);
  assert.equal(terminal, "send_to_partner failed");
  assert.equal(/Running|\.\.\./.test(terminal), false,
    "no present-progressive text and no ellipsis survives on a finished card");
});

test("every custom or MCP tool name fails legibly", function () {
  var names = ["send_to_partner", "replace_partner", "partner_status",
    "mcp__clay-sessions__send_to_partner", "respond_to_worker_permission", "some_unknown_tool"];
  for (var i = 0; i < names.length; i++) {
    var terminal = labels.toolTerminalText(names[i], {}, true);
    assert.equal(terminal, names[i] + " failed", names[i]);
    assert.equal(/Running/.test(terminal), false);
  }
});

test("a successful call drops the generic running text but keeps a real description", function () {
  // The generic fallback is the only misleading one once a result exists.
  assert.equal(labels.toolTerminalText("send_to_partner", { message: "x" }, false), "send_to_partner");
  assert.equal(labels.toolTerminalText("some_unknown_tool", {}, false), "some_unknown_tool");

  // A specific description still describes the call accurately, so it stays.
  assert.equal(labels.toolTerminalText("Read", { file_path: "/a/b/c/foo.js" }, false),
    labels.toolActivityText("Read", { file_path: "/a/b/c/foo.js" }));
  assert.match(labels.toolTerminalText("Read", { file_path: "/a/b/c/foo.js" }, false), /^Reading /);
  assert.match(labels.toolTerminalText("Edit", { file_path: "/a/b.js" }, false), /^Editing /);
  assert.match(labels.toolTerminalText("Bash", { description: "run the tests" }, false), /run the tests/);
});

test("an error wins over any specific description", function () {
  assert.equal(labels.toolTerminalText("Read", { file_path: "/a/b.js" }, true), "Read failed");
  assert.equal(labels.toolTerminalText("Bash", { description: "run the tests" }, true), "Bash failed");
  assert.equal(labels.toolTerminalText("Edit", { file_path: "/a/b.js" }, true), "Edit failed");
});

test("falsy and missing error flags are treated as success", function () {
  assert.equal(labels.toolTerminalText("send_to_partner", {}, false), "send_to_partner");
  assert.equal(labels.toolTerminalText("send_to_partner", {}, undefined), "send_to_partner");
  assert.equal(labels.toolTerminalText("send_to_partner", {}), "send_to_partner");
});

// --- Still-running calls are never relabelled ----------------------------

test("the terminal label is used only where a result has arrived", function () {
  // Start of a call: the running label, unchanged.
  var starting = source.slice(source.indexOf("ctx.setActivity(toolActivityText(name, input));"));
  starting = starting.slice(0, starting.indexOf("\n}") + 2);
  assert.match(starting, /toolActivityText\(name, input\)/,
    "an in-flight call keeps the present-progressive label");
  assert.equal(/toolTerminalText/.test(starting), false);

  // Result arrival: both live and historical results share the terminal label.
  var result = source.slice(source.indexOf("function updateToolResultSubtitle(tool, isError)"));
  result = result.slice(0, result.indexOf("\n}"));
  assert.match(result, /subtitleText\.textContent = toolTerminalText\(tool\.name, tool\.input, isError\);/);
  assert.equal(/toolActivityText/.test(result), false,
    "the running label is no longer re-asserted after completion");
  assert.match(source, /updateToolResultSubtitle\(tool, !!message\.is_error\);/);

  // Exactly one terminal call site, so nothing else can mask a live call.
  assert.equal((source.match(/toolTerminalText\(/g) || []).length, 2,
    "one definition-internal use plus the single call site");
});

test("the completed card still gets its error state and icon", function () {
  // The sublabel is the text half; markToolDone owns the class and icon, and
  // both are driven by the same isError the server sent.
  var done = source.slice(source.indexOf("export function markToolDone(id, isError)"));
  done = done.slice(0, done.indexOf("export function markAllToolsDone"));
  assert.match(done, /tool\.el\.classList\.add\("done"\);/);
  assert.match(done, /if \(isError\) tool\.el\.classList\.add\("error"\);/);
  assert.match(done, /alert-triangle/, "a failure gets the error icon");
  assert.match(source, /markToolDone\(id, isError\);/, "and updateToolResult finishes the card");
});

test("the error flag is plumbed intact from the server, so no normalization was needed", function () {
  // The renderer already receives the provider's own flag; the defect was
  // purely the client re-writing the sublabel after completion.
  var processor = fs.readFileSync(path.join(root, "lib/sdk-message-processor.js"), "utf8");
  assert.match(processor, /is_error: block\.is_error \|\| false,/,
    "the server forwards the provider's error flag");
  var messages = fs.readFileSync(path.join(root, "lib/public/modules/app-messages.js"), "utf8");
  assert.match(messages, /updateToolResult\(msg\.id, msg\.content \|\| "", msg\.is_error \|\| false, msg\.images\);/,
    "and the router passes it straight to the renderer");
});

test("client conventions hold", function () {
  var fn = source.slice(source.indexOf("export function toolTerminalText"));
  fn = fn.slice(0, fn.indexOf("\n}") + 2);
  assert.equal(/=>/.test(fn), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(fn), false, "var only");
  assert.equal(/localStorage|alert\(|confirm\(/.test(fn), false);
  assert.match(source, /export function toolTerminalText/, "ESM export");
});
