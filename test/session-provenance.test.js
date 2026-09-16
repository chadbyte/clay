var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;
var createSessionManager = require("../lib/sessions").createSessionManager;
var provenance = require("../lib/session-provenance");
var attachPairFactory = require("../lib/session-pair-factory").attachPairFactory;
var attachPairLifecycle = require("../lib/project-pair-lifecycle").attachPairLifecycle;

function managerAt(root, sendEach) {
  return createSessionManager({
    cwd: path.join(root, "project"),
    sessionsBase: path.join(root, "sessions"),
    cliSessionsDir: path.join(root, "cli"),
    send: function () {},
    sendEach: sendEach || null,
  });
}

function hierarchyElement() {
  var attributes = {};
  var listeners = {};
  return {
    children: [],
    hidden: false,
    className: "",
    classList: { add: function () {} },
    setAttribute: function (name, value) { attributes[name] = value; },
    getAttribute: function (name) { return attributes[name]; },
    addEventListener: function (name, listener) { listeners[name] = listener; },
    appendChild: function (child) { this.children.push(child); return child; },
    insertBefore: function (child) { this.children.unshift(child); return child; },
    click: function () {
      listeners.click({ preventDefault: function () {}, stopPropagation: function () {} });
    },
  };
}

test("Worker provenance survives restart and local id reassignment", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-provenance-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var first = managerAt(root);
  var driver = first.createSessionRaw({ cliSessionId: "driver-stable", vendor: "claude" });
  var worker = first.createSessionRaw({ cliSessionId: "worker-stable", vendor: "codex" });
  provenance.markWorker(driver, worker, first.sessions);
  first.saveSessionFile(driver);
  first.saveSessionFile(worker);

  var second = managerAt(root);
  var restored = Array.from(second.sessions.values());
  var projected = second.mapSessionsForClient(restored);
  var restoredDriver = projected.find(function (session) { return session.cliSessionId === "driver-stable"; });
  var restoredWorker = projected.find(function (session) { return session.cliSessionId === "worker-stable"; });
  assert.equal(restoredWorker.sessionRole, "worker");
  assert.equal(restoredWorker.parentSessionId, restoredDriver.id);
  assert.equal(restoredWorker.parentAvailable, true);
  assert.equal(restoredWorker.workerGeneration, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(restoredWorker, "sessionOriginId"), false, "opaque durable anchors stay server-side");
});

test("persisted generation ledger and restored Worker generation survive reload", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-generation-ledger-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var first = managerAt(root);
  var driver = first.createSessionRaw({ cliSessionId: "ledger-driver", vendor: "claude" });
  var worker = first.createSessionRaw({ cliSessionId: "ledger-worker", vendor: "codex" });
  provenance.markWorker(driver, worker, first.sessions);
  worker.sessionProvenance.generation = 12;
  worker._pairGeneration = 12;
  driver._workerGenerations = [{ generation: 8, workerSessionId: 99, endedAt: 1, evaluation: null }];
  first.saveSessionFile(driver);
  first.saveSessionFile(worker);
  var second = managerAt(root);
  var restoredDriver = Array.from(second.sessions.values()).filter(function (s) { return s.cliSessionId === "ledger-driver"; })[0];
  var restoredWorker = Array.from(second.sessions.values()).filter(function (s) { return s.cliSessionId === "ledger-worker"; })[0];
  assert.equal(restoredWorker._pairGeneration, 12);
  assert.equal(restoredWorker.sessionProvenance.generation, 12);
  assert.deepEqual(restoredDriver._workerGenerations, [{ generation: 8, workerSessionId: 99, endedAt: 1, evaluation: null }]);
});

test("manager reload reconciles Worker origins before the first evaluation and close", async function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-generation-reload-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var first = managerAt(root);
  var driver = first.createSessionRaw({ cliSessionId: "origin-driver", vendor: "claude" });
  var worker = first.createSessionRaw({ cliSessionId: "origin-worker", vendor: "codex" });
  provenance.markWorker(driver, worker, first.sessions);
  worker.sessionProvenance.generation = 1;
  worker._pairGeneration = 1;
  driver._workerGenerations = [{ generation: 1, workerSessionId: worker.localId, endedAt: null, evaluation: null }];
  first.saveSessionFile(driver);
  first.saveSessionFile(worker);

  var inserted = first.createSessionRaw({ cliSessionId: "origin-inserted", vendor: "claude" });
  inserted.createdAt = driver.createdAt - 1000;
  inserted.history.push({ type: "user_message", text: "anchor" });
  first.saveSessionFile(inserted);
  var insertedTwo = first.createSessionRaw({ cliSessionId: "origin-inserted-two", vendor: "claude" });
  insertedTwo.createdAt = driver.createdAt - 900;
  insertedTwo.history.push({ type: "user_message", text: "anchor-two" });
  first.saveSessionFile(insertedTwo);
  var second = managerAt(root);
  var restored = Array.from(second.sessions.values());
  var restoredDriver = restored.filter(function (s) { return s.cliSessionId === "origin-driver"; })[0];
  var restoredWorker = restored.filter(function (s) { return s.cliSessionId === "origin-worker"; })[0];
  assert.notEqual(restoredWorker.localId, worker.localId, "reload reassigned local IDs");
  var group = { id: "reloaded-group", pair: { driverId: restoredDriver.localId, workerId: restoredWorker.localId } };
  var lifecycle = attachPairLifecycle({
    sm: second,
    splitStore: { groupForMember: function (id) { return id === restoredDriver.localId || id === restoredWorker.localId ? group : null; } },
    turnControl: { blockedReason: function () { return null; }, status: function () { return {}; } },
  });
  var evaluatedResult = await lifecycle.toolHandlers(restoredDriver).evaluate({ outcome: "partial" });
  var evaluated = JSON.parse(evaluatedResult.content[0].text);
  assert.equal(evaluated.generation, 1);
  assert.equal(restoredDriver._workerGenerations[0].workerOriginId, restoredWorker.sessionOriginId);
  assert.equal(restoredDriver._workerGenerations[0].evaluation.outcome, "partial");
  lifecycle.closeGeneration(restoredDriver, restoredWorker);
  second.saveSessionFile(restoredDriver);

  var third = managerAt(root);
  var thirdDriver = Array.from(third.sessions.values()).filter(function (s) { return s.cliSessionId === "origin-driver"; })[0];
  var thirdWorker = Array.from(third.sessions.values()).filter(function (s) { return s.cliSessionId === "origin-worker"; })[0];
  assert.equal(thirdDriver._workerGenerations[0].workerOriginId, thirdWorker.sessionOriginId);
  assert.equal(thirdDriver._workerGenerations[0].workerSessionId, thirdWorker.localId);
  assert.equal(thirdDriver._workerGenerations[0].evaluation.outcome, "partial");
  assert.notEqual(thirdDriver._workerGenerations[0].endedAt, null, "the exact old origin was closed");
});

test("factory-created Worker remains nested after a restart", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-provenance-factory-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var first = managerAt(root);
  first.installedVendors = ["claude", "codex"];
  var driver = first.createSessionRaw({ cliSessionId: "factory-driver", vendor: "claude" });
  var createRaw = first.createSessionRaw;
  first.createSessionRaw = function (spec) {
    return createRaw(Object.assign({}, spec, { cliSessionId: "factory-worker" }));
  };
  var factory = attachPairFactory({
    sm: first,
    splitStore: {
      groupForMember: function () { return null; },
      create: function (ws, record) { return { ok: true, group: { id: "sg_factory", members: record.members, pair: record.pair } }; },
    },
    isMate: false,
    usersModule: { isMultiUser: function () { return false; } },
    sendTo: function () {},
  });
  factory.createPairRecord({ _clayUser: null }, {
    driver: { sessionId: driver.localId },
    worker: { vendor: "codex" },
  });

  var workerMeta = JSON.parse(fs.readFileSync(path.join(first.sessionsDir, "factory-worker.jsonl"), "utf8").split("\n")[0]);
  assert.equal(workerMeta.sessionProvenance.kind, "worker", "the factory persists the Worker's provenance");
  var second = managerAt(root);
  var projected = second.mapSessionsForClient(Array.from(second.sessions.values()));
  var restoredDriver = projected.find(function (session) { return session.cliSessionId === "factory-driver"; });
  var restoredWorker = projected.find(function (session) { return session.cliSessionId === "factory-worker"; });
  assert.equal(restoredWorker.sessionRole, "worker");
  assert.equal(restoredWorker.parentSessionId, restoredDriver.id);
  assert.equal(restoredWorker.parentAvailable, true);
});

test("factory rollback removes a Worker file persisted before group creation fails", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-provenance-rollback-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var manager = managerAt(root);
  manager.installedVendors = ["claude", "codex"];
  var driver = manager.createSessionRaw({ cliSessionId: "rollback-driver", vendor: "claude" });
  var initialSize = manager.sessions.size;
  var createRaw = manager.createSessionRaw;
  manager.createSessionRaw = function (spec) {
    return createRaw(Object.assign({}, spec, { cliSessionId: "rollback-worker" }));
  };
  var factory = attachPairFactory({
    sm: manager,
    splitStore: {
      groupForMember: function () { return null; },
      create: function () { return { ok: false, error: "late group failure" }; },
    },
    isMate: false,
    usersModule: { isMultiUser: function () { return false; } },
    sendTo: function () {},
  });
  assert.throws(function () {
    factory.createPairRecord({ _clayUser: null }, {
      driver: { sessionId: driver.localId },
      worker: { vendor: "codex" },
    });
  }, /late group failure/);
  assert.equal(manager.sessions.size, initialSize);
  assert.equal(manager.sessions.get(driver.localId), driver);
  assert.equal(fs.existsSync(path.join(manager.sessionsDir, "rollback-worker.jsonl")), false);
});

test("legacy migration assigns an origin without changing session recency", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-provenance-migrate-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var cwd = path.join(root, "project");
  var sessionsDir = path.join(root, "sessions", require("../lib/utils").encodeCwd(cwd));
  var file = path.join(sessionsDir, "legacy.jsonl");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ type: "meta", cliSessionId: "legacy", title: "Legacy", createdAt: 1000 }) + "\n" +
    JSON.stringify({ type: "user_message", text: "Keep this legacy session" }) + "\n");
  var oldTime = new Date("2025-01-02T03:04:05.000Z");
  fs.utimesSync(file, oldTime, oldTime);
  var manager = createSessionManager({ cwd: cwd, sessionsBase: path.join(root, "sessions"), cliSessionsDir: path.join(root, "cli"), send: function () {} });
  var session = Array.from(manager.sessions.values())[0];
  var savedMeta = JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]);
  assert.equal(typeof savedMeta.sessionOriginId, "string");
  assert.equal(manager.mapSessionsForClient([session])[0].sessionRole, "driver");
  assert.equal(Math.round(fs.statSync(file).mtimeMs), oldTime.getTime());
});

test("replacement generations remain attached after pair state is dissolved", function () {
  var sessions = new Map();
  var driver = { localId: 1, ownerId: "u1" };
  var first = { localId: 2, ownerId: "u1" };
  var second = { localId: 3, ownerId: "u1" };
  sessions.set(1, driver);
  sessions.set(2, first);
  provenance.markWorker(driver, first, sessions);
  sessions.set(3, second);
  provenance.markWorker(driver, second, sessions);
  var hierarchy = provenance.hierarchyFor([driver, first, second]);
  assert.equal(hierarchy[2].parentSessionId, 1);
  assert.equal(hierarchy[3].parentSessionId, 1);
  assert.deepEqual([hierarchy[2].generation, hierarchy[3].generation], [1, 2]);
});

test("legacy and ad-hoc sessions stay top-level without inferred parentage", function () {
  var left = { localId: 1, ownerId: null };
  var right = { localId: 2, ownerId: null };
  provenance.ensureOrigin(left);
  provenance.ensureOrigin(right);
  var hierarchy = provenance.hierarchyFor([left, right]);
  assert.equal(hierarchy[1].role, "driver");
  assert.equal(hierarchy[2].role, "driver");
  assert.equal(hierarchy[2].parentSessionId, null);
});

test("missing, cross-owner, nested, and ambiguous parents fail closed as orphaned Workers", function () {
  var parent = { localId: 1, ownerId: "u1", sessionOriginId: "same-origin" };
  var duplicate = { localId: 2, ownerId: "u1", sessionOriginId: "same-origin" };
  var crossOwner = { localId: 3, ownerId: "u2", sessionOriginId: "cross-origin" };
  var workers = [
    { localId: 4, ownerId: "u1", sessionProvenance: { kind: "worker", parentSessionOriginId: "missing" } },
    { localId: 5, ownerId: "u1", sessionProvenance: { kind: "worker", parentSessionOriginId: "cross-origin" } },
    { localId: 6, ownerId: "u1", sessionProvenance: { kind: "worker", parentSessionOriginId: "same-origin" } },
    { localId: 7, ownerId: "u1", sessionOriginId: "worker-parent", sessionProvenance: { kind: "worker", parentSessionOriginId: "missing" } },
    { localId: 8, ownerId: "u1", sessionProvenance: { kind: "worker", parentSessionOriginId: "worker-parent" } },
  ];
  var hierarchy = provenance.hierarchyFor([parent, duplicate, crossOwner].concat(workers));
  for (var i = 4; i <= 8; i++) {
    assert.equal(hierarchy[i].role, "worker");
    assert.equal(hierarchy[i].parentAvailable, false);
    assert.equal(hierarchy[i].parentSessionId, null);
  }
});

test("owner-filtered projection never reveals an inaccessible parent", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-provenance-owner-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var manager = managerAt(root);
  var driver = manager.createSessionRaw({ ownerId: "u1" });
  var worker = manager.createSessionRaw({ ownerId: "u1" });
  provenance.markWorker(driver, worker, manager.sessions);
  var projected = manager.mapSessionsForClient([worker]);
  assert.equal(projected[0].sessionRole, "worker");
  assert.equal(projected[0].parentAvailable, false);
  assert.equal(projected[0].parentSessionId, null);
});

test("client hierarchy groups generations and quarantines orphaned Workers", async function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/session-hierarchy.js"), "utf8");
  var module = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  var tree = module.buildSessionHierarchy([
    { id: 1, sessionRole: "driver", title: "Driver", lastActivity: 10 },
    { id: 2, sessionRole: "worker", parentAvailable: true, parentSessionId: 1, workerGeneration: 1, lastActivity: 20 },
    { id: 3, sessionRole: "worker", parentAvailable: true, parentSessionId: 1, workerGeneration: 2, lastActivity: 30 },
    { id: 4, sessionRole: "worker", parentAvailable: false, parentSessionId: null, lastActivity: 40 },
  ]);
  assert.equal(tree.roots.length, 1);
  assert.deepEqual(tree.roots[0].workers.map(function (worker) { return worker.id; }), [3, 2]);
  assert.equal(tree.roots[0].lastActivity, 30);
  assert.deepEqual(tree.orphans.map(function (worker) { return worker.id; }), [4]);
});

test("project hierarchy defaults open for active, current, and searched Workers", async function () {
  var url = pathToFileURL(path.join(__dirname, "../lib/public/modules/sidebar-session-hierarchy.js")).href;
  var module = await import(url + "?provenance-test=" + Date.now());
  var idle = [{ id: 2, active: false }];
  assert.equal(module.defaultHierarchyExpanded(idle, null, new Set()), false);
  assert.equal(module.defaultHierarchyExpanded([{ id: 2, active: true }], null, new Set()), true);
  assert.equal(module.defaultHierarchyExpanded(idle, null, new Set([2])), true);
  assert.equal(module.defaultHierarchyExpanded(idle, new Set([2]), new Set()), true);

  var originalDocument = global.document;
  global.document = { createElement: function () { return hierarchyElement(); } };
  try {
    var rerenders = 0;
    var tree = module.renderDesktopDriverHierarchy({
      driver: { id: 1, title: "Driver" },
      workers: [{ id: 2, active: true }],
    }, function () { return hierarchyElement(); }, function () { rerenders++; }, null);
    var header = tree.children[0];
    var toggle = header.children[0];
    var row = header.children[1];
    var children = tree.children[1];
    assert.notEqual(toggle, row);
    assert.equal(children.hidden, false);
    toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(children.hidden, true);
    toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(children.hidden, false);
    assert.equal(rerenders, 0);
  } finally {
    global.document = originalDocument;
  }
});

test("desktop, mobile, and Home trees expose accessible expansion controls", function () {
  var desktop = fs.readFileSync(path.join(__dirname, "../lib/public/modules/sidebar-sessions.js"), "utf8");
  var mobile = fs.readFileSync(path.join(__dirname, "../lib/public/modules/sidebar-mobile.js"), "utf8");
  var projectHierarchy = fs.readFileSync(path.join(__dirname, "../lib/public/modules/sidebar-session-hierarchy.js"), "utf8");
  var home = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-sidebar-chat-list.js"), "utf8");
  var sheet = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-conversations-sheet.js"), "utf8");
  var combined = desktop + mobile + projectHierarchy + home + sheet;
  assert.match(projectHierarchy, /session-driver-toggle[\s\S]*aria-expanded[\s\S]*aria-controls/);
  assert.match(projectHierarchy, /children\.hidden = !nextExpanded/);
  assert.match(projectHierarchy, /session-driver-header[\s\S]*header\.appendChild\(control\)[\s\S]*header\.appendChild\(row\)/);
  assert.doesNotMatch(desktop, /isDesktopHierarchyToggleEvent/);
  assert.match(projectHierarchy, /mobile-driver-toggle[\s\S]*aria-expanded[\s\S]*aria-controls/);
  assert.match(home, /home-sidebar-driver-toggle[\s\S]*aria-expanded[\s\S]*aria-controls/);
  assert.match(sheet, /home-conversations-driver-toggle[\s\S]*aria-expanded[\s\S]*aria-controls/);
  assert.match(combined, /setAttribute\("role", "group"\)/);
  assert.doesNotMatch(combined, /localStorage/);
  assert.match(desktop, /renderDesktopDriverHierarchy/);
  assert.match(mobile, /renderMobileDriverHierarchy/);
  assert.doesNotMatch(desktop, /session-driver-toggle/);
  assert.doesNotMatch(mobile, /mobile-driver-toggle/);
  assert.ok(projectHierarchy.split("\n").length < 500);
});
