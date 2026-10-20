var test = require('node:test');
var assert = require('node:assert/strict');
var helpers = require('./helpers/codex-recovery-fixture.cjs');
var tick = helpers.tick, until = helpers.until;

test('orphaned idle loaded threads can release a runtime even when unsubscribe cannot unload them', async function(t) {
  var kit = helpers.fixture(t, function(server, method, params) {
    if (method === 'thread/read') return Promise.resolve({ thread: { id: params.threadId, status: { type: 'idle' } } });
    if (method === 'thread/unsubscribe') return Promise.resolve({ status: 'notSubscribed' });
  }, { recoveryAdmissionTimeoutMs: 150 });
  var old = await kit.fresh({ resumeSessionId: 'saved-thread' });
  old.pushMessage('Completed work');
  await tick();
  kit.servers[0].complete('saved-thread');
  await tick();
  old.endInput();
  await tick();
  kit.servers[0].loaded.push('other-orphan');
  var recovered = await kit.recover();
  assert.equal(kit.servers[0].stopped, 1);
  assert.equal(kit.servers[0].handlers.length, 0);
  assert.deepEqual(kit.servers[0].calls.filter(function(call) { return call.method === 'thread/read'; }).map(function(call) { return call.params.threadId; }), ['saved-thread', 'other-orphan']);
  recovered.pushMessage('Explicit new work');
  await tick();
  assert.equal(kit.servers[1].calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
});

test('unsupported and permanently unsafe admission settles without killing siblings or creating a writer', async function(t) {
  for (var kind of ['loaded-unsupported', 'background-unsupported', 'background-active', 'active', 'unknown']) {
    await t.test(kind, async function(st) {
      var kit = helpers.fixture(st, function(server, method, params) {
        if (kind === 'loaded-unsupported' && method === 'thread/loaded/list') return Promise.reject(new Error('Unsupported'));
        if (kind === 'background-unsupported' && method === 'thread/backgroundTerminals/list') return Promise.reject(new Error('Unsupported'));
        if (kind === 'background-active' && method === 'thread/backgroundTerminals/list') return Promise.resolve({ terminals: [{ status: 'running' }] });
        if (method === 'thread/read') return Promise.resolve({ thread: { id: params.threadId, status: { type: kind === 'active' ? 'active' : kind === 'unknown' ? 'systemError' : 'idle' } } });
      }, { recoveryAdmissionTimeoutMs: 100 });
      var sibling = await kit.fresh();
      sibling.pushMessage('Sibling remains active');
      await tick();
      kit.servers[0].loaded.push('saved-thread');
      var admission = [];
      await assert.rejects(kit.recover({ onRecoveryAdmission: function(value) { admission.push(value); } }), { code: 'CODEX_RECOVERY_UNAVAILABLE' });
      assert.deepEqual(admission, [true, false]);
      assert.equal(kit.servers.length, 1);
      assert.equal(kit.servers[0].stopped, 0);
      assert.equal(kit.servers[0].calls.some(function(call) { return call.method === 'turn/interrupt'; }), false);
      if (kind !== 'loaded-unsupported') assert.equal(kit.servers[0].calls.some(function(call) { return call.method === 'thread/unsubscribe'; }), false);
    });
  }
});

test('same-thread deadline preserves ownership and an explicit later attempt succeeds after idle', async function(t) {
  var kit = helpers.fixture(t, null, { recoveryAdmissionTimeoutMs: 100 });
  var first = await kit.recover();
  first.pushMessage('Active target');
  await tick();
  await assert.rejects(kit.recover(), { code: 'CODEX_RECOVERY_UNAVAILABLE' });
  assert.equal(kit.servers.length, 1);
  assert.equal(kit.servers[0].stopped, 0);
  kit.servers[0].complete('saved-thread');
  await tick();
  assert.equal(kit.servers.length, 1, 'expiry does not replay automatically');
  await kit.recover();
  assert.equal(kit.servers[0].stopped, 1);
  assert.equal(kit.servers.length, 2);
});

test('a timed out safety probe keeps its gate until settlement and cannot later start the expired query', async function(t) {
  var release, probing = false;
  var probe = new Promise(function(resolve) { release = resolve; });
  var kit = helpers.fixture(t, function(server, method) {
    if (probing && method === 'thread/loaded/list') return probe;
  }, { recoveryAdmissionTimeoutMs: 100 });
  var sibling = await kit.fresh();
  sibling.pushMessage('Active sibling');
  await tick();
  probing = true;
  await assert.rejects(kit.recover(), { code: 'CODEX_RECOVERY_UNAVAILABLE' });
  var admitted = false;
  var ordinary = kit.fresh().then(function(handle) { admitted = true; return handle; });
  await tick();
  assert.equal(admitted, false);
  probing = false;
  release({ data: ['thread-1'] });
  await ordinary;
  assert.equal(kit.servers.length, 1);
  assert.equal(kit.servers[0].stopped, 0);
});

test('Stop wins over the admission deadline without late automatic resumption', async function(t) {
  var kit = helpers.fixture(t, null, { recoveryAdmissionTimeoutMs: 100 });
  var first = await kit.recover();
  first.pushMessage('Active target');
  await tick();
  var controller = new AbortController();
  var pending = assert.rejects(kit.recover({ abortController: controller, onRecoveryWaiting: function() { controller.abort(); } }), { name: 'AbortError' });
  await pending;
  kit.servers[0].complete('saved-thread');
  await tick();
  assert.equal(kit.servers.length, 1);
});

test('SDK deadline releases busy state and persists unsent initial input and buffered attachments without replay', async function(t) {
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t, null, { recoveryAdmissionTimeoutMs: 100 });
  var first = await kit.recover();
  first.pushMessage('Existing target activity');
  await tick();
  kit.sm.sendAndRecord(kit.driver, { type: 'user_message', text: 'Retain original' });
  kit.driver.isProcessing = true;
  var starting = kit.sdk.startQuery(kit.driver, 'Retain original');
  await until(function() { return !!kit.driver._providerRecoveryWaiting; });
  var serverCount = kit.servers.length;
  var images = [{ mediaType: 'image/png', data: 'fixture-image' }];
  kit.sm.sendAndRecord(kit.driver, { type: 'user_message', text: 'Buffered follow-up', images: images });
  assert.equal(kit.sdk.pushMessage(kit.driver, 'Buffered follow-up', images), true);
  assert.equal(await starting, false);
  assert.equal(kit.driver.isProcessing, false);
  assert.equal(kit.driver._queryStarting, false);
  assert.equal(kit.driver._providerRecoveryWaiting, undefined);
  assert.equal(kit.driver.queryInstance, null);
  var failure = kit.driver.history.find(function(entry) { return entry.recoveryAdmission; });
  assert.deepEqual(failure.recoveryAdmission, { state: 'not_sent', messages: [
    { text: 'Retain original', images: null }, { text: 'Buffered follow-up', images: images },
  ] });
  assert.equal(kit.sm.hasDurableSessionRecord(kit.driver, function(entry) { return !!entry.recoveryAdmission && entry.recoveryAdmission.messages[1].images[0].data === 'fixture-image'; }), true);
  assert.match(failure.text, /explicitly/);
  kit.servers[0].complete('saved-thread');
  await tick();
  assert.equal(kit.servers.length, serverCount);
  kit.driver.isProcessing = true;
  assert.equal(await kit.sdk.startQuery(kit.driver, 'Explicit retry'), true);
  await tick();
  var resumedServer = kit.servers[kit.servers.length - 1];
  var starts = resumedServer.calls.filter(function(call) { return call.method === 'turn/start'; });
  assert.equal(starts.length, 1);
  assert.match(starts[0].params.input[0].text, /Explicit retry/);
  resumedServer.complete('saved-thread');
  await tick();
  assert.equal(resumedServer.calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
});

test('orphaned active or uninspectable sibling prevents whole-runtime shutdown', async function(t) {
  for (var kind of ['active', 'unknown', 'background']) {
    await t.test(kind, async function(st) {
      var kit = helpers.fixture(st, function(server, method, params) {
        if (method === 'thread/read') return Promise.resolve({ thread: { id: params.threadId, status: { type: kind === 'active' ? 'active' : 'idle' } } });
        if (kind === 'unknown' && method === 'thread/backgroundTerminals/list') return Promise.reject(new Error('Unsupported'));
        if (kind === 'background' && method === 'thread/backgroundTerminals/list') return Promise.resolve({ data: [{ status: 'running' }] });
      });
      var old = await kit.fresh();
      old.pushMessage('Old work');
      await tick();
      kit.servers[0].complete('thread-1');
      await tick();
      old.endInput();
      await tick();
      await kit.recover();
      assert.equal(kit.servers[0].stopped, 0);
      assert.deepEqual(kit.servers[0].loaded, ['thread-1']);
      assert.equal(kit.servers[0].calls.some(function(call) { return call.method === 'turn/interrupt'; }), false);
    });
  }
});
