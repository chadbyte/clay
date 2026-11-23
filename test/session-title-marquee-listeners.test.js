var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

// Regression: binding the marquee used to start one document-wide
// MutationObserver plus one window resize listener per session row. Rows are
// rebuilt on every sidebar render, so long session lists (e.g. a Mate with
// hundreds of sessions) piled up thousands of observers, and replaying or
// prepending history produced one MutationRecord per observer per DOM change.

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
  var props = {};
  var title = {
    scrollWidth: 400,
    getBoundingClientRect: function () { return { left: 10, right: 190, width: 180 }; },
    style: { setProperty: function (k, v) { props[k] = v; }, removeProperty: function (k) { delete props[k]; } },
  };
  return { row: row, title: title };
}

test("session title marquee does not keep per-row observers or window listeners", async function () {
  var observers = 0;
  var frames = [];
  var win = new FakeTarget();
  global.window = win;
  global.document = { body: {} };
  global.MutationObserver = function () { observers++; this.observe = function () {}; this.disconnect = function () {}; };
  global.requestAnimationFrame = function (fn) { frames.push(fn); return frames.length; };
  global.cancelAnimationFrame = function () {};
  try {
    var mod = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/session-title-marquee.js")).href);
    var rows = [];
    for (var i = 0; i < 300; i++) {
      var r = fakeRow();
      mod.bindSessionTitleMarquee(r.row, r.title, null);
      rows.push(r);
    }
    assert.equal(observers, 0, "binding rows created MutationObservers");
    assert.equal(win.count("resize"), 0, "idle rows registered window resize listeners");

    var hovered = rows[0];
    hovered.row.dispatch("mouseenter");
    hovered.row.dispatch("focusin");
    frames.splice(0).forEach(function (fn) { fn(); });
    assert.equal(hovered.row.classList.contains("session-title-marquee"), true, "long title did not activate marquee");
    assert.equal(win.count("resize"), 1, "active marquee should listen for resize exactly once");

    win.dispatch("resize");
    assert.equal(hovered.row.classList.contains("session-title-marquee"), false, "resize did not stop the marquee");
    assert.equal(win.count("resize"), 0, "resize listener outlived the marquee");

    hovered.row.dispatch("mouseenter");
    hovered.row.dispatch("mouseleave");
    assert.equal(win.count("resize"), 0, "mouseleave left a resize listener behind");
  } finally {
    delete global.window;
    delete global.document;
    delete global.MutationObserver;
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
  }
});
