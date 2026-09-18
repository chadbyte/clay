var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

function Element(tag, document) {
  this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.parentElement = null;
  this.id = ""; this.className = ""; this.textContent = ""; this.listeners = {};
}
Element.prototype.appendChild = function (child) { child.parentElement = this; this.children.push(child); return child; };
Element.prototype.insertBefore = function (child, before) {
  child.parentElement = this;
  var index = this.children.indexOf(before);
  if (index === -1) this.children.push(child); else this.children.splice(index, 0, child);
  return child;
};
Element.prototype.remove = function () {
  if (!this.parentElement) return;
  var index = this.parentElement.children.indexOf(this);
  if (index !== -1) this.parentElement.children.splice(index, 1);
  this.parentElement = null;
};
Element.prototype.setAttribute = function (name, value) { this[name] = value; };
Element.prototype.addEventListener = function (name, handler) { this.listeners[name] = handler; };

function documentFixture() {
  var document = { root: null, createElement: function (tag) { return new Element(tag, document); },
    getElementById: function (id) {
      function find(node) {
        if (!node) return null;
        if (node.id === id) return node;
        for (var i = 0; i < node.children.length; i++) { var found = find(node.children[i]); if (found) return found; }
        return null;
      }
      return find(document.root);
    } };
  document.root = new Element("main", document);
  var messages = new Element("div", document); messages.id = "messages"; document.root.appendChild(messages);
  return document;
}

function loadModule() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/pair-result-status.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/export \{[^}]+\};\s*$/, "globalThis.pairResultApi = { clear: clearPairResultStatus, handle: handlePairResultStatus, render: renderPairResultStatus };");
  var state = { currentSlug: "project", activeSessionId: 1, myUserId: "owner", pairResultStatus: [] };
  var store = { get: function (key) { return state[key]; }, set: function (partial) { state = Object.assign({}, state, partial); } };
  var document = documentFixture(), socket = { readyState: 1, sent: [], send: function (value) { this.sent.push(JSON.parse(value)); } };
  var confirmation = null;
  var factory = new Function("store", "getWs", "showConfirm", "document", source + "\nreturn globalThis.pairResultApi;");
  var api = factory(store, function () { return socket; }, function (text, callback) { confirmation = callback; }, document);
  return { api: api, store: store, state: function () { return state; }, document: document,
    socket: function () { return socket; }, replaceSocket: function () { socket = { readyState: 1, sent: [], send: function (value) { this.sent.push(JSON.parse(value)); } }; },
    confirm: function () { var callback = confirmation; confirmation = null; if (callback) callback(); } };
}

function statusMessage() {
  return { sessionId: 1, items: [{ id: "opaque", state: "uncertain", message: "Delivery uncertain", response: "done",
    hasCompletedResult: true, canRetry: true, confirmDuplicate: true }] };
}

function retryButton(document) {
  var section = document.getElementById("pair-result-status");
  return section.children[0].children.find(function (child) { return child.tagName === "BUTTON"; });
}

test("production status renderer remounts without duplicate notices", function () {
  var f = loadModule();
  assert.equal(f.api.handle(statusMessage()), true);
  assert.equal(f.api.handle(statusMessage()), true);
  assert.equal(f.document.root.children.filter(function (child) { return child.id === "pair-result-status"; }).length, 1);
  f.api.clear();
  assert.equal(f.document.getElementById("pair-result-status"), null);
  f.api.handle(statusMessage());
  assert.ok(f.document.getElementById("pair-result-status"));
});

test("delayed retry confirmation rejects stale session, account, project, status, and socket", function () {
  var f = loadModule(), button;
  function open() { f.api.handle(statusMessage()); button = retryButton(f.document); button.listeners.click(); }
  open(); f.store.set({ activeSessionId: 2 }); f.confirm(); assert.equal(f.socket().sent.length, 0);
  f.store.set({ activeSessionId: 1 }); open(); f.store.set({ myUserId: "other" }); f.confirm(); assert.equal(f.socket().sent.length, 0);
  f.store.set({ myUserId: "owner" }); open(); f.store.set({ currentSlug: "other" }); f.confirm(); assert.equal(f.socket().sent.length, 0);
  f.store.set({ currentSlug: "project" }); open(); f.api.handle(statusMessage()); f.confirm(); assert.equal(f.socket().sent.length, 0);
  open(); var oldSocket = f.socket(); f.replaceSocket(); f.confirm(); assert.equal(oldSocket.sent.length, 0); assert.equal(f.socket().sent.length, 0);
  open(); f.confirm(); assert.equal(f.socket().sent.length, 1);
  assert.equal(f.socket().sent[0].sessionId, 1); assert.equal(f.socket().sent[0].projectSlug, "project");
});
