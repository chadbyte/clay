var test = require('node:test'), assert = require('node:assert/strict');
var EventEmitter = require('node:events'), PassThrough = require('node:stream').PassThrough;
var termination = require('../lib/yoke/force-termination');
var registry = require('../lib/yoke/vendor-registry');
var antigravity = require('../lib/yoke/adapters/antigravity');

function handle() { return { forceStop: function () { return { status: 'terminated', scope: 'query-runtime' }; } }; }
test('every registered vendor explicitly declares termination; unknown and generic ACP fail closed', function () {
  Object.keys(registry.VENDOR_REGISTRY).forEach(function (vendor) {
    assert.equal(registry.getVendorInfo(vendor).forceTermination, vendor === 'antigravity', vendor);
    assert.equal(registry.publicInfo()[vendor].forceTermination, vendor === 'antigravity', vendor);
    assert.equal(termination.support(vendor, handle()).supported, vendor === 'antigravity', vendor);
  });
  ['unknown', 'acp', null].forEach(function (vendor) { assert.equal(termination.support(vendor, handle()).supported, false); });
});
test('a declaration requires a callable method; abort/close/wait and method presence alone grant nothing', function () {
  [null, {}, { abort: function () {}, close: function () {}, stopAndWait: function () {} }, { forceStop: true }].forEach(function (value) {
    assert.equal(termination.support('antigravity', value).supported, false);
    assert.throws(function () { termination.operation('antigravity', value); }, /unavailable/);
  });
  assert.throws(function () { termination.operation('unknown', handle()); }, /not yet supported/);
});
test('independent live provider contracts work and normalize malformed or ambiguous receipts', async function () {
  var provider = { vendor: 'independent', providerContract: { forceTermination: true } };
  var result = await termination.operation(provider, handle())();
  assert.equal(result.status, 'terminated'); assert.equal(result.externalEffects, 'unconfirmed');
  for (var receipt of [undefined, { status: 'completed' }, { status: 'terminated', scope: 'all-work' }]) {
    var method = { forceStop: function () { return receipt; } };
    assert.equal((await termination.operation(provider, method)()).status, 'unconfirmed');
  }
});
function fixture(behavior) {
  var signals = [], proc = new EventEmitter();
  proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
  proc.stdin = { write: function () {}, end: function () {} };
  proc.kill = function (signal) { signals.push(signal); return behavior(proc); };
  var query = antigravity.createAntigravityQueryHandle('/fake/agy', { _spawn: function () { return proc; }, _forceTerminationOptions: { timeoutMs: 15 } });
  return { query: query, proc: proc, signals: signals };
}
test('actual Antigravity query requires exact child exit and never invokes sibling process controls', async function () {
  var f = fixture(function () { return true; }), sibling = fixture(function () { throw new Error('sibling touched'); });
  f.query.pushMessage('fake'); sibling.query.pushMessage('fake sibling');
  var settled = false, operation = f.query.forceStop(); operation.then(function () { settled = true; });
  await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(f.signals, ['SIGKILL']);
  assert.equal(f.query.pushMessage('late'), false); assert.deepEqual(sibling.signals, []);
  f.proc.emit('exit', null, 'SIGKILL');
  assert.equal((await operation).status, 'terminated'); assert.equal(f.query.forceStop(), operation);
  sibling.proc.emit('exit', 0, null);
});
test('Antigravity signal refusal, throw, and timeout remain unconfirmed', async function () {
  for (var behavior of [function () { return false; }, function () { throw new Error('denied'); }, function () { return true; }]) {
    var f = fixture(behavior); f.query.pushMessage('fake');
    assert.equal((await f.query.forceStop()).status, 'unconfirmed');
    f.proc.emit('exit', 0, null);
  }
});
test('Antigravity never-started and already-exited queries terminate without sending a signal', async function () {
  var f = fixture(function () { throw new Error('must not signal'); });
  assert.equal((await f.query.forceStop()).status, 'terminated');
  assert.equal(f.query.pushMessage('late'), false); assert.deepEqual(f.signals, []);
  var ended = fixture(function () { throw new Error('must not signal'); });
  ended.query.pushMessage('fake'); ended.proc.emit('exit', 0, null);
  assert.equal((await ended.query.forceStop()).status, 'terminated'); assert.deepEqual(ended.signals, []);
});
