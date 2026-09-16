// Driver-operated Split Worker surface: the configured Worker pane loses the
// human composer and its permission-mode chrome, the server refuses an ordinary
// human send into it, and its permission mode is inherited live from the exact
// paired Driver.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

var moduleSource = read("lib/public/modules/worker-pane-lock.js");
var paneCss = read("lib/public/css/pane.css");
var indexHtml = read("lib/public/index.html");
var appSource = read("lib/public/app.js");
var bridgeSource = read("lib/sdk-bridge.js");
var userMessageSource = read("lib/project-user-message.js");
var projectSource = read("lib/project.js");
var permissionSource = read("lib/project-worker-permission.js");

// --- Fake DOM -------------------------------------------------------------

function makeEl(id, tag) {
  var classes = {};
  return {
    id: id,
    tagName: (tag || "div").toUpperCase(),
    disabled: false,
    dataset: {},
    attributes: {},
    children: [],
    classList: {
      add: function (n) { classes[n] = true; },
      remove: function (n) { delete classes[n]; },
      contains: function (n) { return !!classes[n]; },
      toggle: function (n, on) { if (on) classes[n] = true; else delete classes[n]; },
    },
    setAttribute: function (n, v) { this.attributes[n] = String(v); },
    getAttribute: function (n) {
      return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null;
    },
    removeAttribute: function (n) { delete this.attributes[n]; },
    appendChild: function (c) { this.children.push(c); return c; },
  };
}

var COMPOSER_IDS = ["input", "send-btn", "attach-file-btn", "attach-image-btn",
  "input-more-btn", "shell-command-btn", "stt-btn", "schedule-btn", "ask-mate-btn",
  "context-sources-add", "composer-add-worker-btn", "composer-handoff-btn"];

function load(storeState) {
  var els = {};
  function el(id, tag) { els[id] = makeEl(id, tag); return els[id]; }
  el("input-area");
  el("input-wrapper");
  el("skip-perms-pill");
  el("config-chip-wrap");
  for (var i = 0; i < COMPOSER_IDS.length; i++) el(COMPOSER_IDS[i], "button");

  var body = makeEl("body");
  var subscribers = [];
  var state = Object.assign({ splitGroups: [], activeSessionId: null, paneMode: false, paneSessionId: null }, storeState || {});
  var fakeStore = {
    snap: function () { return state; },
    get: function (k) { return state[k]; },
    set: function (patch) {
      var prev = state;
      state = Object.assign({}, state, patch);
      for (var i = 0; i < subscribers.length; i++) subscribers[i](state, prev);
    },
    subscribe: function (fn) { subscribers.push(fn); return function () {}; },
  };
  var fakeDocument = {
    body: body,
    getElementById: function (id) {
      if (els[id]) return els[id];
      // Elements the module creates and appends must become findable, or an
      // "ensure once" helper would look like it re-created every time.
      var area = els["input-area"];
      for (var i = 0; i < area.children.length; i++) {
        if (area.children[i].id === id) return area.children[i];
      }
      return null;
    },
    createElement: function (tag) { return makeEl("", tag); },
  };

  var body_ = moduleSource
    .replace(/^import[\s\S]*?;$/gm, "")
    .replace(/^export function/gm, "function");
  var factory = new Function("document", "store",
    body_ + "\nreturn { initWorkerPaneLock: initWorkerPaneLock, syncWorkerPaneLock: syncWorkerPaneLock," +
      " isDriverOperatedView: isDriverOperatedView };");
  var api = factory(fakeDocument, fakeStore);
  api.els = els;
  api.body = body;
  api.store = fakeStore;
  api.statusLine = function () {
    var area = els["input-area"];
    for (var i = 0; i < area.children.length; i++) {
      if (area.children[i].id === "worker-pane-status") return area.children[i];
    }
    return null;
  };
  return api;
}

var PAIR = [{ id: "sg1", members: [1, 2], pair: { driverId: 1, workerId: 2 } }];
var AD_HOC = [{ id: "sg1", members: [1, 2] }];

// --- Role resolution ------------------------------------------------------

test("only the configured Worker of a live pair is Driver-operated", function () {
  function view(state) { return load(state).isDriverOperatedView(); }

  assert.equal(view({ splitGroups: PAIR, activeSessionId: 2 }), true, "the configured Worker");
  assert.equal(view({ splitGroups: PAIR, activeSessionId: 1 }), false, "the Driver is not locked");
  assert.equal(view({ splitGroups: AD_HOC, activeSessionId: 2 }), false,
    "an ad-hoc split has no roles and stays human-controlled");
  assert.equal(view({ splitGroups: AD_HOC, activeSessionId: 1 }), false);
  assert.equal(view({ splitGroups: [], activeSessionId: 2 }), false, "an ordinary session");
  assert.equal(view({ splitGroups: PAIR, activeSessionId: 9 }), false, "an unrelated session");
  assert.equal(view({ splitGroups: PAIR, activeSessionId: null }), false, "no session on screen");

  // In a pane iframe the pane's own session decides, not the parent's active one.
  assert.equal(view({ splitGroups: PAIR, paneMode: true, paneSessionId: 2, activeSessionId: 1 }), true);
  assert.equal(view({ splitGroups: PAIR, paneMode: true, paneSessionId: 1, activeSessionId: 2 }), false);
});

// --- Composer removal -----------------------------------------------------

test("the configured Worker pane has no usable composer, attachments or send", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 2 });
  assert.equal(api.syncWorkerPaneLock(), true);

  assert.equal(api.body.classList.contains("worker-pane-locked"), true, "the pane is marked locked");
  assert.equal(api.els["input-wrapper"].getAttribute("aria-hidden"), "true",
    "the composer region is hidden from assistive tech too");

  for (var i = 0; i < COMPOSER_IDS.length; i++) {
    var el = api.els[COMPOSER_IDS[i]];
    assert.equal(el.disabled, true, COMPOSER_IDS[i] + " is inert");
    assert.equal(el.getAttribute("tabindex"), "-1",
      COMPOSER_IDS[i] + " is out of the tab order, so no focusable dead input is left");
  }
});

test("the status line replaces the composer footprint and is non-interactive", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 2 });
  api.syncWorkerPaneLock();

  var line = api.statusLine();
  assert.ok(line, "a status line was added");
  assert.equal(line.classList.contains("visible"), true);
  assert.equal(line.getAttribute("role"), "status", "announced as a standing condition");
  assert.equal(line.tagName, "DIV", "not a control");

  var label = line.children[line.children.length - 1];
  assert.equal(label.textContent, "Controlled by Driver");
  var mark = line.children[0];
  assert.equal(mark.getAttribute("aria-hidden"), "true", "the dot is decorative");

  // Rendered once, not on every sync.
  api.syncWorkerPaneLock();
  api.syncWorkerPaneLock();
  var count = 0;
  for (var i = 0; i < api.els["input-area"].children.length; i++) {
    if (api.els["input-area"].children[i].id === "worker-pane-status") count++;
  }
  assert.equal(count, 1);
});

test("Driver and ad-hoc panes keep their composer untouched", function () {
  var cases = [
    { splitGroups: PAIR, activeSessionId: 1 },
    { splitGroups: AD_HOC, activeSessionId: 2 },
    { splitGroups: [], activeSessionId: 5 },
  ];
  for (var c = 0; c < cases.length; c++) {
    var api = load(cases[c]);
    assert.equal(api.syncWorkerPaneLock(), false);
    assert.equal(api.body.classList.contains("worker-pane-locked"), false);
    assert.equal(api.els["input-wrapper"].getAttribute("aria-hidden"), null);
    assert.equal(api.statusLine(), null, "no status line is added");
    for (var i = 0; i < COMPOSER_IDS.length; i++) {
      assert.equal(api.els[COMPOSER_IDS[i]].disabled, false, COMPOSER_IDS[i] + " stays usable");
      assert.equal(api.els[COMPOSER_IDS[i]].getAttribute("tabindex"), null);
    }
  }
});

// --- Permission chrome ----------------------------------------------------

test("the Worker pane has no skip-permissions or permission-mode control", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 2 });
  api.els["skip-perms-pill"].classList.remove("hidden");
  api.els["config-chip-wrap"].classList.remove("hidden");
  api.syncWorkerPaneLock();

  assert.equal(api.els["skip-perms-pill"].classList.contains("hidden"), true);
  assert.equal(api.els["skip-perms-pill"].getAttribute("aria-hidden"), "true");
  assert.equal(api.els["config-chip-wrap"].classList.contains("hidden"), true);
  assert.equal(api.els["config-chip-wrap"].getAttribute("aria-hidden"), "true");
});

test("a Driver pane keeps its own permission chrome", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 1 });
  api.els["skip-perms-pill"].classList.remove("hidden");
  api.syncWorkerPaneLock();
  assert.equal(api.els["skip-perms-pill"].classList.contains("hidden"), false);
  assert.equal(api.els["skip-perms-pill"].getAttribute("aria-hidden"), null);
});

// --- Dissolve, replace, switch, reconnect ---------------------------------

test("dissolving the pair returns the composer and the permission chrome", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 2 });
  api.els["skip-perms-pill"].classList.remove("hidden");
  api.initWorkerPaneLock();
  assert.equal(api.body.classList.contains("worker-pane-locked"), true);

  // The old Worker becomes an ordinary preserved session.
  api.store.set({ splitGroups: [] });

  assert.equal(api.body.classList.contains("worker-pane-locked"), false);
  assert.equal(api.els["input-wrapper"].getAttribute("aria-hidden"), null);
  assert.equal(api.statusLine().classList.contains("visible"), false, "the status line is withdrawn");
  assert.equal(api.els["skip-perms-pill"].classList.contains("hidden"), false, "chrome returns");
  for (var i = 0; i < COMPOSER_IDS.length; i++) {
    assert.equal(api.els[COMPOSER_IDS[i]].disabled, false, COMPOSER_IDS[i] + " is usable again");
    assert.equal(api.els[COMPOSER_IDS[i]].getAttribute("tabindex"), null);
    assert.equal(api.els[COMPOSER_IDS[i]].dataset.workerLockPrev, undefined, "no residue");
  }
});

test("unlocking restores a control that was independently disabled", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 2 });
  api.els["send-btn"].disabled = true; // the real send button starts disabled
  api.initWorkerPaneLock();
  api.store.set({ splitGroups: [] });
  assert.equal(api.els["send-btn"].disabled, true,
    "an already-disabled control is left disabled, not silently enabled");
});

test("replacement re-locks for the new Worker and releases the old one", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 2 });
  api.initWorkerPaneLock();
  assert.equal(api.body.classList.contains("worker-pane-locked"), true);

  // replace_partner dissolves and pairs a new Worker; this pane still shows 2.
  api.store.set({ splitGroups: [{ id: "sg2", members: [1, 7], pair: { driverId: 1, workerId: 7 } }] });
  assert.equal(api.body.classList.contains("worker-pane-locked"), false,
    "the replaced Worker is an ordinary session again");

  // Viewing the new Worker locks it.
  api.store.set({ activeSessionId: 7 });
  assert.equal(api.body.classList.contains("worker-pane-locked"), true);
});

test("a role swap follows the pair record", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 2 });
  api.initWorkerPaneLock();
  assert.equal(api.body.classList.contains("worker-pane-locked"), true);
  api.store.set({ splitGroups: [{ id: "sg1", members: [1, 2], pair: { driverId: 2, workerId: 1 } }] });
  assert.equal(api.body.classList.contains("worker-pane-locked"), false,
    "session 2 is now the Driver");
});

test("session switching and reconnect leave no stale hidden state", function () {
  var api = load({ splitGroups: PAIR, activeSessionId: 2 });
  api.initWorkerPaneLock();
  assert.equal(api.body.classList.contains("worker-pane-locked"), true);

  // Switch to an ordinary session.
  api.store.set({ activeSessionId: 5 });
  assert.equal(api.body.classList.contains("worker-pane-locked"), false);
  assert.equal(api.els["input"].disabled, false, "the composer is live for the ordinary session");

  // Reconnect: groups arrive again as a fresh array.
  api.store.set({ splitGroups: PAIR.slice() });
  assert.equal(api.body.classList.contains("worker-pane-locked"), false, "still the ordinary session");
  api.store.set({ activeSessionId: 2 });
  assert.equal(api.body.classList.contains("worker-pane-locked"), true, "and locks again on the Worker");
});

test("the role is never stored anywhere but pair state", function () {
  // Code only: the header comment names localStorage in order to forbid it.
  var code = moduleSource.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/localStorage|sessionStorage/.test(code), false, "no browser storage");
  assert.equal(/workerRole|isWorker\s*=|_role\b/.test(code), false,
    "no duplicated role field; splitGroups is the only source");
  assert.match(moduleSource, /snapshot\.splitGroups \|\| \[\]/);
});

// --- Server: ordinary human sends are refused ----------------------------

test("an ordinary human message into a configured Worker is refused server-side", function () {
  var handler = userMessageSource.slice(userMessageSource.indexOf('if (msg.type !== "message") return false;'));
  handler = handler.slice(0, handler.indexOf("var userMsg2 = "));

  assert.match(handler, /ctx\.isDriverOperatedSession\(session\)/,
    "the refusal consults exact live pair state");
  assert.match(handler, /This Split Worker is controlled by its Driver/);
  assert.match(handler, /return true;/, "and the message is dropped, not forwarded");
  assert.equal(/msg\.role|msg\.isWorker|msg\.driverId/.test(handler), false,
    "nothing about the role is read from the payload");

  // The refusal sits before any state mutation for that turn.
  assert.ok(handler.indexOf("isDriverOperatedSession") < handler.indexOf("session.vendor = msg.vendor"),
    "refused before the session is mutated");

  // Wired from exact pair state, and never for a Mate project.
  assert.match(projectSource, /isDriverOperatedSession: function \(session\) \{[\s\S]*?workerPermission\.isDriverOperated\(session\)/);
  assert.match(projectSource, /if \(isMate \|\| !_sessionPair\.workerPermission\) return false;/);
});

test("delegated, tool and emergency traffic are untouched", function () {
  // The refusal is inside the ordinary-message branch only.
  var guard = userMessageSource.slice(userMessageSource.indexOf("isDriverOperatedSession"));
  guard = guard.slice(0, guard.indexOf("return true;") + 12);
  assert.equal(/delegated|permission_response|stop|term_/.test(guard), false,
    "the guard mentions no other traffic type");

  // Delegation writes the Worker's user_message through the pair module, not
  // through this handler, so it is structurally unaffected.
  var pairSource = read("lib/project-session-pair.js");
  assert.match(pairSource, /sm\.sendAndRecord\(partner, \{\s*\n\s*type: "user_message",\s*\n\s*text: message,\s*\n\s*delegated: true,/);

  // stop / stop_task / delete are handled in project-sessions.js.
  var sessionsSource = read("lib/project-sessions.js");
  assert.match(sessionsSource, /if \(msg\.type === "stop"\) \{/);
  assert.equal(/isDriverOperated/.test(sessionsSource), false,
    "the emergency stop path is not gated by the role");
});

// --- Server: live permission-mode inheritance ----------------------------

test("a configured Worker inherits its Driver's permission mode, resolved every call", function () {
  var fn = permissionSource.slice(permissionSource.indexOf("function inheritedPermissionMode(session)"));
  fn = fn.slice(0, fn.indexOf("function pendingCountFor"));

  assert.match(fn, /var resolved = driverOperatedPair\(session\);/,
    "the pair is re-resolved on every call");
  assert.match(fn, /return driver\.permissionMode \|\| sm\.currentPermissionMode \|\| "default";/);
  assert.match(fn, /if \(!resolved\) return null;/,
    "a non-Worker keeps the caller's own resolution");
  assert.equal(/session\.permissionMode =|saveSessionFile/.test(fn), false,
    "the Worker's own persisted setting is never written");

  // Applied at the single decision point, before the bypass test.
  var decide = bridgeSource.slice(bridgeSource.indexOf("function handleCanUseTool(session, toolName, input, opts)"));
  decide = decide.slice(0, decide.indexOf("// Ralph Loop execution"));
  assert.match(decide, /var inherited = _wpMode\.inheritedPermissionMode\(session\);\s*\n\s*if \(inherited\) clayPermissionMode = inherited;/);
  assert.ok(decide.indexOf("inheritedPermissionMode") < decide.indexOf('clayPermissionMode === "bypassPermissions"'),
    "inheritance is resolved before the skip test reads the mode");

  // Nothing is cached at creation.
  var lifecycleSource = read("lib/project-pair-lifecycle.js");
  assert.equal(/\.permissionMode\s*=/.test(lifecycleSource), false,
    "pair creation and replacement copy no permission mode");
});

test("AskUserQuestion stays a human question under Driver skip mode", function () {
  var decide = bridgeSource.slice(bridgeSource.indexOf("function handleCanUseTool(session, toolName, input, opts)"));
  decide = decide.slice(0, decide.indexOf("// Ralph Loop execution"));
  assert.match(decide, /clayPermissionMode === "bypassPermissions" && toolName !== "AskUserQuestion"/,
    "the bypass still excludes it, inherited mode or not");
  assert.match(decide, /AskUserQuestion is genuine user input/);

  // And the Driver never gets to answer it either.
  assert.match(permissionSource, /var USER_INPUT_TOOLS = \["AskUserQuestion"\];/);
  assert.match(permissionSource, /if \(isUserInputTool\(req\.toolName\)\) return null;/);
});

// --- Presentation and conventions ---------------------------------------

test("the status line reuses existing tokens and adds no card system", function () {
  var block = paneCss.slice(paneCss.indexOf("#input-area .worker-pane-status {"));
  assert.match(block, /max-width: var\(--content-width\)/, "the composer's own content width");
  assert.match(block, /border-top: 1px solid var\(--border-subtle\)/, "a hairline, not a panel");
  assert.match(block, /color: var\(--text-dimmer\)/);
  assert.match(block, /var\(--safe-bottom, 0px\)/);
  assert.match(block, /text-transform: uppercase/);
  assert.match(block, /user-select: none/);

  // No new surface: no background fill, radius, shadow or border box.
  assert.equal(/border-radius|box-shadow: 0 \d/.test(block.slice(0, block.indexOf("}"))), false,
    "the status line itself is not a card");
  var literals = block.match(/#[0-9a-f]{3,8}\b/gi) || [];
  assert.deepEqual(literals, [], "tokens only, no literal colours");

  // The dot is steady: a standing condition should not animate.
  var markBlock = paneCss.slice(paneCss.indexOf(".worker-pane-status-mark {"));
  markBlock = markBlock.slice(0, markBlock.indexOf("}"));
  assert.equal(/animation|@keyframes|transition/.test(markBlock), false);

  assert.match(paneCss, /body\.worker-pane-locked #input-wrapper \{ display: none; \}/,
    "the composer is hidden, so the transcript keeps its scroll container");
});

test("client conventions and wiring", function () {
  assert.equal(/=>/.test(moduleSource), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(moduleSource), false, "var only");
  assert.equal(/alert\(|confirm\(|prompt\(/.test(moduleSource), false, "no native dialogs");
  assert.equal(/_ctx/.test(moduleSource), false, "no init context bag");
  assert.match(moduleSource, /^import \{ store \} from '\.\/store\.js';$/m, "state through the store");
  assert.match(moduleSource, /export function initWorkerPaneLock/);
  assert.ok(moduleSource.split("\n").length < 500);

  assert.match(appSource, /import \{ initWorkerPaneLock \} from '\.\/modules\/worker-pane-lock\.js';/);
  assert.match(appSource, /  initWorkerPaneLock\(\);/);

  // The transcript, stop control and progress surfaces are not touched.
  assert.equal(/messages|stop-btn|scrollTo|permission-container/.test(moduleSource), false,
    "only composer and permission chrome are affected");
});

test("server conventions hold and project.js stays thin", function () {
  assert.equal(/=>/.test(permissionSource), false);
  assert.ok(permissionSource.split("\n").length < 500);
  assert.ok(read("lib/project-user-message.js").split("\n").length > 0);

  // project.js wires a resolver; it holds no role logic of its own.
  var wiring = projectSource.slice(projectSource.indexOf("isDriverOperatedSession: function"));
  wiring = wiring.slice(0, wiring.indexOf("cwd: cwd,"));
  assert.equal(/group\.pair|workerId|driverId/.test(wiring), false,
    "no pair inspection leaked into project.js");
});

test("no unrelated surface was changed", function () {
  // The composer markup itself is untouched; the lock is applied at runtime.
  assert.match(indexHtml, /<textarea id="input" rows="1"/);
  assert.match(indexHtml, /<button id="send-btn" disabled aria-label="Send">/);
  assert.equal(/worker-pane-status/.test(indexHtml), false,
    "the status line is created by the module, not baked into the page");
});
