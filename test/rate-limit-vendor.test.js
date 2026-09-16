var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

function loadProjection(state) {
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
    function () { var id = nextTimerId++; intervals[id] = true; return id; },
    function (id) { delete intervals[id]; clearedIntervals.push(id); },
    function () { var id = nextTimerId++; timeouts[id] = true; return id; },
    function (id) { delete timeouts[id]; clearedTimeouts.push(id); }
  );
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
  assert.equal(projection.rateLimitEventAppliesToPane({ status: "allowed_warning" }, { activeSessionId: 12, currentVendor: "claude" }), true);
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
