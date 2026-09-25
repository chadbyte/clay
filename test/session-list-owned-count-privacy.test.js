var fs = require("fs");
var os = require("os");
var path = require("path");
// Isolate every config read before any Clay module loads.
var HOME = fs.mkdtempSync(path.join(os.tmpdir(), "clay-owned-count-home-"));
process.env.CLAY_HOME = HOME;

var test = require("node:test");
var assert = require("node:assert");
var users = require("../lib/users");
var createSessionManager = require("../lib/sessions").createSessionManager;
var sessionProvenance = require("../lib/session-provenance");
var attachConnection = require("../lib/project-connection").attachConnection;

test.after(function () { fs.rmSync(HOME, { recursive: true, force: true }); });

// A multi-user project where "owner" shares a Driver that owns a hidden and
// a private Worker, plus a Driver with no Workers.
function fixture(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-owned-count-"));
  var originalMultiUser = users.isMultiUser;
  var originalAccess = users.canAccessSession;
  users.isMultiUser = function () { return true; };
  users.canAccessSession = function (userId, session) {
    return (session.ownerId || null) === userId || session.sessionVisibility === "shared";
  };
  t.after(function () {
    users.isMultiUser = originalMultiUser;
    users.canAccessSession = originalAccess;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  var sockets = [];
  var sm = createSessionManager({ cwd: path.join(dir, "project"), sessionsBase: path.join(dir, "sessions"),
    cliSessionsDir: path.join(dir, "cli"), send: function () {}, sendTo: function () {},
    sendEach: function (fn) {
      sockets.forEach(function (ws) {
        fn(ws, function (s) { return users.canAccessSession(ws._clayUser.id, s, { visibility: "public" }); });
      });
    } });
  function make(name, ownerId, extra) {
    var session = sm.createSessionRaw(Object.assign({ cliSessionId: "cli-" + name, ownerId: ownerId }, extra || {}));
    session.title = name;
    return session;
  }
  var shared = make("shared-driver", "owner", { sessionVisibility: "shared" });
  var hiddenWorker = make("hidden-worker", "owner", { hidden: true });
  var privateWorker = make("private-worker", "owner", { sessionVisibility: "private" });
  sessionProvenance.markWorker(shared, hiddenWorker, sm.sessions);
  sessionProvenance.markWorker(shared, privateWorker, sm.sessions);
  var empty = make("empty-driver", "owner", { sessionVisibility: "shared" });
  var viewerOwn = make("viewer-driver", "viewer");
  return { sm: sm, sockets: sockets, shared: shared, empty: empty, privateWorker: privateWorker, viewerOwn: viewerOwn };
}

function socket(userId) {
  var ws = { readyState: 1, _clayUser: { id: userId }, lists: [] };
  ws.send = function (raw) { var msg = JSON.parse(raw); if (msg.type === "session_list") ws.lists.push(msg.sessions); };
  return ws;
}

function row(list, session) {
  return list.find(function (item) { return item.id === session.localId; });
}

test("the session list gives owned Worker counts only to the Driver's owner", function (t) {
  var f = fixture(t);
  var visible = Array.from(f.sm.sessions.values()).filter(function (s) { return !s.hidden; });
  var ownerView = f.sm.mapSessionsForClient(visible, undefined, undefined, "owner");
  assert.equal(row(ownerView, f.shared).ownedWorkerCount, 2, "the owner sees hidden and private Workers counted");
  assert.equal(row(ownerView, f.empty).ownedWorkerCount, 0);

  var viewerList = visible.filter(function (s) { return users.canAccessSession("viewer", s); });
  var viewerView = f.sm.mapSessionsForClient(viewerList, undefined, undefined, "viewer");
  assert.equal(row(viewerView, f.privateWorker), undefined, "the private Worker is not listed to the viewer");
  assert.equal("ownedWorkerCount" in row(viewerView, f.shared), false, "no count for a shared Driver with private Workers");
  assert.equal("ownedWorkerCount" in row(viewerView, f.empty), false, "no misleading 0 either, so presence reveals nothing");
  assert.equal(row(viewerView, f.viewerOwn).ownedWorkerCount, 0, "the viewer still gets exact counts for their own Drivers");

  var anonymous = f.sm.mapSessionsForClient(visible, undefined, undefined, null);
  assert.equal(anonymous.some(function (item) { return "ownedWorkerCount" in item && item.sessionRole === "driver"; }), false,
    "no trusted viewer identity means no Driver counts");
});

test("subsequent broadcasts never leak another owner's Worker count", function (t) {
  var f = fixture(t);
  var ownerWs = socket("owner");
  var viewerWs = socket("viewer");
  f.sockets.push(ownerWs, viewerWs);
  f.sm.broadcastSessionList();
  var ownerList = ownerWs.lists[ownerWs.lists.length - 1];
  var viewerList = viewerWs.lists[viewerWs.lists.length - 1];
  assert.equal(row(ownerList, f.shared).ownedWorkerCount, 2);
  assert.equal("ownedWorkerCount" in row(viewerList, f.shared), false);
  assert.equal("ownedWorkerCount" in row(viewerList, f.empty), false);
  assert.equal(JSON.stringify(viewerList).indexOf("ownedWorkerCount\":2"), -1);
});

test("the initial connection list never leaks another owner's Worker count", function (t) {
  var f = fixture(t);
  var lists = {};
  var connection = attachConnection({
    cwd: "/srv/example", slug: "example", clients: new Set(), opts: {}, sm: f.sm,
    tm: { list: function () { return []; } }, nm: { list: function () { return []; } },
    _loop: { loopState: {}, sendConnectionState: function () {} },
    sendTo: function (ws, msg) { if (msg.type === "session_list") lists[ws._clayUser.id] = msg.sessions; },
    broadcastClientCount: function () {}, broadcastPresence: function () {},
    getProjectList: function () { return []; }, getHubSchedules: function () { return []; },
    getTitle: function () { return "Example"; }, getProject: function () { return "example"; },
    getProjectOwnerId: function () { return "owner"; },
  });
  ["owner", "viewer"].forEach(function (userId) {
    var ws = { readyState: 1, _clayPane: true };
    // Later connection steps need the full project; the list is sent first.
    try { connection.handleConnection(ws, { id: userId }, function () {}, function () {}); } catch (e) {}
    assert.ok(lists[userId], "the connect-time session list was sent to " + userId);
  });
  assert.equal(row(lists.owner, f.shared).ownedWorkerCount, 2);
  assert.equal("ownedWorkerCount" in row(lists.viewer, f.shared), false);
  assert.equal("ownedWorkerCount" in row(lists.viewer, f.empty), false);
  assert.equal(row(lists.viewer, f.viewerOwn).ownedWorkerCount, 0);
});

test("a missing count still requires the cascade confirmation", async function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/session-delete-scope.js"), "utf8");
  var scope = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  var sessions = [{ id: 1, title: "Shared", sessionRole: "driver" }];
  var described = scope.describeSessionDelete({ id: 1, title: "Shared" }, sessions);
  assert.equal(described.workerCount, null);
  assert.equal(described.requiresDialog, true);
  assert.match(described.message, /If it is a Driver, every Split Worker session it owns, including hidden sessions and previous generations/);
  assert.equal(scope.describeGroupDelete("Shared", [1], sessions).exact, false);
});
