var test = require("node:test");
var assert = require("node:assert/strict");
var service = require("../lib/vendor-usage-service");
var metrics = require("../lib/vendor-usage-metrics");
var native = require("../lib/vendor-usage-native-readers");
var attachVendorUsageOverview = require("../lib/vendor-usage-overview").attachVendorUsageOverview;

function pct(value) { return [metrics.metric("percent", "m", "M", { usedPercent: value })]; }

function make(options) {
  options = options || {};
  var clock = { now: 1000000 };
  var calls = [];
  var gates = [];
  function reader(vendor) {
    return function (context) {
      calls.push({ vendor: vendor, linuxUser: context.linuxUser || null, session: context.session || null, signal: context.signal });
      if (options.manual) return new Promise(function (resolve, reject) { gates.push({ resolve: resolve, reject: reject }); });
      var next = options.script && options.script.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next || { metrics: pct(10) });
    };
  }
  var svc = service.createUsageService({
    now: function () { return clock.now; },
    multiUser: function () { return options.multiUser === true; },
    osUsersEnabled: function () { return options.osUsers === true; },
    getAdapter: function () { return {}; },
    timing: options.timing,
    identities: Object.assign({ kimi: function () { return null; }, grok: function () { return null; } }, options.identities || {}),
    sourceLive: options.sourceLive,
    readers: { claude: reader("claude"), codex: reader("codex"), muse: reader("muse"), kimi: reader("kimi"), grok: reader("grok"), kiro: reader("kiro") },
  });
  return { svc: svc, clock: clock, calls: calls, gates: gates };
}

function failure(kind, message) { return native.failure(kind, message || kind); }

test("single-user mode reads every query vendor; unintegrated vendors never call a reader", async function () {
  var f = make();
  for (var v of ["codex", "muse", "kimi", "grok", "kiro"]) {
    var r = await f.svc.read({ owner: "default", vendor: v });
    assert.equal(r.status, "ok", v);
  }
  assert.equal((await f.svc.read({ owner: "default", vendor: "claude" })).status, "idle", "Claude needs one of the owner's live sessions and starts nothing without one");
  assert.equal((await f.svc.read({ owner: "default", vendor: "claude", session: { localId: 1 } })).status, "ok");
  for (var u of ["antigravity", "opencode", "copilot", "qwen", "junie"]) {
    var s = await f.svc.read({ owner: "default", vendor: u });
    assert.equal(s.status, "unintegrated", u);
    assert.match(s.message, /^Not integrated:/);
  }
  assert.deepEqual(f.calls.map(function (c) { return c.vendor; }), ["codex", "muse", "kimi", "grok", "kiro", "claude"]);
});

test("account mode refuses server-user credentials but allows Codex only for a mapped OS user", async function () {
  var f = make({ multiUser: true, osUsers: true });
  for (var v of ["muse", "kimi", "grok", "kiro"]) {
    var r = await f.svc.read({ owner: "alice", linuxUser: "u_alice", vendor: v });
    assert.equal(r.status, "refused", v + " runs as the server user");
    assert.equal(r.failureKind, "identity_unprovable");
  }
  assert.equal(f.calls.length, 0, "a refused read never touches a reader");
  assert.equal((await f.svc.read({ owner: "alice", linuxUser: "u_alice", vendor: "codex" })).status, "ok");
  assert.equal(f.calls[0].linuxUser, "u_alice");
  assert.equal((await f.svc.read({ owner: "bob", linuxUser: null, vendor: "codex" })).status, "refused", "no mapped OS user, no proof");
  var noIsolation = make({ multiUser: true, osUsers: false });
  assert.equal((await noIsolation.svc.read({ owner: "alice", linuxUser: "u_alice", vendor: "codex" })).status, "refused");
});

test("owners never share a cached account, even for the same vendor", async function () {
  var f = make({ multiUser: true, osUsers: true, script: [{ metrics: pct(11) }, { metrics: pct(22) }] });
  var a = await f.svc.read({ owner: "alice", linuxUser: "u_a", vendor: "codex" });
  var b = await f.svc.read({ owner: "bob", linuxUser: "u_b", vendor: "codex" });
  assert.equal(a.metrics[0].usedPercent, 11);
  assert.equal(b.metrics[0].usedPercent, 22);
  assert.equal(f.svc.peek("alice", "u_b", "codex").status, "idle", "alice's cache is not reachable through bob's OS user");
  assert.equal(f.svc.peek("bob", "u_b", "codex").metrics[0].usedPercent, 22);
});

test("concurrent reads share one request and results are cached until the TTL", async function () {
  var f = make({ manual: true });
  var p1 = f.svc.read({ owner: "default", vendor: "kimi" });
  var p2 = f.svc.read({ owner: "default", vendor: "kimi" });
  assert.equal(f.svc.peek("default", null, "kimi").fetching, true);
  await Promise.resolve();
  f.gates[0].resolve({ metrics: pct(5) });
  var both = await Promise.all([p1, p2]);
  assert.equal(f.calls.length, 1);
  assert.equal(both[0].metrics[0].usedPercent, 5);
  await f.svc.read({ owner: "default", vendor: "kimi" });
  assert.equal(f.calls.length, 1, "within the TTL no new read");
  f.clock.now += 61 * 1000;
  var again = f.svc.read({ owner: "default", vendor: "kimi" });
  await Promise.resolve();
  f.gates[1].resolve({ metrics: pct(6) });
  assert.equal((await again).metrics[0].usedPercent, 6);
  assert.equal(f.calls.length, 2);
});

test("force respects a short floor so refresh spam cannot hammer a vendor", async function () {
  var f = make();
  await f.svc.read({ owner: "default", vendor: "grok" });
  await f.svc.read({ owner: "default", vendor: "grok", force: true });
  assert.equal(f.calls.length, 1);
  f.clock.now += 11 * 1000;
  await f.svc.read({ owner: "default", vendor: "grok", force: true });
  assert.equal(f.calls.length, 2);
});

test("failures back off exponentially; unverifiable figures are not carried across a failure and recovery is clean", async function () {
  var f = make({ script: [{ metrics: pct(40) }, failure("server"), failure("server"), { metrics: pct(41) }] });
  await f.svc.read({ owner: "default", vendor: "muse" });
  f.clock.now += 61 * 1000;
  var first = await f.svc.read({ owner: "default", vendor: "muse" });
  assert.equal(first.status, "error");
  assert.deepEqual(first.metrics, [], "no fingerprint, so the 60 s old figure is not re-shown after a failed refresh");
  assert.equal(first.retryAtMs, f.clock.now + 30 * 1000);
  await f.svc.read({ owner: "default", vendor: "muse" });
  assert.equal(f.calls.length, 2, "no read inside the backoff window");
  f.clock.now += 31 * 1000;
  var second = await f.svc.read({ owner: "default", vendor: "muse" });
  assert.equal(second.retryAtMs, f.clock.now + 60 * 1000, "the delay doubles");
  f.clock.now += 61 * 1000;
  var ok = await f.svc.read({ owner: "default", vendor: "muse" });
  assert.equal(ok.status, "ok");
  assert.equal(ok.retryAtMs, null);
});

test("a verified-identity figure survives a transient failure stale, but only for the bounded stale window", async function () {
  var f = make({ identities: { kimi: function () { return "A"; } }, script: [{ metrics: pct(40), identity: "A" }, failure("network"), failure("network")] });
  await f.svc.read({ owner: "default", vendor: "kimi" });
  f.clock.now += 61 * 1000;
  var kept = await f.svc.read({ owner: "default", vendor: "kimi" });
  assert.equal(kept.metrics[0].usedPercent, 40);
  assert.equal(kept.stale, true);
  f.clock.now += 11 * 60 * 1000;
  var gone = await f.svc.read({ owner: "default", vendor: "kimi" });
  assert.deepEqual(gone.metrics, [], "past staleMaxMs the numbers are removed");
});

test("a vendor with no auth waits before asking again and a failure never invents figures", async function () {
  var f = make({ script: [failure("no_auth", "Not signed in to Kimi Code.")] });
  var r = await f.svc.read({ owner: "default", vendor: "kimi" });
  assert.equal(r.status, "no_auth");
  assert.deepEqual(r.metrics, []);
  assert.equal(r.fetchedAtMs, null);
  f.clock.now += 60 * 1000;
  await f.svc.read({ owner: "default", vendor: "kimi" });
  assert.equal(f.calls.length, 1);
});

test("a reader that returns no valid figures is reported unavailable, never as zero", async function () {
  var f = make({ script: [{ metrics: [{ unit: "percent", id: "x", label: "X", usedPercent: null }] }] });
  var r = await f.svc.read({ owner: "default", vendor: "grok" });
  assert.equal(r.status, "error");
  assert.equal(r.failureKind, "unavailable");
  assert.deepEqual(r.metrics, []);
});

test("a read that never answers times out and a late answer is discarded", async function () {
  var f = make({ manual: true, timing: { timeoutMs: 20 } });
  var r = await f.svc.read({ owner: "default", vendor: "kimi" });
  assert.equal(r.status, "error");
  assert.equal(r.failureKind, "timeout");
  f.gates[0].resolve({ metrics: pct(99) });
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.deepEqual(f.svc.peek("default", null, "kimi").metrics, [], "the late result did not overwrite the timeout");
});

test("invalidation (account switch) drops the cache and an in-flight result can no longer be used", async function () {
  var f = make({ manual: true });
  var pending = f.svc.read({ owner: "default", vendor: "muse" });
  await Promise.resolve();
  f.svc.invalidate("default");
  f.gates[0].resolve({ metrics: pct(77) });
  assert.equal(await pending, null, "the caller is told nothing");
  assert.equal(f.svc.peek("default", null, "muse").status, "idle");
  var next = f.svc.read({ owner: "default", vendor: "muse" });
  await Promise.resolve();
  f.gates[1].resolve({ metrics: pct(3) });
  assert.equal((await next).metrics[0].usedPercent, 3, "the new account is read fresh");
});

test("a caller that is no longer current gets null while the cache stays correct for the owner", async function () {
  var f = make({ manual: true });
  var current = true;
  var pending = f.svc.read({ owner: "default", vendor: "grok", isCurrent: function () { return current; } });
  await Promise.resolve();
  current = false;
  f.gates[0].resolve({ metrics: pct(8) });
  assert.equal(await pending, null);
  assert.equal(f.svc.peek("default", null, "grok").metrics[0].usedPercent, 8);
});

// ---- the project-facing path: socket validation + request correlation -------

function overviewFixture(options) {
  options = options || {};
  var sent = [];
  var revoked = {};
  var clients = new Set();
  var f = make(options);
  var overview = attachVendorUsageOverview({
    slug: "alpha", sm: { sessions: new Map() }, clients: clients, usageService: f.svc,
    usersModule: {
      isMultiUser: function () { return options.multiUser !== false; },
      findUserById: function (id) { return revoked[id] ? null : { id: id }; },
      canAccessProject: function () { return true; },
    },
    getProjectAccess: function () { return { visibility: "public" }; },
    sendTo: function (ws, msg) { ws.sent.push(JSON.parse(JSON.stringify(msg))); },
    getVendorAvailability: function () { return options.availability || ["claude", "codex", "muse", "kimi", "grok", "antigravity"].map(function (id) { return { id: id, installed: true }; }); },
    getLinuxUserForWs: function (ws) { return ws._linuxUser || null; },
    osUsers: options.osUsers, now: function () { return f.clock.now; },
  });
  function socket(id, linuxUser) { var ws = { readyState: 1, _clayUser: { id: id }, _linuxUser: linuxUser, sent: [] }; clients.add(ws); return ws; }
  function vendor(ws, name) { var m = ws.sent[ws.sent.length - 1]; return m.vendors.filter(function (v) { return v.vendor === name; })[0]; }
  return { f: f, overview: overview, socket: socket, vendor: vendor, revoked: revoked, clients: clients };
}

test("refresh replies carry the capability and account state, echo the request id, and arrive after the immediate reply", async function () {
  var o = overviewFixture({ multiUser: false, script: [{ metrics: pct(12) }] });
  var ws = o.socket("alice");
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "r1", refresh: true });
  assert.equal(ws.sent[0].requestId, "r1");
  assert.equal(o.vendor(ws, "kiro") && ws.sent[0].vendors.length, 11);
  assert.equal(ws.sent[0].vendors.filter(function (v) { return v.vendor === "antigravity"; })[0].capability.mode, "unintegrated");
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  var last = ws.sent[ws.sent.length - 1];
  assert.equal(last.requestId, "r1");
  var codex = last.vendors.filter(function (v) { return v.vendor === "codex"; })[0];
  assert.equal(codex.account.status, "ok");
  assert.equal(codex.windows.length, 0, "account figures are never blended into session observations");
  var agy = last.vendors.filter(function (v) { return v.vendor === "antigravity"; })[0];
  assert.equal(agy.account.status, "unintegrated");
});

test("only installed query vendors are read, and a plain request starts no read at all", async function () {
  var o = overviewFixture({ multiUser: false, availability: [{ id: "codex", installed: true }, { id: "muse", installed: false }] });
  var ws = o.socket("alice");
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "r0" });
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.equal(o.f.calls.length, 0);
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "r1", refresh: true, vendor: "copilot" });
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "r2", refresh: true });
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.deepEqual(o.f.calls.map(function (c) { return c.vendor; }), ["codex"]);
});

test("account mode: Codex is read for the requester's own OS user and other vendors report why not", async function () {
  var o = overviewFixture({ multiUser: true, osUsers: true });
  var alice = o.socket("alice", "u_alice");
  var bob = o.socket("bob", "u_bob");
  o.overview.handleMessage(alice, { type: "vendor_usage_get", requestId: "a", refresh: true });
  o.overview.handleMessage(bob, { type: "vendor_usage_get", requestId: "b", refresh: true });
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.deepEqual(o.f.calls.map(function (c) { return c.linuxUser; }).sort(), ["u_alice", "u_bob"]);
  assert.equal(o.vendor(alice, "codex").account.status, "ok");
  assert.equal(o.vendor(alice, "kimi").account.status, "refused");
  assert.equal(o.vendor(alice, "kimi").account.failureKind, "identity_unprovable");
});

test("a reply is dropped when the user lost access while the read was in flight", async function () {
  var o = overviewFixture({ multiUser: true, osUsers: true, manual: true });
  var ws = o.socket("alice", "u_alice");
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "x", refresh: true });
  var before = ws.sent.length;
  await Promise.resolve();
  o.revoked.alice = true;
  o.f.gates[0].resolve({ metrics: pct(50) });
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(ws.sent.length, before, "nothing further is sent to a revoked user");
});

test("a reply is dropped when the socket closes or the OS identity changes mid-read", async function () {
  var o = overviewFixture({ multiUser: true, osUsers: true, manual: true });
  var ws = o.socket("alice", "u_alice");
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "x", refresh: true });
  var before = ws.sent.length;
  await Promise.resolve();
  ws._linuxUser = "u_other";
  o.f.gates[0].resolve({ metrics: pct(50) });
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(ws.sent.length, before);
});

test("a vendor login invalidates cached accounts so the next refresh reads the new account", async function () {
  var o = overviewFixture({ multiUser: false, script: [{ metrics: pct(10) }, { metrics: pct(20) }] });
  var ws = o.socket("alice");
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "1", refresh: true, vendor: "codex" });
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(o.vendor(ws, "codex").account.metrics[0].usedPercent, 10);
  o.overview.invalidateAll();
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "2", refresh: true, vendor: "codex" });
  assert.equal(ws.sent[ws.sent.length - 1].vendors.filter(function (v) { return v.vendor === "codex"; })[0].account.status, "idle", "old account figures are gone immediately");
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(o.vendor(ws, "codex").account.metrics[0].usedPercent, 20);
});

test("an unauthorised socket gets no vendors and starts no read", async function () {
  var o = overviewFixture({ multiUser: true, osUsers: true });
  var ws = o.socket("alice", "u_alice");
  o.revoked.alice = true;
  o.overview.handleMessage(ws, { type: "vendor_usage_get", requestId: "z", refresh: true });
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.deepEqual(ws.sent[0].vendors, []);
  assert.ok(ws.sent[0].error);
  assert.equal(o.f.calls.length, 0);
});

// ---- lifecycle and identity hardening --------------------------------------

test("nothing starts for a requester that is already stale, and a cached answer is not returned to one", async function () {
  var f = make();
  assert.equal(await f.svc.read({ owner: "default", vendor: "kimi", isCurrent: function () { return false; } }), null);
  assert.equal(f.calls.length, 0, "no work for a stale requester");
  await f.svc.read({ owner: "default", vendor: "kimi" });
  var calls = f.calls.length;
  assert.equal(await f.svc.read({ owner: "default", vendor: "kimi", isCurrent: function () { return false; } }), null, "the cached early return also checks the caller");
  assert.equal(f.calls.length, calls);
});

test("invalidation during a flight leaves every deduplicated caller with nothing and stores nothing", async function () {
  var f = make({ manual: true });
  var a = f.svc.read({ owner: "default", vendor: "grok" });
  var b = f.svc.read({ owner: "default", vendor: "grok" });
  var c = f.svc.read({ owner: "default", vendor: "grok", isCurrent: function () { return false; } });
  await Promise.resolve();
  assert.equal(f.calls.length, 1, "deduplicated");
  f.svc.invalidate("default");
  f.gates[0].resolve({ metrics: pct(70) });
  assert.deepEqual(await Promise.all([a, b, c]), [null, null, null]);
  assert.equal(f.svc.peek("default", null, "grok").status, "idle");
});

test("the timeout cancels the underlying work through the abort signal", async function () {
  var f = make({ manual: true, timing: { timeoutMs: 15 } });
  var result = await f.svc.read({ owner: "default", vendor: "muse" });
  assert.equal(result.failureKind, "timeout");
  assert.equal(f.calls[0].signal.aborted, true, "the reader's runtime is told to stop, not abandoned");
});

test("the requester's live session is handed to the reader, never looked up by the service", async function () {
  var f = make();
  var session = { localId: 9 };
  await f.svc.read({ owner: "default", vendor: "claude", session: session });
  assert.equal(f.calls[0].session, session);
});

test("an external sign-in change is noticed before cached figures are returned", async function () {
  var id = { value: "A" };
  var f = make({ identities: { kimi: function () { return id.value; } }, script: [{ metrics: pct(10), identity: "A" }, { metrics: pct(20), identity: "B" }] });
  var first = await f.svc.read({ owner: "default", vendor: "kimi" });
  assert.equal(first.metrics[0].usedPercent, 10);
  assert.equal(f.svc.peek("default", null, "kimi").metrics[0].usedPercent, 10);
  id.value = "B";
  assert.equal(f.svc.peek("default", null, "kimi").status, "idle", "the former account's figures are not shown for the new sign-in");
  var second = await f.svc.read({ owner: "default", vendor: "kimi" });
  assert.equal(second.metrics[0].usedPercent, 20);
  assert.equal(f.calls.length, 2, "the TTL did not mask the change");
});

test("a sign-in that rotates or disappears during a read discards the result instead of attributing it", async function () {
  for (var change of ["B", null]) {
    var id = { value: "A" };
    var f = make({ manual: true, identities: { grok: function () { return id.value; } } });
    var pending = f.svc.read({ owner: "default", vendor: "grok" });
    await Promise.resolve();
    id.value = change;
    f.gates[0].resolve({ metrics: pct(33), identity: "A" });
    var result = await pending;
    assert.equal(result.status, "error", String(change));
    assert.equal(result.failureKind, "account_changed");
    assert.deepEqual(result.metrics, []);
  }
});

test("while a read is in flight a changed or deleted sign-in hides the previous figures", async function () {
  var id = { value: "A" };
  var f = make({ manual: true, identities: { kimi: function () { return id.value; } } });
  var first = f.svc.read({ owner: "default", vendor: "kimi" });
  await Promise.resolve();
  f.gates[0].resolve({ metrics: pct(10), identity: "A" });
  await first;
  f.clock.now += 61 * 1000;
  var refresh = f.svc.read({ owner: "default", vendor: "kimi" });
  await Promise.resolve();
  assert.equal(f.svc.peek("default", null, "kimi").fetching, true);
  id.value = null;
  var during = f.svc.peek("default", null, "kimi");
  assert.deepEqual(during.metrics, [], "the previous account's figures are not exposed mid-flight");
  assert.equal(during.status, "idle");
  f.gates[1].resolve({ metrics: pct(20), identity: "A" });
  assert.equal(await refresh, null, "the superseded caller gets nothing");
});

test("figures from a source without a verifiable account expire after one TTL in peek and read, with no numbers and an honest state", async function () {
  var f = make({ script: [{ metrics: pct(55) }] });
  await f.svc.read({ owner: "default", vendor: "kiro" });
  assert.equal(f.svc.peek("default", null, "kiro").metrics[0].usedPercent, 55);
  f.clock.now += 61 * 1000;
  var peeked = f.svc.peek("default", null, "kiro");
  assert.deepEqual(peeked.metrics, []);
  assert.equal(peeked.failureKind, "expired");
  assert.match(peeked.message, /cannot be verified/);
  assert.equal(peeked.fetchedAtMs, null);
  var cooled = make({ script: [{ metrics: pct(55) }, failure("server")] });
  await cooled.svc.read({ owner: "default", vendor: "muse" });
  cooled.clock.now += 61 * 1000;
  await cooled.svc.read({ owner: "default", vendor: "muse" });
  cooled.clock.now += 20 * 1000;
  assert.deepEqual((await cooled.svc.read({ owner: "default", vendor: "muse" })).metrics, [], "backoff never revives an old reading");
});

test("a Claude reading is bound to the exact session and query and dropped when either is replaced", async function () {
  var live = { value: true };
  var s1 = { localId: 1, queryInstance: { id: "q1" } };
  var f = make({ sourceLive: function () { return live.value; }, script: [{ metrics: pct(10), sourceSessionId: 1 }, { metrics: pct(20), sourceSessionId: 1 }, { metrics: pct(30), sourceSessionId: 2 }] });
  var a = await f.svc.read({ owner: "default", vendor: "claude", session: s1 });
  assert.equal(a.sourceSessionId, 1, "the reader's source session is reported, not discarded");
  assert.equal(f.svc.peek("default", null, "claude").metrics[0].usedPercent, 10);
  s1.queryInstance = { id: "q2" };
  assert.equal(f.svc.peek("default", null, "claude").status, "idle", "a new query on the same session invalidates the reading");
  var b = await f.svc.read({ owner: "default", vendor: "claude", session: s1 });
  assert.equal(b.metrics[0].usedPercent, 20);
  live.value = false;
  assert.equal(f.svc.peek("default", null, "claude").status, "idle", "a deleted or replaced session invalidates it");
  live.value = true;
  var s2 = { localId: 2, queryInstance: { id: "q3" } };
  var c = await f.svc.read({ owner: "default", vendor: "claude", session: s2 });
  assert.equal(c.metrics[0].usedPercent, 30);
  assert.equal(c.sourceSessionId, 2);
  assert.equal(f.calls.length, 3, "a different session never reuses the first session's cache");
});

test("a Claude read whose session is replaced mid-flight is discarded", async function () {
  var s1 = { localId: 1, queryInstance: { id: "q1" } };
  var f = make({ manual: true });
  var pending = f.svc.read({ owner: "default", vendor: "claude", session: s1 });
  await Promise.resolve();
  s1.queryInstance = { id: "q2" };
  f.gates[0].resolve({ metrics: pct(77), sourceSessionId: 1 });
  var result = await pending;
  assert.ok(result === null || (result.failureKind === "source_changed" && result.metrics.length === 0));
});

test("sign-in problems drop earlier figures; only transient failures keep them stale", async function () {
  for (var kind of ["no_auth", "expired_auth", "unauthorized", "untrusted_origin"]) {
    var f = make({ identities: { kimi: function () { return "A"; } }, script: [{ metrics: pct(40), identity: "A" }, failure(kind)] });
    await f.svc.read({ owner: "default", vendor: "kimi" });
    f.clock.now += 61 * 1000;
    var r = await f.svc.read({ owner: "default", vendor: "kimi" });
    assert.deepEqual(r.metrics, [], kind + " must not leave the previous account's figures");
    assert.equal(r.stale, false);
    assert.equal(r.fetchedAtMs, null);
  }
});

test("Codex figures are replaced, not blended, when the reported account id changes", async function () {
  var f = make({ script: [{ metrics: pct(10), accountId: "acct-1" }, { metrics: pct(60), accountId: "acct-2" }] });
  var a = await f.svc.read({ owner: "default", vendor: "codex" });
  assert.equal(a.accountId, "acct-1");
  f.clock.now += 61 * 1000;
  var b = await f.svc.read({ owner: "default", vendor: "codex" });
  assert.equal(b.accountId, "acct-2");
  assert.deepEqual(b.metrics.map(function (x) { return x.usedPercent; }), [60]);
});
