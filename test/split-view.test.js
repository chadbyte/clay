var test = require("node:test");
var assert = require("node:assert");
var { parseWsRequestUrl } = require("../lib/ws-request");
var fs = require("fs");
var path = require("path");

var paneHelperPromise = null;
function loadPaneHelpers() {
  if (!paneHelperPromise) {
    var file = path.join(__dirname, "../lib/public/modules/pane-session.js");
    var source = fs.readFileSync(file, "utf8");
    paneHelperPromise = import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  }
  return paneHelperPromise;
}

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

test("dissolving a pair closes the split UI back to the Driver session", function () {
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");

  assert.match(splitSource, /if \(!stillExists\) switchNativeSession\(split\.panes\[0\]\.sessionId\)/);
});

test("split pane permission control is anchored beside the session title", function () {
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");
  var paneCss = fs.readFileSync(path.join(__dirname, "../lib/public/css/pane.css"), "utf8");

  assert.match(splitSource, /header\.insertBefore\(fullAccess, ctxChip\)/);
  assert.match(paneCss, /\.split-pane-title\s*\{[^}]*flex:\s*0 1 auto/s);
  assert.match(paneCss, /\.split-pane-context\s*\{[^}]*margin-left:\s*auto/s);
});

test("configured Split Workers never show the outer Skip Permissions control", function () {
  var splitSource = fs.readFileSync(path.join(__dirname, "../lib/public/modules/split-view.js"), "utf8");
  var updateStart = splitSource.indexOf("function updatePaneFullAccessButton");
  var updateEnd = splitSource.indexOf("function setPaneFullAccess", updateStart);
  var updateSource = splitSource.slice(updateStart, updateEnd);

  assert.match(updateSource, /isConfiguredWorker\(store\.get\('splitGroups'\), session\.id\)/);
  assert.match(updateSource, /var visible = !!session && !worker/);
});
