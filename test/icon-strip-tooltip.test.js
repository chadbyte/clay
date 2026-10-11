var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function ClassList(element) { this.element = element; }
ClassList.prototype.values = function () { return this.element.className ? this.element.className.split(/\s+/).filter(Boolean) : []; };
ClassList.prototype.add = function (value) { var values = this.values(); if (values.indexOf(value) === -1) values.push(value); this.element.className = values.join(" "); };
ClassList.prototype.contains = function (value) { return this.values().indexOf(value) !== -1; };

function FakeElement(tag, documentRef) {
  this.tagName = String(tag).toUpperCase();
  this.ownerDocument = documentRef;
  this.children = [];
  this.parentNode = null;
  this.listeners = {};
  this.attributes = {};
  this.dataset = {};
  this.style = {};
  this.className = "";
  this.classList = new ClassList(this);
  this._textContent = "";
  this.offsetHeight = 28;
  this.offsetWidth = 120;
}
FakeElement.prototype.appendChild = function (child) { child.parentNode = this; this.children.push(child); return child; };
FakeElement.prototype.remove = function () { if (!this.parentNode) return; var index = this.parentNode.children.indexOf(this); if (index !== -1) this.parentNode.children.splice(index, 1); this.parentNode = null; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.getAttribute = function (name) { return this.attributes[name] === undefined ? null : this.attributes[name]; };
FakeElement.prototype.addEventListener = function (type, handler) { this.listeners[type] = this.listeners[type] || []; this.listeners[type].push(handler); };
FakeElement.prototype.emit = function (type, event) { var value = Object.assign({ type: type, target: this }, event || {}); var handlers = (this.listeners[type] || []).slice(); for (var i = 0; i < handlers.length; i++) handlers[i](value); };
FakeElement.prototype.getBoundingClientRect = function () { return { top: 20, left: 12, right: 60, bottom: 68, width: 48, height: 48 }; };
FakeElement.prototype.querySelector = function (selector) {
  var className = selector.charAt(0) === "." ? selector.substring(1) : "";
  var queue = this.children.slice();
  while (queue.length) {
    var node = queue.shift();
    if (className && node.classList.contains(className)) return node;
    queue = queue.concat(node.children);
  }
  return null;
};
Object.defineProperty(FakeElement.prototype, "isConnected", { get: function () { var node = this; while (node) { if (node === this.ownerDocument.body) return true; node = node.parentNode; } return false; } });
Object.defineProperty(FakeElement.prototype, "textContent", {
  get: function () { return this._textContent; },
  set: function (value) { this._textContent = String(value); this.children = []; },
});

function installDom() {
  var prior = { document: global.document, requestAnimationFrame: global.requestAnimationFrame, window: global.window };
  var documentRef = {};
  documentRef.createElement = function (tag) { return new FakeElement(tag, documentRef); };
  documentRef.body = new FakeElement("body", documentRef);
  global.document = documentRef;
  global.window = { innerWidth: 1024 };
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  return { document: documentRef, restore: function () { global.document = prior.document; global.requestAnimationFrame = prior.requestAnimationFrame; global.window = prior.window; } };
}

test("project and Mate rail tooltips alternate across hover and focus without parsing names", async function () {
  var dom = installDom();
  try {
    var modulePath = path.join(__dirname, "../lib/public/modules/icon-strip-tooltip.js");
    var tooltip = await import(pathToFileURL(modulePath).href);
    var project = dom.document.createElement("a");
    var mate = dom.document.createElement("button");
    mate.setAttribute("aria-label", "에코, 연구, Mate, working, 2 unread");
    dom.document.body.appendChild(project);
    dom.document.body.appendChild(mate);

    tooltip.bindIconTooltip(project, { text: "Studio, North", kind: "project" });
    tooltip.bindIconTooltip(mate, function () {
      return { text: "에코, 연구", kind: "mate", avatarUrl: "data:image/png;base64,mate" };
    });

    project.emit("mouseenter");
    var projectTip = dom.document.body.children[2];
    assert.equal(projectTip.dataset.tooltipKind, "project");
    assert.equal(projectTip.textContent, "Studio, North");
    assert.equal(projectTip.classList.contains("icon-strip-tooltip-mate"), false);

    mate.emit("focus");
    assert.equal(dom.document.body.children.length, 3, "the singleton replaces the project tooltip");
    var mateTip = dom.document.body.children[2];
    assert.equal(mateTip.dataset.tooltipKind, "mate");
    assert.equal(mateTip.classList.contains("icon-strip-tooltip-mate"), true);
    assert.equal(mateTip.querySelector(".icon-strip-tooltip-label").textContent, "에코, 연구");
    assert.equal(mateTip.querySelector(".icon-strip-tooltip-mate-avatar").src, "data:image/png;base64,mate");
    assert.equal(mate.getAttribute("aria-label"), "에코, 연구, Mate, working, 2 unread", "accessible status remains descriptive");

    tooltip.bindIconTooltip(mate, { text: "<img src=x onerror=bad>", kind: "mate", avatarUrl: "data:image/png;base64,new" });
    mate.emit("mouseenter");
    var safeTip = dom.document.body.children[2];
    var safeLabel = safeTip.querySelector(".icon-strip-tooltip-label");
    assert.equal(safeLabel.textContent, "<img src=x onerror=bad>");
    assert.equal(safeLabel.children.length, 0, "the visible name is text, not HTML");

    project.emit("focus");
    var restoredProject = dom.document.body.children[2];
    assert.equal(restoredProject.dataset.tooltipKind, "project");
    assert.equal(restoredProject.querySelector(".icon-strip-tooltip-mate-avatar"), null, "Mate styling and avatar do not leak to projects");
    project.emit("keydown", { key: "Escape" });
    assert.equal(dom.document.body.children.length, 2);
  } finally {
    dom.restore();
  }
});
