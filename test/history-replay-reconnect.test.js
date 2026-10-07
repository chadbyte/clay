var fs = require("fs");
var os = require("os");
var path = require("path");
// Isolate every config read before any Clay module loads.
var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-replay-reconnect-home-"));
process.env.CLAY_HOME = fixtureHome;

var test = require("node:test");
var assert = require("node:assert/strict");
var childProcess = require("child_process");
var captureReconnect = require("./fixtures/history-replay-reconnect-sequence").captureReconnect;

test.after(function () { fs.rmSync(fixtureHome, { recursive: true, force: true }); });

function types(messages) {
  return messages.map(function (msg) { return msg.type; });
}

test("reconnect sends authoritative processing state before replay, then live state after history_done", function () {
  [["running", true], ["tool", true], ["idle", false]].forEach(function (pair) {
    var sent = captureReconnect({ shape: pair[0], size: 5 });
    var order = types(sent);
    var switched = sent[order.indexOf("session_switched")];
    assert.equal(switched.isProcessing, pair[1], pair[0] + " session_switched carries isProcessing");
    assert.ok(order.indexOf("session_switched") < order.indexOf("history_meta"));
    assert.ok(order.indexOf("history_meta") < order.indexOf("history_done"));
    if (pair[1]) assert.ok(order.indexOf("history_done") < order.indexOf("status"), "status arrives only after replay");
    else assert.equal(order.indexOf("status"), -1);
    if (pair[0] === "tool") assert.ok(order.indexOf("history_done") < order.indexOf("permission_request_pending"));
  });
});

function loadPlaywright() {
  try { return require("playwright"); } catch (e) { return null; }
}

function startFixtureServer() {
  var server = childProcess.spawn(process.execPath, [path.join(__dirname, "fixtures/history-replay-browser-server.js")]);
  return new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.stdout.once("data", function (data) { resolve({ url: String(data).trim(), server: server }); });
  });
}

test("Chromium restores real reconnect sequences atomically and continues live output", { timeout: 180000 }, async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip("playwright is not installed"); return; }
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (e) { t.skip("Chromium is not available: " + e.message); return; }
  var fixture = await startFixtureServer();
  async function run(capture, extra) {
    var page = await browser.newPage();
    try {
      await page.goto(fixture.url);
      await page.waitForFunction("window.fixtureReady === true");
      return await page.evaluate(async function (args) {
        var result = await window.runReconnectFixture(args.messages);
        if (args.extra === "stale") result.staleSpinning = !!document.querySelector('[data-tool-id="stale-tool"]:not(.done)');
        if (args.extra === "switch") result.switchPath = await window.runHistoryFixture(args.vendor);
        return result;
      }, { messages: captureReconnect(capture), extra: extra || null, vendor: capture.vendor });
    } finally {
      await page.close();
    }
  }
  try {
    for (var vendor of ["claude", "codex"]) {
      var running = await run({ shape: "running", size: 3000, vendor: vendor }, "switch");
      assert.equal(running.partialPaints, 0, vendor + ": no history painted before history_done");
      assert.equal(running.savedToolText, true);
      assert.equal(running.thinkingItems, 1);
      assert.equal(running.openAnswer, true, vendor + ": the active answer stays open after reconnect");
      assert.equal(running.liveSameBubble, true, vendor + ": live text continues the restored answer");
      assert.equal(running.assistantBubblesAfterLive, 1);
      assert.equal(running.replayingHistory, false);
      assert.deepEqual(running.errors, []);
      assert.equal(running.switchPath.partialPaints, 0, vendor + ": switch_session path still restores atomically");

      var tool = await run({ shape: "tool", size: 3000, vendor: vendor });
      assert.equal(tool.partialPaints, 0);
      assert.equal(tool.toolsDone["active-tool"], false, vendor + ": the running tool is not marked done");
      assert.equal(tool.toolsDone["old-tool"], true);
      assert.equal(tool.permissionActionable, true, vendor + ": the pending permission stays actionable");
      assert.deepEqual(tool.errors, []);

      var idle = await run({ shape: "idle", size: 3000, vendor: vendor });
      assert.equal(idle.partialPaints, 0);
      assert.equal(idle.sessionIsProcessing, false);
      assert.equal(idle.openAnswer, false, vendor + ": a finished turn is finalized");
      assert.equal(idle.liveSameBubble, false);
      assert.deepEqual(idle.errors, []);
    }

    // An earlier turn interrupted before its tool finished (no result or
    // done recorded) must not leave a spinner in a restored running session.
    var ts = 1700000000000;
    var stale = await run({ processing: true, history: [
      { type: "user_message", text: "first", _ts: ts },
      { type: "tool_start", id: "stale-tool", name: "Bash", _ts: ts },
      { type: "tool_executing", id: "stale-tool", name: "Bash", input: { command: "sleep 1" }, _ts: ts },
      { type: "user_message", text: "second", _ts: ts },
      { type: "delta", text: "Working on it", _ts: ts },
    ] }, "stale");
    assert.equal(stale.toolsDone["stale-tool"], true);
    assert.equal(stale.staleSpinning, false);
    assert.equal(stale.openAnswer, true, "the current answer still continues");

    // Question answers and Driver delegations are recorded mid-turn; tools
    // started before them may still be running and must stay active.
    var midTurn = [
      ["askUserAnswer", { type: "user_message", text: "Yes", askUserAnswer: true, _ts: ts }],
      ["delegated", { type: "user_message", text: "Run the task", delegated: true, delegatedBy: 7, delegatedByTitle: "Driver", _ts: ts }],
    ];
    for (var entry of midTurn) {
      var injected = await run({ processing: true, history: [
        { type: "user_message", text: "start", _ts: ts },
        { type: "tool_start", id: "running-tool", name: "Bash", _ts: ts },
        { type: "tool_executing", id: "running-tool", name: "Bash", input: { command: "npm test" }, _ts: ts },
        entry[1],
      ] });
      assert.equal(injected.toolsDone["running-tool"], false, entry[0] + " keeps the running tool active");
      assert.deepEqual(injected.errors, []);
    }
  } finally {
    await browser.close();
    fixture.server.kill();
  }
});
