var test = require("node:test");
var assert = require("node:assert/strict");
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;
var attachVendorUsageOverview = require("../lib/vendor-usage-overview").attachVendorUsageOverview;
var codexKit = require("../lib/yoke/adapters/codex").contractTestKit;

// Real message processor, real quota recorder and the real overview, with an
// in-memory session manager and sockets. Nothing touches disk or a vendor.
function fixture(options) {
  options = options || {};
  var sessions = new Map();
  var recorded = [];
  var sm = {
    sessions: sessions,
    sendAndRecord: function (session, msg) { msg._ts = msg._ts || Date.now(); session.history.push(msg); recorded.push(msg); },
    broadcastSessionList: function () {},
  };
  var rejections = [];
  var processor = attachMessageProcessor({
    sm: sm, opts: { onRateLimitRejected: function (session, at) { rejections.push({ session: session.localId, at: at }); } },
    onProcessingChanged: function () {}, onTurnDone: function () {},
  });
  var sent = [];
  function socket(userId, extra) {
    return Object.assign({ readyState: 1, _clayUser: userId ? { id: userId } : undefined, sent: [] }, extra || {});
  }
  var clients = new Set();
  var clock = { now: Date.now() };
  var revoked = {}, noAccess = {};
  var overview = attachVendorUsageOverview({
    slug: "alpha", sm: sm, clients: clients,
    usersModule: {
      isMultiUser: function () { return options.multiUser !== false; },
      findUserById: function (id) { return revoked[id] ? null : { id: id }; },
      canAccessProject: function (id) { return !noAccess[id]; },
    },
    getProjectAccess: function () { return { visibility: "public" }; },
    sendTo: function (ws, msg) { ws.sent.push(msg); sent.push(msg); },
    getVendorAvailability: function () {
      return options.availability || [
        { id: "claude", installed: true }, { id: "codex", installed: true }, { id: "muse", installed: true },
      ];
    },
    now: function () { return clock.now; },
  });
  var nextId = 1;
  function session(vendor, ownerId, extra) {
    var s = Object.assign({
      localId: nextId++, vendor: vendor, ownerId: ownerId, isProcessing: true, _awaitingTurnResult: true,
      messageUUIDs: [], history: [], pendingPermissions: {}, pendingElicitations: {}, pendingAskUser: {},
    }, extra || {});
    sessions.set(s.localId, s);
    return s;
  }
  function codexSnapshot(s, percent, resetInSeconds, limitId) {
    var event = codexKit.normalizeEvent({ method: "account/rateLimits/updated", params: { rateLimits: Object.assign({
      primary: { usedPercent: percent, windowDurationMins: 300, resetsAt: Math.floor(clock.now / 1000) + resetInSeconds },
    }, limitId ? { limitId: limitId } : {}) } }, codexKit.createEventState())[0];
    processor.processSDKMessage(s, event);
  }
  function latest(ws) { return ws.sent[ws.sent.length - 1]; }
  function vendorOf(message, vendor) { return message.vendors.filter(function (v) { return v.vendor === vendor; })[0]; }
  return { sm: sm, sessions: sessions, session: session, socket: socket, clients: clients, overview: overview, processor: processor,
    codexSnapshot: codexSnapshot, revoked: revoked, noAccess: noAccess, latest: latest, vendorOf: vendorOf, clock: clock, recorded: recorded, rejections: rejections, sent: sent };
}

test("an inactive vendor's snapshot reaches the owner's socket regardless of the socket's active session", function () {
  var f = fixture();
  var owner = f.socket("alice");
  f.clients.add(owner);
  owner._clayActiveSession = 999; // viewing some other session entirely
  var codex = f.session("codex", "alice");
  f.codexSnapshot(codex, 42, 3600);
  var message = f.latest(owner);
  assert.equal(message.type, "vendor_usage_overview");
  assert.equal(message.slug, "alpha");
  var entry = f.vendorOf(message, "codex");
  assert.equal(entry.windows.length, 1);
  assert.equal(entry.windows[0].usedPercent, 42);
  assert.equal(entry.windows[0].windowDurationMins, 300);
  assert.equal(entry.windows[0].origin, "live");
  assert.ok(Number.isFinite(entry.windows[0].observedAtMs));
  // Claude was never observed: no windows and no observation time, never 0%.
  var claude = f.vendorOf(message, "claude");
  assert.deepEqual(claude.windows, []);
  assert.equal(claude.lastObservedAtMs, null);
});

test("another account in the same project never receives or inherits the quota", function () {
  var f = fixture();
  var alice = f.socket("alice"), bob = f.socket("bob");
  f.clients.add(alice); f.clients.add(bob);
  f.codexSnapshot(f.session("codex", "alice"), 90, 3600);
  assert.equal(bob.sent.length, 0, "no push to a different owner");
  f.overview.handleMessage(bob, { type: "vendor_usage_get" });
  assert.deepEqual(f.vendorOf(f.latest(bob), "codex").windows, []);
  assert.equal(f.vendorOf(f.latest(bob), "codex").lastObservedAtMs, null);
  // The same vendor under two owners stays two independent records.
  f.codexSnapshot(f.session("codex", "bob"), 5, 3600);
  assert.equal(f.vendorOf(f.latest(bob), "codex").windows[0].usedPercent, 5);
  f.overview.handleMessage(alice, { type: "vendor_usage_get" });
  assert.equal(f.vendorOf(f.latest(alice), "codex").windows[0].usedPercent, 90);
});

test("ownerless sessions and unauthenticated sockets are excluded in account mode", function () {
  var f = fixture();
  var anon = f.socket(null);
  var alice = f.socket("alice");
  f.clients.add(anon); f.clients.add(alice);
  f.codexSnapshot(f.session("codex", undefined), 50, 3600);
  assert.equal(alice.sent.length, 0);
  f.overview.handleMessage(anon, { type: "vendor_usage_get" });
  assert.deepEqual(f.latest(anon).vendors, [], "an unidentified socket receives no vendor data");
  f.overview.handleMessage(alice, { type: "vendor_usage_get" });
  assert.deepEqual(f.vendorOf(f.latest(alice), "codex").windows, []);
});

test("single-user installations attribute everything to the one local user", function () {
  var f = fixture({ multiUser: false });
  var ws = f.socket(null);
  f.clients.add(ws);
  f.codexSnapshot(f.session("codex", undefined), 30, 3600);
  assert.equal(f.vendorOf(f.latest(ws), "codex").windows[0].usedPercent, 30);
});

test("project and unknown requests are bound to this project", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  assert.equal(f.overview.handleMessage(ws, { type: "something_else" }), false);
  assert.equal(f.overview.handleMessage(ws, { type: "vendor_usage_get", slug: "beta" }), true);
  assert.deepEqual(f.latest(ws).vendors, []);
  assert.match(f.latest(ws).error, /different project/);
});

test("history seeds observation times from the record, never from the scan time", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var old = Date.now() - 3 * 3600000;
  var s = f.session("codex", "alice");
  s.history.push({ type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex", _ts: old,
    quotaWindows: [{ key: "primary", windowDurationMins: 300, usedPercent: 61, resetsAt: Date.now() + 3600000 }] });
  s.history.push({ type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex", _ts: old + 1000,
    quotaWindows: [{ key: "primary", windowDurationMins: 300, usedPercent: 63, resetsAt: Date.now() + 3600000 }] });
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  var entry = f.vendorOf(f.latest(ws), "codex");
  assert.equal(entry.windows[0].usedPercent, 63, "latest recorded snapshot wins");
  assert.equal(entry.windows[0].observedAtMs, old + 1000);
  assert.equal(entry.windows[0].origin, "history", "replayed data is labelled as recorded history");
  assert.equal(entry.lastObservedAtMs, old + 1000);
});

test("history without a record time stays unobserved-time instead of becoming fresh", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("codex", "alice");
  s.history.push({ type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex",
    quotaWindows: [{ key: "primary", windowDurationMins: 300, usedPercent: 12, resetsAt: Date.now() + 3600000 }] });
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  var entry = f.vendorOf(f.latest(ws), "codex");
  assert.equal(entry.windows[0].observedAtMs, null);
  assert.equal(entry.lastObservedAtMs, null);
});

test("an older observation never overwrites a newer one, and a replayed session cannot refresh it", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("codex", "alice");
  var observe = f.overview.observe;
  var reset = Date.now() + 3600000;
  function snap(percent) {
    return { type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex",
      quotaWindows: [{ key: "primary", windowDurationMins: 300, usedPercent: percent, resetsAt: reset }] };
  }
  observe(s, snap(70), 2000000);
  observe(s, snap(20), 1000000);
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  assert.equal(f.vendorOf(f.latest(ws), "codex").windows[0].usedPercent, 70);
  // The session-view replay path re-sends history to a client; it is not an observation.
  var before = ws.sent.length;
  s.history.push(snap(20));
  assert.equal(ws.sent.length, before);
});

test("expired windows are dropped and never become zero", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("codex", "alice");
  f.codexSnapshot(s, 88, 600);
  assert.equal(f.vendorOf(f.latest(ws), "codex").windows.length, 1);
  f.clock.now += 11 * 60 * 1000;
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  var entry = f.vendorOf(f.latest(ws), "codex");
  assert.deepEqual(entry.windows, [], "the reset window is not reported as current usage");
  assert.ok(entry.lastObservedAtMs, "the last observation time is still disclosed");
});

test("claude reset and warning events record reset time and utilization only where observed", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("claude", "alice");
  var resetSec = Math.floor(Date.now() / 1000) + 3600;
  f.processor.processSDKMessage(s, { yokeType: "rate_limit", rateLimitInfo: { status: "allowed", rateLimitType: "five_hour", resetsAt: resetSec } });
  var entry = f.vendorOf(f.latest(ws), "claude");
  assert.equal(entry.windows[0].rateLimitType, "five_hour");
  assert.equal(entry.windows[0].usedPercent, null, "no utilization was reported, so none is shown");
  assert.equal(entry.windows[0].resetsAt, resetSec * 1000);
  f.processor.processSDKMessage(s, { yokeType: "rate_limit", rateLimitInfo: { status: "allowed_warning", rateLimitType: "five_hour", resetsAt: resetSec, utilization: 0.85 } });
  assert.equal(f.vendorOf(f.latest(ws), "claude").windows[0].usedPercent, 85);
});

test("legacy unstamped quota for a source-requiring vendor is ignored", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("codex", "alice");
  f.overview.observe(s, { type: "rate_limit_usage", vendor: "codex", rateLimitType: "five_hour", resetsAt: Date.now() + 3600000, status: "rejected" }, Date.now());
  assert.equal(ws.sent.length, 0);
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  assert.deepEqual(f.vendorOf(f.latest(ws), "codex").windows, []);
});

test("an empty snapshot clears that bucket and is not reported as usage", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("codex", "alice");
  f.codexSnapshot(s, 90, 3600);
  f.overview.observe(s, { type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex", quotaWindows: [] }, Date.now() + 1);
  var entry = f.vendorOf(f.latest(ws), "codex");
  assert.deepEqual(entry.windows, []);
});

test("availability is reported per caller and unknown availability is not invented", function () {
  var f = fixture({ availability: [{ id: "claude", installed: true }, { id: "codex", installed: false }] });
  var ws = f.socket("alice");
  f.clients.add(ws);
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  var message = f.latest(ws);
  assert.equal(f.vendorOf(message, "codex").installed, false);
  assert.equal(f.vendorOf(message, "claude").installed, true);
  // Every reviewed vendor is listed; one without a verified source says so and carries no windows.
  assert.equal(message.vendors.length, 11);
  assert.equal(f.vendorOf(message, "antigravity").capability.mode, "unintegrated");
  assert.deepEqual(f.vendorOf(message, "antigravity").windows, []);
});

test("active-session recording, deduplication and rejection scheduling are unchanged by the overview", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("codex", "alice");
  f.codexSnapshot(s, 40, 3600);
  f.codexSnapshot(s, 40, 3600);
  var usage = f.recorded.filter(function (m) { return m.type === "rate_limit_usage"; });
  assert.equal(usage.length, 1, "identical snapshots are still deduplicated in history");
  assert.equal(ws.sent.length, 2, "while the overview records both observations");
  var claude = f.session("claude", "alice");
  f.processor.processSDKMessage(claude, { yokeType: "rate_limit", rateLimitInfo: { status: "rejected", rateLimitType: "five_hour", resetsAt: Math.floor(Date.now() / 1000) + 3600 } });
  assert.equal(f.rejections.length, 1);
  assert.equal(f.rejections[0].session, claude.localId);
  assert.ok(f.recorded.some(function (m) { return m.type === "rate_limit" && m.status === "rejected" && m.sessionId === claude.localId; }));
  assert.equal(s.rateLimitResetsAt, undefined, "an inactive vendor's overview never schedules the other session");
});

test("a failing overview listener cannot break quota recording", function () {
  var f = fixture();
  f.sm.addOnQuotaObserved(function () { throw new Error("listener failure"); });
  var s = f.session("codex", "alice");
  f.codexSnapshot(s, 10, 3600);
  assert.equal(f.recorded.filter(function (m) { return m.type === "rate_limit_usage"; }).length, 1);
});

test("the overview works when it attaches before the message processor", function () {
  var sessions = new Map();
  var sm = { sessions: sessions, sendAndRecord: function (s, m) { s.history.push(m); }, broadcastSessionList: function () {} };
  var ws = { readyState: 1, _clayUser: { id: "alice" }, sent: [] };
  attachVendorUsageOverview({
    slug: "alpha", sm: sm, clients: new Set([ws]),
    usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return { id: id }; }, canAccessProject: function () { return true; } },
    getProjectAccess: function () { return {}; },
    sendTo: function (target, msg) { target.sent.push(msg); },
  });
  var processor = attachMessageProcessor({ sm: sm, opts: {}, onProcessingChanged: function () {}, onTurnDone: function () {} });
  var s = { localId: 1, vendor: "codex", ownerId: "alice", history: [], messageUUIDs: [], pendingPermissions: {}, pendingElicitations: {}, pendingAskUser: {} };
  sessions.set(1, s);
  processor.processSDKMessage(s, codexKit.normalizeEvent({ method: "account/rateLimits/updated", params: { rateLimits: {
    primary: { usedPercent: 33, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 } } } }, codexKit.createEventState())[0]);
  assert.equal(ws.sent.length, 1);
});

test("sessions are separate sources: the newest coherent snapshot wins and nothing is blended", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var first = f.session("codex", "alice"), second = f.session("codex", "alice");
  var reset = Date.now() + 3600000;
  function snap(key, minutes, percent, limitId) {
    return { type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: limitId || "codex",
      quotaWindows: [{ key: key, windowDurationMins: minutes, usedPercent: percent, resetsAt: reset }] };
  }
  f.overview.observe(first, snap("secondary", 10080, 95), 1000);
  f.overview.observe(second, snap("primary", 300, 10), 2000);
  var entry = f.vendorOf(f.latest(ws), "codex");
  assert.equal(entry.sourceSessionId, second.localId);
  assert.equal(entry.windows.length, 1, "the older session's weekly bucket is not merged in");
  assert.equal(entry.windows[0].usedPercent, 10);
  assert.equal(entry.otherSourceCount, 1);
  // The newest source is removed (session deleted): the earlier coherent source is shown instead.
  f.sessions.delete(second.localId);
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  entry = f.vendorOf(f.latest(ws), "codex");
  assert.equal(entry.sourceSessionId, first.localId);
  assert.equal(entry.windows[0].usedPercent, 95);
  assert.equal(entry.otherSourceCount, 0);
});

test("a later session under a different account does not inherit earlier buckets", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var before = f.session("codex", "alice"), after = f.session("codex", "alice");
  var reset = Date.now() + 3600000;
  f.overview.observe(before, { type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex",
    quotaWindows: [{ key: "primary", windowDurationMins: 300, usedPercent: 99, resetsAt: reset }, { key: "secondary", windowDurationMins: 10080, usedPercent: 80, resetsAt: reset }] }, 1000);
  f.overview.observe(after, { type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex",
    quotaWindows: [{ key: "primary", windowDurationMins: 300, usedPercent: 3, resetsAt: reset }] }, 2000);
  var entry = f.vendorOf(f.latest(ws), "codex");
  assert.deepEqual(entry.windows.map(function (w) { return w.usedPercent; }), [3]);
});

test("a source session transferred to another owner stops contributing", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("codex", "alice");
  f.codexSnapshot(s, 40, 3600);
  s.ownerId = "bob";
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  assert.deepEqual(f.vendorOf(f.latest(ws), "codex").windows, []);
});

test("a deleted user or revoked project access receives nothing, on request or on publish", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var s = f.session("codex", "alice");
  f.codexSnapshot(s, 40, 3600);
  assert.equal(ws.sent.length, 1);
  f.revoked.alice = true;
  f.codexSnapshot(s, 41, 3600);
  assert.equal(ws.sent.length, 1, "no publish to a deleted user");
  f.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "r1" });
  assert.deepEqual(f.latest(ws).vendors, []);
  assert.match(f.latest(ws).error, /Not authorized/);
  f.revoked.alice = false;
  f.noAccess.alice = true;
  var before = ws.sent.length;
  f.codexSnapshot(s, 42, 3600);
  assert.equal(ws.sent.length, before, "no publish after project access is revoked");
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  assert.deepEqual(f.latest(ws).vendors, []);
  f.noAccess.alice = false;
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  assert.equal(f.vendorOf(f.latest(ws), "codex").windows[0].usedPercent, 42);
});

test("replies echo the request and identify the exact user they were built for", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  f.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "abc" });
  assert.equal(f.latest(ws).requestId, "abc");
  assert.equal(f.latest(ws).userId, "alice");
  f.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "x".repeat(100) });
  assert.equal(f.latest(ws).requestId, undefined, "oversized correlation ids are not echoed");
  var stranger = f.socket("alice");
  f.overview.handleMessage(stranger, { type: "vendor_usage_get" });
  assert.match(f.latest(stranger).error, /Not authorized/, "a socket that is not a project client gets nothing");
});

test("the actual project coordinator routes requests and observations for an inactive session", function (t) {
  var fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-vendor-usage-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var exec = require("node:child_process").spawnSync(process.execPath, [path.join(__dirname, "fixtures/vendor-usage-overview-project.cjs"), root], {
    env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, "config"), CLAY_CONFIG: path.join(root, "config", "daemon.json"), CODEX_HOME: path.join(root, ".codex"), GROK_HOME: path.join(root, ".grok"), KIMI_CODE_HOME: path.join(root, ".kimi-code"), SUDO_USER: "", SUDO_HOME: "" }), timeout: 30000, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(exec.status, 0, exec.stdout + exec.stderr);
  assert.match(exec.stdout, /vendor usage production routing passed/);
});

test("more than the source cap keeps the newest session and bounds memory", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var reset = Date.now() + 3600000;
  var all = [];
  for (var i = 0; i < 30; i++) {
    var s = f.session("codex", "alice");
    all.push(s);
    f.overview.observe(s, { type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex",
      quotaWindows: [{ key: "primary", windowDurationMins: 300, usedPercent: i, resetsAt: reset }] }, 1000 + i);
    var entry = f.vendorOf(f.latest(ws), "codex");
    assert.equal(entry.sourceSessionId, s.localId, "session " + i + " becomes the displayed source");
    assert.equal(entry.windows[0].usedPercent, i);
  }
  var last = f.vendorOf(f.latest(ws), "codex");
  assert.equal(last.otherSourceCount, 23, "24 sources are retained in total");
  // The oldest sources were evicted: deleting every newer session leaves nothing from them.
  for (var j = 6; j < 30; j++) f.sessions.delete(all[j].localId);
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  assert.deepEqual(f.vendorOf(f.latest(ws), "codex").windows, []);
});

test("large timestamps and unknown times still order sources correctly", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var reset = Date.now() + 3600000;
  function snap(p) { return { type: "rate_limit_usage", vendor: "codex", source: "account_snapshot", limitId: "codex",
    quotaWindows: [{ key: "primary", windowDurationMins: 300, usedPercent: p, resetsAt: reset }] }; }
  var a = f.session("codex", "alice"), b = f.session("codex", "alice");
  f.overview.observe(a, snap(1), 8.6e15);
  f.overview.observe(b, snap(2), 8.6e15 + 1);
  assert.equal(f.vendorOf(f.latest(ws), "codex").windows[0].usedPercent, 2);
  var c = f.session("codex", "alice");
  f.overview.observe(c, snap(3), null);
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  assert.equal(f.vendorOf(f.latest(ws), "codex").windows[0].usedPercent, 2, "an unknown time never outranks a known one");
});

test("a session replaced at the same id does not inherit the old observations", function () {
  var f = fixture();
  var ws = f.socket("alice");
  f.clients.add(ws);
  var old = f.session("codex", "alice");
  f.codexSnapshot(old, 77, 3600);
  var replacement = Object.assign({}, old, { history: [] });
  f.sessions.set(old.localId, replacement);
  f.overview.handleMessage(ws, { type: "vendor_usage_get" });
  assert.deepEqual(f.vendorOf(f.latest(ws), "codex").windows, [], "the replaced session's data is excluded");
  f.codexSnapshot(replacement, 12, 3600);
  var entry = f.vendorOf(f.latest(ws), "codex");
  assert.equal(entry.windows[0].usedPercent, 12, "the replacement records its own source");
  assert.equal(entry.otherSourceCount, 0);
});
