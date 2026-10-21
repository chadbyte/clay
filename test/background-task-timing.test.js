var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var timing = require("../lib/background-task-timing");
var backgroundTasks = require("../lib/yoke/codex-background-tasks");

function task(id, extra) {
  return Object.assign({ task_id: id, task_type: "shell", description: id }, extra || {});
}

// Realistic epoch milliseconds. Small integers would be read as epoch seconds
// by normalizeTimestamp's vendor heuristic and rescaled.
var T0 = 1767225600000; // 2026-01-01T00:00:00Z

test("a newly seen task is stamped with the current time", function () {
  var merged = timing.mergeStartTimes([], [task("a")], T0);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].started_at, T0);
  assert.strictEqual(merged[0].task_id, "a");
  assert.strictEqual(merged[0].description, "a");
});

test("an already-running task keeps its original stamp when the list is re-emitted", function () {
  var first = timing.mergeStartTimes([], [task("a")], T0);
  // A second task starting re-emits the whole list; "a" must not restart.
  var second = timing.mergeStartTimes(first, [task("a"), task("b")], T0 + 8000);
  assert.strictEqual(second[0].started_at, T0, "existing task keeps its first-seen time");
  assert.strictEqual(second[1].started_at, T0 + 8000, "new task is stamped now");

  var third = timing.mergeStartTimes(second, [task("a")], T0 + 19000);
  assert.strictEqual(third[0].started_at, T0, "stamp survives a sibling finishing");
});

test("a task id reused after disappearing gets a fresh stamp", function () {
  var first = timing.mergeStartTimes([], [task("a")], T0);
  var cleared = timing.mergeStartTimes(first, [], T0 + 1000);
  assert.deepStrictEqual(cleared, []);
  var restarted = timing.mergeStartTimes(cleared, [task("a")], T0 + 4000);
  assert.strictEqual(restarted[0].started_at, T0 + 4000);
});

test("a vendor-supplied start time wins over first-seen stamping", function () {
  var merged = timing.mergeStartTimes([], [task("a", { started_at: T0 - 500 })], T0 + 8000);
  assert.strictEqual(merged[0].started_at, T0 - 500);
});

test("a vendor timestamp still wins over a previously carried stamp", function () {
  var first = timing.mergeStartTimes([], [task("a")], T0);
  var second = timing.mergeStartTimes(first, [task("a", { started_at: T0 - 250 })], T0 + 8000);
  assert.strictEqual(second[0].started_at, T0 - 250);
});

test("epoch seconds, ISO strings, and junk timestamps are normalized", function () {
  assert.strictEqual(timing.normalizeTimestamp(1700000000), 1700000000000, "epoch seconds scale to ms");
  assert.strictEqual(timing.normalizeTimestamp(1700000000000), 1700000000000, "epoch ms pass through");
  assert.strictEqual(timing.normalizeTimestamp("2026-01-02T03:04:05Z"), Date.parse("2026-01-02T03:04:05Z"));
  assert.strictEqual(timing.normalizeTimestamp("not a date"), null);
  assert.strictEqual(timing.normalizeTimestamp(0), null);
  assert.strictEqual(timing.normalizeTimestamp(-5), null);
  assert.strictEqual(timing.normalizeTimestamp(null), null);
  assert.strictEqual(timing.normalizeTimestamp(undefined), null);
});

test("an unusable vendor timestamp falls back to first-seen stamping, not 1970", function () {
  var merged = timing.mergeStartTimes([], [task("a", { started_at: "garbage" })], T0 + 7000);
  assert.strictEqual(merged[0].started_at, T0 + 7000);
});

test("merge tolerates non-array input and skips empty entries", function () {
  assert.deepStrictEqual(timing.mergeStartTimes([], null, T0), []);
  assert.deepStrictEqual(timing.mergeStartTimes(null, undefined, T0), []);
  var merged = timing.mergeStartTimes(null, [null, task("a")], T0);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].task_id, "a");
});

test("merge does not mutate the incoming task objects", function () {
  var incoming = task("a");
  timing.mergeStartTimes([], [incoming], T0);
  assert.strictEqual(incoming.started_at, undefined);
});

test("Codex forwards a background terminal's own start time when present", function () {
  var tasks = backgroundTasks.mapTerminals({ terminals: [
    { id: "term-1", command: "npm test", startedAt: 1700000000000 },
    { id: "term-2", command: "npm run dev" },
  ] });
  assert.strictEqual(tasks[0].started_at, 1700000000000);
  assert.strictEqual(tasks[1].started_at, undefined, "absent vendor time is left for the session to stamp");
});

// The client formatter is an ES module, so assert against its source rather
// than importing it into this CommonJS test.
function loadFormatElapsed() {
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "public", "modules", "background-tasks-ui.js"),
    "utf8"
  );
  var start = source.indexOf("export function formatElapsed");
  var end = source.indexOf("// Ambient tasks");
  assert.ok(start !== -1 && end > start, "formatElapsed and its pad helper must be present");
  var body = source.slice(start, end).replace("export function", "function");
  return new Function(body + "\nreturn formatElapsed;")();
}

test("elapsed time renders as short, tabular-friendly labels", function () {
  var formatElapsed = loadFormatElapsed();
  var base = 1000000;
  assert.strictEqual(formatElapsed(base, base), "0s");
  assert.strictEqual(formatElapsed(base, base + 45 * 1000), "45s");
  assert.strictEqual(formatElapsed(base, base + 59 * 1000), "59s");
  assert.strictEqual(formatElapsed(base, base + 60 * 1000), "1m 00s");
  assert.strictEqual(formatElapsed(base, base + 134 * 1000), "2m 14s");
  assert.strictEqual(formatElapsed(base, base + 3599 * 1000), "59m 59s");
  assert.strictEqual(formatElapsed(base, base + 3600 * 1000), "1h 00m");
  assert.strictEqual(formatElapsed(base, base + 3780 * 1000), "1h 03m");
});

test("elapsed time is blank for a missing stamp and never negative", function () {
  var formatElapsed = loadFormatElapsed();
  assert.strictEqual(formatElapsed(0, 5000), "");
  assert.strictEqual(formatElapsed(undefined, 5000), "");
  assert.strictEqual(formatElapsed(NaN, 5000), "");
  // Clock skew between server stamp and client render must not show "-3s".
  assert.strictEqual(formatElapsed(10000, 7000), "0s");
});

test("the composer bar ships no emoji and no accent-filled count chip", function () {
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "public", "modules", "background-tasks-ui.js"),
    "utf8"
  );
  assert.ok(source.indexOf("⏳") === -1, "the hourglass emoji is gone");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(source), "no emoji in the rendered markup");
  assert.ok(source.indexOf("background-tasks-chip") === -1, "the numeric accent chip is gone");
  assert.ok(source.indexOf("iconHtml") !== -1, "icons come from the shared icon system");
});

test("the sidebar task-count badge keeps its own style rule", function () {
  var css = fs.readFileSync(path.join(__dirname, "..", "lib", "public", "css", "input.css"), "utf8");
  assert.ok(css.indexOf(".session-background-task-count") !== -1, "sidebar badge rule still exists");
  assert.ok(css.indexOf(".background-tasks-chip") === -1, "composer chip rule is removed");
  assert.ok(
    /@media \(prefers-reduced-motion: reduce\)[^}]*\{[\s\S]*?\.background-tasks-activity i \{ animation: none/.test(css),
    "the activity indicator has a reduced-motion fallback"
  );
});

// --- ambient (housekeeping) tasks ------------------------------------------

test("the Claude adapter forwards the ambient flag and defaults it to false", function () {
  var normalize = require("../lib/yoke/adapters/claude").contractTestKit.normalizeEvent;
  var events = normalize({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: [
      { task_id: "t1", task_type: "local_bash", description: "npm test" },
      { task_id: "t2", task_type: "local_agent", description: "watcher", ambient: true },
      { task_id: "t3", task_type: "local_bash", description: "explicit", ambient: false },
    ],
  });
  var result = Array.isArray(events) ? events[0] : events;
  assert.strictEqual(result.tasks[0].ambient, false, "absent normalizes to false, not undefined");
  assert.strictEqual(result.tasks[1].ambient, true);
  assert.strictEqual(result.tasks[2].ambient, false);
  // The existing normalization must survive alongside the new field.
  assert.strictEqual(result.tasks[0].task_type, "shell");
  assert.strictEqual(result.tasks[1].task_type, "agent");
});

test("the start-time merge preserves the ambient flag", function () {
  var merged = timing.mergeStartTimes([], [
    task("a", { ambient: true }),
    task("b", { ambient: false }),
  ], T0);
  assert.strictEqual(merged[0].ambient, true);
  assert.strictEqual(merged[1].ambient, false);

  // And across a re-emission, alongside the carried-forward stamp.
  var again = timing.mergeStartTimes(merged, [task("a", { ambient: true })], T0 + 5000);
  assert.strictEqual(again[0].ambient, true);
  assert.strictEqual(again[0].started_at, T0, "ambient tasks keep their elapsed clock too");
});

test("Codex tasks carry no ambient flag and count as user work", function () {
  var tasks = backgroundTasks.mapTerminals({ terminals: [{ id: "term-1", command: "npm test" }] });
  assert.strictEqual(tasks[0].ambient, undefined, "Codex has no ambient concept");
  assert.strictEqual(timing.countUserTasks(tasks), 1, "absent must not be read as ambient");
});

test("counting and splitting ignore ambient housekeeping", function () {
  var list = [
    task("user-1"),
    task("amb-1", { ambient: true }),
    task("user-2", { ambient: false }),
    task("amb-2", { ambient: true }),
  ];
  assert.strictEqual(timing.countUserTasks(list), 2);
  assert.deepStrictEqual(timing.userTasks(list).map(function (t) { return t.task_id; }), ["user-1", "user-2"]);
  assert.deepStrictEqual(timing.ambientTasks(list).map(function (t) { return t.task_id; }), ["amb-1", "amb-2"]);

  // Ambient-only reads as "no user work running".
  assert.strictEqual(timing.countUserTasks([task("amb", { ambient: true })]), 0);
  assert.strictEqual(timing.countUserTasks([]), 0);
  assert.strictEqual(timing.countUserTasks(null), 0);
});

test("the sidebar badge and change notifications count user work only", function () {
  // sessions.js feeds every sidebar badge site from this one field, and
  // sdk-message-processor decides whether to rebroadcast the session list from
  // the same count. Both must ignore ambient watchers.
  var sessions = fs.readFileSync(path.join(__dirname, "..", "lib", "sessions.js"), "utf8");
  assert.ok(
    /backgroundTaskCount: backgroundTaskTiming\.countUserTasks\(s\.activeBackgroundTasks\)/.test(sessions),
    "the sidebar badge counts non-ambient tasks"
  );
  var processor = fs.readFileSync(path.join(__dirname, "..", "lib", "sdk-message-processor.js"), "utf8");
  assert.strictEqual(
    (processor.match(/backgroundTaskTiming\.countUserTasks\(/g) || []).length, 3,
    "both the init reset and the changed handler's before/after counts use it"
  );
  assert.ok(
    !/previousBackgroundTaskCount !== activeBackgroundTasks\.length/.test(processor),
    "the raw length comparison is gone"
  );
});

// --- client rendering ------------------------------------------------------

function loadClientHelpers() {
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "public", "modules", "background-tasks-ui.js"),
    "utf8"
  );
  var start = source.indexOf("export function isAmbientTask");
  var end = source.indexOf("function renderBackgroundTasks");
  assert.ok(start !== -1 && end > start, "isAmbientTask and splitTasks must be present");
  var body = source.slice(start, end).replace(/export function/g, "function");
  return new Function(body + "\nreturn { isAmbientTask: isAmbientTask, splitTasks: splitTasks };")();
}

test("the composer splits user work from housekeeping", function () {
  var helpers = loadClientHelpers();
  var split = helpers.splitTasks([
    { task_id: "u1", description: "build" },
    { task_id: "a1", description: "watcher", ambient: true },
    { task_id: "u2", description: "test", ambient: false },
    null,
  ]);
  assert.deepStrictEqual(split.user.map(function (t) { return t.task_id; }), ["u1", "u2"]);
  assert.deepStrictEqual(split.ambient.map(function (t) { return t.task_id; }), ["a1"]);
  assert.deepStrictEqual(helpers.splitTasks(null), { user: [], ambient: [] });
});

test("native task tabs hide ambient-only work and reuse Worker chips", function () {
  var source = fs.readFileSync(path.join(__dirname, "..", "lib/public/modules/background-tasks-ui.js"), "utf8");
  assert.match(source, /split.user.length \? split.user.concat\(split.ambient\) : \[\]/);
  assert.match(source, /split-view-worker-chip/);
  assert.match(source, /background_task_stop/);
  assert.match(source, /Housekeeping/);
});
