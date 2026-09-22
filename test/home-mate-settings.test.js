var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function ClassList(element) { this.element = element; }
ClassList.prototype.values = function () { return this.element.className ? this.element.className.split(/\s+/).filter(Boolean) : []; };
ClassList.prototype.add = function (value) { var values = this.values(); if (values.indexOf(value) === -1) values.push(value); this.element.className = values.join(" "); };
ClassList.prototype.remove = function (value) { this.element.className = this.values().filter(function (item) { return item !== value; }).join(" "); };
ClassList.prototype.toggle = function (value, force) { if (force === true) this.add(value); else if (force === false) this.remove(value); else if (this.values().indexOf(value) === -1) this.add(value); else this.remove(value); };
ClassList.prototype.contains = function (value) { return this.values().indexOf(value) !== -1; };

function matches(node, selector) {
  if (selector === '[role="menuitem"]') return node.getAttribute("role") === "menuitem";
  if (selector === '[data-home-mate-settings-section]') return node.dataset.homeMateSettingsSection !== undefined;
  if (selector === '[data-home-mate-model]') return node.dataset.homeMateModel !== undefined;
  if (selector === '[data-home-mate-vendor]') return node.dataset.homeMateVendor !== undefined;
  if (selector === '[data-home-model-focus]') return node.dataset.homeModelFocus !== undefined;
  if (selector.indexOf(".home-mate-model-selection-status") !== -1) return node.classList.contains("home-mate-model-selection-status");
  if (selector.indexOf("button:not") === 0) return node.tagName === "BUTTON" && !node.disabled;
  if (selector === ".home-mate-settings-body") return node.classList.contains("home-mate-settings-body");
  if (selector === ".home-mate-settings-content-title") return node.classList.contains("home-mate-settings-content-title");
  if (selector === ".profile-popover") return node.classList.contains("profile-popover");
  if (selector === "#confirm-modal:not(.hidden)") return node.id === "confirm-modal" && !node.classList.contains("hidden");
  return false;
}

function FakeElement(tag, documentRef) {
  this.tagName = String(tag).toUpperCase();
  this.ownerDocument = documentRef;
  this.children = [];
  this.parentNode = null;
  this.listeners = Object.create(null);
  this.attributes = Object.create(null);
  this.dataset = Object.create(null);
  this.className = "";
  this.classList = new ClassList(this);
  this.style = {};
  this.id = "";
  this.disabled = false;
  this._textContent = "";
}
FakeElement.prototype.appendChild = function (child) { child.parentNode = this; this.children.push(child); return child; };
FakeElement.prototype.remove = function () { if (!this.parentNode) return; var index = this.parentNode.children.indexOf(this); if (index !== -1) this.parentNode.children.splice(index, 1); this.parentNode = null; };
FakeElement.prototype.addEventListener = function (type, handler) { this.listeners[type] = this.listeners[type] || []; this.listeners[type].push(handler); };
FakeElement.prototype.emit = function (type, event) { var value = event || {}; value.target = value.target || this; value.currentTarget = this; value.preventDefault = value.preventDefault || function () { value.defaultPrevented = true; }; value.stopPropagation = value.stopPropagation || function () { value.propagationStopped = true; }; var listeners = (this.listeners[type] || []).slice(); for (var i = 0; i < listeners.length; i++) listeners[i](value); return value; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); if (name === "id") this.id = String(value); };
FakeElement.prototype.getAttribute = function (name) { return this.attributes[name] === undefined ? null : this.attributes[name]; };
FakeElement.prototype.removeAttribute = function (name) { delete this.attributes[name]; };
FakeElement.prototype.contains = function (target) { if (target === this) return true; for (var i = 0; i < this.children.length; i++) if (this.children[i].contains(target)) return true; return false; };
FakeElement.prototype.focus = function (options) { this.ownerDocument.activeElement = this; this.focusOptions = options || null; };
FakeElement.prototype.getBoundingClientRect = function () { return { left: 20, right: 48, top: 20, bottom: 48, width: 160, height: 36 }; };
FakeElement.prototype.querySelectorAll = function (selector) { var selectors = selector.split(",").map(function (item) { return item.trim(); }); var result = []; function visit(node) { if (selectors.some(function (item) { return matches(node, item); })) result.push(node); for (var i = 0; i < node.children.length; i++) visit(node.children[i]); } visit(this); return result; };
FakeElement.prototype.querySelector = function (selector) { return this.querySelectorAll(selector)[0] || null; };
Object.defineProperty(FakeElement.prototype, "isConnected", { get: function () { var node = this; while (node) { if (node === this.ownerDocument.body) return true; node = node.parentNode; } return false; } });
Object.defineProperty(FakeElement.prototype, "innerHTML", { set: function (value) { this.children = []; this._textContent = ""; this._innerHTML = String(value); }, get: function () { return this._innerHTML || ""; } });
Object.defineProperty(FakeElement.prototype, "textContent", { set: function (value) { this._textContent = String(value); }, get: function () { return this._textContent; } });

test("profile editor stays above Mate settings while shared confirmation remains topmost", function () {
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/home-mate-settings.css"), "utf8");
  var overlay = css.match(/\.home-mate-settings-overlay \{[\s\S]*?z-index: (\d+)/);
  var profile = css.match(/body\.home-mate-settings-open \.profile-popover \{ z-index: (\d+); \}/);
  var confirm = css.match(/body\.home-mate-settings-open #confirm-modal \{ z-index: (\d+); \}/);
  assert.ok(overlay && profile && confirm);
  assert.ok(Number(overlay[1]) < Number(profile[1]));
  assert.ok(Number(profile[1]) < Number(confirm[1]));
});

test("per-row Mate menu targets its own Mate and dialog correlates read-only sections", async function () {
  var storageKey = "local" + "Storage";
  var originals = { document: global.document, window: global.window, requestAnimationFrame: global.requestAnimationFrame, CustomEvent: global.CustomEvent, lucide: global.lucide, storage: global[storageKey], marked: global.marked, mermaid: global.mermaid, purifier: global.DOMPurify };
  var documentListeners = Object.create(null);
  var continuationQueries = 0;
  var fakeDocument = { activeElement: null };
  fakeDocument.body = new FakeElement("body", fakeDocument);
  fakeDocument.createElement = function (tag) { return new FakeElement(tag, fakeDocument); };
  fakeDocument.addEventListener = function (type, handler) { documentListeners[type] = documentListeners[type] || []; documentListeners[type].push(handler); };
  fakeDocument.removeEventListener = function (type, handler) { documentListeners[type] = (documentListeners[type] || []).filter(function (item) { return item !== handler; }); };
  fakeDocument.emit = function (type, event) { var listeners = (documentListeners[type] || []).slice(); for (var i = 0; i < listeners.length; i++) listeners[i](event || {}); };
  fakeDocument.querySelector = function (selector) { return fakeDocument.body.querySelector(selector); };
  fakeDocument.querySelectorAll = function (selector) {
    if (selector === "[data-driver-continuation-key]") continuationQueries++;
    return fakeDocument.body.querySelectorAll(selector);
  };
  fakeDocument.getElementById = function (id) { var result = null; function visit(node) { if (node.id === id) result = node; for (var i = 0; !result && i < node.children.length; i++) visit(node.children[i]); } visit(fakeDocument.body); return result; };
  var windowListeners = Object.create(null);
  var narrow = false;
  global.document = fakeDocument;
  global.window = { innerWidth: 1000, innerHeight: 800, matchMedia: function () { return { matches: narrow }; }, addEventListener: function (type, handler) { windowListeners[type] = handler; }, removeEventListener: function (type) { delete windowListeners[type]; }, dispatchEvent: function () {} };
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  global.CustomEvent = function (type, options) { this.type = type; this.detail = options && options.detail; };
  global.lucide = { createIcons: function () {} };
  global[storageKey] = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  global.DOMPurify = { sanitize: function (value) { return value; } };
  try {
    var base = path.join(__dirname, "../lib/public/modules/");
    var settings = await import(pathToFileURL(path.join(base, "home-mate-settings.js")).href);
    var settingsMenu = await import(pathToFileURL(path.join(base, "home-mate-settings-menu.js")).href);
    var store = (await import(pathToFileURL(path.join(base, "store.js")).href)).store;
    var wsRef = await import(pathToFileURL(path.join(base, "ws-ref.js")).href);
    var mates = [
      { id: "active", name: "Active", primary: true },
      { id: "target", name: "Target", profile: { bio: "Target bio" } },
    ];
    store.set({ cachedMatesList: mates, homeChatMateId: "active", homeSidebarCollapsed: false });
    assert.strictEqual(continuationQueries, 0, "unrelated Mate state must not scan continuation cards");
    var sent = [];
    wsRef.setWs({ readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } });
    var hub = new FakeElement("div", fakeDocument); hub.id = "home-hub"; fakeDocument.body.appendChild(hub);
    var trigger = settingsMenu.createHomeMateSettingsTrigger(mates[1]);
    fakeDocument.body.appendChild(trigger);
    assert.match(trigger.innerHTML, /home-mate-list-overflow-mark/);
    assert.match(trigger.innerHTML, /aria-hidden="true">•••<\/span>/);
    assert.doesNotMatch(trigger.innerHTML, /data-lucide/);

    trigger.emit("click");
    assert.strictEqual(trigger.getAttribute("aria-haspopup"), "menu");
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "true");
    assert.strictEqual(store.get('homeChatMateId'), "active");
    var menu = fakeDocument.body.children[fakeDocument.body.children.length - 1];
    assert.strictEqual(menu.getAttribute("role"), "menu");
    assert.strictEqual(menu.children[0].getAttribute("role"), "menuitem");
    assert.strictEqual(fakeDocument.activeElement, menu.children[0]);
    menu.children[0].emit("click");
    assert.strictEqual(store.get('homeChatMateId'), "active");
    var overlay = fakeDocument.body.children[fakeDocument.body.children.length - 1];
    var panel = overlay.children[0];
    assert.strictEqual(panel.getAttribute("role"), "dialog");
    assert.strictEqual(panel.getAttribute("aria-modal"), "true");
    var nav = panel.children[1].children[0];
    assert.deepStrictEqual(nav.children.map(function (item) { return item.textContent; }), ["General", "Model", "Memory", "Knowledge"]);
    nav.children[2].emit("click");
    assert.strictEqual(sent[0].type, "home_mate_memory_list");
    assert.strictEqual(sent[0].mateId, "target");
    assert.ok(sent[0].requestId);
    assert.strictEqual(settings.handleHomeMateMemoryState({ mateId: "target", requestId: "stale", entries: [{ topic: "Wrong" }] }), false);
    assert.strictEqual(settings.handleHomeMateMemoryState({ mateId: "target", requestId: sent[0].requestId, summary: "Remember this", entries: [] }), true);
    nav.children[3].emit("click");
    assert.strictEqual(sent[1].type, "home_mate_knowledge_list");
    assert.notStrictEqual(sent[1].requestId, sent[0].requestId);
    assert.strictEqual(settings.handleHomeMateKnowledgeState({ mateId: "active", requestId: sent[1].requestId, files: ["wrong.md"] }), false);
    assert.strictEqual(settings.handleHomeMateKnowledgeState({ mateId: "target", requestId: sent[1].requestId, files: ["guide.md"] }), true);

    var focusable = overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable[focusable.length - 1].focus();
    fakeDocument.emit("keydown", { key: "Tab", shiftKey: false, preventDefault: function () { this.defaultPrevented = true; }, stopPropagation: function () {} });
    assert.strictEqual(fakeDocument.activeElement, focusable[0]);

    fakeDocument.emit("keydown", { key: "Escape", preventDefault: function () {}, stopPropagation: function () {} });
    assert.strictEqual(fakeDocument.body.classList.contains("home-mate-settings-open"), false);
    assert.strictEqual(fakeDocument.activeElement, trigger);

    trigger.emit("keydown", { key: "ArrowDown" });
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "true");
    fakeDocument.emit("pointerdown", { target: hub });
    assert.strictEqual(trigger.getAttribute("aria-expanded"), "false");
    assert.strictEqual((documentListeners.pointerdown || []).length, 0);

    var enter = trigger.emit("keydown", { key: "Enter" });
    assert.notStrictEqual(enter.defaultPrevented, true);
    trigger.emit("click");
    fakeDocument.emit("keydown", { key: "Escape", preventDefault: function () {}, stopPropagation: function () {} });
    assert.strictEqual(fakeDocument.activeElement, trigger);
    trigger.emit("click");
    settingsMenu.disposeHomeMateSettingsMenu();
    assert.strictEqual((documentListeners.pointerdown || []).length, 0);

    settings.openHomeMateSettings("target", trigger);
    var backdrop = fakeDocument.body.children[fakeDocument.body.children.length - 1];
    backdrop.emit("click", { target: backdrop });
    assert.strictEqual(fakeDocument.activeElement, trigger);

    narrow = true;
    settings.openHomeMateSettings("target", trigger);
    assert.strictEqual(hub.classList.contains("home-settings-drawer-masked"), true);
    assert.strictEqual(store.get('homeSidebarCollapsed'), false);
    settings.closeHomeMateSettings();
    assert.strictEqual(hub.classList.contains("home-settings-drawer-masked"), false);
    assert.strictEqual(store.get('homeSidebarCollapsed'), false);

    narrow = false;
    settings.openHomeMateSettings("target", trigger, { section: "model", sessionId: "draft-target" });
    var modelRequest = sent[sent.length - 1];
    assert.strictEqual(modelRequest.type, "home_mate_models_get");
    assert.strictEqual(modelRequest.mateId, "target");
    assert.ok(modelRequest.requestId);
    assert.strictEqual(settings.handleHomeMateModelsState({ mateId: "target", requestId: "stale", status: "ready", models: [] }), false);
    assert.strictEqual(settings.handleHomeMateModelsState({ mateId: "target", requestId: modelRequest.requestId, status: "ready", vendor: "claude", mateVendor: "claude", mateModel: "haiku", vendors: [{ id: "claude", displayName: "Claude" }], models: [{ value: "sonnet", displayName: "Sonnet" }] }), true);
    var modelOptions = fakeDocument.body.querySelectorAll('[data-home-mate-model]');
    assert.strictEqual(modelOptions.length, 1);
    modelOptions[0].emit("click");
    var modelSelection = sent[sent.length - 1];
    assert.strictEqual(modelSelection.type, "home_mate_model_set");
    assert.strictEqual(modelSelection.model, "sonnet");
    assert.strictEqual(modelSelection.sessionId, "draft-target");
    assert.strictEqual(fakeDocument.activeElement.classList.contains("home-mate-model-selection-status"), true);
    assert.strictEqual(settings.handleHomeMateModelResult({ mateId: "target", requestId: "stale", ok: true }), false);
    assert.strictEqual(settings.handleHomeMateModelResult({ mateId: "target", requestId: modelSelection.requestId, ok: true, vendor: "claude", model: "sonnet", requestedSessionId: "draft-target", sessionId: "draft-target", sessionApplied: true, sessionVendor: "claude", sessionModel: "sonnet" }), true);
    assert.strictEqual(fakeDocument.activeElement.dataset.homeMateModel, "sonnet");
    settings.closeHomeMateSettings();
  } finally {
    global.document = originals.document;
    global.window = originals.window;
    global.requestAnimationFrame = originals.requestAnimationFrame;
    global.CustomEvent = originals.CustomEvent;
    global.lucide = originals.lucide;
    global[storageKey] = originals.storage;
    global.marked = originals.marked;
    global.mermaid = originals.mermaid;
    global.DOMPurify = originals.purifier;
  }
});
