var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function installBrowserGlobals() {
  var prior = { document: global.document, window: global.window, requestAnimationFrame: global.requestAnimationFrame, marked: global.marked, mermaid: global.mermaid, DOMPurify: global.DOMPurify };
  global.document = {
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    getElementById: function () { return null; },
    createElement: function () { return { style: {}, classList: { add: function () {}, remove: function () {}, toggle: function () {} } }; },
    addEventListener: function () {},
    removeEventListener: function () {},
    activeElement: null,
    body: { classList: { add: function () {}, remove: function () {}, toggle: function () {} } },
  };
  global.window = {
    addEventListener: function () {},
    matchMedia: function () { return { matches: false }; },
  };
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  global.DOMPurify = { sanitize: function (value) { return value; } };
  return function () {
    global.document = prior.document;
    global.window = prior.window;
    global.requestAnimationFrame = prior.requestAnimationFrame;
    global.marked = prior.marked;
    global.mermaid = prior.mermaid;
    global.DOMPurify = prior.DOMPurify;
  };
}

test("Mate session creation is immediate, server-defaulted, deduplicated and project-bound", async function () {
  var restore = installBrowserGlobals();
  try {
    var base = path.join(__dirname, "../lib/public/modules/");
    var storeModule = await import(pathToFileURL(path.join(base, "store.js")).href);
    var wsRef = await import(pathToFileURL(path.join(base, "ws-ref.js")).href);
    var creation = await import(pathToFileURL(path.join(base, "session-create.js")).href);
    var sent = [];
    wsRef.setWs({ readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } });
    storeModule.createStore({
      connected: true,
      currentSlug: "mate-a",
      projectsHubList: [{ slug: "mate-a", isMate: true }],
      cachedMatesList: [{ id: "a", vendor: "codex", model: "saved-model" }],
      currentVendor: "claude",
      currentModel: "unrelated-current-session",
      sessionFolders: { folders: [{ id: "work", name: "Work" }], collapsed: {} },
    });

    assert.equal(creation.beginSessionCreate("work"), true);
    assert.equal(creation.beginSessionCreate("work"), false, "a second activation is ignored while pending");
    assert.equal(sent.length, 1);
    assert.deepEqual(Object.keys(sent[0]).sort(), ["folderId", "folderSlug", "forceNew", "mateDefaults", "requestId", "slug", "type"].sort());
    assert.equal(sent[0].type, "new_session");
    assert.equal(sent[0].mateDefaults, true);
    assert.equal(sent[0].folderId, "work");
    assert.equal(sent[0].folderSlug, "mate-a");
    assert.equal("vendor" in sent[0], false, "cached or current provider is never submitted");
    assert.equal("model" in sent[0], false, "cached or current model is never submitted");

    var firstRequest = sent[0].requestId;
    assert.equal(creation.handleNewSessionResult({ type: "new_session_result", requestId: firstRequest, ok: false, error: "Model unavailable" }), true);
    assert.equal(storeModule.store.get("sessionCreate").phase, "ready");
    assert.equal(storeModule.store.get("sessionCreate").error, "Model unavailable");
    assert.equal(creation.beginSessionCreate("work"), true, "an explicit server refusal can be retried");
    assert.equal(sent.length, 2);
    assert.notEqual(sent[1].requestId, firstRequest);

    var secondRequest = sent[1].requestId;
    storeModule.store.set({ currentSlug: "ordinary", projectsHubList: [{ slug: "ordinary", isMate: false }] });
    assert.equal(storeModule.store.get("sessionCreate"), null, "switching projects clears the pending Mate creation UI");
    assert.equal(creation.handleNewSessionResult({ type: "new_session_result", requestId: secondRequest, ok: true, sessionId: 88 }), false, "a late reply cannot mutate the new project");

    sent.length = 0;
    assert.equal(creation.beginSessionCreate("unfiled"), true);
    assert.equal(sent[0].type, "new_session_options_get", "ordinary projects retain the provider chooser path");
    assert.equal(sent.some(function (message) { return message.type === "new_session"; }), false);
  } finally {
    restore();
  }
});

test("offline Mate creation keeps a truthful retryable draft without sending", async function () {
  var restore = installBrowserGlobals();
  try {
    var base = path.join(__dirname, "../lib/public/modules/");
    var storeModule = await import(pathToFileURL(path.join(base, "store.js")).href);
    var wsRef = await import(pathToFileURL(path.join(base, "ws-ref.js")).href);
    var creation = await import(pathToFileURL(path.join(base, "session-create.js")).href);
    var sent = [];
    wsRef.setWs({ readyState: 0, send: function (raw) { sent.push(raw); } });
    storeModule.createStore({ connected: false, currentSlug: "mate-b", projectsHubList: [{ slug: "mate-b", isMate: true }], sessionFolders: { folders: [], collapsed: {} } });
    assert.equal(creation.beginSessionCreate("unfiled"), false);
    assert.equal(sent.length, 0);
    assert.equal(storeModule.store.get("sessionCreate").mode, "mate-direct");
    assert.equal(storeModule.store.get("sessionCreate").phase, "ready");
    assert.match(storeModule.store.get("sessionCreate").error, /Not connected/);
  } finally {
    restore();
  }
});
