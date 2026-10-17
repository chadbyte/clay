var test = require('node:test');
var assert = require('node:assert/strict');
var helpers = require('./helpers/codex-recovery-fixture.cjs');
var fixture = helpers.fixture, tick = helpers.tick, until = helpers.until;

test('recovery starts beside an active different thread without stopping its runtime', async function(t) {
  var kit = fixture(t);
  var sibling = await kit.fresh();
  sibling.pushMessage('Worker needs Driver assistance');
  await tick();
  var recovery = await kit.recover();
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(kit.servers[0].handlers.length, 1);
  recovery.pushMessage('Review the Worker result');
  await tick();
  assert.equal(kit.servers[1].calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
  assert.equal(kit.servers[0].calls.some(function(call) { return call.method === 'turn/interrupt'; }), false);
});

test('same-thread concurrent recoveries wait cancellably and resume once the first becomes idle', async function(t) {
  var kit = fixture(t), waiting = [];
  var first = await kit.recover();
  first.pushMessage('First turn');
  await tick();
  var admitted = false;
  var second = kit.recover({ onRecoveryWaiting: function(reason) { waiting.push(reason); } }).then(function(handle) { admitted = true; return handle; });
  await until(function() { return waiting.length > 0; });
  assert.equal(admitted, false);
  kit.servers[0].complete('saved-thread');
  var handle = await second;
  handle.pushMessage('Second turn');
  await tick();
  assert.equal(first.pushMessage('Retired'), false);
  assert.equal(kit.servers[0].stopped, 1);
  assert.equal(kit.servers[1].calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
});

test('an idle target unloads beside a running sibling without interrupting the sibling', async function(t) {
  var kit = fixture(t);
  var target = await kit.fresh({ resumeSessionId: 'saved-thread' });
  target.pushMessage('Previous Driver turn');
  await tick();
  kit.servers[0].complete('saved-thread');
  await tick();
  var sibling = await kit.fresh();
  sibling.pushMessage('Worker awaits assistance');
  await tick();
  var recovery = await kit.recover();
  assert.equal(target.pushMessage('Closed'), false);
  assert.equal(kit.servers[0].stopped, 0);
  assert.ok(kit.servers[0].calls.some(function(call) { return call.method === 'thread/unsubscribe' && call.params.threadId === 'saved-thread'; }));
  assert.equal(kit.servers[0].handlers.length, 1);
  recovery.pushMessage('Driver can assist now');
  await tick();
});

test('stale loaded bookkeeping requires explicit idle status and terminal proof before unloading', async function(t) {
  var kit = fixture(t, function(server, method) {
    if (method === 'thread/read') return Promise.resolve({ thread: { id: 'saved-thread', status: { type: 'idle' } } });
  });
  var sibling = await kit.fresh();
  sibling.pushMessage('Active sibling');
  await tick();
  kit.servers[0].loaded.push('saved-thread');
  await kit.recover();
  assert.equal(kit.servers[0].stopped, 0);
  assert.ok(kit.servers[0].calls.some(function(call) { return call.method === 'thread/backgroundTerminals/list' && call.params.threadId === 'saved-thread'; }));
});

test('background terminals, unknown loaded state, and active target remain protected until Stop', async function(t) {
  var cases = ['background', 'unknown', 'active', 'pagination', 'wrong-thread'];
  for (var kind of cases) {
    await t.test(kind, async function(st) {
      var kit = fixture(st, function(server, method) {
        if (method === 'thread/read') return Promise.resolve({ thread: { id: kind === 'wrong-thread' ? 'other-thread' : 'saved-thread', status: { type: kind === 'active' ? 'active' : 'idle' } } });
        if (kind === 'unknown' && method === 'thread/loaded/list') return Promise.reject(new Error('Unsupported probe'));
        if (kind === 'pagination' && method === 'thread/loaded/list') return Promise.resolve({ data: [], nextCursor: 'same-cursor' });
        if (kind === 'background' && method === 'thread/backgroundTerminals/list') return Promise.resolve({ data: [{ status: 'running' }] });
      });
      var sibling = await kit.fresh();
      sibling.pushMessage('Active sibling');
      await tick();
      kit.servers[0].loaded.push('saved-thread');
      var controller = new AbortController(), waiting = false;
      var cancelled = assert.rejects(kit.recover({ abortController: controller, onRecoveryWaiting: function() { waiting = true; } }), { name: 'AbortError' });
      await until(function() { return waiting; });
      controller.abort();
      await cancelled;
      assert.equal(kit.servers.length, 1);
      assert.equal(kit.servers[0].stopped, 0);
      if (kind === 'background' || kind === 'active' || kind === 'wrong-thread') assert.equal(kit.servers[0].calls.some(function(call) { return call.method === 'thread/unsubscribe'; }), false);
    });
  }
});

test('Worker completion stays correlated through safe waiting and preserves queued human input', async function(t) {
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t);
  var previous = await kit.recover();
  previous.pushMessage('Previous Driver execution');
  await tick();
  kit.complete();
  await until(function() { return !!kit.driver._providerRecoveryWaiting; });
  assert.equal(kit.sdk.pushMessage(kit.driver, 'Human follow-up retained during startup'), true);
  await new Promise(function(resolve) { setTimeout(resolve, 90); });
  assert.equal(kit.record().deliveryState, 'attempting');
  assert.equal(kit.record().deliveryAttemptCount, 1);
  assert.equal(kit.worker._pairDelegation, kit.token);
  kit.servers[0].complete('saved-thread');
  await until(function() { return kit.record().deliveryState === 'accepted'; });
  await tick();
  assert.equal(kit.record().taskId, 'task-13');
  assert.equal(kit.record().generation, 13);
  assert.equal(kit.driver.history.filter(function(entry) { return entry.partnerResult; }).length, 1);
  var resumedServer = kit.servers[kit.servers.length - 1];
  var starts = resumedServer.calls.filter(function(call) { return call.method === 'turn/start'; });
  assert.equal(starts.length, 1);
  assert.match(starts[0].params.input[0].text, /Verify the replacement Worker result/);
  assert.match(starts[0].params.input[0].text, /Verified Worker evidence/);
  resumedServer.complete('saved-thread');
  await until(function() { return resumedServer.calls.filter(function(call) { return call.method === 'turn/start'; }).length === 2; });
  starts = resumedServer.calls.filter(function(call) { return call.method === 'turn/start'; });
  assert.match(starts[1].params.input[0].text, /Human follow-up retained/);
  assert.equal(kit.worker._pairDelegation, undefined);
  assert.ok(kit.driver.history.some(function(entry) { return /Your message is retained/.test(entry.content || ''); }));
});

test('production completion delivery resumes once beside an active Worker runtime', async function(t) {
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t);
  var sibling = await kit.fresh();
  sibling.pushMessage('Worker remains active after replacement');
  await tick();
  kit.complete();
  await until(function() { return kit.record().deliveryState === 'accepted'; }).catch(function() {
    var record = kit.record();
    assert.fail('Completion was not admitted: ' + JSON.stringify({ state: record.deliveryState,
      attempts: record.deliveryAttemptCount, error: record.deliveryError, retained: record.outcome.response }));
  });
  assert.equal(kit.record().deliveryAttemptCount, 1);
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(kit.driver.history.filter(function(entry) { return entry.partnerResult; }).length, 1);
  assert.equal(kit.worker._pairDelegation, undefined);
});

test('human Stop during completion admission prevents late input and retains the completed result', async function(t) {
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t);
  var previous = await kit.recover();
  previous.pushMessage('Still executing');
  await tick();
  kit.complete();
  await until(function() { return !!kit.driver._providerRecoveryWaiting; });
  kit.stop();
  kit.driver.abortController.abort();
  kit.pipeline.delivery.wake(kit.driver, kit.worker, kit.token);
  await until(function() { return !kit.driver._queryStarting; });
  kit.driver.taskStopRequested = false;
  kit.pipeline.delivery.wake(kit.driver, kit.worker, kit.token);
  kit.servers[0].complete('saved-thread');
  await tick();
  assert.equal(kit.servers.reduce(function(count, server) { return count + server.calls.filter(function(call) { return call.method === 'turn/start'; }).length; }, 0), 1);
  assert.equal(kit.record().state, 'blocked');
  assert.equal(kit.record().blockedCode, 'human_stop');
  assert.equal(kit.record().outcome.response, 'Verified Worker evidence');
});

test('runtime startup failure retries the retained completion without duplicate transcript or sibling cancellation', async function(t) {
  var failed = false;
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t, function(server, method) {
    if (method === 'initialize' && server.options.config.mcp_servers['clay-session-tools'] && !failed) {
      failed = true;
      return Promise.reject(new Error('Transport initialization failed'));
    }
  });
  var sibling = await kit.fresh();
  sibling.pushMessage('Active Worker');
  await tick();
  kit.complete();
  await until(function() { return kit.record().deliveryState === 'accepted'; });
  assert.equal(failed, true);
  assert.equal(kit.record().deliveryAttemptCount, 2);
  assert.equal(kit.driver.history.filter(function(entry) { return entry.partnerResult; }).length, 1);
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(kit.servers[1].stopped, 1);
  assert.equal(kit.servers[2].calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
});

test('replaced Worker generation cannot deliver a retained older completion', async function(t) {
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t);
  kit.worker._pairGeneration++;
  kit.complete();
  await tick();
  assert.equal(kit.servers.length, 0);
  assert.equal(kit.driver.history.filter(function(entry) { return entry.partnerResult; }).length, 0);
});

test('a stale production SDK input resumes completion in the same outbox attempt', async function(t) {
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t);
  var stale = await kit.fresh();
  stale.close();
  kit.driver.queryInstance = stale;
  kit.complete();
  await until(function() { return kit.record().deliveryState === 'accepted'; });
  assert.equal(kit.record().deliveryAttemptCount, 1);
  assert.equal(kit.driver.history.filter(function(entry) { return entry.partnerResult; }).length, 1);
});

test('slow initial safety probes retain completion eligibility before the first waiting notice', async function(t) {
  var release, probing = false;
  var probe = new Promise(function(resolve) { release = resolve; });
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t, function(server, method) {
    if (probing && method === 'thread/loaded/list') return probe;
  });
  var sibling = await kit.fresh();
  sibling.pushMessage('Active sibling');
  await tick();
  probing = true;
  kit.complete();
  await until(function() { return !!kit.driver._providerRecoveryWaiting; });
  await new Promise(function(resolve) { setTimeout(resolve, 90); });
  assert.equal(kit.record().deliveryState, 'attempting');
  assert.equal(kit.record().deliveryAttemptCount, 1);
  release({ data: ['thread-1'] });
  await until(function() { return kit.record().deliveryState === 'accepted'; });
  assert.equal(kit.servers[0].stopped, 0);
});

test('distinct recovery threads run simultaneously and ordinary resumes respect the target lease', async function(t) {
  var kit = fixture(t);
  var first = await kit.recover();
  first.pushMessage('First target');
  await tick();
  var different = await kit.recover({ resumeSessionId: 'different-thread' });
  different.pushMessage('Independent target');
  await tick();
  var waiting = false;
  var ordinary = kit.fresh({ resumeSessionId: 'saved-thread', onRecoveryWaiting: function() { waiting = true; } });
  await until(function() { return waiting; });
  kit.servers[0].complete('saved-thread');
  var resumed = await ordinary;
  resumed.pushMessage('Ordinary resumed target');
  await tick();
  assert.equal(kit.servers[0].stopped, 1);
  assert.equal(kit.servers[1].stopped, 0);
  assert.equal(kit.servers[1].handlers.length, 1);
});

test('cancelling a queued recovery cannot release an earlier admission probe', async function(t) {
  var release, probing = false;
  var probe = new Promise(function(resolve) { release = resolve; });
  var kit = fixture(t, function(server, method) {
    if (probing && method === 'thread/backgroundTerminals/list') return probe;
  });
  var idle = await kit.fresh();
  idle.pushMessage('Idle');
  await tick();
  kit.servers[0].complete('thread-1');
  await tick();
  probing = true;
  var first = kit.recover();
  await tick();
  var controller = new AbortController();
  var cancelled = assert.rejects(kit.recover({ resumeSessionId: 'cancelled-thread', abortController: controller }), { name: 'AbortError' });
  controller.abort();
  await cancelled;
  var admitted = false;
  var ordinary = kit.fresh().then(function(handle) { admitted = true; return handle; });
  await tick();
  assert.equal(admitted, false);
  release({ data: [] });
  await first;
  await ordinary;
  assert.equal(kit.servers.length, 3);
});

test('initialization races keep recovery cancellable without resurrecting a cancelled ordinary handle', async function(t) {
  var release;
  var initialization = new Promise(function(resolve) { release = resolve; });
  var first = true;
  var kit = fixture(t, function(server, method) {
    if (method === 'initialize' && first) { first = false; return initialization; }
  });
  var controller = new AbortController();
  var cancelled = assert.rejects(kit.fresh({ abortController: controller }), { name: 'AbortError' });
  await tick();
  var waiting = false;
  var recovery = kit.recover({ onRecoveryWaiting: function() { waiting = true; } });
  await until(function() { return waiting; });
  controller.abort();
  await cancelled;
  release({});
  await recovery;
  assert.equal(kit.servers[0].handlers.length, 0);
  assert.equal(kit.servers[0].stopped, 1);
});

test('Stop during unsubscribe keeps admission closed until that lifecycle RPC settles', async function(t) {
  var release;
  var unsubscribe = new Promise(function(resolve) { release = resolve; });
  var kit = fixture(t, function(server, method) {
    if (method === 'thread/unsubscribe') return unsubscribe;
  });
  var previous = await kit.fresh({ resumeSessionId: 'saved-thread' });
  previous.pushMessage('Previous turn');
  await tick();
  kit.servers[0].complete('saved-thread');
  await tick();
  var sibling = await kit.fresh();
  sibling.pushMessage('Sibling turn');
  await tick();
  var controller = new AbortController();
  var cancelled = assert.rejects(kit.recover({ abortController: controller }), { name: 'AbortError' });
  await until(function() { return kit.servers[0].calls.some(function(call) { return call.method === 'thread/unsubscribe'; }); });
  controller.abort();
  await cancelled;
  var admitted = false;
  var ordinary = kit.fresh({ resumeSessionId: 'saved-thread' }).then(function(handle) { admitted = true; return handle; });
  await tick();
  assert.equal(admitted, false);
  kit.servers[0].loaded = kit.servers[0].loaded.filter(function(id) { return id !== 'saved-thread'; });
  release({ status: 'unsubscribed' });
  var handle = await ordinary;
  handle.pushMessage('Resume after unsubscribe finished');
  await tick();
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(kit.servers[0].calls.filter(function(call) { return call.method === 'thread/resume' && call.params.threadId === 'saved-thread'; }).length, 2);
});

test('closed inputs do not authorize reclaiming unrelated loaded background work', async function(t) {
  var kit = fixture(t);
  var handle = await kit.fresh();
  handle.pushMessage('Leave a background terminal');
  await tick();
  kit.servers[0].complete('thread-1');
  await tick();
  handle.endInput();
  await tick();
  await kit.recover();
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(kit.servers[0].loaded.indexOf('thread-1') !== -1, true);
});

test('a disconnected shared provider fails admission explicitly without starting another writer', async function(t) {
  var kit = fixture(t, function(server, method) {
    if (method === 'thread/loaded/list') { server.started = false; return Promise.reject(new Error('Provider disconnected')); }
  });
  var active = await kit.fresh();
  active.pushMessage('Active turn');
  await tick();
  await assert.rejects(kit.recover(), /Provider disconnected/);
  assert.equal(kit.servers.length, 1);
});

test('unconfirmed recovery process exit retains its target reservation after bounded cleanup', async function() {
  var EventEmitter = require('node:events').EventEmitter;
  var proc = new EventEmitter();
  proc.exitCode = null; proc.signalCode = null; proc.kill = function() {};
  // The process is synthetic and deliberately cannot exit. No real child or
  // external runtime is created; shutdown failure is asserted explicitly.
  var kit = fixture({ after: function() {} }, function(server, method) {
    if (method === 'initialize') server.proc = proc;
  });
  var first = await kit.recover();
  first.pushMessage('Running');
  await tick();
  await first.abort();
  await assert.rejects(kit.recover(), /exit could not be confirmed/);
  assert.equal(kit.servers.length, 1);
  await assert.rejects(kit.adapter.shutdown(), /cleanup could not be confirmed/);
});

test('unconfirmed shared process exit also blocks ordinary resumes and warmup', async function() {
  var EventEmitter = require('node:events').EventEmitter;
  var proc = new EventEmitter();
  proc.exitCode = null; proc.signalCode = null; proc.kill = function() {};
  var kit = fixture({ after: function() {} });
  var handle = await kit.fresh();
  handle.pushMessage('Previous shared turn');
  await tick();
  kit.servers[0].complete('thread-1');
  await tick();
  kit.servers[0].proc = proc;
  await assert.rejects(kit.recover(), /shared runtime exit could not be confirmed/);
  await assert.rejects(kit.fresh({ resumeSessionId: 'thread-1' }), /shared runtime exit could not be confirmed/);
  await assert.rejects(kit.adapter.init({}), /shared runtime exit could not be confirmed/);
  assert.equal(kit.servers.length, 1);
  await assert.rejects(kit.adapter.shutdown(), /shared runtime exit could not be confirmed/);
});

test('ordinary input waits through recovery-owned idle shutdown and attaches after confirmed exit', async function(t) {
  var EventEmitter = require('node:events').EventEmitter;
  var proc = new EventEmitter();
  proc.exitCode = null; proc.signalCode = null; proc.kill = function() {};
  var kit = fixture(t);
  var handle = await kit.fresh();
  handle.pushMessage('Previous shared turn');
  await tick();
  kit.servers[0].complete('thread-1');
  await tick();
  kit.servers[0].proc = proc;
  var stop = kit.servers[0].stop;
  kit.servers[0].stop = function() {
    stop();
    setTimeout(function() { proc.exitCode = 0; proc.emit('exit'); }, 60);
  };
  var recovery = kit.recover();
  await until(function() { return kit.servers[0].stopped === 1; });
  var ordinary = kit.fresh();
  await recovery;
  var fresh = await ordinary;
  assert.equal(fresh.pushMessage('New ordinary input'), true);
  await tick();
  assert.equal(kit.servers.length, 3);
  assert.equal(proc.exitCode, 0);
  assert.equal(kit.servers[2].calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
});
