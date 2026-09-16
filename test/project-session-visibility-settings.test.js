var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function element() {
  return {
    value: "", disabled: false, style: {}, listeners: {},
    classList: { add: function(name) { this[name] = true; }, remove: function(name) { this[name] = false; }, toggle: function(name, enabled) { this[name] = enabled; } },
    remove: function() {},
    addEventListener: function(type, listener) { this.listeners[type] = listener; },
  };
}

test("visibility settings keep non-current projects read-only and correlate rollbacks", async function() {
  var select = element();
  var field = element();
  var hint = element();
  var nonCurrentHint = element();
  var elements = {
    "ps-session-visibility-default": select,
    "ps-session-visibility-default-field": field,
    "ps-session-visibility-default-inherited-hint": hint,
    "ps-session-visibility-default-non-current-hint": nonCurrentHint,
  };
  global.navigator = { userAgent: "", platform: "", maxTouchPoints: 0 };
  global.document = {
    getElementById: function(id) { return elements[id] || null; },
    createElement: function() { return element(); },
    body: { appendChild: function() {} },
  };
  global.requestAnimationFrame = function(callback) { callback(); };
  var root = path.join(__dirname, "../lib/public/modules");
  var storeModule = await import(pathToFileURL(path.join(root, "store.js")).href);
  var wsModule = await import(pathToFileURL(path.join(root, "ws-ref.js")).href);
  var settings = await import(pathToFileURL(path.join(root, "project-session-visibility-settings.js")).href + "?test=" + Date.now());
  storeModule.createStore({ connected: true, currentSlug: "a", isMultiUserMode: true, myUserId: "owner", cachedAllUsers: [{ id: "owner", role: "member" }], permissions: { projectSettings: true }, projectSessionVisibilityState: { active: null, pending: null } });
  var sent = [];
  wsModule.setWs({ readyState: 1, send: function(payload) { sent.push(JSON.parse(payload)); } });
  settings.initProjectSessionVisibilitySettings();
  settings.populateProjectSessionVisibilitySettings("a", { slug: "a", projectOwnerId: "owner", sessionVisibilityDefault: "shared" });
  select.value = "private";
  select.listeners.change();
  assert.equal(select.disabled, true);
  assert.equal(sent[0].slug, "a");
  settings.populateProjectSessionVisibilitySettings("b", { slug: "b", projectOwnerId: "owner", sessionVisibilityDefault: "private" });
  assert.equal(select.disabled, true);
  assert.equal(nonCurrentHint.classList.hidden, false);
  select.value = "shared";
  select.listeners.change();
  assert.equal(sent.length, 1);
  settings.handleProjectSessionVisibilityDefault({ ok: true, slug: "a", requestId: sent[0].requestId, visibility: "private" });
  assert.equal(select.value, "private");
  assert.equal(storeModule.store.get("projectSessionVisibilityState").active.slug, "b");
  assert.equal(storeModule.store.get("projectSessionVisibilityState").pending, null);
  assert.equal(select.disabled, true);
  storeModule.store.set({ currentSlug: "b" });
  assert.equal(select.disabled, false);
  assert.equal(nonCurrentHint.classList.hidden, true);
  settings.populateProjectSessionVisibilitySettings("a", { slug: "a", projectOwnerId: "owner", sessionVisibilityDefault: "shared" });
  assert.equal(select.disabled, true);
  storeModule.store.set({ currentSlug: "a" });
  assert.equal(select.disabled, false);
  select.value = "private";
  select.listeners.change();
  settings.handleProjectSessionVisibilityDefault({ ok: false, slug: "a", requestId: sent[1].requestId, error: "Rejected" });
  assert.equal(select.value, "shared");
  assert.equal(select.disabled, false);
  assert.equal(storeModule.store.get("projectSessionVisibilityState").pending, null);
  select.value = "private";
  select.listeners.change();
  storeModule.store.set({ connected: false });
  assert.equal(select.value, "shared");
  assert.equal(select.disabled, false);
  assert.equal(storeModule.store.get("projectSessionVisibilityState").pending, null);
  settings.refreshProjectSessionVisibilitySettings([{ slug: "a", projectOwnerId: "owner", sessionVisibilityDefault: "private" }]);
  assert.equal(select.value, "private");
  settings.populateProjectSessionVisibilitySettings("a--feature", { slug: "a--feature", projectOwnerId: "owner", sessionVisibilityDefault: "private", isWorktree: true });
  assert.equal(select.disabled, true);
  assert.equal(hint.classList.hidden, false);
});
