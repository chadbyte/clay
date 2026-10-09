var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function Element(tag) {
  this.tagName = tag.toUpperCase();
  this.children = [];
  this.innerHTML = "";
  this.listeners = {};
  var self = this;
  this.className = "";
  this.classList = {
    contains: function (name) { return (" " + self.className + " ").indexOf(" " + name + " ") !== -1; },
    add: function (name) { self.className += (self.className ? " " : "") + name; },
    remove: function () {},
  };
}
Element.prototype.appendChild = function (child) { this.children.push(child); return child; };
Element.prototype.addEventListener = function (name, fn) { this.listeners[name] = fn; };

test("mobile tools render Debates only for Mate workspaces and preserve Mate composition", async function () {
  var body = new Element("body");
  var priorDocument = global.document;
  var priorWindow = global.window;
  var priorMarked = global.marked;
  var priorPurify = global.DOMPurify;
  var priorMermaid = global.mermaid;
  global.document = {
    body: body,
    createElement: function (tag) { return new Element(tag); },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
  };
  global.window = { matchMedia: function () { return { matches: false }; } };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.DOMPurify = { sanitize: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  try {
    var root = path.join(__dirname, "..");
    var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
    var mobile = await import(pathToFileURL(path.join(root, "lib/public/modules/sidebar-mobile.js")).href);
    var list = new Element("div");
    storeModule.createStore({ currentSlug: "ordinary", activeProjectSlug: "ordinary", activeProjectMateId: null, projectsHubList: [], cachedMatesList: [], dmMode: false });
    mobile.renderSheetTools(list);
    assert.equal(list.children.length, 4);
    assert.equal(list.children.some(function (item) { return /Debates/.test(item.innerHTML); }), false);

    list = new Element("div");
    storeModule.store.set({ currentSlug: "mate-a", activeProjectSlug: "mate-a", activeProjectMateId: "mate-a" });
    mobile.renderSheetTools(list);
    assert.equal(list.children.length, 2);
    assert.match(list.children[0].innerHTML, /Knowledge/);
    assert.match(list.children[1].innerHTML, /Debates/);
    assert.equal(list.children.some(function (item) { return /Memory|MCP/.test(item.innerHTML); }), false);

    list = new Element("div");
    body.className = "mate-dm-active";
    storeModule.store.set({ currentSlug: "mate-a", activeProjectSlug: "mate-a", activeProjectMateId: "mate-a", dmMode: true });
    mobile.renderSheetTools(list);
    assert.equal(list.children.length, 2);
    assert.equal(list.children.filter(function (item) { return /Knowledge/.test(item.innerHTML); }).length, 1);
    assert.equal(list.children.filter(function (item) { return /Debates/.test(item.innerHTML); }).length, 1);

    list = new Element("div");
    storeModule.store.set({ currentSlug: "ordinary", activeProjectSlug: "ordinary", activeProjectMateId: null, dmMode: true });
    mobile.renderSheetTools(list);
    assert.equal(list.children.length, 5);
    assert.equal(list.children.filter(function (item) { return /Knowledge/.test(item.innerHTML); }).length, 1);
    assert.equal(list.children.filter(function (item) { return /Debates/.test(item.innerHTML); }).length, 1);
  } finally {
    global.document = priorDocument;
    global.window = priorWindow;
    global.marked = priorMarked;
    global.DOMPurify = priorPurify;
    global.mermaid = priorMermaid;
  }
});
