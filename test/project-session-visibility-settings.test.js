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

test("visibility settings edit the selected project, bind replies to its slug and correlate rollbacks", async function() {
  var select = element();
  var field = element();
  var hint = element();
  var ownerHint = element();
  var elements = {
    "ps-session-visibility-default": select,
    "ps-session-visibility-default-field": field,
    "ps-session-visibility-default-inherited-hint": hint,
    "ps-session-visibility-default-owner-hint": ownerHint,
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
  assert.equal(select.disabled, true, "held while the request for a is pending");
  select.value = "shared";
  select.listeners.change();
  assert.equal(sent.length, 1);
  settings.handleProjectSessionVisibilityDefault({ ok: true, slug: "a", requestId: sent[0].requestId, visibility: "private" });
  assert.equal(storeModule.store.get("projectSessionVisibilityState").active.slug, "b");
  assert.equal(storeModule.store.get("projectSessionVisibilityState").pending, null);
  assert.equal(select.disabled, false, "b is editable although the open workspace is a");
  assert.equal(select.value, "private", "a's reply never rewrites b");
  select.value = "shared";
  select.listeners.change();
  assert.equal(sent[1].slug, "b");
  assert.equal(sent[1].visibility, "shared");
  settings.handleProjectSessionVisibilityDefault({ ok: false, slug: "a", requestId: sent[1].requestId, error: "Wrong slug" });
  assert.equal(select.disabled, true, "a reply naming another slug does not settle b");
  settings.handleProjectSessionVisibilityDefault({ ok: true, slug: "b", requestId: sent[1].requestId, visibility: "shared" });
  assert.equal(select.value, "shared");
  assert.equal(select.disabled, false);
  settings.populateProjectSessionVisibilitySettings("a", { slug: "a", projectOwnerId: "owner", sessionVisibilityDefault: "shared" });
  storeModule.store.set({ currentSlug: "a" });
  assert.equal(select.disabled, false);
  select.value = "private";
  select.listeners.change();
  settings.handleProjectSessionVisibilityDefault({ ok: false, slug: "a", requestId: sent[2].requestId, error: "Rejected" });
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
  // Owner-only: a non-owner administrator sees the value read-only with the reason.
  storeModule.store.set({ myUserId: "admin", cachedAllUsers: [{ id: "admin", role: "admin" }], currentSlug: "a" });
  settings.populateProjectSessionVisibilitySettings("a", { slug: "a", projectOwnerId: "owner", sessionVisibilityDefault: "shared" });
  assert.equal(field.style.display, "");
  assert.equal(select.disabled, true);
  assert.equal(ownerHint.classList.hidden, false);
  var count = sent.length;
  select.value = "private";
  select.listeners.change();
  assert.equal(sent.length, count, "nothing is sent for a non-owner");
  assert.equal(select.value, "shared");
  settings.populateProjectSessionVisibilitySettings("a", { slug: "a", projectOwnerId: "admin", sessionVisibilityDefault: "shared" });
  assert.equal(select.disabled, false);
  assert.equal(ownerHint.classList.hidden, true);
  // A member without ownership or permission sees nothing; solo mode hides the field.
  storeModule.store.set({ myUserId: "member", cachedAllUsers: [{ id: "member", role: "member" }] });
  settings.populateProjectSessionVisibilitySettings("a", { slug: "a", projectOwnerId: "owner" });
  assert.equal(field.style.display, "none");
  storeModule.store.set({ myUserId: "owner", isMultiUserMode: false });
  settings.populateProjectSessionVisibilitySettings("a", { slug: "a", projectOwnerId: "owner" });
  assert.equal(field.style.display, "none");
});
