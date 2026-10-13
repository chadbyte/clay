var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var cursor = require("../lib/dm-digest-cursor");
var attachMateInteraction = require("../lib/project-mate-interaction").attachMateInteraction;

function user(text) { return { type: "user_message", text: text }; }
function mate(text) { return { type: "assistant_message", text: text }; }

test("chunks a conversation at the cap and preserves oversized entry progress", function () {
  var history = [user("x".repeat(12000))];
  var first = cursor.collectChunk(history, { historyIndex: 0, textOffset: 0 }, "");
  assert.equal(first.conversationContent.length, cursor.CONVERSATION_CAP);
  assert.deepEqual(first.cursor, { historyIndex: 0, textOffset: cursor.CONVERSATION_CAP - 6 });

  var second = cursor.collectChunk(history, first.cursor, "");
  assert.equal(second.conversationContent.length, cursor.CONVERSATION_CAP);
  var third = cursor.collectChunk(history, second.cursor, "");
  assert.equal(third.conversationContent, "User: " + "x".repeat(12000 - second.cursor.textOffset));
  assert.deepEqual(third.cursor, { historyIndex: 1, textOffset: 0 });
  assert.equal(cursor.hasPending(history, third.cursor), false);
});

test("serialized conversation cap includes labels, separators, and every small entry", function () {
  var history = [];
  for (var i = 0; i < 1000; i++) history.push(user("a"));
  var chunk = cursor.collectChunk(history, { historyIndex: 0, textOffset: 0 }, "");
  assert.ok(chunk.conversationContent.length <= cursor.CONVERSATION_CAP);
  assert.equal(chunk.conversationContent, Array(750).join("User: a\n") + "User: a");
  assert.equal(chunk.cursor.historyIndex, 750);
});

test("oversized chunks do not split surrogate pairs", function () {
  var history = [user("a".repeat(5994) + "😀" + "b")];
  var first = cursor.collectChunk(history, { historyIndex: 0, textOffset: 0 }, "");
  assert.equal(first.conversationContent.charCodeAt(first.conversationContent.length - 1), "a".charCodeAt(0));
  var second = cursor.collectChunk(history, first.cursor, "");
  assert.equal(second.conversationContent, "User: 😀b");
});

test("legacy index checkpoints resume at the next entry after restart", function () {
  var history = [user("first"), mate("reply"), { type: "digest_checkpoint", digestedIndex: 2 }, user("second")];
  var start = cursor.readCursor(history);
  assert.deepEqual(start, { historyIndex: 2, textOffset: 0 });
  var chunk = cursor.collectChunk(history, start, "");
  assert.match(chunk.conversationContent, /User: second/);
});

test("persisted mid-message checkpoint restores the exact cursor after restart", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-dm-cursor-"));
  var checkpointFile = path.join(root, "session.jsonl");
  var history = [user("x".repeat(10000))];
  var first = cursor.collectChunk(history, { historyIndex: 0, textOffset: 0 }, "");
  fs.writeFileSync(checkpointFile, JSON.stringify({ type: "user_message", text: history[0].text }) + "\n" +
    JSON.stringify({ type: "digest_checkpoint", cursor: first.cursor }) + "\n");
  var restored = fs.readFileSync(checkpointFile, "utf8").trim().split("\n").map(function (line) { return JSON.parse(line); });
  assert.deepEqual(cursor.readCursor(restored), first.cursor);
  assert.equal(cursor.collectChunk(restored, cursor.readCursor(restored), "").conversationContent,
    "User: " + "x".repeat(10000 - first.cursor.textOffset));
  fs.rmSync(root, { recursive: true, force: true });
});

test("fresh preview never consumes an unread historical assistant entry", function () {
  var history = [user("question"), mate("the answer is ready")];
  var chunk = cursor.collectChunk(history, { historyIndex: 0, textOffset: 0 }, "the answer is ready");
  assert.equal(chunk.conversationContent, "User: question\nMate: the answer is ready");
  assert.deepEqual(chunk.cursor, { historyIndex: 2, textOffset: 0 });
});

test("delta-only and mixed histories drain every character exactly once", function () {
  [
    [{ type: "delta", text: "😀answer".repeat(2500) }],
    [user("question".repeat(1000)), { type: "delta", text: "a".repeat(9000) },
      { type: "tool_result", content: "ignored" }, { type: "delta", text: "😀b".repeat(3000) }, mate("legacy")],
    Array.from({ length: 1000 }, function (_, i) { return { type: i % 2 ? "delta" : "user_message", text: "entry" + i }; }),
  ].forEach(function (history) {
    var position = { historyIndex: 0, textOffset: 0 };
    var actual = "";
    var expected = history.filter(function (entry) { return typeof entry.text === "string"; })
      .map(function (entry) { return entry.text; }).join("");
    var drains = 0;
    while (cursor.hasPending(history, position)) {
      var chunk = cursor.collectChunk(history, position);
      assert.ok(chunk.conversationContent.length <= 6000);
      chunk.conversationContent.split("\n").forEach(function (line) {
        assert.match(line, /^(User|Mate): /);
        var text = line.substring(6);
        assert.ok(!/[\uD800-\uDBFF]$/.test(text));
        assert.ok(!/^[\uDC00-\uDFFF]/.test(text));
        actual += text;
      });
      assert.notDeepEqual(chunk.cursor, position);
      position = chunk.cursor;
      assert.ok(++drains < 100);
    }
    assert.equal(actual, expected);
  });
});

var createSessionManager = require("../lib/sessions").createSessionManager;
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;
var normalizeClaudeEvent = require("../lib/yoke/adapters/claude").contractTestKit.normalizeEvent;

function integration(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-dm-production-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var mateDir = path.join(root, "mate");
  fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });
  fs.writeFileSync(path.join(mateDir, "mate.yaml"), "relationship: assistant\n");
  var sm = createSessionManager({ cwd: mateDir, sessionsBase: path.join(root, "sessions"), send: function () {} });
  var requests = [];
  var sdk = {
    createMentionSession: function (options) {
      requests.push({ prompt: options.initialMessage, callbacks: options });
      return Promise.resolve({
        isAlive: function () { return true; },
        pushMessage: function (prompt, callbacks) { requests.push({ prompt: prompt, callbacks: callbacks }); },
      });
    },
  };
  var api = attachMateInteraction({
    cwd: mateDir, sm: sm, sdk: sdk,
    matesModule: {
      buildMateCtx: function () { return {}; },
      isMate: function () { return true; },
      getMateDir: function () { return mateDir; },
      getMate: function () { return { name: "Mate" }; },
    },
    isMate: true, projectOwnerId: "owner",
    updateMemorySummary: function () {},
    initMemorySummary: function (_ctx, _id, callback) { callback(); },
  });
  function session(id) {
    var value = {
      localId: id, _sessionRecordId: "dm-" + id, title: "DM", history: [],
      messageUUIDs: [], blocks: {}, sentToolResults: {}, pendingPermissions: {},
      pendingElicitations: {}, pendingAskUser: {}, activeTaskToolIds: {}, taskIdMap: {},
      turnCount: 0, responsePreview: "",
    };
    assert.equal(sm.saveSessionFile(value), true);
    return value;
  }
  function disk(value) {
    var files = [];
    function visit(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
        var target = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (entry.name === value._sessionRecordId + ".jsonl") files.push(target);
      });
    }
    visit(path.join(root, "sessions"));
    assert.equal(files.length, 1);
    return files[0];
  }
  var mp = attachMessageProcessor({
    sm: sm, send: function () {}, onProcessingChanged: function () {},
    onTurnDone: function (value, preview) { api.digestDmTurn(value, preview); },
  });
  return {
    root: root, mateDir: mateDir, sm: sm, api: api, mp: mp, requests: requests, session: session, disk: disk,
    finish: function (index) {
      requests[index].callbacks.onDelta(JSON.stringify({ topic: "test", summary: "saved" }));
      requests[index].callbacks.onDone();
    },
    content: function (index) {
      return requests[index].prompt.split("Conversation (dm):\n")[1].split("\n\nSTEP 1:")[0];
    },
  };
}

function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }

function sdkTurn(f, session, text, streamed) {
  assert.equal(f.sm.sendAndRecord(session, user("question")), true);
  if (streamed) {
    [text.slice(0, 17), text.slice(17)].forEach(function (part) {
      f.mp.processSDKMessage(session, normalizeClaudeEvent({ type: "stream_event", event: {
        type: "content_block_delta", index: 0, delta: { type: "text_delta", text: part },
      } }));
    });
  }
  f.mp.processSDKMessage(session, normalizeClaudeEvent({ type: "assistant",
    message: { content: [{ type: "text", text: text }] },
  }));
  f.mp.processSDKMessage(session, normalizeClaudeEvent({ type: "result", subtype: "success",
    is_error: false, num_turns: 1, result: text, total_cost_usd: 0.01,
  }));
}

test("SDK streamed and fallback output persist before turn completion and drain fully", async function (t) {
  for (var streamed of [true, false]) {
    var f = integration(t);
    var session = f.session(1);
    var answer = "😀full answer ".repeat(1600);
    sdkTurn(f, session, answer, streamed);
    var persisted = fs.readFileSync(f.disk(session), "utf8").trim().split("\n").map(function (line) { return JSON.parse(line); });
    assert.equal(persisted.filter(function (entry) { return entry.type === "delta"; }).map(function (entry) { return entry.text; }).join(""), answer);
    assert.equal(persisted.some(function (entry) { return entry.type === "digest_checkpoint"; }), false);
    assert.equal(persisted[persisted.length - 1].type, "done");
    var actual = "";
    var index = 0;
    while (index < f.requests.length) {
      var content = f.content(index);
      assert.ok(content.length <= 6000);
      actual += content.split("\n").map(function (line) { assert.match(line, /^(User|Mate): /); return line.slice(6); }).join("");
      f.finish(index++);
      await tick();
    }
    assert.equal(actual, "question" + answer);
    assert.ok(index > 3);
    assert.equal(cursor.hasPending(session.history, cursor.readCursor(session.history)), false);
  }
});

test("real journal append failure leaves input retryable", async function (t) {
  var f = integration(t);
  var session = f.session(1);
  f.sm.sendAndRecord(session, user("retry this"));
  var journal = path.join(f.mateDir, "knowledge", "session-digests.jsonl");
  fs.mkdirSync(journal);
  f.api.digestDmTurn(session);
  f.finish(0);
  assert.deepEqual(cursor.readCursor(session.history), { historyIndex: 0, textOffset: 0 });
  assert.equal(session.history.length, 1);
  fs.rmdirSync(journal);
  await tick();
  f.api.digestDmTurn(session);
  assert.equal(f.content(1), f.content(0));
  f.finish(1);
  assert.equal(session.history.filter(function (entry) { return entry.type === "digest_checkpoint"; }).length, 1);
});

test("real checkpoint append failure retries and can duplicate an already saved journal", async function (t) {
  var f = integration(t);
  var session = f.session(1);
  f.sm.sendAndRecord(session, user("keep this"));
  var file = f.disk(session);
  var saved = fs.readFileSync(file);
  f.api.digestDmTurn(session);
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  f.finish(0);
  assert.deepEqual(cursor.readCursor(session.history), { historyIndex: 0, textOffset: 0 });
  assert.equal(session.history.length, 1);
  fs.rmdirSync(file);
  fs.writeFileSync(file, saved);
  await tick();
  f.api.digestDmTurn(session);
  assert.equal(f.content(1), f.content(0));
  f.finish(1);
  var journal = fs.readFileSync(path.join(f.mateDir, "knowledge", "session-digests.jsonl"), "utf8").trim().split("\n");
  assert.equal(journal.length, 2, "separate journal/checkpoint writes permit duplicate digests on retry");
  assert.equal(cursor.readCursor(session.history).historyIndex, 1);
});

test("restart restores persisted within-delta offset and drains the remainder", async function (t) {
  var f = integration(t);
  var session = f.session(1);
  var text = "😀restart ".repeat(1500);
  f.sm.sendAndRecord(session, { type: "delta", text: text });
  f.api.digestDmTurn(session);
  var first = f.content(0).slice(6);
  f.finish(0);
  session.history = fs.readFileSync(f.disk(session), "utf8").trim().split("\n").map(function (line) { return JSON.parse(line); }).filter(function (entry) { return entry.type !== "meta"; });
  // Session persistence has a leading metadata record, outside history.
  var offset = cursor.readCursor(session.history);
  assert.equal(offset.historyIndex, 0);
  assert.equal(offset.textOffset, first.length);
  var restored = Object.assign({}, session, { history: session.history.slice() });
  // Retire the old in-memory history before its scheduled drain, as on shutdown.
  session.history = [];
  var f2 = integration(t);
  assert.equal(f2.sm.saveSessionFile(restored), true);
  f2.api.digestDmTurn(restored);
  var actual = first;
  for (var i = 0; i < f2.requests.length; i++) {
    actual += f2.content(i).slice(6);
    f2.finish(i);
    await tick();
  }
  assert.equal(actual, text);
  await tick();
});

test("in-flight arrivals and a second DM session drain without another user message", async function (t) {
  var f = integration(t);
  var a = f.session(1);
  var b = f.session(2);
  f.sm.sendAndRecord(a, user("first"));
  f.api.digestDmTurn(a);
  await tick();
  f.sm.sendAndRecord(a, { type: "delta", text: "arrived asynchronously" });
  f.api.digestDmTurn(a);
  f.sm.sendAndRecord(b, { type: "delta", text: "other session" });
  f.api.digestDmTurn(b);
  assert.equal(f.requests.length, 1);
  f.finish(0);
  await tick();
  assert.equal(f.content(1), "Mate: other session");
  f.finish(1);
  await tick();
  assert.equal(f.content(2), "Mate: arrived asynchronously");
  f.finish(2);
  await tick();
  assert.equal(f.requests.length, 3);
  assert.equal(cursor.hasPending(a.history, cursor.readCursor(a.history)), false);
  assert.equal(cursor.hasPending(b.history, cursor.readCursor(b.history)), false);
});
