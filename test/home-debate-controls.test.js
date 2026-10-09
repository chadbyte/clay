var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var pathToFileURL = require("node:url").pathToFileURL;

function FakeElement(tag) {
  this.tagName = tag.toUpperCase();
  this.children = [];
  this.attributes = {};
  this.listeners = {};
  this.className = "";
  this.textContent = "";
  this.value = "";
  this.disabled = false;
  this.hidden = false;
  this.isConnected = true;
  this.focusCalls = [];
  var element = this;
  this.classList = {
    add: function () {
      for (var i = 0; i < arguments.length; i++) if ((" " + element.className + " ").indexOf(" " + arguments[i] + " ") === -1) element.className += (element.className ? " " : "") + arguments[i];
    },
  };
  Object.defineProperty(this, "innerHTML", {
    get: function () { return ""; },
    set: function () { element.children = []; },
  });
}
FakeElement.prototype.appendChild = function (child) { this.children.push(child); child.parentNode = this; return child; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.addEventListener = function (name, handler) { this.listeners[name] = handler; };
FakeElement.prototype.click = function () { if (this.listeners.click) this.listeners.click({ currentTarget: this }); };
FakeElement.prototype.focus = function (options) { this.focusCalls.push(options); };

function flatten(root) {
  var result = [root];
  for (var i = 0; i < root.children.length; i++) result = result.concat(flatten(root.children[i]));
  return result;
}

function findText(root, text) {
  return flatten(root).find(function (node) { return node.textContent === text; });
}

function fixtureDocument() {
  var elements = {
    "home-debate-controls-slot": new FakeElement("div"),
    "home-mate-chat-composer": new FakeElement("div"),
    "home-mate-chat-session-model": new FakeElement("div"),
  };
  var ordinaryInput = new FakeElement("textarea");
  var ordinarySend = new FakeElement("button");
  elements["home-mate-chat-composer"].appendChild(ordinaryInput);
  elements["home-mate-chat-composer"].appendChild(ordinarySend);
  return {
    elements: elements,
    ordinaryInput: ordinaryInput,
    ordinarySend: ordinarySend,
    document: {
      createElement: function (tag) { return new FakeElement(tag); },
      getElementById: function (id) { return elements[id] || null; },
    },
  };
}

function liveMessages(overrides) {
  var header = Object.assign({ role: "debate_header", phase: "live", topic: "Housing", round: 2, handRaised: false, interaction: null }, overrides || {});
  return [header, { role: "debate_turn", turnId: "turn-2", status: "active", mateName: "Panel", speakerRole: "Analyst", round: 2, text: "Opening", activity: "Speaking" }];
}

test("live Home debate replaces the ordinary composer and routes exact default controls", async function () {
  var originalDocument = global.document;
  var originalFrame = global.requestAnimationFrame;
  var fixture = fixtureDocument();
  var sent = [];
  global.document = fixture.document;
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  try {
    var storeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/store.js")).href);
    var wsModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/ws-ref.js")).href);
    var controls = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-controls.js")).href);
    storeModule.createStore({ homeChatMateId: "builtin:clay", homeChatSessionId: "cli-live" });
    wsModule.setWs({ readyState: 1, send: function (data) { sent.push(JSON.parse(data)); } });
    assert.equal(controls.renderHomeDebateControls([], "request-live"), false);
    assert.equal(fixture.elements["home-mate-chat-composer"].hidden, false);
    assert.equal(fixture.elements["home-mate-chat-session-model"].hidden, false);

    assert.equal(controls.renderHomeDebateControls(liveMessages(), "request-live"), true);
    var slot = fixture.elements["home-debate-controls-slot"];
    assert.equal(fixture.elements["home-mate-chat-composer"].hidden, true);
    assert.equal(fixture.ordinaryInput.parentNode.hidden, true);
    assert.equal(fixture.ordinarySend.parentNode.hidden, true);
    assert.equal(fixture.elements["home-mate-chat-session-model"].hidden, true);
    assert.equal(slot.hidden, false);
    assert.equal(slot.children[0].attributes.role, "toolbar");
    assert.equal(slot.children[0].attributes["aria-label"], "Live debate controls");
    assert.equal(findText(slot, "Panel is speaking").attributes["aria-live"], "polite");
    assert.equal(flatten(slot).filter(function (node) { return node.tagName === "I"; }).length, 3);

    var raise = findText(slot, "Raise hand");
    var stop = findText(slot, "Stop debate");
    raise.click();
    stop.click();
    assert.deepEqual(sent, [
      { type: "home_debate_control", action: "hand_raise", mateId: "builtin:clay", sessionId: "cli-live", requestId: "request-live", text: "", response: null },
      { type: "home_debate_control", action: "stop", mateId: "builtin:clay", sessionId: "cli-live", requestId: "request-live", text: "", response: null },
    ]);
    controls.renderHomeDebateControls(liveMessages({ stopping: true }), "request-live");
    assert.equal(findText(slot, "Stopping after Panel finishes").attributes["aria-live"], "polite");
    var cancel = findText(slot, "Cancel stop");
    assert.match(cancel.className, /home-debate-control-secondary/);
    cancel.click();
    assert.equal(sent[2].action, "cancel_stop");
    assert.equal(findText(slot, "Cancelling…").disabled, true);
    controls.renderHomeDebateControls(liveMessages({ stopping: false }), "request-live");
    assert.ok(findText(slot, "Stop debate"));
    controls.renderHomeDebateControls(liveMessages({ handRaised: true }), "request-live");
    assert.equal(findText(slot, "Hand raised").disabled, true);
    assert.equal(findText(slot, "Hand raised").attributes["aria-pressed"], "true");
  } finally {
    global.document = originalDocument;
    global.requestAnimationFrame = originalFrame;
  }
});

test("user-floor and conclude controls preserve IME, caret, focus, and occupy one stable slot", async function () {
  var originalDocument = global.document;
  var originalFrame = global.requestAnimationFrame;
  var fixture = fixtureDocument();
  var sent = [];
  global.document = fixture.document;
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  try {
    var storeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/store.js")).href);
    var wsModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/ws-ref.js")).href);
    var controls = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-controls.js")).href);
    storeModule.store.set({ homeChatMateId: "builtin:clay", homeChatSessionId: "local:31" });
    wsModule.setWs({ readyState: 1, send: function (data) { sent.push(JSON.parse(data)); } });
    var floorState = liveMessages({ interaction: "user_floor" });
    controls.renderHomeDebateControls(floorState, "floor-request");
    var slot = fixture.elements["home-debate-controls-slot"];
    var input = flatten(slot).find(function (node) { return node.tagName === "TEXTAREA"; });
    assert.deepEqual(input.focusCalls, [{ preventScroll: true }]);
    input.value = "한글 의견";
    input.selectionStart = 3;
    input.selectionEnd = 3;
    input.listeners.input();
    input.listeners.compositionstart();
    var prevented = 0;
    input.listeners.keydown({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 229, preventDefault: function () { prevented++; } });
    assert.equal(sent.length, 0);
    assert.equal(prevented, 0);
    controls.renderHomeDebateControls(floorState, "floor-request");
    var stableInput = flatten(slot).find(function (node) { return node.tagName === "TEXTAREA"; });
    assert.equal(stableInput, input);
    assert.equal(stableInput.value, "한글 의견");
    assert.equal(stableInput.selectionStart, 3);
    assert.equal(stableInput.focusCalls.length, 1);
    input.listeners.compositionend();
    input.listeners.keydown({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13, preventDefault: function () { prevented++; } });
    assert.equal(prevented, 1);
    assert.equal(sent[0].action, "user_floor");
    assert.equal(sent[0].text, "한글 의견");
    assert.equal(findText(slot, "Sending…").disabled, true);

    controls.renderHomeDebateControls(liveMessages(), "conclude-request");
    controls.renderHomeDebateControls(liveMessages({ interaction: "conclude" }), "conclude-request");
    var concludeInput = flatten(slot).find(function (node) { return node.tagName === "TEXTAREA"; });
    concludeInput.value = "Address implementation risk";
    findText(slot, "Continue").click();
    assert.equal(sent[1].action, "conclude");
    assert.equal(sent[1].response, "continue");
    assert.equal(sent[1].text, "Address implementation risk");

    controls.renderHomeDebateControls(liveMessages(), "end-request");
    controls.renderHomeDebateControls(liveMessages({ interaction: "conclude" }), "end-request");
    findText(slot, "End debate").click();
    assert.equal(sent[2].action, "conclude");
    assert.equal(sent[2].response, "end");
  } finally {
    global.document = originalDocument;
    global.requestAnimationFrame = originalFrame;
  }
});

test("terminal Home debate remains special and offers resume plus fresh debate actions", async function () {
  var originalDocument = global.document;
  var fixture = fixtureDocument();
  var starts = 0;
  var sent = [];
  global.document = fixture.document;
  try {
    var storeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/store.js")).href);
    var wsModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/ws-ref.js")).href);
    var controls = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-controls.js")).href);
    storeModule.store.set({ homeChatMateId: "builtin:clay", homeChatSessionId: "cli-ended" });
    wsModule.setWs({ readyState: 1, send: function (data) { sent.push(JSON.parse(data)); } });
    controls.renderHomeDebateControls([{ role: "debate_header", phase: "interrupted", reason: "interrupted" }], "terminal", function () { starts++; });
    var slot = fixture.elements["home-debate-controls-slot"];
    assert.equal(fixture.elements["home-mate-chat-composer"].hidden, true);
    assert.equal(fixture.elements["home-mate-chat-session-model"].hidden, true);
    assert.equal(flatten(slot).some(function (node) { return node.tagName === "TEXTAREA"; }), false);
    assert.equal(findText(slot, "Debate interrupted when Clay restarted").attributes.role, "status");
    findText(slot, "Resume debate").click();
    assert.deepEqual(sent[0], { type: "home_debate_control", action: "resume", mateId: "builtin:clay", sessionId: "cli-ended", requestId: "terminal", text: "", response: null });
    assert.equal(findText(slot, "Resuming…").disabled, true);
    controls.renderHomeDebateControls([{ role: "debate_header", phase: "ended", reason: "natural" }], "terminal-new", function () { starts++; });
    findText(slot, "New debate").click();
    assert.equal(starts, 1);
    controls.renderHomeDebateControls([], "normal");
    assert.equal(fixture.elements["home-mate-chat-composer"].hidden, false);
    assert.equal(fixture.elements["home-mate-chat-session-model"].hidden, false);
    assert.equal(slot.hidden, true);
  } finally {
    global.document = originalDocument;
  }
});

test("project chat restores debate live controls without a Home composer", function () {
  var root = path.join(__dirname, "..");
  var index = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var workspace = fs.readFileSync(path.join(root, "lib/public/modules/project-debate-workspace.js"), "utf8");
  var live = fs.readFileSync(path.join(root, "lib/public/modules/home-debate-live.js"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/home-debate-live.css"), "utf8");
  assert.doesNotMatch(index, /id="home-mate-chat-composer"|id="home-debate-controls-slot"/);
  assert.match(workspace, /home-debate-live\.js/);
  assert.match(workspace, /home-debate-planning\.js/);
  assert.match(workspace, /restore/);
  assert.doesNotMatch(live, /home-debate-live-controls|home-debate-live-interaction|Raise hand|End debate/);
  assert.match(css, /\.home-debate-control-surface[\s\S]*var\(--bg\)[\s\S]*var\(--border-subtle\)/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*var\(--safe-bottom/);
  assert.match(css, /home-debate-control-terminal \.home-debate-control-actions[\s\S]*margin-left:\s*auto/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*home-debate-control-dots/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|serif|linear-gradient/i);
});
