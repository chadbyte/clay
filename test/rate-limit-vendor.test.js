var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

function providerState(state) {
  state.vendorInfo = Object.assign({}, require('../lib/yoke/vendor-registry').VENDOR_REGISTRY, state.vendorInfo || {});
  return state;
}
function loadProjection(state) {
  providerState(state);
  var source = fs.readFileSync(path.join(__dirname, "..", "lib", "public", "modules", "app-rate-limit.js"), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace(/export function/g, "function")
    .replace(/export \{ rateLimitEventAppliesToPane, getVendorUsageMeta \};/g, "");
  return new Function(
    "store", "iconHtml", "refreshIcons", "setScheduleDelayMs", "clearScheduleDelay",
    source + "\nreturn { rateLimitEventAppliesToPane: rateLimitEventAppliesToPane, getVendorUsageMeta: getVendorUsageMeta };"
  )(
    { get: function (key) { return state[key]; }, snap: function () { return state; }, set: function () {} },
    function () { return "" }, function () {}, function () {}, function () {}
  );
}

function makeDomHarness(state) {
  providerState(state);
  var listeners = [];
  var nextTimerId = 1;
  var intervals = {};
  var timeouts = {};
  var clearedIntervals = [];
  var clearedTimeouts = [];

  function Element(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = {};
    this.innerHTML = "";
    this.className = "";
    this.id = "";
    this.removed = false;
  }
  Element.prototype.insertBefore = function (child, ref) {
    child.parentNode = this;
    this.children.unshift(child);
  };
  Element.prototype.appendChild = function (child) {
    child.parentNode = this;
    this.children.push(child);
  };
  Element.prototype.remove = function () {
    this.removed = true;
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(function (child) { return child !== this; }, this);
      this.parentNode = null;
    }
  };
  Element.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
  Element.prototype.removeAttribute = function (name) { delete this.attributes[name]; if (name === "href") delete this.href; };
  Element.prototype.querySelector = function (selector) {
    if (selector === ".header-pill-text") return { textContent: "" };
    if (selector === ".rate-limit-popover") return this.children.filter(function (child) { return child.className.indexOf("rate-limit-popover") !== -1; })[0] || null;
    return null;
  };

  var status = new Element("span");
  var topBarActions = new Element("div");
  var skipPerms = new Element("span");
  var document = {
    createElement: function (tag) { return new Element(tag); },
    querySelector: function (selector) {
      if (selector === ".title-bar-content .status") return status;
      if (selector === "#top-bar .top-bar-actions") return topBarActions;
      return null;
    },
    getElementById: function (id) { return id === "skip-perms-pill" ? skipPerms : null; },
  };
  var store = {
    get: function (key) { return state[key]; },
    snap: function () { return state; },
    set: function (partial) {
      var prev = Object.assign({}, state);
      Object.assign(state, partial);
      for (var i = 0; i < listeners.length; i++) listeners[i](state, prev);
    },
    subscribe: function (listener) { listeners.push(listener); },
  };
  var module = new Function(
    "store", "iconHtml", "refreshIcons", "setScheduleDelayMs", "clearScheduleDelay", "document", "setInterval", "clearInterval", "setTimeout", "clearTimeout",
    fs.readFileSync(path.join(__dirname, "..", "lib", "public", "modules", "app-rate-limit.js"), "utf8")
      .replace(/^import .*;\n/gm, "")
      .replace(/export function/g, "function")
      .replace(/export \{ rateLimitEventAppliesToPane, getVendorUsageMeta \};/g, "") +
      "\nreturn { initRateLimit: initRateLimit, updateRateLimitUsage: updateRateLimitUsage, handleRateLimitEvent: handleRateLimitEvent };"
  )(
    store,
    function (name) { return "<svg data-icon=\"" + name + "\"></svg>"; },
    function () {}, function () {}, function () {}, document,
    function (fn) { var id = nextTimerId++; intervals[id] = fn; return id; },
    function (id) { delete intervals[id]; clearedIntervals.push(id); },
    function () { var id = nextTimerId++; timeouts[id] = true; return id; },
    function (id) { delete timeouts[id]; clearedTimeouts.push(id); }
  );
  ['updateRateLimitUsage', 'handleRateLimitEvent'].forEach(function(name) {
    var original = module[name];
    module[name] = function(message) {
      return original(require('../lib/yoke/usage').clientEvent(Object.assign({ type: name === 'handleRateLimitEvent' ? 'rate_limit' : 'rate_limit_usage' }, message), message.vendor || state.currentVendor));
    };
  });
  return { document: document, status: status, topBarActions: topBarActions, store: store, module: module, intervals: intervals, timeouts: timeouts, clearedIntervals: clearedIntervals, clearedTimeouts: clearedTimeouts };
}

test("rate-limit projection follows the displayed session and vendor", function () {
  var projection = loadProjection({ activeSessionId: 12, currentVendor: "codex", vendorInfo: {} });
  assert.equal(projection.rateLimitEventAppliesToPane({ sessionId: 12, vendor: "codex" }, { activeSessionId: 12, currentVendor: "codex" }), true);
  assert.equal(projection.rateLimitEventAppliesToPane({ sessionId: 12, vendor: "claude" }, { activeSessionId: 12, currentVendor: "codex" }), false);
  assert.equal(projection.rateLimitEventAppliesToPane({ sessionId: 13, vendor: "codex" }, { activeSessionId: 12, currentVendor: "codex" }), false);
  assert.equal(projection.rateLimitEventAppliesToPane({ vendor: "codex" }, { activeSessionId: 12, currentVendor: "codex" }), true);
});

test("legacy unstamped rate-limit history is Claude-only", function () {
  var projection = loadProjection({ activeSessionId: 12, currentVendor: "codex", vendorInfo: {} });
  assert.equal(projection.rateLimitEventAppliesToPane({ status: "allowed_warning" }, { activeSessionId: 12, currentVendor: "codex" }), false);
  assert.equal(projection.rateLimitEventAppliesToPane({ status: "allowed_warning" }, { activeSessionId: 12, currentVendor: "claude", vendorInfo: require("../lib/yoke/vendor-registry").VENDOR_REGISTRY }), true);
});

test("vendor usage metadata never falls back to Claude", function () {
  var projection = loadProjection({ vendorInfo: {} });
  assert.equal(projection.getVendorUsageMeta("unknown-vendor"), null);
  assert.equal(projection.getVendorUsageMeta("codex").href, "https://chatgpt.com/codex/settings/usage");
});

test("rate-limit usage is scoped to the session instead of broadcast", function () {
  var source = fs.readFileSync(path.join(__dirname, "..", "lib", "sdk-message-processor.js"), "utf8");
  assert.match(source, /sendAndRecord\(session, \{\n\s+type: "rate_limit_usage",\n\s+sessionId: session\.localId,\n\s+vendor: session\.vendor/);
  assert.match(source, /type: "rate_limit",\n\s+sessionId: session\.localId,\n\s+vendor: session\.vendor/);
});

test("session/vendor switch reprojects the real usage DOM and clears old timers", function () {
  var state = {
    currentSlug: "projectA",
    myUserId: "userA",
    activeSessionId: 1,
    currentVendor: "claude",
    vendorInfo: {
      claude: { rateLimitTracking: true, usageDashboard: { icon: "claude.png", alt: "Claude", href: "https://claude.example/usage", title: "Claude usage" } },
      codex: { rateLimitTracking: true, usageDashboard: { icon: "codex.png", alt: "Codex", href: "https://chatgpt.com/codex/settings/usage", title: "Codex usage" } },
    },
    rateLimitState: { "projectA\u0000userA\u00002\u0000codex": { seven_day: { resetsAt: Date.now() + 2 * 60 * 60 * 1000, status: "allowed" } } },
  };
  var harness = makeDomHarness(state);
  harness.module.initRateLimit();
  var oldReset = Date.now() + 59 * 60 * 1000;
  harness.module.updateRateLimitUsage({ sessionId: 1, vendor: "claude", rateLimitType: "five_hour", resetsAt: oldReset, status: "allowed_warning" });
  harness.module.handleRateLimitEvent({ sessionId: 1, vendor: "claude", rateLimitType: "five_hour", resetsAt: oldReset, status: "allowed_warning", utilization: 0.85 });

  var usage = harness.topBarActions.children[0];
  assert.equal(usage.href, "https://claude.example/usage");
  assert.match(usage.innerHTML, /claude\.png/);
  assert.match(usage.innerHTML, /5h resets 5[89]m/);
  assert.ok(harness.status.children.length > 0);
  assert.ok(Object.keys(harness.intervals).length > 0);
  assert.ok(Object.keys(harness.timeouts).length > 0);

  harness.store.set({ activeSessionId: 2, currentVendor: "codex" });

  assert.equal(usage.href, "https://chatgpt.com/codex/settings/usage");
  assert.match(usage.innerHTML, /codex\.png/);
  assert.match(usage.innerHTML, /7d resets [12]h/);
  assert.doesNotMatch(usage.innerHTML, /claude\.png|5h resets/);
  assert.equal(harness.status.children.length, 0);
  assert.equal(Object.keys(harness.intervals).length, 1, "the selected Codex cache owns the remaining countdown");
  assert.ok(harness.clearedIntervals.length > 0, "the Claude countdown interval was cleared");
  assert.equal(Object.keys(harness.timeouts).length, 0);
  assert.ok(harness.clearedTimeouts.length > 0, "the Claude popover/reset timers were cleared");
  assert.ok(state.rateLimitState["projectA\u0000userA\u00001\u0000claude"], "old session cache remains scoped and available");
  assert.ok(state.rateLimitState["projectA\u0000userA\u00002\u0000codex"], "new session cache is not deleted on switch");

  harness.store.set({ currentSlug: "projectB", myUserId: "userB" });
  assert.doesNotMatch(usage.innerHTML, /7d resets/);
  assert.match(usage.innerHTML, /Usage unavailable|Check usage/);
  assert.equal(harness.status.children.length, 0);
  assert.equal(Object.keys(harness.intervals).length, 0);
  assert.equal(Object.keys(harness.timeouts).length, 0);
  assert.ok(state.rateLimitState["projectA\u0000userA\u00002\u0000codex"], "prior project/account cache remains isolated");
});

function codexSnapshot(windows, limitId) {
  return { sessionId: 1, vendor: "codex", source: "account_snapshot", limitId: limitId || "codex", quotaWindows: windows };
}

function quotaWindow(duration, percent, resetsAt, key) {
  return { key: key || "primary", windowDurationMins: duration, usedPercent: percent, resetsAt: resetsAt };
}

test("Codex snapshots show actual labels without rejection popovers, including old history", function () {
  var h = makeDomHarness({ activeSessionId: 1, currentVendor: "codex" });
  var reset = Date.now() + 94 * 3600000;
  [
    { duration: 10080, label: "7d" },
    { duration: 300, label: "5h" },
    { duration: 90, label: "90m" },
    { duration: null, label: "Usage" },
  ].forEach(function (example) {
    var msg = codexSnapshot([quotaWindow(example.duration, 100, reset)]);
    h.module.updateRateLimitUsage(msg);
    h.module.updateRateLimitUsage(msg);
    assert.ok(h.topBarActions.children[0].innerHTML.includes(example.label + " 100% used"));
    assert.match(h.topBarActions.children[0].className, /pill-warning/);
    assert.equal(h.status.children.length, 0);
    assert.equal(Object.keys(h.timeouts).length, 0);
  });
  var legacy = { sessionId: 1, vendor: "codex", rateLimitType: "five_hour", status: "rejected", resetsAt: reset };
  h.module.handleRateLimitEvent(legacy);
  h.module.updateRateLimitUsage(legacy);
  assert.equal(h.status.children.length, 0);
  assert.doesNotMatch(h.topBarActions.children[0].innerHTML, /5h/);
});

test("Codex recovery, disabled windows and expiry remove stale usage warnings", function () {
  var h = makeDomHarness({ activeSessionId: 1, currentVendor: "codex" });
  var reset = Date.now() + 3600000;
  h.module.updateRateLimitUsage(codexSnapshot([quotaWindow(10080, 100, reset)]));
  h.module.updateRateLimitUsage(codexSnapshot([quotaWindow(10080, 0, reset)]));
  assert.match(h.topBarActions.children[0].className, /pill-dim/);
  assert.match(h.topBarActions.children[0].innerHTML, /0% used/);
  h.module.updateRateLimitUsage(codexSnapshot([]));
  assert.match(h.topBarActions.children[0].innerHTML, /Check usage/);
  assert.equal(Object.keys(h.intervals).length, 0);
  h.module.updateRateLimitUsage(codexSnapshot([quotaWindow(10080, 100, reset)]));
  var originalNow = Date.now;
  try {
    Date.now = function () { return reset + 1; };
    Object.values(h.intervals).forEach(function (tick) { tick(); });
  } finally { Date.now = originalNow; }
  assert.match(h.topBarActions.children[0].innerHTML, /Check usage/);
  assert.match(h.topBarActions.children[0].className, /pill-dim/);
  assert.equal(Object.keys(h.intervals).length, 0);
});

test("Codex snapshot buckets and same-duration windows remain independent", function () {
  var state = { activeSessionId: 1, currentVendor: "codex" };
  var h = makeDomHarness(state);
  h.module.initRateLimit();
  h.module.updateRateLimitUsage(codexSnapshot([quotaWindow(300, 90, null), quotaWindow(300, 10, null, "secondary")]));
  h.module.updateRateLimitUsage(codexSnapshot([quotaWindow(15, 20, null)], "other"));
  assert.match(h.topBarActions.children[0].innerHTML, /5h 90% used.*5h 10% used.*15m 20% used/);
  h.module.updateRateLimitUsage(codexSnapshot([]));
  assert.doesNotMatch(h.topBarActions.children[0].innerHTML, /5h/);
  assert.match(h.topBarActions.children[0].innerHTML, /15m/);
  h.module.updateRateLimitUsage(Object.assign(codexSnapshot([]), { sessionId: 2, limitId: "other" }));
  assert.match(h.topBarActions.children[0].innerHTML, /15m/);
  h.store.set({ activeSessionId: 2 });
  assert.match(h.topBarActions.children[0].innerHTML, /Check usage/);
  h.store.set({ activeSessionId: 1 });
  assert.match(h.topBarActions.children[0].innerHTML, /15m/);
  assert.equal(h.status.children.length, 0, "restoring a cache never opens a popover");
});

test("Claude extra usage warnings distinguish disabled, active and unknown states", function () {
  var h = makeDomHarness({ currentVendor: "claude", activeSessionId: 12 });
  [
    [{ overageEnabled: false }, "Extra usage is turned off"],
    [{ overageEnabled: true }, "Extra usage is enabled"],
    [{ overageEnabled: true, isUsingOverage: true }, "Extra usage is currently being used"],
    [{ overageDisabledReason: "out_of_credits" }, "Extra usage has no credits remaining"],
    [{ overageDisabledReason: "fetch_error" }, "Extra usage availability could not be checked"],
    [{}, "5-hour warning"]
  ].forEach(function (entry) {
    h.module.handleRateLimitEvent(Object.assign({ vendor: "claude", sessionId: 12, status: "allowed_warning", rateLimitType: "five_hour" }, entry[0]));
    var popover = h.status.children[0].querySelector('.rate-limit-popover');
    assert.ok(popover.textContent.endsWith(entry[1]), popover.textContent);
  });
});

test('an independently named provider renders quota snapshots from the shared schema', function() {
  var metadata = require('../lib/yoke/vendor-registry').publicInfo().codex;
  var h = makeDomHarness({ currentVendor: 'independent', activeSessionId: 1, vendorInfo: { independent: metadata } });
  var message = Object.assign({}, codexSnapshot([quotaWindow(300, 0, Date.now() + 3600000)]), { vendor: 'independent' });
  h.module.updateRateLimitUsage(message);
  assert.ok(h.topBarActions.children[0].innerHTML.includes('5h 0% used'));
  assert.equal(h.status.children.length, 0);
});

test("the session usage link stands down once the vendor overview owns the display, but rejection handling is unchanged", function () {
  var state = { currentSlug: "p", myUserId: "u", activeSessionId: 1, currentVendor: "claude", vendorUsageOverview: null };
  var h = makeDomHarness(state);
  h.module.initRateLimit();
  var reset = Date.now() + 30 * 60 * 1000;
  h.module.updateRateLimitUsage({ sessionId: 1, vendor: "claude", rateLimitType: "five_hour", resetsAt: reset, status: "allowed" });
  assert.equal(h.topBarActions.children.length, 1, "before the overview answers, the existing link is shown");
  h.store.set({ vendorUsageOverview: { slug: "p", serverNowMs: Date.now(), receivedAtMs: Date.now(), vendors: [] } });
  assert.equal(h.topBarActions.children.length, 0, "the overview chips replace it without a duplicate");
  h.module.updateRateLimitUsage({ sessionId: 1, vendor: "claude", rateLimitType: "five_hour", resetsAt: reset, status: "allowed" });
  assert.equal(h.topBarActions.children.length, 0);
  // Genuine rejection still shows its indicator and keeps its countdown timers.
  h.module.handleRateLimitEvent({ sessionId: 1, vendor: "claude", rateLimitType: "five_hour", resetsAt: reset, status: "rejected" });
  assert.ok(h.status.children.length > 0, "the rejection indicator is unchanged");
  assert.ok(Object.keys(h.timeouts).length > 0, "the reset timer is unchanged");
  h.store.set({ vendorUsageOverview: null });
  assert.equal(h.topBarActions.children.length, 1, "the link returns when the overview is cleared");
});
