var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(root, file), "utf8")
    .replace(/^import .*;$/gm, "")
    .replace(/^export function/gm, "function");
}

function classListFor(classes) {
  return {
    add: function () {
      for (var i = 0; i < arguments.length; i++) classes[arguments[i]] = true;
    },
    remove: function () {
      for (var i = 0; i < arguments.length; i++) delete classes[arguments[i]];
    },
    contains: function (name) { return !!classes[name]; },
    toggle: function (name, force) {
      var enabled = arguments.length > 1 ? !!force : !classes[name];
      if (enabled) classes[name] = true;
      else delete classes[name];
      return enabled;
    },
  };
}

function childElement() {
  var classes = {};
  return {
    classList: classListFor(classes),
    attributes: {},
    style: {},
    tabIndex: -1,
    textContent: "",
    innerHTML: "",
    listeners: {},
    setAttribute: function (name, value) { this.attributes[name] = String(value); },
    getAttribute: function (name) { return this.attributes[name] || null; },
    removeAttribute: function (name) { delete this.attributes[name]; },
    addEventListener: function (name, listener) { this.listeners[name] = listener; },
  };
}

function thinkingElement() {
  var classes = {};
  var nodes = {};
  var el = {
    classList: classListFor(classes),
    hidden: false,
    nodes: nodes,
    querySelector: function (selector) { return nodes[selector.slice(1)] || null; },
  };
  Object.defineProperty(el, "className", {
    set: function (value) {
      var names = value.split(/\s+/);
      for (var i = 0; i < names.length; i++) if (names[i]) classes[names[i]] = true;
    },
  });
  Object.defineProperty(el, "innerHTML", {
    set: function (value) {
      var names = ["thinking-header", "thinking-chevron", "thinking-label", "thinking-duration", "thinking-spinner", "thinking-content"];
      if (value.indexOf("mate-thinking-activity") !== -1) names.push("mate-thinking-activity");
      for (var i = 0; i < names.length; i++) if (!nodes[names[i]]) nodes[names[i]] = childElement();
    },
  });
  return el;
}

function load(initialState) {
  var state = Object.assign({ replayingHistory: false, dmMode: false, dmTargetUser: null, thinkingState: null }, initialState || {});
  var added = [];
  var thinkingStates = [];
  var scrolls = 0;
  var document = {
    body: { dataset: { mateAvatarUrl: "/avatar.png" } },
    createElement: function () { return thinkingElement(); },
  };
  var store = {
    get: function (key) { return state[key]; },
    set: function (patch) {
      Object.assign(state, patch);
      if (Object.prototype.hasOwnProperty.call(patch, "thinkingState")) thinkingStates.push(patch.thinkingState);
    },
  };
  var body = source("lib/public/modules/thinking-summary.js") + "\n" +
    source("lib/public/modules/thinking-view.js") + "\n" +
    source("lib/public/modules/thinking-lifecycle.js") + "\n";
  var factory = new Function("document", "store", "renderMarkdown", "escapeHtml", "iconHtml", "refreshIcons", "addToMessages", "scrollToBottom",
    body + "\nreturn { startThinkingSegment: startThinkingSegment, appendThinkingText: appendThinkingText," +
      " stopThinkingSegment: stopThinkingSegment, finishThinkingTurn: finishThinkingTurn," +
      " resetThinkingTurn: resetThinkingTurn, clearThinkingState: clearThinkingState," +
      " resumeThinkingAfterReplay: resumeThinkingAfterReplay };"
  );
  var api = factory(
    document,
    store,
    function (text) { return "rendered:" + text; },
    function (text) { return text; },
    function (name) { return "[" + name + "]"; },
    function () {},
    function (el) { added.push(el); },
    function () { scrolls++; }
  );
  api.added = added;
  api.state = state;
  api.thinkingStates = thinkingStates;
  api.scrolls = function () { return scrolls; };
  return api;
}

test("one live entry spans reasoning separated by tools and commentary", function () {
  var api = load();
  var el = api.startThinkingSegment();
  assert.equal(api.state.thinkingState.el, el, "turn state lives in the shared store");
  var startedState = api.state.thinkingState;
  api.appendThinkingText("Inspecting the handler.");
  assert.notEqual(api.state.thinkingState, startedState, "stream updates are shallow-observable store writes");
  assert.equal(el.classList.contains("thinking-live"), true);
  assert.equal(el.nodes["thinking-label"].textContent, "Inspecting the handler.");
  api.stopThinkingSegment(1.25);

  // Tool and assistant-commentary events pause thinking but do not reset its turn.
  assert.equal(api.startThinkingSegment(), el);
  api.appendThinkingText("Verifying the recovery path.");
  api.stopThinkingSegment(2.5);
  api.finishThinkingTurn();

  assert.equal(api.added.length, 1);
  assert.equal(el.nodes["thinking-label"].textContent, "Verifying the recovery path.");
  assert.equal(el.nodes["thinking-content"].innerHTML,
    "rendered:Inspecting the handler.\n\nVerifying the recovery path.");
  assert.equal(el.nodes["thinking-duration"].textContent, " 3.8s");
  assert.equal(el.classList.contains("thinking-live"), false);
  assert.equal(el.classList.contains("expanded"), false);
  assert.equal(el.nodes["thinking-header"].getAttribute("aria-disabled"), "false");
  assert.equal(el.nodes["thinking-header"].getAttribute("aria-expanded"), "false");
  assert.equal(el.nodes["thinking-header"].tabIndex, 0);

  el.nodes["thinking-header"].listeners.click();
  assert.equal(el.classList.contains("expanded"), true);
  assert.equal(el.nodes["thinking-header"].getAttribute("aria-expanded"), "true");
});

test("completion and error boundaries collapse retained details", function () {
  var completion = load();
  var completedEl = completion.startThinkingSegment();
  completion.appendThinkingText("Completing normally.");
  completion.finishThinkingTurn();
  assert.equal(completedEl.hidden, false);
  assert.equal(completedEl.classList.contains("done"), true);
  assert.equal(completedEl.classList.contains("thinking-live"), false);

  var error = load();
  var errorEl = error.startThinkingSegment();
  error.appendThinkingText("Checking the failing request.");
  error.finishThinkingTurn();
  assert.equal(errorEl.nodes["thinking-content"].innerHTML, "rendered:Checking the failing request.");
  assert.equal(errorEl.nodes["thinking-header"].getAttribute("aria-expanded"), "false");
});

test("history never shimmers and the next user turn starts a fresh entry", function () {
  var api = load({ replayingHistory: true });
  var replayEl = api.startThinkingSegment();
  api.appendThinkingText("Restored reasoning.");
  assert.equal(replayEl.classList.contains("thinking-live"), false);
  api.stopThinkingSegment(1);
  api.finishThinkingTurn();

  api.resetThinkingTurn();
  api.state.replayingHistory = false;
  var liveEl = api.startThinkingSegment();
  api.appendThinkingText("New turn reasoning.");
  assert.notEqual(liveEl, replayEl);
  assert.equal(api.added.length, 2);
  assert.equal(liveEl.classList.contains("thinking-live"), true);
  assert.equal(liveEl.nodes["thinking-content"].innerHTML, "rendered:New turn reasoning.");
});

test("session reset drops live state and completed empty entries stay hidden", function () {
  var api = load();
  var abandoned = api.startThinkingSegment();
  api.appendThinkingText("Old session reasoning.");
  api.clearThinkingState();
  assert.equal(api.state.thinkingState, null);
  api.appendThinkingText("must be ignored");
  var replacement = api.startThinkingSegment();
  assert.notEqual(replacement, abandoned);

  api.stopThinkingSegment(0.5);
  api.finishThinkingTurn();
  assert.equal(replacement.hidden, true);
  assert.equal(replacement.nodes["thinking-header"].getAttribute("aria-disabled"), "true");
  assert.equal(replacement.nodes["thinking-content"].innerHTML, "");
});

test("Mate thinking keeps its live activity and one retained details entry", function () {
  var api = load({ dmMode: true, dmTargetUser: { isMate: true, displayName: "Clay" } });
  var el = api.startThinkingSegment();
  assert.equal(el.classList.contains("mate-thinking"), true);
  assert.equal(el.classList.contains("thinking-live"), false);
  assert.equal(el.nodes["mate-thinking-activity"].style.display, "");
  assert.equal(el.nodes["thinking-header"].style.display, "none");
  api.appendThinkingText("Considering the answer.");
  assert.equal(el.nodes["mate-thinking-activity"].style.display, "", "streamed content keeps live activity visible");
  assert.equal(el.nodes["thinking-header"].style.display, "none", "collapsed details wait until thinking stops");
  api.stopThinkingSegment(1);
  api.finishThinkingTurn();
  assert.equal(api.added.length, 1);
  assert.equal(el.nodes["mate-thinking-activity"].style.display, "none");
  assert.equal(el.nodes["thinking-header"].style.display, "");
  assert.equal(el.nodes["thinking-content"].innerHTML, "rendered:Considering the answer.");
});

test("message routing pauses segments and ends the turn at terminal events", function () {
  var messages = source("lib/public/modules/app-messages.js");
  var delta = messages.slice(messages.indexOf('case "delta":'), messages.indexOf('case "tool_start":'));
  var tool = messages.slice(messages.indexOf('case "tool_start":'), messages.indexOf('case "tool_executing":'));
  var result = messages.slice(messages.indexOf('case "result":'), messages.indexOf('case "done":'));
  var done = messages.slice(messages.indexOf('case "done":'), messages.indexOf('case "stderr":'));
  var error = messages.slice(messages.indexOf('case "error":'), messages.indexOf('case "system_info":'));
  assert.match(delta, /stopThinking\(\)/);
  assert.doesNotMatch(delta, /resetThinkingGroup/);
  assert.match(tool, /stopThinking\(\)/);
  assert.match(result, /finishThinkingTurn\(\)/);
  assert.match(done, /finishThinkingTurn\(\)/, "done also closes interrupted turns");
  assert.match(error, /finishThinkingTurn\(\)/);
});
