var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var root = path.join(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

test("composer exposes Loop interview beside Send while retaining active run status controls", function () {
  var html = source("lib/public/index.html");
  var selector = html.indexOf('id="loop-interview-btn"');
  var send = html.indexOf('id="send-btn"');
  assert.ok(selector > 0 && send > selector);
  assert.match(html, /id="loop-interview-btn"[^>]*aria-label="Start Loop interview"/);
  assert.doesNotMatch(html, /id="execution-mode-wrap"/);
  assert.match(html, /id="autonomous-run-status"/);
  assert.match(html, /id="autonomous-run-stop"/);
  assert.match(html, /id="autonomous-run-resume"/);
});

test("Until complete client state is store-owned and send waits for the server arm token", function () {
  var moduleSource = source("lib/public/modules/autonomous-run.js");
  var appSource = source("lib/public/app.js");
  var inputSource = source("lib/public/modules/input.js");
  assert.match(appSource, /autonomousSelectedMode: "normal"/);
  assert.match(moduleSource, /store\.set\(\{ autonomousArming: true/);
  assert.doesNotMatch(moduleSource, /^var (selectedMode|arming|armToken|criteria|maxContinuations|maxMinutes|currentRun|expanded)\s*=/m);
  assert.doesNotMatch(moduleSource, /localStorage/);
  assert.match(moduleSource, /payload\.autonomousRunToken = state\.autonomousArmToken/);
  assert.ok(inputSource.indexOf("prepareAutonomousPayload(payload)") < inputSource.indexOf("addUserMessage("));
});

test("standalone Loop creation UI is removed while scheduler creation and legacy runtime remain", function () {
  var html = source("lib/public/index.html");
  var app = source("lib/public/app.js");
  var palette = source("lib/public/modules/tool-palette-order.js");
  var scheduler = source("lib/public/modules/scheduler.js");
  var serverLoop = source("lib/project-loop.js");
  assert.doesNotMatch(html, /id="ralph-loop-section"|id="ralph-wizard"/);
  assert.doesNotMatch(app, /app-loop-wizard/);
  assert.doesNotMatch(palette, /ralph-loop/);
  assert.match(scheduler, /openCreateModal\(new Date\(\), null, addTrigger\)/);
  assert.match(serverLoop, /schedule_create/);
  assert.match(serverLoop, /loop_registry_list/);
});

test("new client and server modules follow project syntax and size boundaries", function () {
  var files = ["lib/project-autonomous-run.js", "lib/project-full-access.js", "lib/project-pair-autonomous-stop.js", "lib/public/modules/autonomous-run.js"];
  for (var i = 0; i < files.length; i++) {
    var text = source(files[i]);
    assert.doesNotMatch(text, /=>/, files[i] + " uses no arrow functions");
    assert.doesNotMatch(text, /^\s*(const|let)\s/m, files[i] + " uses var");
    assert.ok(text.split("\n").length <= 500, files[i] + " stays within 500 lines");
  }
  assert.ok(source("lib/project-session-pair.js").split("\n").length < 500, "session pair remains under 500 lines");
});

test("desktop Enter and mobile button-send behavior remain intact", function () {
  var input = source("lib/public/modules/input.js");
  var css = source("lib/public/css/input.css");
  assert.match(input, /Mobile: Enter inserts newline, send via button only/);
  assert.match(input, /e\.key === "Enter" && !e\.shiftKey && !isComposing/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*#execution-mode-label/);
});

test("server consumes an arm token only after delivery deduplication and tags later steering", function () {
  var server = source("lib/project-user-message.js");
  assert.ok(server.indexOf("messageDelivery.inspect") < server.indexOf("ctx.autonomousRun.consume"));
  assert.match(server, /sdk\.pushMessage\(session, finalText, msg\.images, autonomousDeliveryMeta\)/);
});

function FakeClassList(names) {
  this.names = new Set(names || []);
}
FakeClassList.prototype.add = function (name) { this.names.add(name); };
FakeClassList.prototype.remove = function (name) { this.names.delete(name); };
FakeClassList.prototype.contains = function (name) { return this.names.has(name); };
FakeClassList.prototype.toggle = function (name, force) {
  var enabled = force === undefined ? !this.names.has(name) : !!force;
  if (enabled) this.names.add(name); else this.names.delete(name);
  return enabled;
};

function FakeElement(id, classes) {
  this.id = id || "";
  this.classList = new FakeClassList(classes);
  this.listeners = {};
  this.attributes = {};
  this.children = [];
  this.textContent = "";
  this.value = "";
  this.disabled = false;
  this.focused = false;
}
FakeElement.prototype.addEventListener = function (type, handler) { this.listeners[type] = handler; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.getAttribute = function (name) { return this.attributes[name]; };
FakeElement.prototype.appendChild = function (child) { this.children.push(child); return child; };
FakeElement.prototype.contains = function (target) { return target === this || this.children.indexOf(target) !== -1; };
FakeElement.prototype.focus = function () { this.focused = true; };
FakeElement.prototype.remove = function () {};
FakeElement.prototype.click = function () {
  if (this.listeners.click) this.listeners.click({ target: this, stopPropagation: function () {} });
};

function fakeDom() {
  var ids = {};
  function add(id, classes) { ids[id] = new FakeElement(id, classes); return ids[id]; }
  add("home-hub", ["hidden"]); add("execution-mode-wrap", ["hidden"]); add("execution-mode-btn");
  add("execution-mode-label"); add("execution-mode-popover", ["hidden"]); add("execution-normal-option");
  add("execution-until-option"); add("execution-success-criteria"); add("execution-max-continuations").value = "10";
  add("execution-max-minutes").value = "60"; add("autonomous-run-status", ["hidden"]); add("autonomous-run-state");
  add("autonomous-run-progress"); add("autonomous-run-detail"); add("autonomous-run-stop");
  add("autonomous-run-resume", ["hidden"]); add("autonomous-run-toggle");
  var listeners = {};
  var body = new FakeElement("body");
  return {
    ids: ids, listeners: listeners, body: body,
    getElementById: function (id) { return ids[id] || null; },
    createElement: function () { return new FakeElement(""); },
    addEventListener: function (type, handler) { listeners[type] = handler; },
  };
}

test("mode interactions close on Escape and ignore delayed results from another session", async function () {
  var priorDocument = global.document;
  var priorNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
  var priorAnimation = global.requestAnimationFrame;
  var priorLucide = global.lucide;
  var dom = fakeDom();
  global.document = dom;
  Object.defineProperty(global, "navigator", { configurable: true, value: { userAgent: "node", platform: "node", maxTouchPoints: 0, clipboard: null } });
  global.requestAnimationFrame = function (callback) { callback(); return 1; };
  global.lucide = { createIcons: function () {} };
  try {
    var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
    var wsModule = await import(pathToFileURL(path.join(root, "lib/public/modules/ws-ref.js")).href);
    var sent = [];
    storeModule.createStore({ activeSessionId: 1, activeSessionMode: "gui", dmMode: false, processing: false,
      splitGroups: [], paneMode: false, paneSessionId: null, autonomousSelectedMode: "normal", autonomousArming: false,
      autonomousArmToken: null, autonomousArmRequestId: null, autonomousArmSessionId: null,
      autonomousActionRequestId: null, autonomousActionSessionId: null, autonomousCriteria: "", autonomousRun: null,
      autonomousExpanded: false, autonomousMaxContinuations: 10, autonomousMaxMinutes: 60 });
    wsModule.setWs({ readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } });
    var moduleUrl = pathToFileURL(path.join(root, "lib/public/modules/autonomous-run.js")).href + "?interaction=" + Date.now();
    var autonomous = await import(moduleUrl);
    autonomous.initAutonomousRun();

    dom.ids["execution-mode-btn"].click();
    assert.equal(dom.ids["execution-mode-btn"].getAttribute("aria-expanded"), "true");
    assert.equal(dom.ids["execution-mode-popover"].classList.contains("hidden"), false);
    var prevented = false;
    dom.listeners.keydown({ key: "Escape", preventDefault: function () { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(dom.ids["execution-mode-popover"].classList.contains("hidden"), true);
    assert.equal(dom.ids["execution-mode-btn"].getAttribute("aria-expanded"), "false");
    assert.equal(dom.ids["execution-mode-btn"].focused, true);
    assert.match(dom.ids["execution-mode-btn"].getAttribute("aria-label"), /Normal/);

    dom.ids["execution-success-criteria"].value = "Session one criterion";
    dom.ids["execution-until-option"].click();
    var firstArm = sent.pop();
    assert.deepEqual(firstArm.successCriteria, ["Session one criterion"]);
    storeModule.store.set({ activeSessionId: 2 });
    autonomous.syncAutonomousRunForSession(null);
    assert.equal(dom.ids["execution-success-criteria"].value, "");
    autonomous.handleAutonomousRunMessage({ type: "autonomous_run_arm_result", ok: true, sessionId: 1,
      requestId: firstArm.requestId, armToken: "old-token", run: { id: "old-run", state: "armed", successCriteria: ["Old"] } });
    assert.equal(storeModule.store.get("autonomousSelectedMode"), "normal");
    assert.equal(storeModule.store.get("autonomousArmToken"), null);
    assert.equal(storeModule.store.get("autonomousCriteria"), "");

    dom.ids["execution-success-criteria"].value = "Session two criterion";
    dom.ids["execution-until-option"].click();
    var secondArm = sent.pop();
    autonomous.handleAutonomousRunMessage({ type: "autonomous_run_arm_result", ok: false, sessionId: 1,
      requestId: firstArm.requestId, error: "late failure" });
    assert.equal(storeModule.store.get("autonomousArming"), true);
    assert.equal(storeModule.store.get("autonomousCriteria"), "Session two criterion");
    autonomous.handleAutonomousRunMessage({ type: "autonomous_run_arm_result", ok: true, sessionId: 2,
      requestId: secondArm.requestId, armToken: "token-two", run: { id: "run-two", state: "armed", successCriteria: ["Canonical two"] } });
    assert.equal(storeModule.store.get("autonomousCriteria"), "Canonical two");
    assert.equal(dom.ids["execution-success-criteria"].value, "Canonical two");
    assert.match(dom.ids["execution-mode-btn"].getAttribute("aria-label"), /Loop/);

    dom.ids["autonomous-run-stop"].click();
    var stopRequest = sent.pop();
    storeModule.store.set({ activeSessionId: 3 });
    autonomous.syncAutonomousRunForSession(null);
    autonomous.handleAutonomousRunMessage({ type: "autonomous_run_action_result", ok: false, sessionId: 2,
      requestId: stopRequest.requestId, runId: "run-two", error: "late stop failure" });
    assert.equal(storeModule.store.get("autonomousRun"), null);
    assert.equal(dom.body.children.length, 0, "a stale error does not show a toast in the new session");
  } finally {
    global.document = priorDocument;
    if (priorNavigator) Object.defineProperty(global, "navigator", priorNavigator); else delete global.navigator;
    global.requestAnimationFrame = priorAnimation;
    global.lucide = priorLucide;
  }
});
