var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var createSessionManager = require("../lib/sessions").createSessionManager;

// Claude SDK 0.3.277 fixed a resumed/forked session's total_cost_usd and
// modelUsage starting at zero instead of continuing from earlier turns.
// Clay has no compensating delta-accounting for the old bug to remove: it
// only ever reads the SDK's own reported total_cost_usd verbatim as each
// result arrives (lib/yoke/adapters/claude.js:479 `base.cost = raw.total_cost_usd`)
// and surfaces the most recent one on history replay
// (lib/sessions.js replayHistory, scanning backward for the last "result").
// These tests exercise that real replay path with a realistic resumed-session
// history, to prove cumulative growth across turns is preserved verbatim and
// never re-summed, re-zeroed, or capped by Clay's own code.

function manager(root) {
  var sent = [];
  var sm = createSessionManager({
    cwd: path.join(root, "project"),
    sessionsBase: path.join(root, "sessions"),
    send: function (obj) { sent.push(obj); },
  });
  return { sm: sm, sent: sent };
}

test("a resumed session's cumulative cost/usage survives history replay verbatim, across multiple turns", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-resumed-cost-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var m = manager(root);
  var session = m.sm.createSession({ vendor: "claude", cliSessionId: "resumed-thread" });

  // Simulates three turns of an ALREADY-RESUMED session (cliSessionId set
  // before any of these turns ran): each "result" reports total_cost_usd as
  // the SDK's own cumulative total for the whole session, strictly
  // increasing, exactly like a correctly-fixed 0.3.277+ resume.
  session.history.push({ type: "user_message", text: "first" });
  session.history.push({ type: "result", cost: 0.12, usage: { input_tokens: 100 }, modelUsage: { "claude-opus-5": { outputTokens: 50 } } });
  session.history.push({ type: "user_message", text: "second" });
  session.history.push({ type: "result", cost: 0.27, usage: { input_tokens: 220 }, modelUsage: { "claude-opus-5": { outputTokens: 110 } } });
  session.history.push({ type: "user_message", text: "third" });
  session.history.push({ type: "result", cost: 0.41, usage: { input_tokens: 340 }, modelUsage: { "claude-opus-5": { outputTokens: 180 } } });

  m.sent.length = 0;
  m.sm.replayHistory(session, undefined, null, null);
  var historyDone = m.sent.find(function (msg) { return msg.type === "history_done"; });
  assert.ok(historyDone, "history_done must be sent on replay");
  assert.equal(historyDone.lastCost, 0.41, "the latest cumulative total is surfaced verbatim, not re-derived");
  assert.equal(historyDone.lastUsage.input_tokens, 340);
  assert.equal(historyDone.lastModelUsage["claude-opus-5"].outputTokens, 180);
});

test("cost never resets to zero mid-session the way the pre-0.3.277 SDK bug did", function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-resumed-cost-nozero-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var m = manager(root);
  var session = m.sm.createSession({ vendor: "claude", cliSessionId: "resumed-thread-2" });

  session.history.push({ type: "user_message", text: "first" });
  session.history.push({ type: "result", cost: 0.50 });
  // A resume boundary used to reset total_cost_usd to 0 on the SDK side pre-
  // 0.3.277. Clay must not paper over that by carrying forward its own
  // cached number -- it must show exactly what the (now-fixed) SDK reports.
  session.history.push({ type: "user_message", text: "after resume" });
  session.history.push({ type: "result", cost: 0.63 });

  m.sent.length = 0;
  m.sm.replayHistory(session, undefined, null, null);
  var historyDone = m.sent.find(function (msg) { return msg.type === "history_done"; });
  assert.equal(historyDone.lastCost, 0.63, "Clay reflects the SDK's own post-fix cumulative figure, not a cached or summed one");
});

test("claude.js's result normalization forwards total_cost_usd/modelUsage with no local arithmetic", function () {
  var source = fs.readFileSync("lib/yoke/adapters/claude.js", "utf8");
  var resultBlock = source.slice(source.indexOf('if (raw.type === "result") {'));
  resultBlock = resultBlock.slice(0, resultBlock.indexOf("return base;") + 12);
  assert.match(resultBlock, /base\.cost = raw\.total_cost_usd;/,
    "cost is a direct passthrough of the SDK's own cumulative total_cost_usd");
  assert.match(resultBlock, /base\.modelUsage = raw\.modelUsage \|\| null;/);
  assert.equal(/\+=|\bsum\b|cumulative\w*\s*\+|prior\w*[Cc]ost/.test(resultBlock), false,
    "no addition, summation, or prior-cost variable exists here that could double-count a resumed session's total");
});
