var test = require('node:test');
var assert = require('node:assert/strict');
var helpers = require('./helpers/codex-recovery-fixture.cjs');
var tick = helpers.tick;

test('original retained SDK input recovers once without probing an unrelated idle sibling', async function(t) {
  var blockedSibling = false;
  var kit = require('./helpers/codex-recovery-delivery.cjs').fixture(t, function(server, method, params) {
    if (blockedSibling && method === 'thread/backgroundTerminals/list' && params.threadId !== 'saved-thread') {
      return new Promise(function(resolve) { setTimeout(function() { resolve({ data: [] }); }, 300); });
    }
  }, { recoveryAdmissionTimeoutMs: 150 });
  var target = await kit.fresh({ resumeSessionId: 'saved-thread' });
  target.pushMessage('Prior target work');
  await tick();
  kit.servers[0].complete('saved-thread');
  await tick();
  var sibling = await kit.fresh();
  sibling.pushMessage('Prior sibling work');
  await tick();
  kit.servers[0].complete('thread-1');
  await tick();
  var before = kit.servers[0].calls.length;
  blockedSibling = true;
  kit.sm.sendAndRecord(kit.driver, { type: 'user_message', text: 'Original retained request' });
  kit.driver.isProcessing = true;
  assert.equal(await kit.sdk.startQuery(kit.driver, 'Original retained request'), true);
  await tick();
  var probes = kit.servers[0].calls.slice(before).filter(function(call) { return call.method === 'thread/backgroundTerminals/list'; });
  assert.deepEqual(probes.map(function(call) { return call.params.threadId; }), ['saved-thread']);
  assert.equal(kit.servers[0].stopped, 0);
  assert.equal(target.pushMessage('Retired target'), false);
  assert.equal(sibling.pushMessage('Sibling continues'), true);
  var resumed = kit.servers[kit.servers.length - 1];
  var starts = resumed.calls.filter(function(call) { return call.method === 'turn/start'; });
  assert.equal(starts.length, 1);
  assert.match(starts[0].params.input[0].text, /Original retained request/);
  assert.equal(kit.driver.history.some(function(entry) { return entry.recoveryAdmission; }), false);
  assert.equal(kit.driver.codexIssuesToolCatalogVersion, undefined, 'a query bridge must not claim a persisted dynamic catalog');
  resumed.complete('saved-thread');
  await tick();
});

test('explicit incompatible probe errors fail truthfully rather than polling as busy', async function(t) {
  for (var method of ['thread/loaded/list', 'thread/read', 'thread/backgroundTerminals/list', 'thread/unsubscribe']) {
    await t.test(method, async function(st) {
      var enabled = false;
      var kit = helpers.fixture(st, function(server, requested, params) {
        if (enabled && requested === method) {
          var error = new Error('Method not found');
          error.code = -32601;
          return Promise.reject(error);
        }
        if (requested === 'thread/read') return Promise.resolve({ thread: { id: params.threadId, status: { type: 'idle' } } });
      });
      var sibling = await kit.fresh();
      sibling.pushMessage('Active sibling');
      await tick();
      kit.servers[0].loaded.push('saved-thread');
      enabled = true;
      var before = kit.servers[0].calls.length;
      await assert.rejects(kit.recover(), function(error) {
        return error.code === 'CODEX_RECOVERY_PROBE_UNAVAILABLE' && error.message.includes(method);
      });
      assert.equal(kit.servers[0].calls.slice(before).filter(function(call) { return call.method === method; }).length, 1);
      assert.equal(kit.servers[0].stopped, 0);
      assert.equal(kit.servers.length, 1);
    });
  }
});

test('actual app-server response path preserves method-not-found evidence', async function() {
  var Server = require('../lib/yoke/codex-app-server').CodexAppServer;
  var server = new Server('/nonexistent/codex', {});
  server.started = true;
  server.proc = {};
  server._write = function() {};
  var pending = server.send('thread/backgroundTerminals/list', { threadId: 'target' }, 100);
  var requestId = Object.keys(server.pendingRequests)[0];
  server._handleMessage({ id: requestId, error: { code: -32601, message: 'Method not found' } });
  await assert.rejects(pending, { code: -32601 });
});

test('diagnostics distinguish observed active state from unknown probes without exposing payloads', async function(t) {
  for (var kind of ['active', 'unknown']) {
    await t.test(kind, async function(st) {
      var evidence = [];
      var kit = helpers.fixture(st, function(server, method) {
        if (method === 'thread/read') {
          if (kind === 'unknown') return Promise.reject(new Error('PRIVATE provider payload'));
          return Promise.resolve({ thread: { id: 'saved-thread', status: { type: 'active' } } });
        }
      }, { recoveryAdmissionTimeoutMs: 180 });
      var sibling = await kit.fresh();
      sibling.pushMessage('PRIVATE sibling input');
      await tick();
      kit.servers[0].loaded.push('saved-thread');
      await assert.rejects(kit.recover({ onRecoveryDiagnostic: function(record) { evidence.push(record); } }), { code: 'CODEX_RECOVERY_UNAVAILABLE' });
      assert.ok(evidence.some(function(record) { return record.reason === (kind === 'active' ? 'provider_reports_active' : 'probe_failed'); }));
      if (kind === 'unknown') assert.equal(evidence.some(function(record) { return record.reason === 'provider_reports_active'; }), false);
      assert.equal(evidence[evidence.length - 1].reason, 'admission_ended_without_grant');
      assert.ok(evidence.length <= 25);
      assert.equal(JSON.stringify(evidence).includes('PRIVATE'), false);
      var targetKey = require('crypto').createHash('sha256').update('saved-thread').digest('hex').slice(0, 16);
      assert.ok(evidence.some(function(record) { return record.method === 'thread/read' && record.phase === 'shared_target' && record.targetKey === targetKey; }));
      assert.equal(JSON.stringify(evidence).includes('saved-thread'), false, 'diagnostics identify targets by digest only');
      var readStarts = evidence.filter(function(record) { return record.reason === 'probe_started' && record.method === 'thread/read'; });
      assert.equal(readStarts.length, new Set(readStarts.map(function(record) { return record.phase; })).size, 'polling repeats are deduplicated per phase');
      assert.ok(kit.servers[0].calls.filter(function(call) { return call.method === 'thread/read'; }).length > 1);
    });
  }
});

test('diagnostics cannot interfere with successful admission', async function(t) {
  var kit = helpers.fixture(t);
  var recovered = await kit.recover({ onRecoveryDiagnostic: function() { throw new Error('Diagnostic sink unavailable'); } });
  assert.equal(recovered.pushMessage('Original input'), true);
  await tick();
  assert.equal(kit.servers.length, 1);
});
