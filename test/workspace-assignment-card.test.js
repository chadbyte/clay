var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var pathToFileURL = require("node:url").pathToFileURL;
var homeEvents = require("../lib/server-home-chat-events");

function FakeElement(tag) {
  this.tagName = String(tag).toUpperCase();
  this.children = [];
  this.attributes = {};
  this.listeners = {};
  this.className = "";
  this.textContent = "";
  this.innerHTML = "";
  this.dataset = {};
  this.disabled = false;
  this.tabIndex = 0;
  this.style = {};
}

FakeElement.prototype.appendChild = function (child) { this.children.push(child); child.parentNode = this; return child; };
FakeElement.prototype.insertBefore = function (child, before) { var index = this.children.indexOf(before); if (index < 0) return this.appendChild(child); this.children.splice(index, 0, child); child.parentNode = this; return child; };
FakeElement.prototype.replaceChild = function (child, prior) { var index = this.children.indexOf(prior); if (index >= 0) this.children[index] = child; child.parentNode = this; return prior; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.removeAttribute = function (name) { delete this.attributes[name]; };
FakeElement.prototype.addEventListener = function (name, handler) { this.listeners[name] = handler; };
FakeElement.prototype.click = function () { if (this.listeners.click) this.listeners.click({ currentTarget: this }); };
FakeElement.prototype.focus = function (options) { this.focused = true; this.focusOptions = options; };
FakeElement.prototype.querySelector = function (selector) { return select(this, selector)[0] || null; };
FakeElement.prototype.querySelectorAll = function (selector) { return select(this, selector); };

function flatten(root) {
  var nodes = [root];
  for (var i = 0; i < root.children.length; i++) nodes = nodes.concat(flatten(root.children[i]));
  return nodes;
}

function select(root, selector) {
  var nodes = flatten(root).slice(1);
  if (selector === "button") return nodes.filter(function (node) { return node.tagName === "BUTTON"; });
  var className = selector.charAt(0) === "." ? selector.slice(1) : null;
  var role = selector.match(/^\[role="([^"]+)"\]$/);
  return nodes.filter(function (node) {
    if (className) return (" " + node.className + " ").indexOf(" " + className + " ") !== -1;
    return role ? node.attributes.role === role[1] : false;
  });
}

function assignment(status) {
  return {
    assignmentId: "assignment-1",
    status: status || "proposed",
    title: "Audit <script>bad()</script>",
    task: "Inspect <img src=x onerror=bad>",
    projectSlug: "target",
    projectTitle: "Target <b>Project</b>",
    sourceProjectSlug: "mate-clay",
    sourceSessionRef: "opaque-source-ref",
  };
}

function followUpAssignment(status) {
  return Object.assign(assignment(status), {
    delivery: "follow_up",
    targetSessionRef: "session:durable-target",
    targetSessionTitle: "Parser review",
  });
}

test("assignment card uses safe text, exact decisions, loading, errors, and resolved focus", async function () {
  var original = { document: global.document, window: global.window, localStorage: global.localStorage, lucide: global.lucide, marked: global.marked, mermaid: global.mermaid, DOMPurify: global.DOMPurify, requestAnimationFrame: global.requestAnimationFrame };
  var body = new FakeElement("body");
  body.classList = { contains: function () { return false; }, add: function () {}, remove: function () {} };
  global.document = { body: body, createElement: function (tag) { return new FakeElement(tag); }, getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} };
  global.window = { addEventListener: function () {}, matchMedia: function () { return { matches: false }; } };
  global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  global.lucide = { createIcons: function () {} };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  global.DOMPurify = { sanitize: function (value) { return value; } };
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  try {
    var wsRef = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/ws-ref.js")).href);
    var sent = [];
    wsRef.setWs({ readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } });
    var cardModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/workspace-assignment-card.js")).href);
    var first = cardModule.createWorkspaceAssignmentCard(assignment(), { home: true, context: { mateId: "mate-1", sessionId: "cli-1", requestId: "request-1" } });
    var nodes = flatten(first);
    assert.equal(first.attributes["aria-label"], "Project assignment: Audit <script>bad()</script>");
    assert.equal(nodes.some(function (node) { return node.textContent === "Inspect <img src=x onerror=bad>"; }), true);
    assert.equal(nodes.some(function (node) { return node.innerHTML.indexOf("onerror") !== -1 || node.innerHTML.indexOf("<script") !== -1; }), false);
    var approve = nodes.find(function (node) { return node.attributes["aria-label"] && node.attributes["aria-label"].indexOf("Approve new session") === 0; });
    approve.click();
    assert.equal(first.attributes["aria-busy"], "true");
    assert.equal(first.querySelectorAll("button").every(function (button) { return button.disabled; }), true);
    assert.deepEqual(sent[0], { type: "project_assignment_response", assignmentId: "assignment-1", action: "approve", surface: "home", sourceProjectSlug: "mate-clay", sourceSessionRef: "opaque-source-ref", mateId: "mate-1", sessionId: "cli-1", requestId: "request-1" });
    var running = cardModule.createWorkspaceAssignmentCard(assignment("running"), { home: true });
    assert.equal(running.querySelector('[role="status"]').focused, true);

    var second = cardModule.createWorkspaceAssignmentCard(assignment(), { home: false });
    var cancel = flatten(second).find(function (node) { return node.attributes["aria-label"] === "Cancel project assignment"; });
    cancel.click();
    assert.equal(sent[1].action, "cancel");
    assert.equal(sent[1].surface, "project");
    var failed = assignment();
    failed.error = "Target changed";
    var errorCard = cardModule.createWorkspaceAssignmentCard(failed, { home: false });
    assert.equal(errorCard.querySelector(".workspace-assignment-error").focused, true);
    var followUp = Object.assign(assignment(), { delivery: "follow_up", targetSessionTitle: "Parser audit" });
    var followUpCard = cardModule.createWorkspaceAssignmentCard(followUp, { home: false });
    assert.equal(flatten(followUpCard).some(function (node) { return node.textContent === "PROJECT FOLLOW-UP"; }), true);
    assert.equal(flatten(followUpCard).some(function (node) { return node.textContent === "Send instructions to “Parser audit” in Target <b>Project</b>"; }), true);
    var queued = Object.assign(followUpAssignment("queued"), { deliveryState: "queued" });
    var queuedCard = cardModule.createWorkspaceAssignmentCard(queued, { home: false });
    assert.equal(queuedCard.querySelectorAll("button").length, 1);
    assert.equal(queuedCard.querySelector("button").textContent, "Cancel queued update");
    assert.equal(flatten(queuedCard).some(function (node) { return node.textContent === "Approved. Waiting for the Driver to finish its current turn."; }), true);
    queuedCard.querySelector("button").click();
    assert.equal(sent[2].action, "cancel");
    assert.equal(sent[2].assignmentId, queued.assignmentId);
    var acceptedCard = cardModule.createWorkspaceAssignmentCard(Object.assign(followUpAssignment("running"), { deliveryState: "accepted" }), { home: false });
    assert.equal(flatten(acceptedCard).some(function (node) { return node.textContent === "Accepted by the Driver runtime. Completion is still pending."; }), true);
    assert.equal(acceptedCard.querySelectorAll("button").length, 0);
    var homeMessages = [{ role: "assignment", assignment: assignment("running") }];
    var updated = cardModule.applyHomeWorkspaceAssignment(homeMessages, { assignment: assignment("completed") });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].assignment.status, "completed");
    assert.equal(homeMessages[0].assignment.status, "running");
  } finally {
    global.document = original.document;
    global.window = original.window;
    global.localStorage = original.localStorage;
    global.lucide = original.lucide;
    global.marked = original.marked;
    global.mermaid = original.mermaid;
    global.DOMPurify = original.DOMPurify;
    global.requestAnimationFrame = original.requestAnimationFrame;
  }
});

test("Home assignment transcript restores one correlated card", function () {
  var proposal = assignment();
  var restored = homeEvents.historyToHomeChat([{ type: "project_assignment_proposal", assignment: proposal }, { type: "project_assignment_status", assignment: Object.assign({}, proposal, { status: "running" }) }], false);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].role, "assignment");
  assert.equal(restored[0].assignment.status, "running");
});

test("approval card clearly distinguishes an existing-session follow-up", async function () {
  var original = { document: global.document, window: global.window, lucide: global.lucide, requestAnimationFrame: global.requestAnimationFrame };
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  global.window = { addEventListener: function () {} };
  global.lucide = { createIcons: function () {} };
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  try {
    var cardModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/workspace-assignment-card.js")).href);
    var card = cardModule.createWorkspaceAssignmentCard(followUpAssignment(), { home: false });
    var nodes = flatten(card);
    assert.equal(card.dataset.delivery, "follow_up");
    assert.equal(card.attributes["aria-label"], "Project follow-up: Audit <script>bad()</script>");
    assert.equal(nodes.some(function (node) { return node.textContent === "PROJECT FOLLOW-UP"; }), true);
    assert.equal(nodes.some(function (node) { return node.textContent === "Send instructions to “Parser review” in Target <b>Project</b>"; }), true);
    assert.equal(nodes.some(function (node) { return node.attributes["aria-label"] === "Approve follow-up in Parser review"; }), true);
  } finally {
    global.document = original.document;
    global.window = original.window;
    global.lucide = original.lucide;
    global.requestAnimationFrame = original.requestAnimationFrame;
  }
});

test("Home routing is exact and ordinary project assignment events are not swallowed", async function () {
  var routing = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/workspace-assignment-routing.js")).href);
  assert.equal(routing.isHomeWorkspaceAssignmentMessage({ type: "home_project_assignment_status", mateId: "mate-1", requestId: "request-1" }), true);
  assert.equal(routing.isHomeWorkspaceAssignmentMessage({ type: "home_project_assignment_status", mateId: "mate-1" }), false);
  assert.equal(routing.isHomeWorkspaceAssignmentMessage({ type: "project_assignment_status", mateId: "mate-1", requestId: "request-1" }), false);
  var router = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-message-router.js"), "utf8");
  assert.match(router, /if \(handleHomeProtocolMessage\(msg\)\) return;\s*processAppMessage\(msg\);/);
  var project = fs.readFileSync(path.join(__dirname, "../lib/project.js"), "utf8");
  var server = fs.readFileSync(path.join(__dirname, "../lib/server.js"), "utf8");
  assert.match(project, /msg\.type === "project_assignment_response"[\s\S]*opts\.onDmMessage\(ws, msg, slug\)/);
  assert.match(server, /handleDmMessage\(ws, msg, routedProjectSlug\)[\s\S]*assignmentService\.handleMessage\(ws, msg, routedProjectSlug\)/);
});

test("assignment card CSS preserves accessible focus and responsive actions", function () {
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/workspace-assignment.css"), "utf8");
  assert.match(css, /workspace-assignment-action:focus-visible/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /workspace-assignment-action \{ flex: 1; \}/);
});
