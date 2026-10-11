var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function FakeElement(tag) {
  this.tagName = tag.toUpperCase();
  this.children = [];
  this.attributes = {};
  this.className = "";
  this.dataset = {};
  this.textContent = "";
  this.src = "";
  this.parentNode = null;
  var element = this;
  this.classList = {
    add: function () {
      for (var i = 0; i < arguments.length; i++) {
        if ((" " + element.className + " ").indexOf(" " + arguments[i] + " ") === -1) element.className += (element.className ? " " : "") + arguments[i];
      }
    },
  };
}

FakeElement.prototype.appendChild = function (child) {
  this.children.push(child);
  child.parentNode = this;
  return child;
};
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.querySelector = function (selector) {
  var all = this.querySelectorAll(selector);
  return all.length ? all[0] : null;
};
FakeElement.prototype.querySelectorAll = function (selector) {
  var result = [];
  var className = selector.charAt(0) === "." ? selector.slice(1) : null;
  var wantsMateId = selector === "[data-session-mate-id]";
  var nodes = flatten(this);
  for (var i = 1; i < nodes.length; i++) {
    if (className && (" " + nodes[i].className + " ").indexOf(" " + className + " ") !== -1) result.push(nodes[i]);
    if (wantsMateId && nodes[i].dataset.sessionMateId) result.push(nodes[i]);
  }
  return result;
};

function flatten(root) {
  var result = [root];
  for (var i = 0; i < root.children.length; i++) result = result.concat(flatten(root.children[i]));
  return result;
}

async function loadModules(initialState) {
  var root = path.join(__dirname, "..");
  var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
  storeModule.createStore(initialState || {});
  return {
    store: storeModule.store,
    identity: await import(pathToFileURL(path.join(root, "lib/public/modules/project-chat-identity.js")).href),
    bubbles: await import(pathToFileURL(path.join(root, "lib/public/modules/chat-bubble-renderer.js")).href),
  };
}

function installBrowserGlobals() {
  var prior = {
    document: global.document,
    window: global.window,
    marked: global.marked,
    mermaid: global.mermaid,
    DOMPurify: global.DOMPurify,
  };
  global.document = {
    body: new FakeElement("body"),
    activeElement: null,
    createElement: function (tag) { return new FakeElement(tag); },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
  };
  global.window = { addEventListener: function () {}, removeEventListener: function () {}, matchMedia: function () { return { matches: false, addEventListener: function () {} }; } };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  global.DOMPurify = { sanitize: function (value) { return value; } };
  return function () {
    global.document = prior.document;
    global.window = prior.window;
    global.marked = prior.marked;
    global.mermaid = prior.mermaid;
    global.DOMPurify = prior.DOMPurify;
  };
}

test("session-bound Mate identity renders safely and late profile data refreshes only headers", async function () {
  var restore = installBrowserGlobals();
  try {
    var loaded = await loadModules({
      activeSessionMateId: "mate-a",
      activeSessionMateName: "Fallback A",
      currentVendor: "codex",
      cachedMatesList: [],
    });
    var initial = loaded.identity.resolveProjectAssistantIdentity(loaded.store.snap(), "codex");
    assert.equal(initial.kind, "mate");
    assert.equal(initial.name, "Fallback A");
    assert.notEqual(initial.avatarUrl, "");

    var row = loaded.bubbles.createAssistantBubble({ avatarUrl: initial.avatarUrl, name: initial.name, time: "09:41" });
    var content = row.querySelector(".md-content");
    content.textContent = "Existing streamed response";
    var focused = new FakeElement("textarea");
    global.document.activeElement = focused;
    loaded.identity.applyProjectAssistantIdentity(row, initial);
    var root = new FakeElement("main");
    root.appendChild(row);

    loaded.store.set({ cachedMatesList: [{ id: "mate-a", profile: { displayName: "<img src=x onerror=bad>", avatarCustom: "data:mate-a" } }] });
    loaded.identity.refreshProjectAssistantIdentities(root);
    assert.equal(row.querySelector(".dm-bubble-name").textContent, "<img src=x onerror=bad>");
    assert.equal(row.querySelector(".dm-bubble-name").children.length, 0);
    assert.equal(row.querySelector(".dm-bubble-avatar").src, "data:mate-a");
    assert.equal(content.textContent, "Existing streamed response");
    assert.equal(global.document.activeElement, focused);
    assert.equal(row.querySelector(".dm-bubble-time").textContent, "09:41");
  } finally {
    restore();
  }
});

test("each rendered Mate row retains its owning identity across updates and switches", async function () {
  var restore = installBrowserGlobals();
  try {
    var loaded = await loadModules({ cachedMatesList: [
      { id: "mate-a", profile: { displayName: "A", avatarCustom: "data:a" } },
      { id: "mate-b", profile: { displayName: "B", avatarCustom: "data:b" } },
    ] });
    var root = new FakeElement("main");
    var identityA = loaded.identity.resolveProjectAssistantIdentity(Object.assign({}, loaded.store.snap(), { activeSessionMateId: "mate-a" }), "claude");
    var rowA = loaded.identity.applyProjectAssistantIdentity(loaded.bubbles.createAssistantBubble(identityA), identityA);
    var identityB = loaded.identity.resolveProjectAssistantIdentity(Object.assign({}, loaded.store.snap(), { activeSessionMateId: "mate-b" }), "codex");
    var rowB = loaded.identity.applyProjectAssistantIdentity(loaded.bubbles.createAssistantBubble(identityB), identityB);
    root.appendChild(rowA);
    root.appendChild(rowB);

    loaded.store.set({ cachedMatesList: [
      { id: "mate-a", profile: { displayName: "A updated", avatarCustom: "data:a2" } },
      { id: "mate-b", profile: { displayName: "B updated", avatarCustom: "data:b2" } },
    ] });
    loaded.identity.refreshProjectAssistantIdentities(root);
    assert.equal(rowA.querySelector(".dm-bubble-name").textContent, "A updated");
    assert.equal(rowA.querySelector(".dm-bubble-avatar").src, "data:a2");
    assert.equal(rowB.querySelector(".dm-bubble-name").textContent, "B updated");
    assert.equal(rowB.querySelector(".dm-bubble-avatar").src, "data:b2");
  } finally {
    restore();
  }
});

test("ordinary and Worker sessions keep provider identity even when Mate data is cached", async function () {
  var restore = installBrowserGlobals();
  try {
    var loaded = await loadModules({
      activeSessionMateId: null,
      currentSlug: "mate-a-worker-1",
      currentVendor: "codex",
      cachedMatesList: [{ id: "mate-a", profile: { displayName: "Wrong Mate", avatarCustom: "data:wrong" } }],
    });
    var identity = loaded.identity.resolveProjectAssistantIdentity(loaded.store.snap(), "codex");
    assert.equal(identity.kind, "provider");
    assert.equal(identity.name, "Codex");
    assert.notEqual(identity.avatarUrl, "data:wrong");
    var row = loaded.identity.applyProjectAssistantIdentity(loaded.bubbles.createAssistantBubble(identity), identity);
    assert.equal(row.dataset.sessionMateId, undefined);
  } finally {
    restore();
  }
});

test("live deltas and history replay share the session identity renderer and controller refresh", function () {
  var root = path.join(__dirname, "..");
  var rendering = fs.readFileSync(path.join(root, "lib/public/modules/app-rendering.js"), "utf8");
  var messages = fs.readFileSync(path.join(root, "lib/public/modules/app-messages.js"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project-connection.js"), "utf8");
  assert.match(rendering, /function ensureAssistantBlock\(\)[\s\S]*resolveProjectAssistantIdentity\(store\.snap\(\), vendor\)[\s\S]*applyProjectAssistantIdentity\(_el, identity\)/);
  assert.match(rendering, /function appendDelta\(text\) \{\s*ensureAssistantBlock\(\);[\s\S]*if \(store\.get\('replayingHistory'\)\)/);
  assert.match(messages, /case "session_switched":[\s\S]*_sessionRole === "worker" \? null : \(store\.get\('activeProjectMateId'\) \|\| null\)/);
  assert.match(messages, /case "mate_updated":[\s\S]*refreshProjectAssistantIdentities\(messagesEl\)/);
  assert.match(messages, /case "mate_list":[\s\S]*refreshProjectAssistantIdentities\(messagesEl\)/);
  assert.match(project, /isMate: isMate, mateId: isMate \? mateId : null, mateDisplayName:/);
});

test("server session identity marks split Workers independently of the Mate project", function () {
  var root = path.join(__dirname, "..");
  var connection = require(path.join(root, "lib/project-connection.js"));
  var permission = { requestedPermissionMode: "default", effectivePermissionMode: "default", permissionCapabilities: {}, mcpPermissionModeOverrides: {} };
  var driver = connection.buildRestoredSessionMessage({ localId: 1, history: [] }, null, {}, permission);
  var worker = connection.buildRestoredSessionMessage({ localId: 2, history: [], sessionProvenance: { kind: "worker" } }, null, {}, permission);
  assert.equal(driver.sessionRole, "driver");
  assert.equal(worker.sessionRole, "worker");
});
