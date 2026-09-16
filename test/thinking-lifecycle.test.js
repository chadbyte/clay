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
  var tailPlacements = [];
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
  var factory = new Function("document", "store", "renderMarkdown", "escapeHtml", "iconHtml", "refreshIcons", "addToMessages", "keepActiveThinkingAtTail", "scrollToBottom",
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
    function () { tailPlacements.push(state.thinkingState && state.thinkingState.el); },
    function () { scrolls++; }
  );
  api.added = added;
  api.state = state;
  api.thinkingStates = thinkingStates;
  api.tailPlacements = tailPlacements;
  api.scrolls = function () { return scrolls; };
  return api;
}

function loadRuntime() {
  var state = { thinkingState: null, replayingHistory: false };
  var messages = {
    children: [],
    moves: 0,
    appendChild: function (el) {
      if (el.parentNode === this) this.moves++;
      this.removeChild(el);
      this.children.push(el);
      el.parentNode = this;
      return el;
    },
    insertBefore: function (el, before) {
      if (el.parentNode === this) this.moves++;
      this.removeChild(el);
      var index = before ? this.children.indexOf(before) : -1;
      if (index === -1) this.children.push(el);
      else this.children.splice(index, 0, el);
      el.parentNode = this;
      return el;
    },
    removeChild: function (el) {
      var index = this.children.indexOf(el);
      if (index !== -1) this.children.splice(index, 1);
    },
  };
  Object.defineProperty(messages, "lastElementChild", {
    get: function () { return this.children[this.children.length - 1] || null; },
  });
  function element(name) {
    var el = { name: name, parentNode: null };
    Object.defineProperty(el, "nextSibling", {
      get: function () {
        if (!this.parentNode) return null;
        var index = this.parentNode.children.indexOf(this);
        return this.parentNode.children[index + 1] || null;
      },
    });
    return el;
  }
  var body = source("lib/public/modules/chat-render-runtime.js").replace(/^export var /gm, "var ");
  var factory = new Function("store", "getMessagesEl", "document", body +
    "\nreturn { addToMessages: addToMessages, keepActiveThinkingAtTail: keepActiveThinkingAtTail, setActivityEl: setActivityEl, setPrependAnchor: setPrependAnchor };"
  );
  var api = factory({ get: function (key) { return state[key]; } }, function () { return messages; }, {});
  api.state = state;
  api.messages = messages;
  api.element = element;
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
  assert.deepEqual(api.tailPlacements, [el, el, el, el], "each live segment returns the retained entry to the tail");

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
  assert.deepEqual(api.tailPlacements, [], "replayed Thinking never requests a tail move");
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
  var thinkingStart = messages.slice(messages.indexOf('case "thinking_start":'), messages.indexOf('case "thinking_delta":'));
  assert.match(delta, /stopThinking\(\)/);
  assert.doesNotMatch(delta, /resetThinkingGroup/);
  assert.match(tool, /stopThinking\(\)/);
  assert.match(result, /finishThinkingTurn\(\)/);
  assert.match(done, /finishThinkingTurn\(\)/, "done also closes interrupted turns");
  assert.match(error, /finishThinkingTurn\(\)/);
  assert.match(thinkingStart, /setActivity\(null\)/, "live Thinking replaces the generic tail dots");
});

test("transcript insertion moves active Thinking and activity behind later work without moving completed history", function () {
  var api = loadRuntime();
  var thinking = api.element("thinking");
  var tool = api.element("tool");
  var activity = api.element("activity");
  api.messages.appendChild(thinking);
  api.state.thinkingState = { active: false, el: thinking };
  api.addToMessages(tool);
  assert.deepEqual(api.messages.children, [thinking, tool], "completed Thinking retains its chronological position");

  api.state.thinkingState = { active: true, el: thinking };
  api.setActivityEl(activity);
  api.addToMessages(activity);
  assert.deepEqual(api.messages.children, [tool, activity, thinking], "the live record is the tail after activity");
  var settledMoves = api.messages.moves;
  api.keepActiveThinkingAtTail();
  api.keepActiveThinkingAtTail();
  assert.equal(api.messages.moves, settledMoves, "an already-correct progress pair performs no DOM moves");

  var laterItem = api.element("later item");
  api.addToMessages(laterItem);
  assert.deepEqual(api.messages.children, [tool, laterItem, activity, thinking], "new work remains before the tail progress pair");

  api.setActivityEl(null);
  activity.parentNode = null;
  api.messages.removeChild(activity);
  var anotherItem = api.element("another item");
  api.addToMessages(anotherItem);
  assert.deepEqual(api.messages.children, [tool, laterItem, anotherItem, thinking], "live Thinking stays at the tail without activity");

  var replayAnchor = api.element("replay anchor");
  var replayed = api.element("replayed message");
  api.messages.appendChild(replayAnchor);
  api.setPrependAnchor(replayAnchor);
  api.addToMessages(replayed);
  assert.deepEqual(api.messages.children, [tool, laterItem, anotherItem, thinking, replayed, replayAnchor], "prepended history does not reorder the active DOM");
});

test("full history replay preserves active Thinking until history_done resumes it", function () {
  var api = loadRuntime();
  var thinking = api.element("thinking");
  var historicItem = api.element("historic item");
  api.messages.appendChild(thinking);
  api.state.thinkingState = { active: true, el: thinking };
  api.state.replayingHistory = true;
  api.addToMessages(historicItem);
  assert.deepEqual(api.messages.children, [thinking, historicItem], "full replay does not move live Thinking");

  api.state.replayingHistory = false;
  api.keepActiveThinkingAtTail();
  assert.deepEqual(api.messages.children, [historicItem, thinking], "post-replay resumption restores live Thinking to the tail");
});
