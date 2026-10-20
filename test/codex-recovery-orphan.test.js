var test = require('node:test');
var assert = require('node:assert/strict');
var helpers = require('./helpers/codex-recovery-fixture.cjs');
var tick = helpers.tick, until = helpers.until;

test('whole-runtime shutdown remains a fallback when idle orphan unsubscribe cannot release ownership', async function(t) {
  var kit = helpers.fixture(t, function(server, method, params) {
    if (method === 'thread/read') return Promise.resolve({ thread: { id: params.threadId, status: { type: 'idle' } } });
    if (method === 'thread/unsubscribe') return Promise.resolve({ status: 'notSubscribed' });
  });
  var sibling = await kit.fresh();
  sibling.pushMessage('Completed sibling work');
  await tick();
  kit.servers[0].complete('thread-1');
  await tick();
  kit.servers[0].loaded.push('saved-thread');
  var recovered = await kit.recover();
  assert.equal(kit.servers[0].stopped, 1);
  assert.equal(sibling.pushMessage('Retired safely'), false);
  assert.equal(recovered.pushMessage('Original input'), true);
  await tick();
  assert.equal(kit.servers[1].calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
});

async function verifyIndependentDelivery(st, orphan) {
  var blocking = false;
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(st, function(server, method, params) {
    if (method === 'thread/read') return Promise.resolve({ thread: { id: params.threadId, status: { type: 'idle' } } });
    if (blocking && method === 'thread/backgroundTerminals/list' && params.threadId !== 'saved-thread') {
      return new Promise(function(resolve) { setTimeout(function() { resolve({ data: [] }); }, 300); });
    }
  }, { recoveryAdmissionTimeoutMs: 150 });
  var sibling = await kit.fresh();
  sibling.pushMessage('Sibling work');
  await tick();
  kit.servers[0].complete('thread-1');
  await tick();
  if (orphan) {
    var target = await kit.fresh({ resumeSessionId: 'saved-thread' });
    target.pushMessage('Previously completed target work');
    await tick();
    kit.servers[0].complete('saved-thread');
    await tick();
    target.close();
    await tick();
    assert.equal(kit.servers[0].loaded.includes('saved-thread'), true);
    assert.equal(kit.servers[0].handlers.some(function(entry) { return entry.threadId === 'saved-thread'; }), false);
  }
  var before = kit.servers[0].calls.length;
  blocking = true;
  kit.sm.sendAndRecord(kit.driver, { type: 'user_message', text: 'Original retained input' });
  kit.driver.isProcessing = true;
  assert.equal(await kit.sdk.startQuery(kit.driver, 'Original retained input'), true);
  await tick();
  assert.equal(kit.driver.history.some(function(entry) { return entry.type === 'error' || entry.recoveryAdmission; }), false);
  var calls = kit.servers[0].calls.slice(before);
  assert.equal(calls.some(function(call) { return call.method === 'thread/backgroundTerminals/list' && call.params.threadId === 'thread-1'; }), false);
  assert.equal(calls.some(function(call) { return call.method === 'thread/unsubscribe' && call.params.threadId === 'saved-thread'; }), orphan);
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(sibling.pushMessage('Still usable'), true);
  var resumed = kit.servers[kit.servers.length - 1];
  var starts = resumed.calls.filter(function(call) { return call.method === 'turn/start'; });
  assert.equal(starts.length, 1);
  assert.match(starts[0].params.input[0].text, /Original retained input/);
  resumed.complete('saved-thread');
  await tick();
  assert.equal(resumed.calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
}

test('SDK absent target delivers original input once beside an idle sibling with a stalled probe', async function(t) {
  await verifyIndependentDelivery(t, false);
});

test('SDK closed orphan target delivers original input once beside an idle sibling with a stalled probe', async function(t) {
  await verifyIndependentDelivery(t, true);
});

test('SDK incompatible-probe failure durably retains initial and buffered input with images', async function(t) {
  var rejectProbe, enabled = false;
  var probe = new Promise(function(resolve, reject) { rejectProbe = reject; });
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t, function(server, method) {
    if (enabled && method === 'thread/loaded/list') return probe;
  });
  var sibling = await kit.fresh();
  sibling.pushMessage('Active sibling');
  await tick();
  enabled = true;
  var initialImages = [{ mediaType: 'image/png', data: 'initial-image' }];
  var bufferedImages = [{ mediaType: 'image/png', data: 'buffered-image' }];
  kit.driver.isProcessing = true;
  var starting = kit.sdk.startQuery(kit.driver, 'Initial input', initialImages);
  await until(function() { return !!kit.driver._providerRecoveryWaiting; });
  assert.equal(kit.sdk.pushMessage(kit.driver, 'Buffered input', bufferedImages), true);
  var error = new Error('PRIVATE provider error');
  error.code = -32601;
  rejectProbe(error);
  assert.equal(await starting, false);
  var expected = [{ text: 'Initial input', images: initialImages }, { text: 'Buffered input', images: bufferedImages }];
  var failure = kit.driver.history.find(function(entry) { return entry.recoveryAdmission; });
  assert.deepEqual(failure.recoveryAdmission.messages, expected);
  assert.equal(failure.recoveryAdmission.state, 'not_sent');
  assert.match(failure.text, /thread\/loaded\/list is unavailable or incompatible/);
  assert.equal(failure.text.includes('PRIVATE'), false);
  assert.equal(kit.sm.hasDurableSessionRecord(kit.driver, function(entry) {
    return entry.recoveryAdmission && JSON.stringify(entry.recoveryAdmission.messages) === JSON.stringify(expected);
  }), true);
  assert.equal(kit.driver.isProcessing, false);
  assert.equal(kit.driver._queryStarting, false);
  assert.equal(kit.driver.queryInstance, null);
  enabled = false;
  kit.driver.isProcessing = true;
  assert.equal(await kit.sdk.startQuery(kit.driver, 'Explicit subsequent input'), true);
  await tick();
  var resumed = kit.servers[kit.servers.length - 1];
  assert.equal(resumed.calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1);
  resumed.complete('saved-thread');
  await tick();
  assert.equal(resumed.calls.filter(function(call) { return call.method === 'turn/start'; }).length, 1, 'retained batch is not replayed');
});
