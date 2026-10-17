var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var registry = require("../lib/yoke/vendor-registry");
var MODULES = path.join(__dirname, "..", "lib", "public", "modules");

function strip(file) {
  return fs.readFileSync(path.join(MODULES, file), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace(/export function/g, "function");
}

// --- Minimal DOM: just enough structure for the real view module ---
function Node(tag) {
  this.tagName = tag; this.children = []; this.parentNode = null; this.attrs = {}; this.className = "";
  this._text = ""; this.style = {}; this.listeners = {}; this.id = "";
}
Node.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
Node.prototype.insertBefore = function (c, ref) {
  if (c.parentNode) c.parentNode.children = c.parentNode.children.filter(function (x) { return x !== c; });
  c.parentNode = this;
  var i = ref ? this.children.indexOf(ref) : -1;
  if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
  return c;
};
Node.prototype.remove = function () { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(function (x) { return x !== this; }, this); this.parentNode = null; };
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Node.prototype.getAttribute = function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; };
Node.prototype.addEventListener = function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
Node.prototype.insertAdjacentHTML = function (where, html) { this.children.push({ html: html, children: [], contains: function () { return false; } }); };
Node.prototype.focus = function () { this.ownerDoc.activeElement = this; };
Node.prototype.getBoundingClientRect = function () { return { left: 900, right: 960, top: 4, bottom: 28 }; };
Object.defineProperty(Node.prototype, "nextSibling", { get: function () { if (!this.parentNode) return null; var s = this.parentNode.children; return s[s.indexOf(this) + 1] || null; } });
Object.defineProperty(Node.prototype, "innerHTML", { set: function () { this.children = []; }, get: function () { return ""; } });
Object.defineProperty(Node.prototype, "textContent", {
  get: function () { return this.children.length ? this.children.map(function (c) { return c.textContent === undefined ? "" : c.textContent; }).join("") : this._text; },
  set: function (v) { this.children = []; this._text = String(v); },
});
Node.prototype.contains = function (n) { if (n === this) return true; return this.children.some(function (c) { return c.contains && c.contains(n); }); };
function walk(node, test, out) { node.children.forEach(function (c) { if (c.tagName && test(c)) out.push(c); if (c.children) walk(c, test, out); }); return out; }
Node.prototype.querySelectorAll = function (sel) { var cls = sel.replace(/^\./, ""); return walk(this, function (n) { return (" " + n.className + " ").indexOf(" " + cls + " ") !== -1; }, []); };
Node.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };

function load(initial) {
  var state = Object.assign({
    currentSlug: "alpha", myUserId: "alice", currentVendor: "claude", connected: false,
    vendorInfo: registry.publicInfo(), vendorUsageOverview: null, vendorUsageOpen: null,
  }, initial || {});
  var listeners = [];
  var store = {
    get: function (k) { return state[k]; }, snap: function () { return state; },
    set: function (partial) { var prev = Object.assign({}, state); Object.assign(state, partial); listeners.slice().forEach(function (fn) { fn(state, prev); }); },
    subscribe: function (fn) { listeners.push(fn); },
  };
  var actions = new Node("div");
  var skip = new Node("div"); skip.id = "skip-perms-pill"; actions.appendChild(skip);
  var doc = {
    activeElement: null,
    documentElement: { clientWidth: 1200 },
    createElement: function (tag) { var n = new Node(tag); n.ownerDoc = doc; return n; },
    querySelector: function (sel) { return sel === "#top-bar .top-bar-actions" ? actions : null; },
    getElementById: function (id) { return id === "skip-perms-pill" ? skip : (id === "rate-limit-usage-link" ? actions.children.filter(function (c) { return c.id === id; })[0] || null : null); },
    handlers: {},
    addEventListener: function (t, fn) { (doc.handlers[t] = doc.handlers[t] || []).push(fn); },
    removeEventListener: function (t, fn) { doc.handlers[t] = (doc.handlers[t] || []).filter(function (f) { return f !== fn; }); },
  };
  var sentMessages = [];
  var ws = { readyState: 1, send: function (m) { sentMessages.push(JSON.parse(m)); } };
  var timers = [];
  var module = new Function("store", "getWs", "iconHtml", "refreshIcons", "document", "setInterval", "clearInterval", "Date2",
    "var Date = Date2;\n" + strip("vendor-usage-format.js") + "\n" + strip("vendor-usage-model.js") + "\n" + strip("vendor-usage-list.js") + "\n" + strip("vendor-usage-overview.js") +
    "\nreturn { init: initVendorUsageOverview, handle: handleVendorUsageOverview, render: renderVendorUsageOverview };"
  )(store, function () { return ws; }, function (name) { return "<svg " + name + "/>"; }, function () {}, doc,
    function (fn) { timers.push(fn); return timers.length; }, function () {}, Date);
  return { chip: function (v) { return this.chips().filter(function (c) { return c.getAttribute("data-vendor") === v; })[0]; }, timers: timers, state: state, store: store, actions: actions, doc: doc, sent: sentMessages, module: module, ws: ws, skip: skip,
    chips: function () { var g = actions.children.filter(function (c) { return c.id === "vendor-usage-overview"; })[0]; return g ? g.querySelectorAll("vendor-usage-chip") : []; },
    group: function () { return actions.children.filter(function (c) { return c.id === "vendor-usage-overview"; })[0] || null; } };
}

function overview(vendors, extra) {
  return Object.assign({ type: "vendor_usage_overview", slug: "alpha", userId: "alice", serverNowMs: Date.now(), vendors: vendors }, extra || {});
}
function entry(vendor, windows, extra) {
  return Object.assign({ vendor: vendor, installed: true, windows: windows || [], lastObservedAtMs: windows && windows.length ? windows[0].observedAtMs : null }, extra || {});
}
function codexWindow(percent, extra) {
  return Object.assign({ kind: "snapshot", limitId: "codex", key: "primary", windowDurationMins: 300, usedPercent: percent,
    resetsAt: Date.now() + 2 * 3600000, observedAtMs: Date.now() - 60000, origin: "live" }, extra || {});
}

function listText(h) {
  h.chip("__all").listeners.click[0]();
  var pop = h.chip("__all").parentNode.querySelector("vendor-usage-list-popover");
  return pop ? pop.textContent : "";
}

test("a vendor with figures gets a chip whatever session is displayed; every installed vendor is in the list", function () {
  ["claude", "codex", "muse"].forEach(function (active) {
    var h = load({ currentVendor: active });
    h.module.init();
    h.module.handle(overview([entry("claude"), entry("codex", [codexWindow(42)])]));
    assert.deepEqual(h.chips().map(function (chip) { return chip.getAttribute("data-vendor"); }), ["codex", "__all"], "active vendor " + active);
    var text = listText(h);
    assert.match(text, /Claude Code/);
    assert.match(text, /Codex/);
  });
});

test("switching sessions or vendors keeps the same chips, values and popover content", function () {
  var h = load({ currentVendor: "codex", activeSessionId: 1 });
  h.module.init();
  h.module.handle(overview([entry("claude"), entry("codex", [codexWindow(42)])]));
  var nodes = h.chips();
  var snapshot = nodes.map(function (c) { return c.getAttribute("aria-label") + "|" + c.children[c.children.length - 1].textContent; });
  h.store.set({ activeSessionId: 2 });                       // another session, same vendor (fresh Codex session)
  h.store.set({ activeSessionId: 3, currentVendor: "claude" });  // other vendor
  h.store.set({ activeSessionId: 4, currentVendor: "muse" });    // vendor that does not track usage
  h.store.set({ activeSessionId: 5, currentVendor: "codex" });
  var after = h.chips();
  assert.deepEqual(after.map(function (c) { return c.getAttribute("aria-label") + "|" + c.children[c.children.length - 1].textContent; }), snapshot);
  assert.deepEqual(after, nodes, "the same elements are updated in place, nothing is rebuilt");
  after[1].listeners.click[0]();
  var pop = h.group().querySelector("vendor-usage-popover");
  assert.match(pop.textContent, /42% used/);
  h.store.set({ activeSessionId: 6, currentVendor: "claude" });
  assert.match(h.group().querySelector("vendor-usage-popover").textContent, /42% used/, "the open popover survives a session switch");
});

test("the displayed session's legacy usage link is not duplicated beside the overview chips", function () {
  var h = load({ currentVendor: "codex" });
  h.module.init();
  h.module.handle(overview([entry("codex", [codexWindow(42)])]));
  var chips = h.chips().filter(function (c) { return c.getAttribute("data-vendor") === "codex"; });
  assert.equal(chips.length, 1);
});

test("an unobserved vendor says Unknown in the list, has no chip and is never zero", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  h.module.handle(overview([entry("claude"), entry("codex")]));
  assert.equal(h.chip("codex"), undefined);
  var text = listText(h);
  assert.match(text, /Unknown/);
  assert.doesNotMatch(text, /0%/);
  assert.match(h.chip("__all").getAttribute("aria-label"), /0 with figures/);
});

test("nothing renders until the server has answered for this project", function () {
  var h = load();
  h.module.init();
  h.module.render();
  assert.equal(h.group(), null);
});

test("observed percentage, warning level and freshness are shown; old observations say so", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  h.module.handle(overview([entry("codex", [codexWindow(91, { observedAtMs: Date.now() - 3 * 3600000 })])]));
  var chip = h.chip("codex");
  var text = chip.children[chip.children.length - 1].textContent;
  assert.match(text, /^91% · 3h ago$/);
  assert.match(chip.className, /pill-warning/);
  assert.match(chip.getAttribute("aria-label"), /91% used, observed 3h ago/);
});

test("expired windows disappear using the server clock, not the browser clock", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  var serverNow = Date.now() + 10 * 3600000; // browser clock 10h behind the server
  h.module.handle(overview([entry("codex", [codexWindow(50, { resetsAt: serverNow + 600000, observedAtMs: serverNow - 60000 })])], { serverNowMs: serverNow }));
  var chip = h.chip("codex");
  assert.equal(chip.children[chip.children.length - 1].textContent, "50%", "relative ages use the server clock");
  var expired = overview([entry("codex", [codexWindow(50, { resetsAt: serverNow - 1000, observedAtMs: serverNow - 60000 })])], { serverNowMs: serverNow });
  h.module.handle(expired);
  assert.equal(h.chip("codex"), undefined, "an expired window is no longer a figure");
  assert.match(listText(h), /Unknown/);
});

test("a reset-only observation never invents a percentage", function () {
  var h = load({ currentVendor: "codex" });
  h.module.init();
  h.module.handle(overview([entry("claude", [{ kind: "reset", rateLimitType: "five_hour", usedPercent: null, resetsAt: Date.now() + 59 * 60000 + 30000, status: "allowed", observedAtMs: Date.now() - 1000, origin: "live" }])]));
  var chip = h.chip("claude");
  var text = chip.children[chip.children.length - 1].textContent;
  assert.match(text, /^resets 59m$/);
  assert.doesNotMatch(text, /%/);
});

test("vendors reported as not installed are omitted", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  h.module.handle(overview([entry("claude", [], { installed: false }), entry("codex", [], { installed: false })]));
  assert.equal(h.group(), null);
});

test("details open on activation, expose state, close with Escape and return focus", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  h.module.handle(overview([entry("codex", [codexWindow(42)])]));
  var chip = h.chip("codex");
  assert.equal(chip.tagName, "button");
  assert.equal(chip.getAttribute("aria-expanded"), "false");
  chip.listeners.click[0]();
  var item = h.chip("codex").parentNode;
  var pop = item.children.filter(function (c) { return /vendor-usage-popover/.test(c.className); })[0];
  assert.ok(pop, "popover is rendered next to its chip for natural tab order");
  assert.equal(pop.getAttribute("role"), "dialog");
  assert.equal(h.chip("codex").getAttribute("aria-expanded"), "true");
  var rows = pop.querySelectorAll("vendor-usage-row");
  assert.match(rows[0].children[0].textContent, /5h/);
  assert.match(rows[0].children[1].textContent, /42% used/);
  assert.match(rows[0].children[1].textContent, /resets in 1h|resets in 2h/);
  assert.match(rows[0].children[1].textContent, /observed 1m ago/, "each row discloses its own observation age");
  var link = pop.querySelector("vendor-usage-link");
  assert.equal(link.href, "https://chatgpt.com/codex/settings/usage");
  assert.equal(link.rel, "noopener");
  assert.ok(h.doc.handlers.keydown.length === 1, "dismissal handlers are active only while open");
  h.doc.handlers.keydown[0]({ key: "Escape" });
  assert.equal(h.state.vendorUsageOpen, null);
  assert.equal(h.doc.activeElement.getAttribute("data-vendor"), "codex", "focus returns to the chip");
  assert.equal((h.doc.handlers.keydown || []).length, 0, "handlers are removed after close");
});

test("clicking outside closes the popover without stealing focus", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  h.module.handle(overview([entry("codex", [codexWindow(42)])]));
  h.chip("codex").listeners.click[0]();
  h.doc.handlers.pointerdown[0]({ target: new Node("div") });
  assert.equal(h.state.vendorUsageOpen, null);
  assert.equal(h.doc.activeElement, null);
});

test("switching project or account clears overview and asks again; a reply for another project is dropped", function () {
  var h = load({ currentVendor: "claude", connected: true });
  h.module.init();
  h.module.handle(overview([entry("codex", [codexWindow(70)])]));
  assert.equal(h.chips().length, 2);
  h.store.set({ currentSlug: "beta" });
  assert.equal(h.state.vendorUsageOverview, null, "alpha values are not shown under beta");
  assert.equal(h.group(), null);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, "vendor_usage_get");
  assert.equal(h.sent[0].slug, "beta");
  assert.ok(h.sent[0].requestId);
  h.module.handle(overview([entry("codex", [codexWindow(70)])], { slug: "alpha" }));
  assert.equal(h.state.vendorUsageOverview, null, "late alpha reply is ignored in beta");
  h.module.handle(overview([entry("codex", [codexWindow(5)])], { slug: "beta" }));
  h.store.set({ myUserId: "bob" });
  assert.equal(h.state.vendorUsageOverview, null, "another account starts unknown");
  assert.equal(h.sent.length, 2);
});

test("reconnecting requests a fresh overview; error replies are not displayed", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  h.store.set({ connected: true });
  assert.equal(h.sent.length, 1);
  h.module.handle(overview([entry("codex", [codexWindow(10)])], { error: "This request belongs to a different project." }));
  assert.equal(h.state.vendorUsageOverview, null);
});

test("the chip group sits before the legacy usage link, whose own logic is untouched", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  var legacy = h.doc.createElement("a"); legacy.id = "rate-limit-usage-link";
  h.actions.insertBefore(legacy, h.skip);
  h.module.handle(overview([entry("codex", [codexWindow(42)])]));
  assert.deepEqual(h.actions.children.map(function (c) { return c.id; }), ["vendor-usage-overview", "rate-limit-usage-link", "skip-perms-pill"]);
});

test("the headline value, label and age describe the same window", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  var weekly = codexWindow(95, { key: "secondary", windowDurationMins: 10080, observedAtMs: Date.now() - 3 * 3600000 });
  var hourly = codexWindow(10, { observedAtMs: Date.now() - 60000 });
  h.module.handle(overview([entry("codex", [hourly, weekly])]));
  var chip = h.chip("codex");
  assert.match(chip.children[chip.children.length - 1].textContent, /^95% \u00b7 3h ago$/, "the old 95% is not presented as fresh");
  assert.match(chip.getAttribute("aria-label"), /Codex 7d usage, 95% used, observed 3h ago/);
  chip.listeners.click[0]();
  var rows = h.group().querySelectorAll("vendor-usage-row");
  assert.match(rows[0].textContent + rows[1].textContent, /observed 1m ago/);
  assert.match(rows[0].textContent + rows[1].textContent, /observed 3h ago/);
});

test("a window without an observation time is explicit and never fresh", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  h.module.handle(overview([entry("codex", [codexWindow(30, { observedAtMs: null })])]));
  var chip = h.chip("codex");
  assert.match(chip.children[chip.children.length - 1].textContent, /age unknown/);
  assert.match(chip.getAttribute("aria-label"), /observation time unknown/);
});

test("keyboard focus on the dashboard link survives timer refreshes and new data", function () {
  var h = load({ currentVendor: "claude" });
  h.module.init();
  h.module.handle(overview([entry("codex", [codexWindow(42)])]));
  h.chip("codex").listeners.click[0]();
  var link = h.group().querySelector("vendor-usage-link");
  link.focus();
  assert.equal(h.doc.activeElement, link);
  h.timers.forEach(function (tick) { tick(); });
  h.module.handle(overview([entry("codex", [codexWindow(55)])]));
  var after = h.group().querySelector("vendor-usage-link");
  assert.equal(after, link, "the focused link element is the same node");
  assert.equal(h.doc.activeElement, link);
  assert.ok(h.group().contains(link));
  assert.match(h.group().querySelector("vendor-usage-popover").textContent, /55% used/, "contents did update");
});

test("a delayed reply from before an account or project change is dropped", function () {
  var h = load({ currentVendor: "claude", connected: true });
  h.module.init();
  h.store.set({ connected: false });
  h.store.set({ connected: true });
  var first = h.sent[h.sent.length - 1];
  assert.equal(first.type, "vendor_usage_get");
  assert.ok(first.requestId);
  h.store.set({ myUserId: "bob" });
  var second = h.sent[h.sent.length - 1];
  assert.notEqual(second.requestId, first.requestId);
  h.module.handle(overview([entry("codex", [codexWindow(80)])], { requestId: first.requestId, userId: "alice" }));
  assert.equal(h.state.vendorUsageOverview, null, "stale request for the previous account");
  h.module.handle(overview([entry("codex", [codexWindow(80)])], { requestId: second.requestId, userId: "alice" }));
  assert.equal(h.state.vendorUsageOverview, null, "the reply was built for a different user");
  h.module.handle(overview([entry("codex", [codexWindow(80)])], { userId: "alice" }));
  assert.equal(h.state.vendorUsageOverview, null, "an unsolicited push for another user is dropped");
  h.module.handle(overview([entry("codex", [codexWindow(7)])], { requestId: second.requestId, userId: "bob" }));
  assert.equal(h.chips().length, 2);
});

test("the overview module never imports or mutates the rate-limit scheduling state", function () {
  var source = fs.readFileSync(path.join(MODULES, "vendor-usage-overview.js"), "utf8") + fs.readFileSync(path.join(MODULES, "vendor-usage-model.js"), "utf8");
  assert.doesNotMatch(source, /^import .*app-rate-limit|^import .*input\.js/m);
  assert.doesNotMatch(source, /rateLimitState|setScheduleDelayMs|clearScheduleDelay/);
  assert.doesNotMatch(source, /localStorage/);
});

// ---- account figures, units and the compact list ----------------------------

function account(metricList, extra) {
  return Object.assign({ status: "ok", metrics: metricList, fetchedAtMs: Date.now() - 60000, stale: false, failureKind: null, message: null, retryAtMs: null, fetching: false }, extra || {});
}
function cap(mode, extra) { return Object.assign({ mode: mode, observed: false, units: [] }, extra || {}); }
function chipText(chip) { return chip.children[chip.children.length - 1].textContent; }
function detailText(h, vendor) {
  h.chip(vendor).listeners.click[0]();
  var pop = h.chip(vendor).parentNode.querySelector("vendor-usage-popover");
  return pop ? pop.textContent : "";
}

test("different metric types are shown in their own units and never converted to a percentage", function () {
  var h = load();
  h.module.init();
  var m = function (extra) { return Object.assign({ windowMins: null, resetsAtMs: null }, extra); };
  h.module.handle(overview([
    entry("kimi", [], { capability: cap("query"), account: account([m({ unit: "count", id: "k", label: "Weekly requests", used: 120, limit: 500, remaining: 380, windowMins: 10080 })]) }),
    entry("grok", [], { capability: cap("query"), account: account([m({ unit: "amount", id: "g", label: "Monthly budget", used: 12.5, limit: 50 })]) }),
    entry("muse", [], { capability: cap("query"), account: account([m({ unit: "credits", id: "c", label: "Credits", balance: 12.5, unlimited: false })]) }),
    entry("codex", [], { capability: cap("query"), account: account([m({ unit: "currency", id: "$", label: "Spend", used: 3.2, limit: 20, currencyCode: "USD" })]) }),
  ]));
  // Registry order: codex, muse, kimi fill the three chip slots; grok lives in the list.
  assert.equal(chipText(h.chip("muse")), "12.5");
  assert.equal(chipText(h.chip("kimi")), "120/500");
  assert.equal(chipText(h.chip("codex")), "$3.20");
  assert.equal(h.chip("grok"), undefined);
  var kimiText = listText(h);
  assert.match(kimiText, /Weekly requests \(7d\): 120 of 500 used, 380 left/);
  assert.match(kimiText, /Monthly budget: 12\.5 of 50 used \(unit not stated\)/);
  assert.doesNotMatch(kimiText.replace(/\$[\d.]+ of \$[\d.]+/, ""), /%/);
  assert.match(kimiText, /\$3\.20 of \$20\.00 used/);
});

test("the bar stays compact: at most three chips, warnings first, everything else in the list", function () {
  var h = load();
  h.module.init();
  var rows = ["claude", "codex", "muse", "kimi", "grok"].map(function (v, i) {
    return entry(v, [], { capability: cap("query"), account: account([{ unit: "percent", id: v, label: "W", usedPercent: v === "grok" ? 95 : 10 + i, windowMins: 300, resetsAtMs: null }]) });
  });
  h.module.handle(overview(rows));
  var chips = h.chips().map(function (c) { return c.getAttribute("data-vendor"); });
  assert.equal(chips.length, 4, "three vendor chips plus the list");
  assert.deepEqual(chips, ["claude", "codex", "grok", "__all"], "the warning vendor takes a slot; chips keep a stable registry order");
  assert.equal(h.chip("kimi"), undefined);
  assert.match(h.chip("__all").getAttribute("aria-label"), /5 vendors, 5 with figures/);
  var text = listText(h);
  ["Claude Code", "Codex", "Muse Code", "Kimi Code", "Grok Build"].forEach(function (n) { assert.match(text, new RegExp(n)); });
});

test("unintegrated, refused, signed-out and waiting vendors say why in the list; none shows a number", function () {
  var h = load();
  h.module.init();
  h.module.handle(overview([
    entry("kiro", [], { capability: cap("unintegrated", { reason: "Not integrated: Credits are shown by the /usage chat command." }), account: account([], { status: "unintegrated", message: "x" }) }),
    entry("muse", [], { capability: cap("query"), account: account([], { status: "refused", message: "Clay cannot prove which account this vendor uses for you, so it will not read one." }) }),
    entry("kimi", [], { capability: cap("query"), account: account([], { status: "no_auth" }) }),
    entry("grok", [], { capability: cap("query"), account: account([], { status: "expired_auth" }) }),
    entry("codex", [], { capability: cap("query"), account: account([], { status: "idle", fetching: true }) }),
    entry("claude", [], { capability: cap("event"), account: account([], { status: "idle" }) }),
  ]));
  assert.equal(h.chips().length, 1, "only the list entry: nothing has figures");
  var text = listText(h);
  assert.match(text, /Credits are shown by the \/usage chat command/);
  assert.match(text, /will not read one/);
  assert.match(text, /Not signed in/);
  assert.match(text, /Sign-in has expired/);
  assert.match(text, /Checking account usage/);
  assert.match(text, /Waiting for a report from one of your sessions/);
  assert.doesNotMatch(text, /\d+%/);
  assert.match(text, /Not integrated/);
});

test("stale account figures stay visible but are marked stale; a session observation is kept distinct", function () {
  var h = load();
  h.module.init();
  var stale = account([{ unit: "percent", id: "p", label: "Primary", usedPercent: 60, windowMins: 300, resetsAtMs: null }], { stale: true, status: "error", message: "Usage could not be read.", fetchedAtMs: Date.now() - 3 * 3600000 });
  h.module.handle(overview([entry("codex", [codexWindow(30)], { capability: cap("query", { observed: true, source: "codex app-server" }), account: stale })]));
  var chip = h.chip("codex");
  assert.match(chipText(chip), /^30%$/, "a fresher session observation outranks a stale account read");
  var text = detailText(h, "codex");
  assert.match(text, /60% used/);
  assert.match(text, /account, read 3h ago \(stale\)/);
  assert.match(text, /session, observed/);
  assert.match(text, /Account figures: codex app-server/);
});

test("opening the list or a chip, connecting and switching account each ask the server to refresh; replies correlate by request id", function () {
  var h = load({ connected: true });
  h.module.init();
  h.store.set({ connected: false });
  h.store.set({ connected: true });
  var first = h.sent[h.sent.length - 1];
  assert.equal(first.type, "vendor_usage_get");
  assert.equal(first.refresh, true);
  h.module.handle(overview([entry("codex", [], { capability: cap("query"), account: account([{ unit: "percent", id: "p", label: "P", usedPercent: 5, windowMins: 300, resetsAtMs: null }]) })], { requestId: first.requestId }));
  assert.ok(h.chip("codex"));
  var count = h.sent.length;
  h.chip("__all").listeners.click[0]();
  assert.equal(h.sent.length, count + 1);
  var second = h.sent[h.sent.length - 1];
  assert.notEqual(second.requestId, first.requestId);
  // A late reply for the earlier request is ignored; one for the latest is shown.
  h.module.handle(overview([entry("codex", [], { capability: cap("query"), account: account([{ unit: "percent", id: "p", label: "P", usedPercent: 99, windowMins: 300, resetsAtMs: null }]) })], { requestId: first.requestId }));
  assert.equal(chipText(h.chip("codex")), "5%");
  h.module.handle(overview([entry("codex", [], { capability: cap("query"), account: account([{ unit: "percent", id: "p", label: "P", usedPercent: 6, windowMins: 300, resetsAtMs: null }]) })], { requestId: second.requestId }));
  assert.equal(chipText(h.chip("codex")), "6%");
});

test("an expired account window is dropped on the server clock and a vendor not installed is omitted from the list", function () {
  var h = load();
  h.module.init();
  var serverNow = Date.now();
  h.module.handle(overview([
    entry("codex", [], { capability: cap("query"), account: account([{ unit: "percent", id: "p", label: "P", usedPercent: 50, windowMins: 300, resetsAtMs: serverNow - 1000 }]) }),
    entry("kimi", [], { installed: false, capability: cap("query"), account: account([]) }),
  ], { serverNowMs: serverNow }));
  assert.equal(h.chip("codex"), undefined);
  var text = listText(h);
  assert.doesNotMatch(text, /Kimi/);
  assert.match(text, /Codex/);
});

test("a not-integrated vendor shows a dash, never Unknown or a number, and the list chip keeps focus across updates", function () {
  var h = load();
  h.module.init();
  var ov = function (p) { return overview([entry("codex", [], { capability: cap("query"), account: account([{ unit: "percent", id: "p", label: "P", usedPercent: p, windowMins: 300, resetsAtMs: null }]) }),
    entry("kiro", [], { capability: cap("unintegrated", { reason: "Not integrated: example." }), account: account([], { status: "unintegrated" }) })]); };
  h.module.handle(ov(10));
  var text = listText(h);
  assert.match(text, /Kiro CLINot integrated—Not integrated: example\./);
  var chip = h.chip("__all");
  chip.focus();
  h.module.handle(ov(11));
  assert.equal(h.chip("__all"), chip, "the list chip element is reused");
  assert.equal(h.doc.activeElement, chip, "focus survives an update");
  assert.equal(chip.getAttribute("aria-expanded"), "true");
});
