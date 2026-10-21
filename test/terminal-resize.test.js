var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");

test("desktop terminal resize preserves the Clay panel header", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/terminal.js"), "utf8");

  assert.match(source, /if \(isTouchDevice && window\.visualViewport && !viewportHandler\)/);
  assert.match(source, /terminalContainerEl\.style\.height = window\.visualViewport\.height/);
});

test('attachment snapshots refit the visible viewport while explicit resize commands remain authoritative', async function () {
  var sizing = await import('../lib/public/modules/terminal-viewport.js'), resized = [], fits = 0;
  var visible = true, tab = { bodyEl: { getBoundingClientRect: function () { return { width: visible ? 600 : 0, height: visible ? 400 : 0 }; } },
    xterm: { resize: function (cols, rows) { resized.push([cols, rows]); } } };
  function refit() { fits++; }
  sizing.applyTerminalSize(tab, { cols: 100, rows: 50, initial: true }, true, refit);
  assert.equal(fits, 1); assert.deepEqual(resized, []);
  sizing.applyTerminalSize(tab, { cols: 90, rows: 25 }, true, refit);
  assert.deepEqual(resized, [[90, 25]], 'Reviewed resize and other live resize events retain their actual dimensions');
  visible = false;
  sizing.applyTerminalSize(tab, { cols: 100, rows: 50, initial: true }, true, refit);
  assert.equal(fits, 1, 'A hidden pane cannot publish zero or stale fitted dimensions');
  sizing.applyTerminalSize(tab, { cols: 80, rows: 24, initial: true }, false, refit);
  assert.deepEqual(resized[1], [80, 24], 'Inactive instances retain their snapshot until activation fits them');
  sizing.applyTerminalSize(null, { cols: 80, rows: 24 }, true, refit);
  sizing.applyTerminalSize(tab, { cols: 0, rows: 24 }, true, refit);
  assert.equal(resized.length, 2); assert.equal(fits, 1);
});
