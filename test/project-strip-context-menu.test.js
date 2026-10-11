var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var root = path.join(__dirname, "..");

function FakeElement(tag, documentRef) {
  this.tagName = String(tag).toUpperCase();
  this.ownerDocument = documentRef;
  this.children = [];
  this.listeners = {};
  this.attributes = {};
  this.style = {};
  this.className = "";
  this.innerHTML = "";
  this.parentNode = null;
  this.isConnected = true;
  this.focusCount = 0;
}
FakeElement.prototype.appendChild = function (child) { child.parentNode = this; this.children.push(child); return child; };
FakeElement.prototype.remove = function () { if (!this.parentNode) return; var index = this.parentNode.children.indexOf(this); if (index !== -1) this.parentNode.children.splice(index, 1); this.parentNode = null; this.isConnected = false; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.addEventListener = function (type, handler) { this.listeners[type] = handler; };
FakeElement.prototype.emit = function (type, event) { if (this.listeners[type]) this.listeners[type](Object.assign({ stopPropagation: function () {}, preventDefault: function () {} }, event || {})); };
FakeElement.prototype.focus = function () { this.ownerDocument.activeElement = this; this.focusCount += 1; };
FakeElement.prototype.getBoundingClientRect = function () { return { top: 10, left: 10, right: 50, bottom: 50, width: 40, height: 40 }; };
FakeElement.prototype.querySelectorAll = function (selector) {
  if (selector !== ".project-ctx-item:not([disabled])") return [];
  return this.children.filter(function (child) { return child.className.indexOf("project-ctx-item") !== -1 && !child.disabled; });
};
FakeElement.prototype.querySelector = function (selector) { var items = this.querySelectorAll(selector); return items[0] || null; };

function menuHarness(options) {
  options = options || {};
  var documentRef = { activeElement: null };
  documentRef.createElement = function (tag) { return new FakeElement(tag, documentRef); };
  documentRef.body = new FakeElement("body", documentRef);
  var calls = { shares: [], settings: [], access: [], worktrees: [], socket: [], toast: [] };
  var source = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-projects.js"), "utf8");
  var functionStart = source.indexOf("export function closeProjectCtxMenu");
  source = source.substring(functionStart, source.indexOf("// --- Emoji picker ---", functionStart));
  source = source.replace(/export function/g, "function");
  var factory = new Function("deps", [
    "var document = deps.document; var window = deps.window; var requestAnimationFrame = deps.requestAnimationFrame;",
    "var projectCtxMenu = null; var projectCtxAnchor = null;",
    "var closeUserCtxMenu = deps.noop; var closeEmojiPicker = deps.noop;",
    "var getCachedProjects = deps.getCachedProjects; var store = deps.store; var iconHtml = deps.iconHtml; var refreshIcons = deps.noop;",
    "var showEmojiPicker = deps.noop; var showToast = deps.showToast; var openProjectSettings = deps.openProjectSettings;",
    "var triggerShare = deps.triggerShare; var showProjectAccessPopover = deps.showProjectAccessPopover; var showWorktreeModal = deps.showWorktreeModal;",
    "var getWs = deps.getWs;",
    source,
    "return { show: showProjectCtxMenu, close: closeProjectCtxMenu };",
  ].join("\n"));
  var controller = factory({
    document: documentRef,
    window: { innerWidth: 1200, innerHeight: 900 },
    requestAnimationFrame: function (callback) { callback(); },
    noop: function () {},
    getCachedProjects: function () { return options.projects || []; },
    store: { get: function (key) { return (options.state || {})[key]; } },
    iconHtml: function (name) { return "<i>" + name + "</i>"; },
    showToast: function (message) { calls.toast.push(message); },
    openProjectSettings: function (slug, project) { calls.settings.push({ slug: slug, project: project }); },
    triggerShare: function (target) { calls.shares.push(target); },
    showProjectAccessPopover: function (anchor, slug) { calls.access.push(slug); },
    showWorktreeModal: function (slug, name) { calls.worktrees.push({ slug: slug, name: name }); },
    getWs: function () { return { send: function (message) { calls.socket.push(JSON.parse(message)); } }; },
  });
  var anchor = new FakeElement("a", documentRef);
  documentRef.body.appendChild(anchor);
  function labels(menu) {
    return menu.children.filter(function (child) { return child.className.indexOf("project-ctx-item") !== -1; }).map(function (child) {
      var match = child.innerHTML.match(/<span>([^<]+)<\/span>/);
      return match ? match[1] : "";
    });
  }
  function click(menu, label) {
    var menuLabels = labels(menu);
    var index = menuLabels.indexOf(label);
    var items = menu.children.filter(function (child) { return child.className.indexOf("project-ctx-item") !== -1; });
    assert.notEqual(index, -1, "menu contains " + label);
    items[index].emit("click");
  }
  return { show: controller.show, close: controller.close, anchor: anchor, document: documentRef, calls: calls, labels: labels, click: click };
}

test("project strip and header share one full menu while inactive actions keep the captured target", function () {
  var h = menuHarness({
    projects: [{ slug: "active", name: "Active" }, { slug: "inactive", name: "Inactive", title: "Inactive title" }],
    state: { connected: true, permissions: { projectSettings: true, deleteProject: true }, isMultiUserMode: false },
  });
  h.show(h.anchor, "inactive", "Inactive", null, null, { shareTargetSlug: true });
  var menu = h.document.body.children[1];
  assert.deepEqual(h.labels(menu), ["Set Icon", "Project Settings", "Share", "Add Worktree", "Remove Project"]);
  assert.equal(menu.attributes.role, "menu");
  h.click(menu, "Project Settings");
  assert.equal(h.calls.settings[0].slug, "inactive");
  assert.equal(h.calls.settings[0].project.name, "Inactive title");
  h.show(h.anchor, "inactive", "Inactive", null, null, { shareTargetSlug: true });
  menu = h.document.body.children[1];
  h.click(menu, "Share");
  assert.deepEqual(h.calls.shares[0], { projectSlug: "inactive", title: "Inactive" });
  h.show(h.anchor, "inactive", "Inactive", null, null, { shareTargetSlug: true });
  menu = h.document.body.children[1];
  h.click(menu, "Remove Project");
  assert.deepEqual(h.calls.socket[0], { type: "remove_project_check", slug: "inactive", name: "Inactive" });

  h.show(h.anchor, "inactive", "Inactive", null, "below");
  menu = h.document.body.children[1];
  h.click(menu, "Share");
  assert.equal(h.calls.shares[1], undefined, "the project header retains its current-URL share behavior");

  h.show(h.anchor, "inactive", "Inactive", null, null, { shareTargetSlug: true });
  menu = h.document.body.children[1];
  menu.emit("keydown", { key: "Escape" });
  assert.equal(h.document.body.children.length, 1, "Escape dismisses the menu");
  assert.equal(h.anchor.focusCount, 1, "Escape restores focus to its trigger");
});

test("menu policy preserves permissions and worktree removal distinctions", function () {
  var restricted = menuHarness({ projects: [{ slug: "p", name: "P" }], state: { permissions: { projectSettings: false, deleteProject: false }, isMultiUserMode: true } });
  restricted.show(restricted.anchor, "p", "P", null, null, { shareTargetSlug: true });
  assert.deepEqual(restricted.labels(restricted.document.body.children[1]), ["Set Icon", "Share", "Add Worktree"]);

  var external = menuHarness({ projects: [{ slug: "p--external", name: "External" }], state: { permissions: { projectSettings: true, deleteProject: true } } });
  external.show(external.anchor, "p--external", "External", null, null, { shareTargetSlug: true, canRemoveWorktree: false });
  var externalMenu = external.document.body.children[1];
  assert.deepEqual(external.labels(externalMenu), ["Set Icon", "Project Settings", "Share"]);
  assert.equal(externalMenu.children.filter(function (child) { return child.className === "project-ctx-separator"; }).length, 1, "external worktree has no empty trailing action group");

  var internal = menuHarness({ projects: [{ slug: "p--branch", name: "Branch" }], state: { permissions: { projectSettings: true, deleteProject: true }, connected: true } });
  internal.show(internal.anchor, "p--branch", "Branch", null, null, { shareTargetSlug: true, canRemoveWorktree: true });
  assert.deepEqual(internal.labels(internal.document.body.children[1]), ["Set Icon", "Project Settings", "Share", "Remove Worktree"]);

  var owner = menuHarness({ projects: [{ slug: "owned", name: "Owned", projectOwnerId: "me" }], state: { myUserId: "me", isMultiUserMode: true, permissions: { projectSettings: false, deleteProject: false } } });
  owner.show(owner.anchor, "owned", "Owned", null, null, { shareTargetSlug: true });
  var ownerMenu = owner.document.body.children[1];
  assert.deepEqual(owner.labels(ownerMenu), ["Set Icon", "Share", "Manage Access", "Add Worktree"]);
  owner.click(ownerMenu, "Manage Access");
  assert.deepEqual(owner.calls.access, ["owned"]);

  var missing = menuHarness({ projects: [], state: { permissions: { projectSettings: true, deleteProject: false } } });
  missing.show(missing.anchor, "missing", "Missing", null, null, { shareTargetSlug: true });
  missing.click(missing.document.body.children[1], "Project Settings");
  assert.equal(missing.calls.settings.length, 0);
  assert.match(missing.calls.toast[0], /unavailable/);
});

test("targeted share URLs replace the project route without retaining session state", async function () {
  var priorWindow = global.window;
  global.window = { location: new URL("http://localhost:3000/p/current/?session=42#message"), __lanHost: "192.168.1.8:3000" };
  try {
    var qrcodeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/qrcode.js")).href + "?menu=" + Date.now());
    assert.equal(qrcodeModule.getShareUrl("other,project"), "http://192.168.1.8:3000/p/other%2Cproject/");
    assert.equal(qrcodeModule.getShareUrl(), "http://192.168.1.8:3000/p/current/?session=42#message");
  } finally {
    global.window = priorWindow;
  }
});
