var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

function loadFocusModule() {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/home-composer-focus.js"), "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

function fixture(options) {
  var opts = options || {};
  var listeners = {};
  var home = { classList: { contains: function (name) { return name === "hidden" && !!opts.hidden; } } };
  var ownerDocument = { activeElement: null, hidden: !!opts.documentHidden };
  var input = {
    disabled: !!opts.disabled,
    isConnected: opts.removed !== true,
    ownerDocument: ownerDocument,
    selectionStart: 3,
    selectionEnd: 3,
    focusCalls: [],
    closest: function () { return opts.removed ? null : home; },
    focus: function (focusOptions) {
      this.focusCalls.push(focusOptions);
      ownerDocument.activeElement = this;
    },
    addEventListener: function (type, handler) { listeners.input = listeners.input || {}; listeners.input[type] = handler; },
  };
  var button = {
    addEventListener: function (type, handler) { listeners.button = listeners.button || {}; listeners.button[type] = handler; },
  };
  return { input: input, button: button, ownerDocument: ownerDocument, listeners: listeners };
}

test("Enter submission keeps composer focus without a duplicate focus call", async function () {
  var focus = await loadFocusModule();
  var f = fixture();
  var submitted = 0;
  var prevented = 0;
  f.ownerDocument.activeElement = f.input;
  focus.bindHomeComposerSubmission(f.input, f.button, function () { submitted++; return true; });
  f.listeners.input.keydown({ key: "Enter", shiftKey: false, isComposing: false, preventDefault: function () { prevented++; } });
  assert.equal(submitted, 1);
  assert.equal(prevented, 1);
  assert.equal(f.ownerDocument.activeElement, f.input);
  assert.equal(f.input.focusCalls.length, 0);
  assert.equal(f.input.selectionStart, 3);
});

test("Send button restores composer focus once with preventScroll", async function () {
  var focus = await loadFocusModule();
  var f = fixture();
  var submitted = 0;
  f.ownerDocument.activeElement = f.button;
  focus.bindHomeComposerSubmission(f.input, f.button, function () { submitted++; return true; });
  f.listeners.button.click();
  assert.equal(submitted, 1);
  assert.equal(f.ownerDocument.activeElement, f.input);
  assert.deepEqual(f.input.focusCalls, [{ preventScroll: true }]);
});

test("rejected, unresolved, hidden, disabled, and removed submissions do not focus", async function () {
  var focus = await loadFocusModule();
  var rejected = fixture();
  focus.bindHomeComposerSubmission(rejected.input, rejected.button, function () { return false; });
  rejected.listeners.button.click();
  assert.equal(rejected.input.focusCalls.length, 0);

  var noModel = fixture({ disabled: true });
  focus.bindHomeComposerSubmission(noModel.input, noModel.button, function () { return false; });
  noModel.listeners.button.click();
  assert.equal(noModel.input.focusCalls.length, 0);

  var cases = [fixture({ hidden: true }), fixture({ documentHidden: true }), fixture({ disabled: true }), fixture({ removed: true })];
  for (var i = 0; i < cases.length; i++) {
    focus.bindHomeComposerSubmission(cases[i].input, cases[i].button, function () { return true; });
    cases[i].listeners.button.click();
    assert.equal(cases[i].input.focusCalls.length, 0);
  }
});

test("assistant completion cannot steal focus after the one-shot restore", async function () {
  var focus = await loadFocusModule();
  var f = fixture();
  var elsewhere = {};
  f.ownerDocument.activeElement = f.button;
  focus.bindHomeComposerSubmission(f.input, f.button, function () { return true; });
  f.listeners.button.click();
  f.ownerDocument.activeElement = elsewhere;
  await Promise.resolve();
  assert.equal(f.ownerDocument.activeElement, elsewhere);
  assert.equal(f.input.focusCalls.length, 1);
});

test("Home submit path reports acceptance only after send and keeps pending composer focusable", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
  assert.match(source, /if \(!mateId \|\| !text \|\| streaming \|\| hasPendingHomeDebateQuestion\(messages\) \|\| !hasCommittedSessionModel\(\)\) return false/);
  assert.match(source, /if \(!sendMessage\([\s\S]*\)\) return false/);
  assert.match(source, /renderHomeChat\(\);\s*return true/);
  assert.match(source, /bindHomeComposerSubmission\(inputEl, sendBtn, submitMessage\)/);
  assert.match(source, /inputEl\.disabled = !mateId \|\| awaitingQuestion \|\| !hasCommittedSessionModel\(\)/);
  assert.match(source, /if \(debateLaunching \|\| mateCreationActive \|\| !!debatePhase\) inputEl\.disabled = true/);
  assert.match(source, /sendBtn\.disabled = !mateId \|\| streaming \|\| awaitingQuestion \|\| !hasCommittedSessionModel\(\)/);
  assert.match(source, /if \(debateLaunching \|\| mateCreationActive \|\| !!debatePhase \|\| \(!inputEl\.value\.trim\(\) && !hasRecordedSpeechFor\(inputEl\)\)\) sendBtn\.disabled = true/);
  assert.match(source, /if \(requestRecordedSend\(inputEl, submitMessage\)\) return true/);
});
