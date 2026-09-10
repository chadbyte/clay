var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function FakeElement(tag) {
  this.tagName = String(tag).toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.dataset = {};
  this.className = "";
  this.listeners = {};
  this.textContent = "";
  this.value = "";
  this.disabled = false;
  var self = this;
  this.classList = {
    add: function () { for (var i = 0; i < arguments.length; i++) if (!self.classList.contains(arguments[i])) self.className += (self.className ? " " : "") + arguments[i]; },
    remove: function (name) { self.className = self.className.split(" ").filter(function (item) { return item && item !== name; }).join(" "); },
    contains: function (name) { return (" " + self.className + " ").indexOf(" " + name + " ") !== -1; },
  };
}

FakeElement.prototype.appendChild = function (child) { child.parentNode = this; this.children.push(child); return child; };
FakeElement.prototype.insertBefore = function (child, before) { var i = this.children.indexOf(before); if (i < 0) return this.appendChild(child); child.parentNode = this; this.children.splice(i, 0, child); return child; };
FakeElement.prototype.addEventListener = function (name, fn) { this.listeners[name] = fn; };
FakeElement.prototype.click = function () { if (this.listeners.click) this.listeners.click({ currentTarget: this }); };
FakeElement.prototype.querySelectorAll = function (selector) {
  var result = [];
  function matches(node) {
    if (selector === ".ask-user-container") return node.classList.contains("ask-user-container");
    if (selector === ".ask-user-question") return node.classList.contains("ask-user-question");
    if (selector === ".ask-user-option") return node.classList.contains("ask-user-option");
    if (selector === ".ask-user-submit") return node.classList.contains("ask-user-submit");
    if (selector === ".ask-user-answer-summary") return node.classList.contains("ask-user-answer-summary");
    if (selector === ".ask-user-other input") return node.tagName === "INPUT" && node.parentNode && node.parentNode.classList.contains("ask-user-other");
    if (selector === ".option-label") return node.classList.contains("option-label");
    return false;
  }
  function visit(node) { if (matches(node)) result.push(node); for (var i = 0; i < node.children.length; i++) visit(node.children[i]); }
  visit(this);
  return result;
};
FakeElement.prototype.querySelector = function (selector) {
  if (selector === ".option-label" && this._innerHTML && !this.querySelectorAll(selector).length) {
    var label = new FakeElement("div"); label.className = "option-label"; this.appendChild(label);
  }
  return this.querySelectorAll(selector)[0] || null;
};
Object.defineProperty(FakeElement.prototype, "innerHTML", { get: function () { return this._innerHTML || ""; }, set: function (value) { this._innerHTML = String(value); } });

test("AskUserQuestion rendering is idempotent per session request and submits once", async function () {
  var originalDocument = global.document;
  var originalWindow = global.window;
  var originalLocalStorage = global.localStorage;
  var originalMarked = global.marked;
  var originalMermaid = global.mermaid;
  var originalPurifier = global.DOMPurify;
  var messages = new FakeElement("div");
  var secondMessages = new FakeElement("div");
  var input = new FakeElement("textarea");
  var sent = [];
  var context;
  global.document = {
    body: new FakeElement("body"),
    createElement: function (tag) { return new FakeElement(tag); },
    querySelectorAll: function (selector) { return messages.querySelectorAll(selector).concat(secondMessages.querySelectorAll(selector)); },
    getElementById: function () { return null; },
  };
  global.window = { addEventListener: function () {}, removeEventListener: function () {} };
  global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  global.DOMPurify = { sanitize: function (value) { return value; } };
  try {
    var storeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/store.js")).href);
    storeModule.createStore({ activeSessionId: 101, currentVendor: "claude" });
    var tools = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/tools.js")).href);
    context = {
      finalizeAssistantBlock: function () {}, stopUrgentBlink: function () {}, setActivity: function () {},
      addToMessages: function (el) { context.messagesEl.appendChild(el); }, scrollToBottom: function () {},
      isMateDm: function () { return false; }, inputEl: input, ws: { send: function (value) { sent.push(JSON.parse(value)); } }, connected: true,
      messagesEl: messages,
    };
    tools.initTools(context);
    tools.resetToolState();
    var question = { questions: [{ question: "Which outcome?", options: [{ label: "Ship" }, { label: "Wait" }] }] };
    tools.renderAskUserQuestion("ask-101", question);
    var first = messages.children[0];
    var freeform = first.querySelector(".ask-user-other input");
    freeform.value = "Keep the current plan";
    freeform.listeners.input();
    var reordered = { questions: [{ options: [{ label: "Ship" }, { label: "Wait" }], question: "Which outcome?" }] };
    tools.renderAskUserQuestion("ask-101", reordered);
    assert.strictEqual(messages.children[0], first);
    assert.equal(messages.querySelectorAll(".ask-user-container").length, 1);
    assert.equal(freeform.value, "Keep the current plan");
    first.querySelector(".ask-user-submit").click();
    first.querySelector(".ask-user-submit").click();
    assert.deepEqual(sent, [{ type: "ask_user_response", toolId: "ask-101", answers: { 0: "Keep the current plan" } }]);

    storeModule.store.set({ activeSessionId: 202 });
    context.messagesEl = secondMessages;
    tools.renderAskUserQuestion("ask-101", question);
    var next = secondMessages.children[0];
    assert.notStrictEqual(next, first);
    assert.equal(messages.querySelectorAll(".ask-user-container").length, 1);
    assert.equal(secondMessages.querySelectorAll(".ask-user-container").length, 1);
    tools.markAskUserAnswered("ask-101", { 0: "Wait" });
    tools.renderAskUserQuestion("ask-101", question);
    assert.equal(next.classList.contains("answered"), true);
    assert.equal(secondMessages.querySelectorAll(".ask-user-container").length, 1);

    storeModule.store.set({ activeSessionId: 303, askUserRequests: {} });
    context.messagesEl = new FakeElement("div");
    tools.renderAskUserQuestion("ask-101", question);
    tools.renderAskUserQuestion("ask-102", question);
    assert.equal(context.messagesEl.querySelectorAll(".ask-user-container").length, 2);
  } finally {
    global.document = originalDocument;
    global.window = originalWindow;
    global.localStorage = originalLocalStorage;
    global.marked = originalMarked;
    global.mermaid = originalMermaid;
    global.DOMPurify = originalPurifier;
  }
});
