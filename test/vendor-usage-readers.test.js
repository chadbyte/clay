var test = require("node:test");
var assert = require("node:assert/strict");
var capabilities = require("../lib/vendor-usage-capabilities");
var registry = require("../lib/yoke/vendor-registry");
var metrics = require("../lib/vendor-usage-metrics");
var native = require("../lib/vendor-usage-native-readers");
var http = require("../lib/vendor-usage-http-readers");
var museServices = require("../lib/yoke/muse-services");

var SECRET = "SECRET-TOKEN-do-not-leak";

// ---- capability mapping ----------------------------------------------------

test("all eleven vendors have an explicit capability, and the mapping is exactly what was verified", function () {
  var expected = {
    claude: "query", codex: "query", muse: "query", antigravity: "unintegrated", opencode: "unintegrated",
    kimi: "query", grok: "query", copilot: "unintegrated", qwen: "unintegrated", junie: "unintegrated", kiro: "query",
  };
  assert.deepEqual(capabilities.VENDORS.slice().sort(), Object.keys(expected).sort());
  Object.keys(expected).forEach(function (vendor) {
    assert.equal(capabilities.capabilityFor(vendor).mode, expected[vendor], vendor);
    assert.ok(registry.getVendorInfo(vendor), vendor + " exists in the registry");
  });
});

test("an unintegrated vendor always says why and claims no units; a supported one names its source", function () {
  capabilities.VENDORS.forEach(function (vendor) {
    var cap = capabilities.publicCapability(vendor);
    if (cap.mode === "unintegrated") {
      assert.match(cap.reason, /^Not integrated:/, vendor + " says not integrated, never that the provider has no source");
      assert.ok(cap.reason && cap.reason.length > 20, vendor + " needs a precise reason");
      assert.deepEqual(cap.units, []);
      assert.equal(cap.observed, false);
    } else {
      assert.ok(cap.source, vendor + " names its native source");
      assert.ok(cap.units.length > 0);
    }
  });
  assert.equal(capabilities.capabilityFor("not-a-vendor").mode, "unintegrated");
});

test("units are preserved per vendor and never collapsed to a percentage", function () {
  assert.deepEqual(capabilities.capabilityFor("kimi").units, ["count"]);
  assert.deepEqual(capabilities.capabilityFor("grok").units, ["percent", "amount"], "the Grok reader emits unit-less amounts, so the table does not claim currency");
  assert.deepEqual(capabilities.capabilityFor("kiro").units, ["credits", "currency"]);
  assert.ok(capabilities.capabilityFor("codex").units.indexOf("credits") !== -1);
});

test("enabling account reads does not change which vendors take part in rejection scheduling", function () {
  var scheduling = Object.keys(registry.VENDOR_REGISTRY).filter(function (v) { return registry.VENDOR_REGISTRY[v].rateLimitTracking === true; });
  assert.deepEqual(scheduling.sort(), ["claude", "codex"]);
});

// ---- metric validation -----------------------------------------------------

test("metric validation rejects unknown units, missing figures and negative percent", function () {
  assert.equal(metrics.valid(metrics.metric("percent", "a", "A", { usedPercent: 0 })), true, "a real 0% is valid");
  assert.equal(metrics.valid(metrics.metric("percent", "a", "A", { usedPercent: null })), false);
  assert.equal(metrics.valid(metrics.metric("percent", "a", "A", { usedPercent: -1 })), false);
  assert.equal(metrics.valid(metrics.metric("bogus", "a", "A", { used: 1 })), false);
  assert.equal(metrics.valid(metrics.metric("currency", "a", "A", { used: 1, currencyCode: "" })), false);
  assert.equal(metrics.valid(metrics.metric("credits", "a", "A", { balance: null, unlimited: false })), false);
  assert.equal(metrics.valid(metrics.metric("count", "a", "A", { used: null, remaining: null })), false);
});

// ---- Codex -----------------------------------------------------------------

function codexAdapter(reply) {
  return { readAccountRateLimits: function (opts) { codexAdapter.lastOpts = opts; return Promise.resolve(reply); } };
}

test("Codex: windows keep native percent and real durations, credits keep their own unit", async function () {
  var reply = {
    accountId: "acct-1",
    rateLimits: { limitId: "codex", planType: "pro", primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 2000 }, secondary: { usedPercent: 7, windowDurationMins: 10080, resetsAt: 3000 } },
    rateLimitsByLimitId: {
      codex: { limitId: "codex", primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 2000 }, secondary: { usedPercent: 7, windowDurationMins: 10080, resetsAt: 3000 }, credits: { hasCredits: true, unlimited: false, balance: "12.50" } },
    },
  };
  var result = await native.codex({ adapter: codexAdapter(reply), linuxUser: "u_alice" });
  assert.equal(codexAdapter.lastOpts.linuxUser, "u_alice", "the request is routed to the owner's OS user");
  assert.equal(result.accountId, "acct-1");
  var byId = {};
  result.metrics.forEach(function (x) { byId[x.id] = x; });
  assert.equal(byId["codex:primary"].usedPercent, 42);
  assert.equal(byId["codex:primary"].windowMins, 300);
  assert.equal(byId["codex:primary"].resetsAtMs, 2000000, "seconds become milliseconds");
  assert.equal(byId["codex:secondary"].windowMins, 10080);
  assert.equal(byId["codex:credits"].unit, "credits");
  assert.equal(byId["codex:credits"].balance, 12.5);
  assert.ok(result.metrics.every(metrics.valid));
});

test("Codex: a disabled window, missing credits and unreported fields are omitted, not shown as zero", async function () {
  var reply = { rateLimits: { limitId: "codex", primary: { usedPercent: 10, windowDurationMins: 0 }, secondary: null, credits: { hasCredits: false, unlimited: false, balance: null } } };
  var result = await native.codex({ adapter: codexAdapter(reply) });
  assert.deepEqual(result.metrics, []);
  var unlimited = await native.codex({ adapter: codexAdapter({ rateLimits: { limitId: "codex", credits: { hasCredits: true, unlimited: true, balance: null } } }) });
  assert.equal(unlimited.metrics[0].unlimited, true);
  assert.equal(unlimited.metrics[0].balance, null);
});

test("Codex: a runtime that cannot report usage, or returns nothing, fails with a typed reason", async function () {
  await assert.rejects(native.codex({ adapter: {} }), function (e) { return e.failureKind === "unavailable"; });
  await assert.rejects(native.codex({ adapter: codexAdapter(null) }), function (e) { return e.failureKind === "parse"; });
});

test("Codex adapter: reads through the running app-server, never starts one, and routes by OS user", async function () {
  var codexModule = require("../lib/yoke/adapters/codex");
  var calls = [];
  var server = {
    started: true, start: function () { return Promise.resolve(); }, notify: function () {}, respond: function () {},
    addHandler: function () { return {}; }, removeHandler: function () {},
    send: function (method, params) { calls.push({ method: method, params: params }); return Promise.resolve(method === "account/rateLimits/read" ? { rateLimits: { limitId: "codex" } } : {}); },
  };
  var idle = codexModule.createCodexAdapter({ cwd: "/w", createAppServer: function () { return server; } });
  await assert.rejects(idle.readAccountRateLimits({}), function (e) { return e.failureKind === "runtime_idle"; });
  assert.equal(calls.length, 0, "no runtime was started for a usage read");
  var isolated = codexModule.createCodexAdapter({ cwd: "/w", osUsers: true, createAppServer: function () { return server; } });
  await assert.rejects(isolated.readAccountRateLimits({}), /mapped Linux user/);
});

// ---- Muse ------------------------------------------------------------------

test("Muse: native used percent and reset times are converted without inventing durations", async function () {
  var adapter = { readUsage: function () { return Promise.resolve({ observedAtMs: 5000, window: { usedPercent: 30, resetsAtMs: 9000, windowDurationMins: 300 }, weekly: { usedPercent: 0, resetsAtMs: 99000 } }); } };
  var result = await native.muse({ adapter: adapter });
  assert.equal(result.observedAtMs, 5000);
  assert.deepEqual(result.metrics.map(function (x) { return [x.id, x.usedPercent, x.windowMins, x.resetsAtMs]; }), [["muse:window", 30, 300, 9000], ["muse:weekly", 0, 10080, 99000]]);
  var none = await native.muse({ adapter: { readUsage: function () { return Promise.resolve({ observedAtMs: 1, window: { usedPercent: null } }); } } });
  assert.deepEqual(none.metrics, []);
  await assert.rejects(native.muse({ adapter: { readUsage: function () { return Promise.resolve(null); } } }), function (e) { return e.failureKind === "unavailable"; });
  assert.equal(typeof museServices.quotaEvent, "function", "the session event path is unchanged");
});

// ---- Kimi / Grok (mock transports; no real credential or network) ----------

function deps(files, responder, extra) {
  var requests = [];
  var d = Object.assign({
    env: {}, homedir: function () { return "/home/test"; }, now: function () { return 1000 * 1000; },
    readText: function (file) {
      requests.push({ read: file });
      if (files[file] === undefined) { var e = new Error("missing"); e.code = "ENOENT"; return Promise.reject(e); }
      return Promise.resolve(files[file]);
    },
    fetchJson: function (url, headers) { requests.push({ url: url, headers: headers }); return Promise.resolve(responder(url, headers)); },
  }, extra || {});
  d.requests = requests;
  return d;
}

var KIMI_FILE = "/home/test/.kimi-code/credentials/kimi-code.json";
function kimiCreds(extra) { return JSON.stringify(Object.assign({ access_token: SECRET, expires_at: 2000 }, extra || {})); }

test("Kimi: request counts stay counts with the vendor's own limit and window", async function () {
  var d = deps({ [KIMI_FILE]: kimiCreds() }, function () {
    return { status: 200, body: {
      usage: { limit: "500", used: "120", resetTime: "2030-01-01T00:00:00Z" },
      limits: [{ window: { duration: 5, timeUnit: "TIME_UNIT_HOUR" }, detail: { limit: 40, remaining: 15 } }, { window: {}, detail: { limit: 0 } }],
    } };
  });
  var result = await http.kimi(d);
  assert.equal(d.requests[1].url, "https://api.kimi.com/coding/v1/usages");
  assert.equal(d.requests[1].headers.Authorization, "Bearer " + SECRET, "the token only goes to the vendor request");
  assert.deepEqual(result.metrics.map(function (x) { return [x.unit, x.used, x.limit, x.remaining, x.windowMins]; }), [["count", 120, 500, 380, null], ["count", 25, 40, 15, 300]]);
  assert.equal(result.metrics[0].usedPercent, undefined, "no percentage is invented from counts");
  assert.equal(result.metrics[0].resetsAtMs, Date.parse("2030-01-01T00:00:00Z"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test("Kimi: not signed in, expired, rejected and rate-limited states are typed and leak nothing", async function () {
  async function kind(d) { try { await http.kimi(d); } catch (e) { assert.doesNotMatch(e.message, new RegExp(SECRET)); return e.failureKind; } return "none"; }
  assert.equal(await kind(deps({}, function () { return { status: 200, body: {} }; })), "no_auth");
  assert.equal(await kind(deps({ [KIMI_FILE]: JSON.stringify({}) }, function () { return { status: 200, body: {} }; })), "no_auth");
  assert.equal(await kind(deps({ [KIMI_FILE]: "not json " + SECRET }, function () { return { status: 200, body: {} }; })), "parse");
  var expired = deps({ [KIMI_FILE]: kimiCreds({ expires_at: 1002 }) }, function () { return { status: 200, body: {} }; });
  assert.equal(await kind(expired), "expired_auth");
  assert.equal(expired.requests.filter(function (r) { return r.url; }).length, 0, "an expired token is never sent");
  assert.equal(await kind(deps({ [KIMI_FILE]: kimiCreds() }, function () { return { status: 401, body: {} }; })), "unauthorized");
  assert.equal(await kind(deps({ [KIMI_FILE]: kimiCreds() }, function () { return { status: 429, body: {} }; })), "rate_limited");
  assert.equal(await kind(deps({ [KIMI_FILE]: kimiCreds() }, function () { return { status: 503, body: {} }; })), "server");
  var timeout = deps({ [KIMI_FILE]: kimiCreds() }, null, { fetchJson: function () { var e = new Error("t"); e.name = "TimeoutError"; return Promise.reject(e); } });
  assert.equal(await kind(timeout), "timeout");
});

test("Kimi: the home override is honoured and the credential path is fixed", async function () {
  var d = deps({ "/srv/kimi/credentials/kimi-code.json": kimiCreds() }, function () { return { status: 200, body: { usage: { limit: 10, used: 1 } } }; }, { env: { KIMI_CODE_HOME: "/srv/kimi" } });
  await http.kimi(d);
  assert.equal(d.requests[0].read, "/srv/kimi/credentials/kimi-code.json");
  assert.equal(d.requests.filter(function (r) { return r.read; }).length, 1, "exactly one credential file is read");
});

var GROK_FILE = "/home/test/.grok/auth.json";
function grokFile(extra) { return JSON.stringify({ "https://auth.x.ai": Object.assign({ key: SECRET, user_id: "u1" }, extra || {}) }); }

test("Grok: only a reported percent is a percent; unnamed money stays an unnamed amount", async function () {
  var d = deps({ [GROK_FILE]: grokFile() }, function () {
    return { status: 200, body: { config: { creditUsagePercent: 37.5, currentPeriod: { end: "2030-01-08T00:00:00Z" }, monthlyLimit: { val: "50" }, used: { val: "12.5" }, subscriptionTier: "pro" } } };
  });
  var result = await http.grok(d);
  assert.match(d.requests[1].url, /\/billing\?format=credits$/);
  assert.equal(d.requests[1].headers["x-userid"], "u1");
  var byId = {};
  result.metrics.forEach(function (x) { byId[x.id] = x; });
  assert.equal(byId["grok:credits"].unit, "percent");
  assert.equal(byId["grok:credits"].usedPercent, 37.5);
  assert.equal(byId["grok:credits"].windowMins, null, "no period length is assumed when the response gives no start");
  assert.equal(byId["grok:budget"].unit, "amount");
  assert.equal(byId["grok:budget"].used, 12.5);
  assert.equal(byId["grok:budget"].currencyCode, undefined, "no currency is guessed");
  assert.equal(result.planType, "pro");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test("Grok: an absent percent is unknown (never 0%) and the default billing view is the only fallback", async function () {
  var d = deps({ [GROK_FILE]: grokFile() }, function (url) {
    return url.indexOf("format=credits") !== -1 ? { status: 200, body: { config: { subscriptionTier: "x" } } } : { status: 200, body: { config: { monthlyLimit: { val: 20 }, used: { val: 5 } } } };
  });
  var result = await http.grok(d);
  assert.equal(d.requests.filter(function (r) { return r.url; }).length, 2);
  assert.deepEqual(result.metrics.map(function (x) { return x.unit; }), ["amount"]);
  var none = await http.grok(deps({ [GROK_FILE]: grokFile() }, function () { return { status: 200, body: { config: {} } }; }));
  assert.deepEqual(none.metrics, [], "nothing reported means no figures, not zero");
});

test("Grok: no auth, expired token and a stale alternate issuer are handled without leaking the token", async function () {
  async function kind(d) { try { await http.grok(d); } catch (e) { assert.doesNotMatch(e.message, new RegExp(SECRET)); return e.failureKind; } return "none"; }
  assert.equal(await kind(deps({}, function () { return { status: 200, body: {} }; })), "no_auth");
  assert.equal(await kind(deps({ [GROK_FILE]: JSON.stringify({ "https://auth.x.ai": {} }) }, function () { return { status: 200, body: {} }; })), "no_auth");
  var expired = deps({ [GROK_FILE]: grokFile({ expires_at: new Date(1000 * 1000 + 1000).toISOString() }) }, function () { return { status: 200, body: {} }; });
  assert.equal(await kind(expired), "expired_auth");
  assert.equal(expired.requests.filter(function (r) { return r.url; }).length, 0);
  var alt = deps({ [GROK_FILE]: JSON.stringify({ "https://other.example": { key: "alt" } , "https://auth.x.ai": { key: SECRET, expires_at: new Date(1000 * 1000 - 1).toISOString() } }) }, function () { return { status: 200, body: {} }; });
  assert.equal(await kind(alt), "expired_auth", "a stale alternate issuer never replaces the default one");
  assert.equal(await kind(deps({ [GROK_FILE]: grokFile() }, function () { return { status: 403, body: {} }; })), "unauthorized");
});

test("the HTTP readers contain no endpoint beyond the two vendor hosts and read no other file", function () {
  var source = require("node:fs").readFileSync(require.resolve("../lib/vendor-usage-http-readers.js"), "utf8");
  var urls = source.match(/https?:\/\/[^"'\s)]+/g) || [];
  assert.deepEqual(Array.from(new Set(urls)).sort(), ["https://api.kimi.com/coding/v1", "https://auth.x.ai", "https://cli-chat-proxy.grok.com/v1"].sort());
  assert.doesNotMatch(source, /writeFile|appendFile|unlink|child_process|execFile|spawn/);
});

// ---- endpoint trust: a saved token is never sent to an unverified origin -----

test("an endpoint override that is not the vendor's own HTTPS host is refused before any credential is read or sent", async function () {
  var bad = ["http://api.kimi.com/coding/v1", "https://evil.example/coding/v1", "https://api.kimi.com.evil.example/v1", "https://user:pw@api.kimi.com/v1", "https://api.kimi.com:8443/v1", "not a url"];
  for (var value of bad) {
    var d = deps({ [KIMI_FILE]: kimiCreds() }, function () { return { status: 200, body: {} }; }, { env: { KIMI_CODE_BASE_URL: value } });
    await assert.rejects(http.kimi(d), function (e) { return e.failureKind === "untrusted_origin" && !new RegExp(SECRET).test(e.message); }, value);
    assert.equal(d.requests.length, 0, "no file read and no fetch for " + value);
  }
  var grokBad = ["http://cli-chat-proxy.grok.com/v1", "https://grok.evil.example/v1", "ftp://cli-chat-proxy.grok.com"];
  for (var g of grokBad) {
    var gd = deps({ [GROK_FILE]: grokFile() }, function () { return { status: 200, body: {} }; }, { env: { GROK_CLI_CHAT_PROXY_BASE_URL: g } });
    await assert.rejects(http.grok(gd), function (e) { return e.failureKind === "untrusted_origin"; }, g);
    assert.equal(gd.requests.length, 0);
  }
});

test("an override on the vendor's own HTTPS host is accepted, and the transport refuses redirects", async function () {
  var d = deps({ [KIMI_FILE]: kimiCreds() }, function () { return { status: 200, body: { usage: { limit: 10, used: 1 } } }; }, { env: { KIMI_CODE_BASE_URL: "https://api.kimi.com/custom/v2/" } });
  await http.kimi(d);
  assert.equal(d.requests[1].url, "https://api.kimi.com/custom/v2/usages");
  var service = require("node:fs").readFileSync(require.resolve("../lib/vendor-usage-service.js"), "utf8");
  assert.match(service, /redirect: "error"/);
});

test("Grok never uses a credential from another issuer", async function () {
  var d = deps({ [GROK_FILE]: JSON.stringify({ "https://other.example": { key: SECRET } }) }, function () { return { status: 200, body: {} }; });
  await assert.rejects(http.grok(d), function (e) { return e.failureKind === "no_auth"; });
  assert.equal(d.requests.filter(function (r) { return r.url; }).length, 0, "the other issuer's token is never sent to the xAI billing host");
});

test("credential fingerprints change with the token or user, are one-way and absent without a sign-in", function () {
  var d1 = deps({ [KIMI_FILE]: kimiCreds() }, null, { readTextSync: function (f) { return kimiCreds(); } });
  var d2 = deps({}, null, { readTextSync: function () { return kimiCreds({ access_token: "other" }); } });
  var d3 = deps({}, null, { readTextSync: function () { throw new Error("nope"); } });
  var a = http.identities.kimi(d1), b = http.identities.kimi(d2);
  assert.ok(a && b && a !== b);
  assert.doesNotMatch(a, new RegExp(SECRET));
  assert.equal(a.length, 16);
  assert.equal(http.identities.kimi(d3), null);
  var g1 = http.identities.grok(deps({}, null, { readTextSync: function () { return grokFile(); } }));
  var g2 = http.identities.grok(deps({}, null, { readTextSync: function () { return grokFile({ user_id: "u2" }); } }));
  assert.notEqual(g1, g2, "a different Grok user is a different identity");
});

// ---- Kiro (ACP usage command; fake process, no real CLI) -------------------

var kiroUsage = require("../lib/vendor-usage-acp-readers");
var EventEmitter = require("node:events");

function fakeKiro(script) {
  var child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.killed = false;
  child.requests = [];
  child.stdin = { write: function (line) {
    var req = JSON.parse(line);
    child.requests.push(req);
    var reply = script(req);
    if (reply !== undefined) setImmediate(function () { child.stdout.emit("data", JSON.stringify(reply) + "\n"); });
  } };
  child.kill = function () { child.killed = true; };
  return child;
}

function kiroDeps(child, extra) {
  return Object.assign({ binary: function () { return "/bin/kiro-cli"; }, spawn: function () { return child; }, tmpdir: function () { return "/tmp/neutral"; }, env: {} }, extra || {});
}

var KIRO_DATA = { planName: "KIRO FREE", billingCycleReset: "2030-01-01", overagesEnabled: true, usageBreakdowns: [
  { resourceType: "CREDIT", displayName: "Credits", used: 1.25, limit: 50, percentage: 2.5, hasLimit: true, currency: "USD", overageCharges: 3.5 },
  { resourceType: "OTHER", displayName: "Unlimited thing", used: 5, limit: 0, hasLimit: false } ] };

test("Kiro: credits keep used/limit and overage keeps its currency; the process is killed and only the usage command runs", async function () {
  var child = fakeKiro(function (req) {
    if (req.method === "initialize") return { id: req.id, result: {} };
    if (req.method === "session/new") return { id: req.id, result: { sessionId: "s1" } };
    if (req.method === "_kiro.dev/commands/execute") return { id: req.id, result: { success: true, data: KIRO_DATA } };
  });
  var result = await kiroUsage.kiro({}, kiroDeps(child));
  assert.deepEqual(child.requests.map(function (r) { return r.method; }), ["initialize", "session/new", "_kiro.dev/commands/execute"]);
  assert.deepEqual(child.requests[2].params, { sessionId: "s1", command: { command: "usage", args: {} } }, "exactly the usage command, nothing arbitrary");
  assert.equal(child.requests[1].params.cwd, "/tmp/neutral");
  assert.equal(child.killed, true);
  assert.deepEqual(result.metrics.map(function (x) { return [x.unit, x.used, x.limit, x.currencyCode || null]; }), [["credits", 1.25, 50, null], ["currency", 3.5, null, "USD"]]);
  assert.equal(result.metrics[0].resetsAtMs, Date.parse("2030-01-01"));
  assert.equal(result.planType, "KIRO FREE");
  assert.ok(result.metrics.every(metrics.valid));
});

test("Kiro: a failed command, a missing binary, an early exit and an abort are typed failures and never leave a process", async function () {
  var notOk = fakeKiro(function (req) { if (req.method === "initialize") return { id: req.id, result: {} }; if (req.method === "session/new") return { id: req.id, result: { sessionId: "s" } }; return { id: req.id, result: { success: false } }; });
  await assert.rejects(kiroUsage.kiro({}, kiroDeps(notOk)), function (e) { return e.failureKind === "unavailable"; });
  assert.equal(notOk.killed, true);
  await assert.rejects(kiroUsage.kiro({}, kiroDeps(null, { binary: function () { return null; } })), function (e) { return e.failureKind === "unavailable"; });
  var dies = fakeKiro(function () { return undefined; });
  var pending = kiroUsage.kiro({}, kiroDeps(dies));
  setImmediate(function () { dies.emit("exit"); });
  await assert.rejects(pending, function (e) { return e.failureKind === "unavailable"; });
  var hung = fakeKiro(function () { return undefined; });
  var controller = new AbortController();
  var cancelled = kiroUsage.kiro({ signal: controller.signal }, kiroDeps(hung));
  setImmediate(function () { controller.abort(); });
  await assert.rejects(cancelled, function (e) { return e.failureKind === "timeout"; });
  assert.equal(hung.killed, true, "cancelling kills the underlying process");
});

// ---- Claude (SDK account usage on a live owner session) ---------------------

function claudeSession(reply) {
  return { localId: 7, queryInstance: { getAccountUsage: function () { claudeSession.calls = (claudeSession.calls || 0) + 1; return Promise.resolve(reply); } } };
}

test("Claude: native windows keep percent, durations and ISO reset times; extra usage keeps credits or currency", async function () {
  var reply = { subscription_type: "max", rate_limits_available: true, rate_limits: {
    five_hour: { utilization: 41, resets_at: "2030-01-01T00:00:00Z" }, seven_day: { utilization: 0, resets_at: null }, seven_day_opus: { utilization: null, resets_at: null },
    model_scoped: [{ display_name: "Fable", utilization: 12, resets_at: null }],
    extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 25, utilization: 25, currency: null } } };
  var result = await native.claude({ session: claudeSession(reply) });
  assert.equal(result.planType, "max");
  assert.deepEqual(result.metrics.map(function (x) { return [x.id, x.unit, x.usedPercent === undefined ? x.used : x.usedPercent, x.windowMins]; }),
    [["claude:five_hour", "percent", 41, 300], ["claude:seven_day", "percent", 0, 10080], ["claude:model:0", "percent", 12, null], ["claude:extra", "credits", 25, null]]);
  assert.equal(result.metrics[0].resetsAtMs, Date.parse("2030-01-01T00:00:00Z"));
  var currency = await native.claude({ session: claudeSession({ rate_limits: { extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 5, currency: "USD" } } }) });
  assert.equal(currency.metrics[0].unit, "currency");
});

test("Claude: no live session, a runtime without the call, API-key accounts and a changed shape are all 'unavailable'", async function () {
  var kind = async function (ctx) { try { await native.claude(ctx); } catch (e) { return e.failureKind; } return "none"; };
  assert.equal(await kind({}), "unavailable");
  assert.equal(await kind({ session: { queryInstance: {} } }), "unavailable");
  assert.equal(await kind({ session: claudeSession(null) }), "unavailable");
  assert.equal(await kind({ session: claudeSession({ rate_limits_available: false, rate_limits: null }) }), "unavailable");
  var empty = await native.claude({ session: claudeSession({ rate_limits_available: true, rate_limits: { five_hour: { utilization: "abc" } } }) });
  assert.deepEqual(empty.metrics, [], "a malformed window produces no figure");
});

test("Claude adapter: the account usage call is capability-guarded and the worker path says unavailable", async function () {
  var source = require("node:fs").readFileSync(require.resolve("../lib/yoke/adapters/claude.js"), "utf8");
  assert.match(source, /typeof method === "function"/);
  assert.match(source, /getAccountUsage: function\(\) \{ return Promise.resolve\(null\); \}/);
});

// ---- Muse cancellation ------------------------------------------------------

test("Muse: a timeout signal reaches the adapter so the spawned runtime can be closed", async function () {
  var controller = new AbortController();
  var seen = null;
  var adapter = { readUsage: function (options) { seen = options; return new Promise(function () {}); } };
  native.muse({ adapter: adapter, signal: controller.signal });
  assert.equal(seen.signal, controller.signal);
  var source = require("node:fs").readFileSync(require.resolve("../lib/yoke/muse-services.js"), "utf8");
  assert.match(source, /signal\.addEventListener\("abort"/);
  assert.match(source, /runtime\.close\(\)/);
});

test("the identity fingerprint never reads a credential file when the endpoint override is untrusted", function () {
  var reads = [];
  var d = deps({}, null, { env: { KIMI_CODE_BASE_URL: "https://evil.example/v1", GROK_CLI_CHAT_PROXY_BASE_URL: "http://cli-chat-proxy.grok.com/v1" }, readTextSync: function (f) { reads.push(f); return kimiCreds(); } });
  assert.equal(http.identities.kimi(d), null);
  assert.equal(http.identities.grok(d), null);
  assert.deepEqual(reads, [], "no credential read for an unverified origin, in the identity check as in the reader");
  var ok = deps({}, null, { readTextSync: function () { return kimiCreds(); } });
  assert.ok(http.identities.kimi(ok));
});
