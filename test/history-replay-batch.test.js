var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');

function source(name) {
  return fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8');
}

function fixture() {
  var state = {};
  var delivered = [];
  var timers = [];
  var logs = [];
  var context = {
    store: {
      get: function (key) { return state[key]; },
      set: function (next) { Object.assign(state, next); },
      snap: function () { return state; },
    },
    processAppMessage: function (msg) {
      if (msg.type === 'history_meta') state.replayingHistory = true;
      delivered.push(msg);
      if (msg.type === 'history_done') state.replayingHistory = false;
    },
    setTimeout: function (fn, ms) { var timer = { fn: fn, ms: ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: function (timer) { if (timer) timer.cleared = true; },
    console: {
      error: function () { logs.push(['error', Array.from(arguments).join(' ')]); },
      warn: function () { logs.push(['warn', Array.from(arguments).join(' ')]); },
    },
  };
  var router = source('app-message-router');
  Array.from(router.matchAll(/import \{([^}]+)\}/g)).forEach(function (match) {
    match[1].split(',').forEach(function (name) {
      name = name.trim().split(' as ').pop();
      if (!context[name]) context[name] = function () {};
    });
  });
  vm.createContext(context);
  [source('history-replay-batch'), router].forEach(function (code) {
    vm.runInContext(code.replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  });
  function fire() {
    timers.filter(function (timer) { return !timer.cleared; }).forEach(function (timer) { timer.cleared = true; timer.fn(); });
  }
  return { context: context, state: state, delivered: delivered, timers: timers, logs: logs, fire: fire, send: context.processMessage };
}

function live(timers) {
  return timers.filter(function (timer) { return !timer.cleared; }).length;
}

test('delayed Claude history stays unrendered until complete and coalesces thousands of token events', async function () {
  var f = fixture();
  f.send({ type: 'history_meta', from: 0, total: 6005 });
  f.send({ type: 'user_message', text: 'Review this' });
  f.send({ type: 'thinking_start' });
  var expected = '';
  for (var i = 0; i < 3000; i++) {
    expected += 'part' + i + ' ';
    f.send({ type: 'thinking_delta', text: 'part' + i + ' ', _ts: i + 1 });
  }
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(f.delivered.length, 0, 'no intermediate transcript reaches the renderer');
  f.send({ type: 'thinking_stop', duration: 30 });
  for (var j = 0; j < 3000; j++) f.send({ type: 'delta', text: 'part' + j + ' ', _ts: j + 4000 });
  f.send({ type: 'history_done' });
  assert.deepEqual(f.delivered.map(function (msg) { return msg.type; }), [
    'history_meta', 'user_message', 'thinking_start', 'thinking_delta', 'thinking_stop', 'delta', 'history_done',
  ]);
  assert.equal(f.delivered[3].text, expected);
  assert.equal(f.delivered[3]._ts, 1);
  assert.equal(f.delivered[5].text, expected);
  assert.equal(f.state.historyReplayBatch, null);
  f.send({ type: 'delta', text: ' live' });
  assert.equal(f.delivered.at(-1).text, ' live');
});

test('restoration preserves tools, question answers, message UUIDs and metadata boundaries', function () {
  var f = fixture();
  var history = [
    { type: 'history_meta', from: 200, total: 215 },
    { type: 'delta', text: 'first', sessionId: 1 },
    { type: 'delta', text: 'second', sessionId: 2 },
    { type: 'message_uuid', uuid: 'answer-1', messageType: 'assistant' },
    { type: 'tool_start', id: 'ask-1', name: 'AskUserQuestion' },
    { type: 'tool_executing', id: 'ask-1', name: 'AskUserQuestion', input: { questions: ['Choose'] } },
    { type: 'ask_user_answered', toolId: 'ask-1', answers: { Choose: 'Yes' } },
    { type: 'tool_result', id: 'ask-1', content: 'Yes' },
    { type: 'delta', text: 'after tool' },
    { type: 'history_done' },
  ];
  history.forEach(f.send);
  assert.equal(JSON.stringify(f.delivered), JSON.stringify(history));
  var pending = { type: 'permission_request_pending', requestId: 'pending-1' };
  f.send(pending);
  assert.equal(f.delivered.at(-1), pending);
});

test('session switch, project switch, replacement history and reconnect discard incomplete batches', function () {
  ['session_switched', 'project_info', 'history_meta', 'reconnect'].forEach(function (boundary) {
    var f = fixture();
    f.send({ type: 'history_meta' });
    f.send({ type: 'delta', text: 'discard this' });
    if (boundary === 'reconnect') f.context.resetHistoryReplayBatch();
    else f.send({ type: boundary });
    if (boundary !== 'history_meta') f.send({ type: 'history_meta' });
    f.send({ type: 'delta', text: 'current session' });
    f.send({ type: 'history_done' });
    assert.equal(f.delivered.some(function (msg) { return msg.text === 'discard this'; }), false);
    assert.equal(f.delivered.at(-2).text, 'current session');
    assert.equal(f.state.replayingHistory, false);
  });
});

test('a failing historical entry is isolated: later entries and history_done still run, diagnostics omit content', function () {
  var f = fixture();
  var delivered = [];
  f.context.processAppMessage = function (msg) {
    if (msg.type === 'history_meta') f.state.replayingHistory = true;
    if (msg.type === 'bad_entry') throw new TypeError('secret transcript words');
    delivered.push(msg.type);
  };
  f.send({ type: 'history_meta' });
  f.send({ type: 'user_message', text: 'private prompt' });
  f.send({ type: 'bad_entry', text: 'secret transcript words' });
  f.send({ type: 'delta', text: 'after the bad entry' });
  f.send({ type: 'tool_start', id: 't1' });
  assert.doesNotThrow(function () { f.send({ type: 'history_done' }); });
  assert.deepEqual(delivered, ['history_meta', 'user_message', 'delta', 'tool_start', 'history_done']);
  assert.equal(f.state.historyReplayBatch, null);
  assert.equal(f.state.replayingHistory, false);
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0][1], /3\/6: bad_entry entry failed with TypeError/);
  assert.equal(/secret|private|after the bad/.test(f.logs[0][1]), false, 'no transcript text or error message is logged');
  f.send({ type: 'delta', text: 'live' });
  assert.equal(delivered.at(-1), 'delta');
});

test('failure diagnostics never include error messages, multiline headers or email-like content', function () {
  var f = fixture();
  var thrown = [
    new Error('private@example.com transcript'),
    new TypeError('first line\n    at leak (https://evil.example/private@example.com.js:1:1)\nsecond@line'),
    { name: 'Error', message: 'x', stack: 'person@example.com said hi\nfoo@bar' },
    { name: 'TypeError', message: 'private@example.com', stack: 'TypeError: private@example.com\n    at appendThinking (http://127.0.0.1:8080/modules/thinking-lifecycle.js?v=4#x:12:3)' },
    { name: 'private@example.com', message: '', stack: '' },
  ];
  var index = 0;
  f.context.processAppMessage = function (msg) {
    if (msg.type === 'boom') throw thrown[index++];
  };
  f.send({ type: 'history_meta' });
  thrown.forEach(function () { f.send({ type: 'boom', text: 'transcript text' }); });
  f.send({ type: 'history_done' });
  assert.equal(f.logs.length, 5);
  f.logs.forEach(function (entry) {
    assert.equal(/private|example|person|transcript|leak|evil|first line|second/.test(entry[1]), false, entry[1]);
  });
  assert.match(f.logs[3][1], /boom entry failed with TypeError at thinking-lifecycle\.js:12:3$/, 'a validated browser frame keeps its code location');
  assert.match(f.logs[4][1], /boom entry failed with Error$/, 'an unsafe error name is replaced');
});

test('the store batch holds data only, dispatch stays in the module closure', function () {
  var f = fixture();
  f.send({ type: 'history_meta' });
  f.send({ type: 'delta', text: 'a' });
  f.send({ type: 'delta', text: 'b' });
  var batch = f.state.historyReplayBatch;
  Object.keys(batch).forEach(function (key) {
    assert.notEqual(typeof batch[key], 'function', key + ' must not be a function');
  });
  f.fire();
  assert.deepEqual(f.delivered.map(function (msg) { return msg.type; }), ['history_meta', 'delta', 'history_done'], 'the timer still restores through the router');
});

test('replayed user turns close stale tools except mid-turn question answers and delegations', function () {
  var code = source('app-messages');
  var start = code.indexOf('      case "user_message":');
  var end = code.indexOf('      case "plan_content":', start);
  [
    [{ type: 'user_message', text: 'next turn' }, true, 1],
    [{ type: 'user_message', text: 'answer', askUserAnswer: true }, true, 0],
    [{ type: 'user_message', text: 'task', delegated: true }, true, 0],
    [{ type: 'user_message', text: 'live turn' }, false, 0],
  ].forEach(function (row) {
    var closed = 0;
    var state = { replayingHistory: row[1], activeSessionId: 1, currentSlug: 'p' };
    var context = {
      store: { get: function (key) { return state[key]; }, set: function (next) { Object.assign(state, next); } },
      messagesEl: { querySelector: function () { return null; }, querySelectorAll: function () { return []; } },
      markAllToolsDone: function () { closed++; },
    };
    Array.from(code.matchAll(/import \{([^}]+)\}/g)).forEach(function (match) {
      match[1].split(',').forEach(function (name) {
        name = name.trim().split(' as ').pop();
        if (!context[name]) context[name] = function () {};
      });
    });
    vm.createContext(context);
    vm.runInContext('(function (msg) { switch (msg.type) {\n' + code.slice(start, end) + '\n} })', context)(row[0]);
    assert.equal(closed, row[2], JSON.stringify(row[0]) + ' replaying=' + row[1]);
  });
});

test('failure diagnostics are bounded per batch and a failing history_done still clears replay state', function () {
  var f = fixture();
  f.context.processAppMessage = function (msg) {
    if (msg.type === 'history_meta') f.state.replayingHistory = true;
    throw new Error('boom');
  };
  f.send({ type: 'history_meta' });
  for (var i = 0; i < 20; i++) f.send({ type: 'tool_start', id: 't' + i });
  f.send({ type: 'history_done' });
  assert.equal(f.logs.length, 6, 'five entries plus one suppression summary');
  assert.match(f.logs[5][1], /17 more restored history failures were not logged/);
  assert.equal(f.state.replayingHistory, false);
  assert.equal(live(f.timers), 0, 'completion cancels the recovery timer');
});

test('a never-finished replay is restored at the time bound, then live output and permissions flow', function () {
  var f = fixture();
  f.send({ type: 'history_meta', from: 0, total: 3 });
  f.send({ type: 'user_message', text: 'question' });
  f.send({ type: 'delta', text: 'partial ' });
  f.send({ type: 'delta', text: 'answer' });
  f.send({ type: 'permission_request_pending', requestId: 'p1' });
  assert.equal(f.delivered.length, 0, 'still atomic before a bound is reached');
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].ms, f.context.HISTORY_REPLAY_TIMEOUT_MS);
  f.fire();
  assert.deepEqual(f.delivered.map(function (msg) { return msg.type; }), ['history_meta', 'user_message', 'delta', 'permission_request_pending', 'history_done']);
  assert.equal(f.delivered[2].text, 'partial answer');
  assert.equal(f.delivered.at(-1).replayRecovered, true);
  assert.equal(f.state.historyReplayBatch, null);
  assert.equal(f.state.replayingHistory, false);
  assert.match(f.logs[0][1], /history_done missing after 5 events \(timeout\)/);
  f.send({ type: 'delta', text: 'live' });
  f.send({ type: 'permission_request_pending', requestId: 'p2' });
  assert.equal(f.delivered.at(-2).text, 'live');
  assert.equal(f.delivered.at(-1).requestId, 'p2');
  // A late terminator is ordinary completion, not another batch.
  f.send({ type: 'history_done' });
  assert.equal(f.delivered.at(-1).type, 'history_done');
  assert.equal(f.state.historyReplayBatch, null);
});

test('coalesced token growth counts toward the size bound even though the item list stays small', function () {
  var f = fixture();
  f.context.HISTORY_REPLAY_MAX_EVENTS = 1000;
  f.send({ type: 'history_meta' });
  f.send({ type: 'thinking_start' });
  for (var i = 0; i < 997; i++) f.send({ type: 'thinking_delta', text: 'x' });
  assert.equal(f.state.historyReplayBatch.items.length, 3);
  assert.equal(f.delivered.length, 0);
  f.send({ type: 'thinking_delta', text: 'y' });
  assert.deepEqual(f.delivered.map(function (msg) { return msg.type; }), ['history_meta', 'thinking_start', 'thinking_delta', 'history_done']);
  assert.equal(f.delivered[2].text.length, 998);
  assert.equal(live(f.timers), 0, 'size recovery cancels the timer');
  assert.match(f.logs[0][1], /after 1000 events \(size\)/);
  f.send({ type: 'thinking_delta', text: 'live' });
  assert.equal(f.delivered.at(-1).text, 'live', 'later events are not captured into a new batch');

  var g = fixture();
  g.context.HISTORY_REPLAY_MAX_TEXT = 50;
  g.send({ type: 'history_meta' });
  for (var j = 0; j < 4; j++) g.send({ type: 'delta', text: '0123456789' });
  assert.equal(g.delivered.length, 0);
  g.send({ type: 'delta', text: '0123456789' });
  assert.equal(g.delivered.at(-1).replayRecovered, true, 'text volume is bounded too');
});

test('reset, session switch and replacement history cancel the pending recovery timer', function () {
  ['reconnect', 'session_switched', 'project_info', 'history_meta'].forEach(function (boundary) {
    var f = fixture();
    f.send({ type: 'history_meta' });
    f.send({ type: 'delta', text: 'stale' });
    var first = f.timers[0];
    if (boundary === 'reconnect') f.context.resetHistoryReplayBatch();
    else f.send({ type: boundary });
    assert.equal(first.cleared, true, boundary + ' cancels the old timer');
    // Even if a cancelled callback were to run, it must not touch newer state.
    if (boundary === 'history_meta') {
      first.fn();
      assert.equal(f.delivered.length, 0, 'stale timer cannot flush the replacement batch');
      assert.ok(f.state.historyReplayBatch);
    } else {
      f.send({ type: 'history_meta' });
      f.send({ type: 'delta', text: 'current' });
      first.fn();
      assert.equal(f.delivered.some(function (msg) { return msg.text === 'stale' || msg.text === 'current'; }), false);
      f.send({ type: 'history_done' });
      assert.equal(f.delivered.at(-2).text, 'current');
    }
  });
});

test('live events and older-history pages are delivered immediately without token coalescing', function () {
  var f = fixture();
  var messages = [{ type: 'delta', text: 'one' }, { type: 'delta', text: 'two' }, { type: 'history_prepend', items: [] }];
  messages.forEach(f.send);
  assert.deepEqual(f.delivered, messages);
});

test('history completion preserves active answer/tools but finalizes an inactive turn', function () {
  [true, false].forEach(function (processing) {
    var f = fixture();
    f.state.sessionIsProcessing = processing;
    var calls = [];
    var code = source('app-messages');
    var start = code.indexOf('      case "history_done":');
    var end = code.indexOf('      case "restore_mate_dm":', start);
    var context = f.context;
    Array.from(code.matchAll(/import \{([^}]+)\}/g)).forEach(function (match) {
      match[1].split(',').forEach(function (name) {
        name = name.trim().split(' as ').pop();
        if (!context[name]) context[name] = function () {};
      });
    });
    context.messagesEl = null;
    context.isDebateActive = function () { return true; };
    ['flushStreamBuffer', 'finalizeAssistantBlock', 'markAllToolsDone'].forEach(function (name) {
      context[name] = function () { calls.push(name); };
    });
    var complete = vm.runInContext('(function (msg) { switch(msg.type) {\n' + code.slice(start, end) + '\n} })', context);
    complete({ type: 'history_done' });
    assert.deepEqual(calls, processing ? ['flushStreamBuffer'] : ['markAllToolsDone', 'finalizeAssistantBlock']);
  });
});

test('history scroll requests do not measure layout or schedule scrolling', function () {
  var context = {
    store: { get: function () { return true; } },
    getMessagesEl: function () { throw new Error('must not measure replay layout'); },
  };
  vm.runInNewContext(source('chat-render-runtime').replace(/^import .*;\n/gm, '').replace(/export /g, ''), context);
  context.scrollToBottom();
  context.forceScrollToBottom();
});
