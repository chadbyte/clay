var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

function moduleSource(name) {
  return fs.readFileSync(path.join(__dirname, "../lib/public/modules", name), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
}

function element() {
  var classes = {};
  return {
    value: "", disabled: false, textContent: "", attributes: {}, focused: false,
    setAttribute: function (key, value) { this.attributes[key] = value; },
    addEventListener: function () {},
    focus: function () { this.focused = true; },
    classList: {
      add: function (name) { classes[name] = true; },
      remove: function (name) { delete classes[name]; },
      toggle: function (name, on) { if (on) classes[name] = true; else delete classes[name]; },
      contains: function (name) { return !!classes[name]; },
    },
  };
}

function load(pageOrigin, responses) {
  var state = { networkSettings: { loaded: false, busy: false, confirming: false, draft: "", saved: "", status: "", errorKind: "", requestId: 0 } };
  var elements = {
    "settings-network-origins": element(), "settings-network-save": element(), "settings-network-status": element(),
    "confirm-modal": element(), "confirm-cancel": element(),
  };
  var requests = [];
  var dialogs = [];
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (value) { state = Object.assign({}, state, value); } },
    document: { getElementById: function (id) { return elements[id] || null; } },
    window: { location: { origin: pageOrigin }, addEventListener: function () {} },
    showConfirm: function (text, onConfirm, okLabel, destructive, onCancel) {
      dialogs.push({ text: text, confirm: onConfirm, cancel: onCancel, okLabel: okLabel, destructive: destructive });
    },
    hideConfirm: function () { var open = dialogs[dialogs.length - 1]; if (open && open.cancel) open.cancel(); },
    fetch: function (url, options) {
      requests.push({ url: url, options: options || {} });
      var next = responses.shift();
      return Promise.resolve({ ok: next.status < 400, status: next.status, json: function () { return Promise.resolve(next.body); } });
    },
    URL: URL, Promise: Promise, Error: Error, String: String, Array: Array, Object: Object, JSON: JSON,
  };
  vm.runInNewContext(moduleSource("network-origin-guard.js") + "\n" + moduleSource("server-network-settings.js") +
    "\nthis.api={loadNetworkSettings:loadNetworkSettings,saveNetworkSettings:saveNetworkSettings,handleConfirmEscape:handleConfirmEscape,removesCurrentOrigin:removesCurrentOrigin};", context);
  return {
    api: context.api, requests: requests, dialogs: dialogs, elements: elements,
    state: function () { return state.networkSettings; },
    edit: function (draft) { state = Object.assign({}, state, { networkSettings: Object.assign({}, state.networkSettings, { draft: draft }) }); },
  };
}

function puts(h) { return h.requests.filter(function (r) { return r.options.method === "PUT"; }); }
function flush() { return new Promise(function (resolve) { setImmediate(resolve); }); }

test("removing the current page origin asks first, and cancel keeps the draft without a PUT", async function () {
  var h = load("https://tunnel.example", [{ status: 200, body: { allowedOrigins: ["https://tunnel.example", "https://other.example"], invalid: [] } }]);
  await h.api.loadNetworkSettings();
  h.edit("https://other.example");
  h.api.saveNetworkSettings({ preventDefault: function () {} });
  assert.equal(h.dialogs.length, 1);
  assert.match(h.dialogs[0].text, /removes https:\/\/tunnel\.example/);
  assert.match(h.dialogs[0].text, /current connection stays open/);
  assert.match(h.dialogs[0].text, /local access/);
  assert.equal(h.state().confirming, true);
  assert.equal(h.elements["settings-network-save"].disabled, true);
  assert.equal(h.elements["settings-network-origins"].disabled, true);
  assert.equal(h.elements["confirm-modal"].classList.contains("confirm-above-settings"), true);
  assert.equal(h.elements["confirm-cancel"].focused, true);
  h.api.saveNetworkSettings({ preventDefault: function () {} });
  assert.equal(h.dialogs.length, 1, "a second submit while confirming is ignored");
  h.dialogs[0].cancel();
  await flush();
  assert.equal(puts(h).length, 0);
  assert.equal(h.state().confirming, false);
  assert.equal(h.state().draft, "https://other.example");
  assert.equal(h.elements["settings-network-origins"].value, "https://other.example");
  assert.equal(h.elements["confirm-modal"].classList.contains("confirm-above-settings"), false);
  assert.equal(h.elements["settings-network-save"].disabled, false);
});

test("Escape during confirmation cancels it instead of closing settings", async function () {
  var h = load("https://tunnel.example", [{ status: 200, body: { allowedOrigins: ["https://tunnel.example"], invalid: [] } }]);
  await h.api.loadNetworkSettings();
  h.edit("");
  h.api.saveNetworkSettings({ preventDefault: function () {} });
  var stopped = false;
  h.api.handleConfirmEscape({ key: "Escape", preventDefault: function () {}, stopImmediatePropagation: function () { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(h.state().confirming, false);
  assert.equal(puts(h).length, 0);
});

test("accepting the confirmation sends exactly one PUT with the draft", async function () {
  var h = load("https://tunnel.example", [
    { status: 200, body: { allowedOrigins: ["https://tunnel.example"], invalid: [] } },
    { status: 200, body: { allowedOrigins: [], invalid: [] } },
  ]);
  await h.api.loadNetworkSettings();
  h.edit("");
  h.api.saveNetworkSettings({ preventDefault: function () {} });
  h.dialogs[0].confirm();
  await flush(); await flush();
  assert.equal(puts(h).length, 1);
  assert.deepEqual(JSON.parse(puts(h)[0].options.body), { allowedOrigins: [] });
  assert.equal(puts(h)[0].options.headers["X-Clay-Network-Settings"], "1");
  assert.equal(h.state().saved, "");
  assert.match(h.state().status, /existing connections stay open/);
});

test("equivalent spellings and origins that were never listed save without confirmation", async function () {
  var h = load("https://tunnel.example", [
    { status: 200, body: { allowedOrigins: ["https://tunnel.example"], invalid: [] } },
    { status: 200, body: { allowedOrigins: ["https://tunnel.example"], invalid: [] } },
  ]);
  await h.api.loadNetworkSettings();
  h.edit("HTTPS://Tunnel.Example:443/\n\n");
  await h.api.saveNetworkSettings({ preventDefault: function () {} });
  assert.equal(h.dialogs.length, 0);
  assert.equal(puts(h).length, 1);
  assert.equal(h.api.removesCurrentOrigin("https://a.example", [], "http://localhost:2633"), null);
  assert.equal(h.api.removesCurrentOrigin("", [], "https://tunnel.example"), null);
  assert.equal(h.api.removesCurrentOrigin("https://tunnel.example:443", ["https://other.example"], "https://TUNNEL.example"), "https://tunnel.example");
});

test("validation errors name the textarea line and mark only input errors invalid", async function () {
  var h = load("http://localhost:2633", [
    { status: 200, body: { allowedOrigins: ["https://ok.example", "clay.example"], invalid: [{ index: 1, reason: "must start with http:// or https://." }] } },
    { status: 400, body: { error: "Entry 2 cannot include a path.", index: 1, reason: "cannot include a path." } },
    { status: 500, body: { error: "Could not save network settings. Your previous settings are unchanged." } },
  ]);
  await h.api.loadNetworkSettings();
  assert.equal(h.state().draft, "https://ok.example\nclay.example");
  assert.match(h.state().status, /^Line 2 must start with http:\/\/ or https:\/\/\./);
  assert.equal(h.elements["settings-network-origins"].attributes["aria-invalid"], "true");
  h.edit("https://ok.example\n\n\nhttps://clay.example/app");
  await h.api.saveNetworkSettings({ preventDefault: function () {} });
  assert.equal(h.state().status, "Line 4 cannot include a path.");
  assert.equal(h.elements["settings-network-origins"].attributes["aria-invalid"], "true");
  h.edit("https://ok.example");
  await h.api.saveNetworkSettings({ preventDefault: function () {} });
  assert.match(h.state().status, /previous settings are unchanged/);
  assert.equal(h.state().errorKind, "request");
  assert.equal(h.elements["settings-network-origins"].attributes["aria-invalid"], "false");
  assert.equal(h.state().draft, "https://ok.example");
});

test("shared confirm modal reports cancel, backdrop, and replacement but not confirmation", function () {
  var listeners = {};
  function node(id) {
    return {
      id: id, textContent: "", className: "",
      classList: { add: function () {}, remove: function () {} },
      addEventListener: function (type, fn) { listeners[id + ":" + type] = fn; },
      querySelector: function () { return node(id + "-backdrop"); },
    };
  }
  var nodes = {};
  ["confirm-modal", "confirm-ok", "confirm-cancel", "confirm-text"].forEach(function (id) { nodes[id] = node(id); });
  var context = {
    document: { getElementById: function (id) { return nodes[id] || null; } },
    window: { addEventListener: function () {} },
    initPasteModal: function () {},
  };
  var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-misc.js"), "utf8")
    .replace(/^import [\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  vm.runInNewContext(source + "\nthis.api={initMisc:initMisc,showConfirm:showConfirm};", context);
  context.api.initMisc();
  var events = [];
  context.api.showConfirm("one", function () { events.push("ok1"); }, "OK", false, function () { events.push("cancel1"); });
  listeners["confirm-ok:click"]();
  context.api.showConfirm("two", function () { events.push("ok2"); }, "OK", false, function () { events.push("cancel2"); });
  listeners["confirm-cancel:click"]();
  context.api.showConfirm("three", function () {}, "OK", false, function () { events.push("cancel3"); });
  listeners["confirm-modal-backdrop:click"]();
  context.api.showConfirm("four", function () {}, "OK", false, function () { events.push("cancel4"); });
  context.api.showConfirm("five", function () { events.push("ok5"); });
  listeners["confirm-ok:click"]();
  assert.deepEqual(events, ["ok1", "cancel2", "cancel3", "cancel4", "ok5"]);
});
