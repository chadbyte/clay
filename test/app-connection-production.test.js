var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var vm = require("node:vm");
var path = require("node:path");

var root = path.join(__dirname, "..");

function productionHarness() {
  var now = 0;
  var nextTimer = 1;
  var timers = new Map();
  var listeners = {};
  var sockets = [];
  var fetches = [];
  var socket = null;
  var state = { connected: false, wsPath: "/ws", socketPath: "/ws", currentSlug: "project-a", activeSessionId: 7 };
  var context = {
    console: { warn: function () {}, log: function () {} },
    Math: Object.assign(Object.create(Math), { random: function () { return 0.5; } }),
    Date: { now: function () { return now; } },
    navigator: { onLine: true },
    location: { protocol: "http:", host: "fixture", reload: function () {} },
    localStorage: { removeItem: function () {} },
    state: state,
    store: {
      get: function (key) { return state[key]; },
      set: function (next) { Object.assign(state, next); },
      subscribe: function () {}
    },
    getWs: function () { return socket; },
    setWs: function (next) { socket = next; },
    window: {
      addEventListener: function (name, callback) { listeners[name] = callback; },
      dispatchEvent: function () {}
    },
    document: {
      hidden: false,
      getElementById: function () { return null; },
      addEventListener: function (name, callback) { listeners[name] = callback; }
    },
    fetch: function () {
      var success = null;
      var failure = null;
      var pending = {
        then: function (callback) { success = callback; return pending; },
        catch: function (callback) { failure = callback; return pending; },
        resolve: function (value) { if (success) success(value); },
        reject: function () { if (failure) failure(); }
      };
      fetches.push(pending);
      return pending;
    },
    CustomEvent: function (type, init) { this.type = type; this.detail = init.detail; },
    AbortController: function () { this.signal = {}; this.abort = function () {}; },
    processMessage: function () {}
  };
  var imported = fs.readFileSync(path.join(root, "lib/public/modules/app-connection.js"), "utf8");
  Array.from(imported.matchAll(/import \{([^}]+)\}/g)).forEach(function (match) {
    match[1].split(",").forEach(function (name) {
      name = name.trim();
      if (name && !context[name]) context[name] = function () {};
    });
  });
  context.setTimeout = function (fn, delay) {
    var id = nextTimer++;
    timers.set(id, { fn: fn, at: now + delay });
    return id;
  };
  context.clearTimeout = function (id) { timers.delete(id); };
  context.setInterval = function (fn, delay) {
    var id = nextTimer++;
    timers.set(id, { fn: fn, at: now + delay, interval: delay });
    return id;
  };
  context.clearInterval = context.clearTimeout;
  context.WebSocket = function () {
    var current = this;
    current.readyState = 0;
    current.send = function () {};
    current.close = function () {
      current.readyState = 3;
      if (current.onclose) current.onclose({ code: 1000, wasClean: true });
    };
    sockets.push(current);
  };
  vm.createContext(context);
  var lifecycle = fs.readFileSync(path.join(root, "lib/public/modules/websocket-lifecycle.js"), "utf8");
  vm.runInContext(lifecycle.replace(/export \{[^}]+\};?/, ""), context);
  vm.runInContext(imported.replace(/^import .*;\n/gm, "").replace(/export /g, ""), context);
  function tick(duration) {
    var end = now + duration;
    while (true) {
      var selected = null;
      timers.forEach(function (entry, id) {
        if (entry.at <= end && (!selected || entry.at < selected.entry.at)) selected = { id: id, entry: entry };
      });
      if (!selected) break;
      now = selected.entry.at;
      timers.delete(selected.id);
      if (selected.entry.interval) timers.set(selected.id, { fn: selected.entry.fn, at: now + selected.entry.interval, interval: selected.entry.interval });
      selected.entry.fn();
    }
    now = end;
  }
  return { context: context, listeners: listeners, sockets: sockets, fetches: fetches, timers: timers, tick: tick, getSocket: function () { return socket; } };
}

test("production connection cancels close stability, stale messages, probes, and resume deadlines", function () {
  var f = productionHarness();
  f.context.connect();
  var first = f.sockets[0];
  first.readyState = 1;
  first.onopen();
  first.close();
  f.tick(14999);
  var retryBeforeOldStableDeadline = f.context.lifecycle.getRetryAttempt();
  f.tick(1);
  assert.equal(f.context.lifecycle.getRetryAttempt(), retryBeforeOldStableDeadline, "closed sockets cannot reset retry state through an old stable timer");

  var g = productionHarness();
  g.context.initConnection();
  g.context.connect();
  var live = g.sockets[0];
  live.readyState = 1;
  live.send = function (data) {
    if (JSON.parse(data).type === "ping" && live.onmessage) live.onmessage({ data: JSON.stringify({ type: "pong" }) });
  };
  live.onopen();
  g.listeners.visibilitychange();
  g.context.cancelReconnect();
  var sendsAfterCancel = 0;
  live.send = function () { sendsAfterCancel += 1; };
  g.tick(10000);
  assert.equal(sendsAfterCancel, 0, "cancel prevents a pending probe from sending");
  g.context.state.connected = false;
  live.onmessage({ data: JSON.stringify({ type: "pong" }) });
  assert.equal(g.context.state.connected, false, "cancelled socket messages cannot restore connected state");

  var h = productionHarness();
  h.context.initConnection();
  h.context.connect();
  var offlineSocket = h.sockets[0];
  offlineSocket.readyState = 1;
  offlineSocket.onopen();
  h.listeners.offline();
  assert.equal(h.getSocket(), null, "offline detaches the old OPEN socket");
  assert.equal(offlineSocket.onmessage, null, "offline detaches stale message handlers");

  var resumed = productionHarness();
  resumed.context.initConnection();
  resumed.context.connect();
  var resumedSocket = resumed.sockets[0];
  resumedSocket.readyState = 1;
  resumedSocket.send = function (data) {
    if (JSON.parse(data).type === "ping" && resumedSocket.onmessage) resumedSocket.onmessage({ data: JSON.stringify({ type: "pong" }) });
  };
  resumedSocket.onopen();
  resumed.tick(25000);
  resumed.listeners.visibilitychange();
  resumed.tick(10000);
  assert.equal(resumed.getSocket(), resumedSocket, "visible resume replaces the old heartbeat deadline");
});

test("production handshake timeout replaces a stalled socket and server health resets stability", function () {
  var f = productionHarness();
  f.context.connect();
  assert.equal(f.sockets.length, 1);
  f.tick(11999);
  assert.equal(f.sockets.length, 1, "the production handshake remains within its 12-second budget");
  f.tick(1);
  assert.equal(f.getSocket(), null, "a stalled handshake is replaced without waiting for close");

  var healthy = productionHarness();
  healthy.context.lifecycle.schedule("prior", function () {});
  healthy.context.connect();
  var healthySocket = healthy.sockets[0];
  healthySocket.readyState = 1;
  healthySocket.onopen();
  healthy.tick(14999);
  assert.equal(healthy.context.lifecycle.getRetryAttempt(), 1, "open alone does not reset retry state");
  healthySocket.onmessage({ data: JSON.stringify({ type: "bootstrap" }) });
  healthy.tick(15000);
  assert.equal(healthy.context.lifecycle.getRetryAttempt(), 0, "server health proof resets retry state after stability");
});

test("production auth ignores late resolve and reject from a timed-out request", function () {
  ["resolve", "reject"].forEach(function (outcome) {
    var f = productionHarness();
    f.context.scheduleReconnect("auth-race");
    f.tick(1000);
    assert.equal(f.fetches.length, 1);
    f.tick(4000);
    f.tick(1500);
    assert.equal(f.fetches.length, 2, "a replacement auth request is pending in the same epoch");
    f.fetches[0][outcome]({ status: 200 });
    assert.equal(f.getSocket(), null, "the stale auth result cannot start a socket");
  });
});

test("wakeups do not replace a CONNECTING handshake and errors replace directly", function () {
  var f = productionHarness();
  f.context.initConnection();
  f.context.connect();
  var connecting = f.sockets[0];
  f.listeners.online();
  f.listeners.visibilitychange();
  f.listeners["clay-message-delivery-timeout"]({ detail: { socket: connecting } });
  f.tick(1000);
  assert.equal(f.sockets.length, 1, "wakeups do not create parallel sockets during the handshake");
  assert.equal(f.getSocket(), connecting, "the allowed handshake remains live");
  connecting.onerror();
  assert.equal(f.getSocket(), null, "onerror replaces without waiting for close");
  assert.equal(connecting.onclose, null, "replacement detaches the close callback");
});

test("a real ACK-timeout event probes a healthy OPEN socket without reconnecting", function () {
  var f = productionHarness();
  f.context.initConnection();
  f.context.connect();
  var socket = f.sockets[0];
  var pings = 0;
  socket.readyState = 1;
  socket.send = function (data) {
    if (JSON.parse(data).type === "ping") {
      pings++;
      socket.onmessage({ data: JSON.stringify({ type: "pong" }) });
    }
  };
  socket.onopen();
  f.listeners["clay-message-delivery-timeout"]({ detail: { socket: socket, clientMessageId: "cm-health" } });
  assert.equal(f.getSocket(), socket, "a healthy ACK-timeout probe does not replace the socket");
  assert.equal(f.sockets.length, 1, "a healthy ACK-timeout probe does not create another socket");
  assert.equal(pings, 1, "the ACK-timeout event sends one immediate ping");
});
