var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

// Regression: binding the marquee used to start one document-wide
// MutationObserver plus one window resize listener per session row. Rows are
// rebuilt on every sidebar render, so long session lists (e.g. a Mate with
// hundreds of sessions) piled up thousands of observers, and replaying or
// prepending history produced one MutationRecord per observer per DOM change.
// Cleanup must still happen when a hovered row is removed without mouseleave.

function FakeTarget() { this.listeners = {}; }
FakeTarget.prototype.addEventListener = function (type, fn) {
  var list = this.listeners[type] || (this.listeners[type] = []);
  if (list.indexOf(fn) === -1) list.push(fn);
};
FakeTarget.prototype.removeEventListener = function (type, fn) {
  var list = this.listeners[type] || [];
  var index = list.indexOf(fn);
  if (index !== -1) list.splice(index, 1);
};
FakeTarget.prototype.dispatch = function (type, event) {
  (this.listeners[type] || []).slice().forEach(function (fn) { fn(event || {}); });
};
FakeTarget.prototype.count = function (type) { return (this.listeners[type] || []).length; };

function fakeRow() {
  var row = new FakeTarget();
  var classes = new Set();
  row.isConnected = true;
  row.classList = { add: function (c) { classes.add(c); }, remove: function (c) { classes.delete(c); }, contains: function (c) { return classes.has(c); } };
  row.contains = function () { return false; };
  row.getBoundingClientRect = function () { return { left: 0, right: 200, width: 200 }; };
  var title = {
    scrollWidth: 400,
    getBoundingClientRect: function () { return { left: 10, right: 190, width: 180 }; },
    style: { setProperty: function () {}, removeProperty: function () {} },
  };
  return { row: row, title: title };
}

function setupGlobals() {
  var env = { win: new FakeTarget(), frames: [], created: 0, connected: new Set(), maxConnected: 0 };
  global.window = env.win;
  global.document = { body: {} };
  global.MutationObserver = function (callback) {
    var observer = this;
    env.created++;
    observer.observe = function () { env.connected.add(observer); env.maxConnected = Math.max(env.maxConnected, env.connected.size); };
    observer.disconnect = function () { env.connected.delete(observer); };
    observer.fire = function () { callback([{ type: "childList" }], observer); };
  };
  global.requestAnimationFrame = function (fn) { env.frames.push(fn); return env.frames.length; };
  global.cancelAnimationFrame = function () {};
  env.flushFrames = function () { env.frames.splice(0).forEach(function (fn) { fn(); }); };
  // What the browser does when a row is detached: queue a childList record for every connected observer.
  env.remove = function (r) { r.row.isConnected = false; Array.from(env.connected).forEach(function (o) { o.fire(); }); };
  return env;
}

function teardownGlobals() {
  delete global.window;
  delete global.document;
  delete global.MutationObserver;
  delete global.requestAnimationFrame;
  delete global.cancelAnimationFrame;
}

test("session title marquee keeps no per-row observers and cleans up removed hovered rows", async function () {
  var env = setupGlobals();
  try {
    var mod = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/session-title-marquee.js")).href);
    function bindRow() { var r = fakeRow(); mod.bindSessionTitleMarquee(r.row, r.title, null); return r; }

    var rows = [];
    for (var i = 0; i < 300; i++) rows.push(bindRow());
    assert.equal(env.created, 0, "binding idle rows created MutationObservers");
    assert.equal(env.win.count("resize"), 0, "idle rows registered window resize listeners");

    var hovered = rows[0];
    hovered.row.dispatch("mouseenter");
    hovered.row.dispatch("focusin");
    env.flushFrames();
    assert.equal(hovered.row.classList.contains("session-title-marquee"), true, "long title did not activate marquee");
    assert.equal(env.win.count("resize"), 1, "active marquee should listen for resize exactly once");
    assert.equal(env.connected.size, 1, "active marquee should use exactly one removal observer");

    env.win.dispatch("resize");
    assert.equal(hovered.row.classList.contains("session-title-marquee"), false, "resize did not stop the marquee");
    assert.equal(env.win.count("resize"), 0, "resize listener outlived the marquee");
    assert.equal(env.connected.size, 0, "removal observer outlived the marquee");

    hovered.row.dispatch("mouseenter");
    hovered.row.dispatch("mouseleave");
    assert.equal(env.win.count("resize"), 0, "mouseleave left a resize listener behind");
    assert.equal(env.connected.size, 0, "mouseleave left an observer connected");

    // Hover, then remove the row without mouseleave and without any resize, repeatedly.
    for (var round = 0; round < 20; round++) {
      var r = bindRow();
      r.row.dispatch("mouseenter");
      env.flushFrames();
      assert.equal(r.row.classList.contains("session-title-marquee"), true);
      env.remove(r);
      assert.equal(r.row.classList.contains("session-title-marquee"), false, "removed row kept its marquee");
    }
    assert.equal(env.win.count("resize"), 0, "removed hovered rows left resize listeners behind");
    assert.equal(env.connected.size, 0, "removed hovered rows left observers connected");

    // Two running marquees share one listener and one observer; removing one keeps the other tracked.
    var a = bindRow(), b = bindRow();
    a.row.dispatch("mouseenter");
    b.row.dispatch("focusin");
    assert.equal(env.win.count("resize"), 1);
    assert.equal(env.connected.size, 1);
    env.remove(a);
    assert.equal(env.win.count("resize"), 1, "remaining marquee lost its resize listener");
    assert.equal(env.connected.size, 1, "remaining marquee lost its removal observer");
    b.row.dispatch("focusout", { relatedTarget: null });
    assert.equal(env.win.count("resize"), 0);
    assert.equal(env.connected.size, 0);

    assert.equal(env.maxConnected, 1, "more than one observer was connected at a time");
  } finally {
    teardownGlobals();
  }
});
