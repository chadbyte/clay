// Shared acquisition service for vendor account usage.
//
// One place decides whether a direct read is allowed, runs it with a bounded
// timeout (cancelling the underlying work), shares an in-flight read between
// callers, caches results and backs off after failures. Provider-specific
// parsing lives in the reader modules; the capability table says which vendors
// have a reader at all.
//
// Identity: a direct read is allowed only when the credential provably belongs
// to the requester. In account mode, vendors that run as the server's own user
// (Muse, Kimi, Grok, Kiro) and Codex without a mapped OS user are refused with a
// clear status instead of showing the server user's account to every owner.
// Cache entries are keyed by owner + OS user + vendor. Where a cheap credential
// fingerprint exists (Kimi, Grok) it is re-read before cached figures are
// returned (including while a read is in flight) and again when a read
// completes; rotation or deletion discards the figures. Figures from a source
// whose account cannot be verified (Muse, Kiro, Claude, Codex) are shown for at
// most one TTL (60 s) from the reading: after that, in peek and read alike,
// they are replaced by an explicit "expired" state with no numbers, and a failed
// refresh never extends them. Verified-identity figures may be kept, marked
// stale, across a transient failure for at most `staleMaxMs`. A Claude reading
// is bound to the exact live session and query that produced it and is dropped
// when that source is replaced. Sign-in failures and account changes always drop
// figures. A result is used only if the caller is still current when the work
// starts, while it waits, and when it settles.

var capabilities = require("./vendor-usage-capabilities");
var metrics = require("./vendor-usage-metrics");
var nativeReaders = require("./vendor-usage-native-readers");
var httpReaders = require("./vendor-usage-http-readers");
var acpReaders = require("./vendor-usage-acp-readers");

var DEFAULTS = { ttlMs: 60 * 1000, minForceMs: 10 * 1000, timeoutMs: 15 * 1000, backoffBaseMs: 30 * 1000, backoffMaxMs: 10 * 60 * 1000, noAuthRetryMs: 5 * 60 * 1000, staleMaxMs: 10 * 60 * 1000 };

// Failures that mean the credential or account is not (or no longer) the one
// the cached figures described, so those figures must not be shown again.
var DROPS_FIGURES = ["no_auth", "expired_auth", "unauthorized", "untrusted_origin", "account_changed", "source_changed"];

var MESSAGES = {
  identity_unprovable: "Clay cannot prove which account this vendor uses for you, so it will not read one.",
  account_changed: "The saved sign-in changed while usage was being read; figures from the previous account were discarded.",
  source_changed: "The session that reported this usage was replaced; its figures were discarded.",
  expired: "The last reading is too old and its account cannot be verified, so it is not shown. Read again.",
};

function defaultFetchJson(timeoutMs) {
  return async function (url, headers) {
    var response = await fetch(url, { headers: headers, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    var body = null;
    try { body = await response.json(); } catch (e) { body = null; }
    return { status: response.status, body: body };
  };
}

function createUsageService(options) {
  options = options || {};
  var now = typeof options.now === "function" ? options.now : Date.now;
  var timing = Object.assign({}, DEFAULTS, options.timing || {});
  var fs = require("fs");
  var os = require("os");
  var httpDeps = Object.assign({
    readText: function (file) { return fs.promises.readFile(file, "utf8"); },
    readTextSync: function (file) { return fs.readFileSync(file, "utf8"); },
    fetchJson: defaultFetchJson(timing.timeoutMs),
    env: process.env, homedir: os.homedir,
  }, options.http || {});
  httpDeps.now = now;
  var acpDeps = Object.assign({
    binary: function () { try { return require("./yoke/kiro-acp-server").findKiroPath(); } catch (e) { return null; } },
    spawn: function (command, args, spawnOptions) { return require("child_process").spawn(command, args, spawnOptions); },
    tmpdir: os.tmpdir, env: process.env,
  }, options.acp || {});
  var readers = Object.assign({
    claude: nativeReaders.claude,
    codex: nativeReaders.codex,
    muse: nativeReaders.muse,
    kimi: function () { return httpReaders.kimi(httpDeps); },
    grok: function () { return httpReaders.grok(httpDeps); },
    kiro: function (context) { return acpReaders.kiro(context, acpDeps); },
  }, options.readers || {});
  var identities = Object.assign({
    kimi: function () { return httpReaders.identities.kimi(httpDeps); },
    grok: function () { return httpReaders.identities.grok(httpDeps); },
  }, options.identities || {});
  var multiUser = typeof options.multiUser === "function" ? options.multiUser : function () { return false; };
  var osUsersEnabled = typeof options.osUsersEnabled === "function" ? options.osUsersEnabled : function () { return false; };
  var sourceLive = typeof options.sourceLive === "function" ? options.sourceLive : function () { return true; };
  var getAdapter = typeof options.getAdapter === "function" ? options.getAdapter : function () { return null; };
  var entries = Object.create(null);
  var generations = Object.create(null);

  function keyOf(owner, linuxUser, vendor) { return owner + "\u0000" + (linuxUser || "") + "\u0000" + vendor; }

  function identityOf(vendor) {
    try { return identities[vendor] ? identities[vendor]() : null; } catch (e) { return null; }
  }

  function refusal(vendor, linuxUser, hasSession) {
    var cap = capabilities.capabilityFor(vendor);
    if (cap.mode !== "query") return { status: "unintegrated", failureKind: "unintegrated", message: cap.reason || "No usage source is integrated." };
    if (cap.identity === "owner-session") return hasSession === false ? { status: "idle", failureKind: null, message: null } : null;
    if (!multiUser()) return null;
    if (cap.identity === "owner-os-user" && osUsersEnabled() && linuxUser) return null;
    return { status: "refused", failureKind: "identity_unprovable", message: MESSAGES.identity_unprovable };
  }

  function blank(status, failureKind, message) {
    return { status: status, metrics: [], fetchedAtMs: null, stale: false, failureKind: failureKind || null, message: message || null, retryAtMs: null, planType: null, accountId: null, fetching: false };
  }

  function bindingOf(session) {
    return session ? { session: session, query: session.queryInstance } : null;
  }

  function bindingLive(binding) {
    return !binding || (binding.session.queryInstance === binding.query && sourceLive(binding.session) !== false);
  }

  function sameBinding(a, b) {
    return (!a && !b) || (!!a && !!b && a.session === b.session && a.query === b.query);
  }

  // Figures whose account cannot be verified live only for one TTL; verified
  // ones may stay (stale) a bounded while. Past that the numbers are removed.
  function expire(entry) {
    var a = entry.account;
    if (!a.metrics.length) return;
    var age = a.fetchedAtMs === null ? Infinity : now() - a.fetchedAtMs;
    var limit = entry.identity ? timing.staleMaxMs : timing.ttlMs;
    if (age < limit) return;
    entry.account = { status: "idle", metrics: [], fetchedAtMs: null, stale: false, failureKind: "expired", message: MESSAGES.expired, planType: null, accountId: null };
    entry.identity = null;
  }

  function snapshotOf(entry) {
    expire(entry);
    var a = entry.account;
    return {
      status: a.status, metrics: a.metrics.slice(), fetchedAtMs: a.fetchedAtMs, stale: a.stale === true,
      failureKind: a.failureKind || null, message: a.message || null, retryAtMs: entry.retryAtMs || null,
      planType: a.planType || null, accountId: a.accountId || null, sourceSessionId: a.sourceSessionId === undefined ? null : a.sourceSessionId,
      fetching: !!entry.inflight,
    };
  }

  function emptyEntry() {
    return { account: { status: "idle", metrics: [], fetchedAtMs: null }, identity: null, binding: null, failures: 0, retryAtMs: 0, inflight: null, token: 0 };
  }

  function drop(key) {
    var entry = entries[key];
    if (!entry) return;
    entry.token++;
    delete entries[key];
  }

  // True when the cached projection no longer describes the live source: the
  // credential fingerprint differs (rotation or deletion, even mid-read) or the
  // session/query that produced it was replaced.
  function sourceChanged(entry, vendor) {
    if (entry.identity && identityOf(vendor) !== entry.identity) return true;
    return !bindingLive(entry.binding);
  }

  // The current known state, without starting a read.
  function peek(owner, linuxUser, vendor) {
    var refused = refusal(vendor, linuxUser, null);
    if (refused && refused.status !== "idle") return blank(refused.status, refused.failureKind, refused.message);
    var key = keyOf(owner, linuxUser, vendor);
    var entry = entries[key];
    if (!entry) return blank("idle");
    if (sourceChanged(entry, vendor)) { drop(key); return blank("idle"); }
    return snapshotOf(entry);
  }

  function failureDelay(entry, kind) {
    if (kind === "no_auth") return timing.noAuthRetryMs;
    return Math.min(timing.backoffMaxMs, timing.backoffBaseMs * Math.pow(2, Math.max(0, entry.failures - 1)));
  }

  function settleFailure(entry, error) {
    var kind = error && error.failureKind ? error.failureKind : "error";
    entry.failures += 1;
    entry.retryAtMs = now() + failureDelay(entry, kind);
    var prior = entry.account;
    // Only a transient failure keeps the last good figures (marked stale);
    // a sign-in problem or account change must not leave a former account's numbers.
    // Figures survive only when their account is verifiable (a fingerprint) and
    // they are still inside the bounded stale window.
    var keep = DROPS_FIGURES.indexOf(kind) === -1 && !!entry.identity && prior.metrics.length > 0 && (prior.status === "ok" || prior.stale === true) && prior.fetchedAtMs !== null && now() - prior.fetchedAtMs < timing.staleMaxMs;
    entry.account = {
      status: kind === "no_auth" ? "no_auth" : kind === "expired_auth" ? "expired_auth" : "error",
      metrics: keep ? prior.metrics : [], fetchedAtMs: keep ? prior.fetchedAtMs : null, stale: keep,
      failureKind: kind, message: error && error.failureKind ? error.message : "Usage could not be read.",
      planType: keep ? prior.planType || null : null, accountId: keep ? prior.accountId || null : null,
      sourceSessionId: keep ? prior.sourceSessionId : null,
    };
    if (!keep) { entry.identity = null; entry.binding = null; }
  }

  function withTimeout(promise, controller) {
    var timer;
    var limit = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        controller.abort();
        reject(nativeReaders.failure("timeout", "The usage read timed out."));
      }, timing.timeoutMs);
    });
    return Promise.race([promise, limit]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  // Resolves to a snapshot, or null when the result must not be used because
  // the caller or the account changed. Nothing is started for a caller that is
  // already stale.
  async function read(request) {
    var owner = request.owner, linuxUser = request.linuxUser || null, vendor = request.vendor;
    var isCurrent = typeof request.isCurrent === "function" ? request.isCurrent : function () { return true; };
    if (!isCurrent()) return null;
    var refused = refusal(vendor, linuxUser, !!request.session);
    if (refused) return refused.status === "idle" ? peek(owner, linuxUser, vendor) : blank(refused.status, refused.failureKind, refused.message);
    var key = keyOf(owner, linuxUser, vendor);
    var entry = entries[key] || (entries[key] = emptyEntry());
    var startedGeneration = generations[owner] || 0;
    var before = identityOf(vendor);
    var binding = bindingOf(request.session);
    if ((entry.identity && before !== entry.identity) || !bindingLive(entry.binding) || (entry.binding && !sameBinding(entry.binding, binding))) {
      drop(key);
      entry = entries[key] = emptyEntry();
    }
    expire(entry);
    var current = now();
    var age = entry.account.fetchedAtMs === null ? Infinity : current - entry.account.fetchedAtMs;
    var coolingDown = entry.retryAtMs > current;
    var fresh = entry.account.status === "ok" && age < (request.force ? timing.minForceMs : timing.ttlMs);
    if (!entry.inflight && (fresh || coolingDown)) return isCurrent() ? snapshotOf(entry) : null;
    if (!entry.inflight) {
      var token = ++entry.token;
      var controller = new AbortController();
      var context = { adapter: getAdapter(vendor), linuxUser: linuxUser, session: request.session || null, signal: controller.signal };
      entry.binding = binding;
      var run = Promise.resolve().then(function () { return withTimeout(readers[vendor](context), controller); });
      entry.inflight = run.then(function (result) {
        if (entry.token !== token || (generations[owner] || 0) !== startedGeneration) return;
        var list = (result && Array.isArray(result.metrics) ? result.metrics : []).filter(metrics.valid);
        if (list.length === 0) throw nativeReaders.failure("unavailable", "The vendor reported no usage figures for this account.");
        if (!bindingLive(binding)) throw nativeReaders.failure("source_changed", MESSAGES.source_changed);
        // The credential is re-read AFTER the response. For a fingerprinted
        // source it must equal the one the reader used (or, failing that, the
        // one seen before the call); rotation, deletion or first appearance
        // mid-read means neither account's figures can be attributed.
        var expected = result.identity || before;
        if (identities[vendor]) {
          var fresh = identityOf(vendor);
          if (fresh !== expected) throw nativeReaders.failure("account_changed", MESSAGES.account_changed);
        }
        entry.failures = 0; entry.retryAtMs = 0;
        entry.identity = identities[vendor] ? expected || null : null;
        entry.account = { status: "ok", metrics: list, fetchedAtMs: Number.isFinite(result.observedAtMs) ? result.observedAtMs : now(), stale: false, planType: result.planType || null, accountId: result.accountId || null, sourceSessionId: result.sourceSessionId === undefined ? null : result.sourceSessionId };
      }).catch(function (error) {
        if (entry.token !== token || (generations[owner] || 0) !== startedGeneration) return;
        settleFailure(entry, error);
      }).then(function () { if (entry.token === token) entry.inflight = null; });
    }
    await entry.inflight;
    if (!isCurrent() || (generations[owner] || 0) !== startedGeneration || entries[key] !== entry) return null;
    return snapshotOf(entry);
  }

  // Forget everything for an owner (account switch, logout, access change);
  // reads still in flight can no longer store or return a result.
  function invalidate(owner) {
    generations[owner] = (generations[owner] || 0) + 1;
    Object.keys(entries).forEach(function (key) {
      if (key.indexOf(owner + "\u0000") === 0) drop(key);
    });
  }

  return { read: read, peek: peek, invalidate: invalidate, refusal: refusal };
}

module.exports = { createUsageService: createUsageService, DEFAULTS: DEFAULTS };
