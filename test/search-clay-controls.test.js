var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

function loadControls() {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/search-clay-controls.js"), "utf8");
  source = source.replace(/export function /g, "function ");
  return Function(source + "\nreturn { isExactSearchControlMessage: isExactSearchControlMessage, replaceSearchPermissions: replaceSearchPermissions, applySearchPermissionMessage: applySearchPermissionMessage, createSearchPermissionCard: createSearchPermissionCard };")();
}

function Element(tag) {
  this.tag = tag;
  this.children = [];
  this.listeners = {};
  this.attributes = {};
  this.className = "";
  this.textContent = "";
  this.disabled = false;
}
Element.prototype.appendChild = function (child) { this.children.push(child); return child; };
Element.prototype.setAttribute = function (name, value) { this.attributes[name] = value; };
Element.prototype.addEventListener = function (name, handler) { this.listeners[name] = handler; };

test("Ask Clay permission state restores only live requests and rejects stale chat events", function () {
  var controls = loadControls();
  var state = { requestId: "chat-a", mateId: "clay", sessionId: "session-a", permissions: [] };
  controls.replaceSearchPermissions(state, [{ permissionRequestId: "p1", toolName: "Edit", toolInput: { file_path: "/repo/a.js" } }]);
  assert.deepEqual(state.permissions.map(function (item) { return [item.permissionRequestId, item.status]; }), [["p1", "pending"]]);
  assert.equal(controls.applySearchPermissionMessage(state, { type: "home_mate_permission_request", requestId: "chat-a", mateId: "clay", sessionId: "session-b", permissionRequestId: "stale", toolName: "Bash" }), false);
  assert.equal(controls.applySearchPermissionMessage(state, { type: "home_mate_permission_request", requestId: "chat-a", mateId: "clay", permissionRequestId: "missing", toolName: "Bash" }), false);
  assert.equal(state.permissions.length, 1);
  assert.equal(controls.applySearchPermissionMessage(state, { type: "home_mate_permission_resolved", requestId: "chat-a", mateId: "clay", sessionId: "session-a", permissionRequestId: "p1", decision: "deny" }), true);
  assert.equal(state.permissions[0].status, "denied");
  controls.replaceSearchPermissions(state, []);
  assert.deepEqual(state.permissions, []);
});

test("Ask Clay accepts only the matching local-to-durable identity promotion", function () {
  var controls = loadControls();
  var state = { requestId: "chat-a", mateId: "clay", sessionId: "local:7" };
  assert.equal(controls.isExactSearchControlMessage(state, { type: "home_mate_session_identity", requestId: "chat-a", mateId: "clay", previousSessionId: "local:7", sessionId: "durable-7" }), true);
  assert.equal(controls.isExactSearchControlMessage(state, { type: "home_mate_session_identity", requestId: "chat-a", mateId: "clay", previousSessionId: "local:8", sessionId: "durable-7" }), false);
});

test("Ask Clay renders an accessible inline approve and deny control", function () {
  var controls = loadControls();
  var originalDocument = global.document;
  var decisions = [];
  global.document = { createElement: function (tag) { return new Element(tag); } };
  try {
    var card = controls.createSearchPermissionCard({ permissionRequestId: "p1", toolName: "Bash", toolInput: { command: "npm test" }, decisionReason: "", status: "pending" }, function (permission, decision) { decisions.push([permission.permissionRequestId, decision]); });
    assert.equal(card.attributes.role, "group");
    assert.equal(card.attributes["aria-label"], "Permission request for Bash");
    var actions = card.children[2];
    actions.children[0].listeners.click();
    actions.children[1].listeners.click();
    assert.deepEqual(decisions, [["p1", "deny"], ["p1", "allow"]]);
  } finally {
    global.document = originalDocument;
  }
});
