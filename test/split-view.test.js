var test = require("node:test");
var assert = require("node:assert");
var { parseWsRequestUrl } = require("../lib/ws-request");
var fs = require("fs");
var path = require("path");

var paneHelperPromise = null;
var projectActivationPromise = null;
var splitGroupPromise = null;
function loadPaneHelpers() {
  if (!paneHelperPromise) {
    var file = path.join(__dirname, "../lib/public/modules/pane-session.js");
    var source = fs.readFileSync(file, "utf8");
    paneHelperPromise = import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  }
  return paneHelperPromise;
}

function loadProjectActivationHelpers() {
  if (!projectActivationPromise) {
    var file = path.join(__dirname, "../lib/public/modules/project-activation.js");
    var source = fs.readFileSync(file, "utf8");
    projectActivationPromise = import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  }
  return projectActivationPromise;
}

function loadSplitGroupHelpers() {
  if (!splitGroupPromise) {
    var file = path.join(__dirname, "../lib/public/modules/split-group-helpers.js");
    splitGroupPromise = import("data:text/javascript;base64," + Buffer.from(fs.readFileSync(file, "utf8")).toString("base64"));
  }
  return splitGroupPromise;
}

test("split group projection follows explicit legacy and v2 roles, not member order", async function () {
  var helpers = await loadSplitGroupHelpers();
  var legacy = { members: [22, 11], pair: { driverId: 11, workerId: 22 } };
  assert.deepStrictEqual(helpers.splitGroupMemberIds(legacy), [11, 22]);
  assert.equal(helpers.isConfiguredWorker([legacy], 22), true);
  assert.equal(helpers.isConfiguredWorker([legacy], 11), false);
  var v2 = { members: [33, 11, 22], pair: { version: 2, driverId: 11, workerIds: [22, 33] } };
  assert.deepStrictEqual(helpers.splitGroupMemberIds(v2), [11, 22, 33]);
  assert.deepStrictEqual(helpers.splitGroupRoles(v2).workerIds, [22, 33]);
  assert.equal(helpers.findSplitGroup([v2], [33, 11, 22]), v2);
  assert.equal(helpers.splitGroupActiveAnchor(v2, 33), 11);
  assert.equal(helpers.splitGroupActiveAnchor({ members: [44, 55] }, 55), 55);
  assert.equal(helpers.splitGroupActiveAnchor({ members: [44, 55] }, 66), 44);
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");
  assert.match(splitSource, /var anchorId = splitGroupActiveAnchor\(group, activeId\);/);
  assert.match(splitSource, /switch_session", id: anchorId/);
});

test("targeted Worker close payload carries stable Driver, group, Worker, and generation identity", async function () {
  var helpers = await loadSplitGroupHelpers();
  var group = {
    id: "group-a",
    members: [11, 22, 33],
    pair: { version: 2, driverId: 11, workerIds: [22, 33] },
    pairAnchors: {
      version: 2,
      driver: { origin: "origin-driver" },
      workers: [{ origin: "origin-a" }, { origin: "origin-b" }],
    },
  };
  var request = helpers.splitWorkerCloseRequest(group, [
    { id: 11, workerGeneration: null },
    { id: 22, workerGeneration: 4 },
    { id: 33, workerGeneration: 5 },
  ], "project-a", 33, "request-a");
  assert.deepStrictEqual(request, {
    type: "split_worker_close",
    requestId: "request-a",
    projectSlug: "project-a",
    groupId: "group-a",
    driverId: 11,
    driverOriginId: "origin-driver",
    workerId: 33,
    workerOriginId: "origin-b",
    generation: 5,
    expectedWorkerIds: [22, 33],
  });
  assert.equal(helpers.splitWorkerCloseRequest(group, [{ id: 33, workerGeneration: null }], "project-a", 33, "missing"), null);
});

test("split session selection is scoped to the hydrated project socket", async function () {
  var helpers = await loadProjectActivationHelpers();
  var socket = { readyState: 1 };
  var state = {
    connected: true,
    wsPath: "/p/project-b/ws",
    socketPath: "/p/project-b/ws",
    currentSlug: "project-b",
    activeProjectSlug: "project-b",
    sessionActivatedProjectSlug: "project-b",
    sessionListProjectSlug: "project-b",
    splitGroupsProjectSlug: "project-b",
  };
  assert.equal(helpers.isProjectSessionReady(state, socket), true);
  assert.equal(helpers.isProjectSessionReady(Object.assign({}, state, {
    sessionListProjectSlug: null,
  }), socket), false);
  assert.equal(helpers.isProjectSessionReady(Object.assign({}, state, {
    splitGroupsProjectSlug: null,
  }), socket), false);
  assert.equal(helpers.isProjectSessionReady(Object.assign({}, state, {
    sessionActivatedProjectSlug: null,
  }), socket), false);
  assert.equal(helpers.isProjectSessionReady(Object.assign({}, state, {
    currentSlug: "project-a",
    activeProjectSlug: "project-a",
  }), socket), false);
  assert.equal(helpers.isProjectSessionReady(Object.assign({}, state, {
    splitGroupsProjectSlug: "project-a",
  }), socket), false);
  assert.equal(helpers.isProjectSessionReady(Object.assign({}, state, {
    socketPath: "/p/project-a/ws",
  }), socket), false);
  assert.equal(helpers.isProjectSessionReady(state, { readyState: 0 }), false);
  var split = { groupId: "g1", panes: [{ slug: "project-a", sessionId: 11 }, { slug: "project-a", sessionId: 12 }] };
  assert.equal(helpers.splitPanesMatchProject(split, "project-a"), true);
  assert.equal(helpers.splitPanesMatchProject(split, "project-b"), false);
  assert.equal(helpers.hasCurrentSplitGroup(split, [{ id: "g1", members: [11, 12] }]), true);
  assert.equal(helpers.hasCurrentSplitGroup(split, []), false);
  assert.equal(helpers.reconcileRestoredSplit(split, []).action, "clear");
  assert.equal(helpers.reconcileRestoredSplit(split, [{ id: "g1", members: [11, 13] }]).action, "rebuild");
  assert.equal(helpers.reconcileRestoredSplit(split, [{ id: "g1", members: [11, 12] }]).action, "keep");
});

test("pane websocket URL separates path and pane metadata", function () {
  assert.deepStrictEqual(parseWsRequestUrl("/p/clay/ws?pane=1&session=42"), {
    path: "/p/clay/ws",
    pane: true,
    paneSession: 42,
  });
});

test("normal websocket URL stays non-pane", function () {
  assert.deepStrictEqual(parseWsRequestUrl("/p/clay/ws"), {
    path: "/p/clay/ws",
    pane: false,
    paneSession: null,
  });
});

test("invalid pane session metadata is ignored", function () {
  assert.strictEqual(parseWsRequestUrl("/ws?pane=1&session=deleted").paneSession, null);
  assert.strictEqual(parseWsRequestUrl("/ws?pane=1&session=-2").paneSession, null);
  assert.strictEqual(parseWsRequestUrl("/ws?pane=1&session=42x").paneSession, null);
});

test("pane session pin resolves once when the session is accessible", async function () {
  var helpers = await loadPaneHelpers();
  assert.deepStrictEqual(helpers.resolvePaneSession(true, true, 42, [{ id: 41 }, { id: 42 }]), {
    consumed: true,
    sessionId: 42,
  });
});

test("missing pane session is consumed without a fallback", async function () {
  var helpers = await loadPaneHelpers();
  assert.deepStrictEqual(helpers.resolvePaneSession(true, true, 42, [{ id: 41 }]), {
    consumed: true,
    sessionId: null,
  });
});

test("pane session pin waits until the current websocket marks it pending", async function () {
  var helpers = await loadPaneHelpers();
  assert.deepStrictEqual(helpers.resolvePaneSession(true, false, 42, [{ id: 42 }]), {
    consumed: false,
    sessionId: null,
  });
});

test("session switches replace the previous vendor for model menu routing", async function () {
  var helpers = await loadPaneHelpers();
  assert.strictEqual(helpers.resolveSwitchedVendor("codex", "claude"), "claude");
  assert.strictEqual(helpers.resolveSwitchedVendor("claude", "codex"), "codex");
});

test("split view promotes one sticky-note canvas above both panes", function () {
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");
  // Drag and resize, and therefore pointer capture, live in the card module
  // since the sticky-note canvas was split up.
  var notesSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/sticky-notes-card.js"), "utf8");
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");

  assert.match(splitSource, /mainPanelsEl\.appendChild\(stickyNotesContainer\)/);
  assert.match(splitSource, /placeStickyNotesOverlay\(false\)/);
  assert.match(paneCss, /body\.pane-mode #sticky-notes-container\s*\{[^}]*display:\s*none !important/s);
  assert.match(notesSource, /setPointerCapture\(pointerId\)/);
  assert.match(paneCss, /body\.sticky-note-interacting \.split-pane-frame\s*\{[^}]*pointer-events:\s*none/s);
});

test("split role arrow stays anchored to the pane divider", function () {
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");

  assert.match(paneCss, /#split-host\s*\{[^}]*position:\s*relative/s);
  assert.match(paneCss, /#split-host\.split-delegating::after\s*\{[^}]*left:\s*calc\(50% - 17px\)/s);
});

test("split pane headers match the native session header background", function () {
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");

  assert.match(paneCss, /\.split-pane-header\s*\{[^}]*background:\s*var\(--bg\)/s);
});

test("worker delegation notice is a rounded task status", function () {
  var pairSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-pair-ui.js"), "utf8");
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");

  assert.match(pairSource, /inputArea\.insertBefore\(workerNoticeEl, inputWrapper\)/);
  assert.match(paneCss, /\.pane-delegation-notice\s*\{[^}]*width:\s*100%[^}]*max-width:\s*var\(--content-width\)[^}]*margin:\s*0 auto/s);
  assert.match(paneCss, /\.pane-delegation-notice\s*\{[^}]*border-radius:\s*8px;/s);
  assert.match(pairSource, /Working on a task from /);
});

test("split pane clients leave notification banners to the parent shell", function () {
  var notificationsSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-notifications.js"), "utf8");
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");
  var initStart = notificationsSource.indexOf("export function initAppNotifications()");
  var initEnd = notificationsSource.indexOf("// ========================================================", initStart);
  var initSource = notificationsSource.slice(initStart, initEnd);

  assert.match(initSource, /if \(store\.get\('paneMode'\)\) return;/);
  assert.ok(initSource.indexOf("paneMode") < initSource.indexOf('document.createElement("div")'));
  assert.match(paneCss, /body\.pane-mode \.notif-banner-container\s*\{[^}]*display:\s*none !important/s);
});

test("split pane clients prepare web links before browser navigation", function () {
  var bridgeSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/pane-bridge.js"), "utf8");

  assert.match(bridgeSource, /document\.addEventListener\("click", preparePaneLink, true\)/);
  assert.match(bridgeSource, /document\.addEventListener\("auxclick", preparePaneLink, true\)/);
  assert.match(bridgeSource, /forceExternalLinkToNewTab\(anchor, window\.location\.href\)/);
});

test("session actions live beside composer context and stay out of split panes", function () {
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var actionsSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/session-actions.js"), "utf8");

  assert.doesNotMatch(html, /id="header-session-actions-btn"/);
  assert.match(html, /id="context-sources-btn-wrap"[\s\S]*id="composer-add-worker-btn"[\s\S]*id="composer-handoff-btn"/);
  assert.match(actionsSource, /!!state\.splitPanes/);
  assert.match(actionsSource, /state\.paneMode/);
  assert.match(actionsSource, /composer-add-worker-btn/);
  assert.match(actionsSource, /composer-handoff-btn/);
  assert.match(actionsSource, /handoff_session_options/);
  assert.match(actionsSource, /Reasoning effort/);
  assert.match(actionsSource, /model: modelSelect\.value/);
});

test("configured pair roles are status labels rather than role-transfer controls", function () {
  var pairSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-pair-ui.js"), "utf8");
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");

  assert.match(pairSource, /document\.createElement\("span"\)/);
  assert.match(pairSource, /Split Worker controlled by the Driver/);
  assert.match(pairSource, /var role = isDriver \? "Driver" : "Split Worker"/);
  assert.match(pairSource, /role\.toLowerCase\(\)\.replace\(\/ \/g, "-"\)/);
  assert.match(paneCss, /\.split-pair-role-split-worker/);
  assert.doesNotMatch(pairSource, /Split Worker — click to make this session the Driver instead/);
  assert.doesNotMatch(paneCss, /button\.split-pair-role/);
});

test("configured Split Workers preserve direct human messaging and stopping", function () {
  var pairSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-pair-ui.js"), "utf8");
  var messageSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");

  assert.doesNotMatch(pairSource, /syncWorkerComposerLock/);
  assert.doesNotMatch(messageSource, /syncWorkerComposerLock/);
  assert.doesNotMatch(paneCss, /worker-controlled/);
});

test("membership updates reconcile the split instead of collapsing it", function () {
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");

  assert.match(splitSource, /var projectedPanes = projectedIds\.map/);
  assert.match(splitSource, /store\.set\(\{ splitPanes: \{ groupId: split\.groupId, panes: projectedPanes \} \}\)/);
  assert.doesNotMatch(splitSource, /!hasCurrentSplitGroup\(split, state\.splitGroups\)/);
});

test("stacked Worker close uses the targeted backend contract instead of disabling the control", function () {
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");
  var rendererSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-pane-renderer.js"), "utf8");
  assert.match(splitSource, /splitWorkerCloseRequest/);
  assert.match(splitSource, /JSON\.stringify\(request\)/);
  assert.doesNotMatch(rendererSource, /Worker removal requires backend integration/);
});

test("split pane reconciliation is keyed and does not rebuild existing pane nodes", function () {
  var reconcilerSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-pane-reconciler.js"), "utf8");
  assert.match(reconcilerSource, /splitPaneIdentity/);
  assert.match(reconcilerSource, /byKey\.get\(key\)/);
  assert.doesNotMatch(reconcilerSource, /host\.innerHTML/);
  assert.doesNotMatch(reconcilerSource, /moveBefore|insertBefore/);
});

test("split pane permission control is anchored beside the session title", function () {
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");
  var rendererSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-pane-renderer.js"), "utf8");
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");

  assert.match(rendererSource, /header\.insertBefore\(fullAccess, ctxChip\)/);
  assert.match(paneCss, /\.split-pane-title\s*\{[^}]*flex:\s*0 1 auto/s);
  assert.match(paneCss, /\.split-pane-context\s*\{[^}]*margin-left:\s*auto/s);
});

test("configured Split Workers never show the outer Skip Permissions control", function () {
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");
  var rendererSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-pane-renderer.js"), "utf8");

  assert.match(rendererSource, /var worker = !!session && isConfiguredWorker\(store\.get\('splitGroups'\), session\.id\)/);
  assert.match(rendererSource, /effectivePermissionMode: session && session\.effectivePermissionMode \|\| null/);
  assert.match(rendererSource, /visible: !!session && !worker && mode === "gui"/);
  assert.match(rendererSource, /locked: worker/);
  assert.match(rendererSource, /renderPermissionControl\(button, permissionState\(session\)\)/);
});
