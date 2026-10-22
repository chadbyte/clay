// Personal "Agent behavior" client logic: registry entry, catalog-driven state,
// save acknowledgement, failure/retry and stale-reply handling. Runs the real
// modules in Node with a fake fetch; the browser behaviour is covered in
// agent-behavior-browser.test.js.
var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var pathToFileURL = require('node:url').pathToFileURL;
var schema = require('../lib/agent-behavior-schema');

var MODULES = path.join(__dirname, '../lib/public/modules');
function load(name) { return import(pathToFileURL(path.join(MODULES, name)).href); }

function payload(policy, extra) {
  var full = Object.assign(schema.defaults(), policy || {});
  return Object.assign({ ok: true, policy: full, effective: schema.effective(full), catalog: schema.catalog() }, extra || {});
}
function reply(status, body) { return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } }; }
function deferredFetch() {
  var calls = [];
  global.fetch = function (url, init) {
    return new Promise(function (resolve, reject) { calls.push({ url: url, init: init || {}, resolve: resolve, reject: reject, body: init && init.body ? JSON.parse(init.body) : null }); });
  };
  return calls;
}
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
async function ready(m, policy) {
  var calls = deferredFetch();
  var loading = m.loadAgentBehavior();
  calls[0].resolve(reply(200, payload(policy)));
  await loading;
  assert.equal(m.getAgentBehavior().status, 'ready');
  return calls;
}
function put(calls, index, body) { calls[index].resolve(reply(200, body)); }

test('the Personal registry lists Agent behavior right after AI preferences', async function () {
  var registry = await load('settings-shell-registry.js');
  var ids = registry.PERSONAL_PAGES.map(function (page) { return page.id; });
  assert.equal(ids[ids.indexOf('us-ai') + 1], 'us-agent');
  assert.equal(registry.PERSONAL_PAGES.filter(function (page) { return page.id === 'us-agent'; })[0].label, 'Agent behavior');
  assert.equal(registry.resolvePage('personal', 'us-agent'), 'us-agent');
});

test('loading fetches the catalog and policy, and a failed load is an error state with a message', async function () {
  var m = await load('agent-behavior.js');
  var calls = deferredFetch();
  var loading = m.loadAgentBehavior();
  assert.equal(m.getAgentBehavior().status, 'loading');
  assert.equal(calls[0].url, '/api/user/agent-behavior');
  calls[0].resolve(reply(500, { error: 'Disk unavailable' }));
  await loading;
  assert.equal(m.getAgentBehavior().status, 'error');
  assert.equal(m.getAgentBehavior().error, 'Disk unavailable');
  loading = m.loadAgentBehavior();
  calls[1].resolve(reply(401, { error: 'unauthorized' }));
  await loading;
  assert.match(m.getAgentBehavior().error, /signed out/);
  loading = m.loadAgentBehavior();
  calls[2].resolve(reply(200, { ok: true, policy: {} }));
  await loading;
  assert.equal(m.getAgentBehavior().status, 'error', 'a malformed answer is not an empty page');
  loading = m.loadAgentBehavior();
  calls[3].reject(new Error('offline'));
  await loading;
  assert.match(m.getAgentBehavior().error, /Could not reach/);
  assert.equal(m.getAgentBehavior().catalog, null);
});

test('a choice shows Saving, sends only the changed key with a request id and is Saved only after the 200', async function () {
  var m = await load('agent-behavior.js');
  var calls = await ready(m);
  assert.equal(m.chooseValue('notes', 'request'), true);
  var state = m.getAgentBehavior();
  assert.equal(m.displayedValue(state, 'notes'), 'request');
  assert.deepEqual(m.statusFor(state, 'notes'), { kind: 'saving', text: 'Saving...' });
  assert.equal(state.policy.notes, 'auto', 'the acknowledged value does not move before the reply');
  var request = calls[1];
  assert.equal(request.init.method, 'PUT');
  assert.deepEqual(Object.keys(request.body).sort(), ['changes', 'requestId']);
  assert.deepEqual(request.body.changes, { notes: 'request' });
  assert.match(request.body.requestId, /^ab-/);
  put(calls, 1, payload({ notes: 'request' }, { requestId: request.body.requestId }));
  await tick();
  state = m.getAgentBehavior();
  assert.equal(state.policy.notes, 'request');
  assert.deepEqual(m.statusFor(state, 'notes'), { kind: 'saved', text: 'Saved' });
  assert.equal(m.chooseValue('notes', 'request'), false, 'selecting the saved value again sends nothing');
  assert.equal(calls.length, 2);
});

test('a failed save reverts to the acknowledged value, keeps the failed choice and Retry resends it', async function () {
  var m = await load('agent-behavior.js');
  var calls = await ready(m);
  m.chooseValue('issues', 'off');
  calls[1].resolve(reply(500, { error: 'Could not save agent behavior' }));
  await tick();
  var state = m.getAgentBehavior();
  assert.equal(m.displayedValue(state, 'issues'), 'auto', 'the display reverts');
  assert.deepEqual(m.statusFor(state, 'issues'), { kind: 'error', text: 'Could not save agent behavior' });
  assert.equal(state.edits.issues.value, 'off');
  assert.equal(m.retryValue('issues'), true);
  assert.equal(m.statusFor(m.getAgentBehavior(), 'issues').kind, 'saving');
  assert.deepEqual(calls[2].body.changes, { issues: 'off' });
  assert.notEqual(calls[2].body.requestId, calls[1].body.requestId);
  put(calls, 2, payload({ issues: 'off' }, { requestId: calls[2].body.requestId }));
  await tick();
  assert.equal(m.getAgentBehavior().policy.issues, 'off');
  assert.equal(m.statusFor(m.getAgentBehavior(), 'issues').kind, 'saved');
  // A network failure is handled the same way.
  m.chooseValue('logs', 'request');
  calls[3].reject(new Error('offline'));
  await tick();
  assert.equal(m.statusFor(m.getAgentBehavior(), 'logs').kind, 'error');
  assert.equal(m.displayedValue(m.getAgentBehavior(), 'logs'), 'auto');
  // Choosing the acknowledged value discards the failed choice.
  m.chooseValue('logs', 'auto');
  assert.equal(m.statusFor(m.getAgentBehavior(), 'logs').kind, '');
});

test('requests for one setting are serialized and the newest choice wins; a mismatched reply is a failure', async function () {
  var m = await load('agent-behavior.js');
  var calls = await ready(m);
  m.chooseValue('sketch', 'request');
  m.chooseValue('sketch', 'off');
  assert.equal(calls.length, 2, 'the second choice waits for the first reply');
  assert.equal(m.displayedValue(m.getAgentBehavior(), 'sketch'), 'off');
  put(calls, 1, payload({ sketch: 'request' }, { requestId: calls[1].body.requestId }));
  await tick();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].body.changes, { sketch: 'off' });
  assert.equal(m.displayedValue(m.getAgentBehavior(), 'sketch'), 'off', 'the older reply never moves the display');
  assert.equal(m.statusFor(m.getAgentBehavior(), 'sketch').kind, 'saving');
  put(calls, 2, payload({ sketch: 'off' }, { requestId: calls[2].body.requestId }));
  await tick();
  assert.equal(m.getAgentBehavior().policy.sketch, 'off');
  assert.equal(m.statusFor(m.getAgentBehavior(), 'sketch').kind, 'saved');
  m.chooseValue('continuation', 'off');
  put(calls, 3, payload({ continuation: 'off' }, { requestId: 'someone-else' }));
  await tick();
  assert.equal(m.statusFor(m.getAgentBehavior(), 'continuation').kind, 'error');
});

test('a reply only merges its own setting and cannot overwrite another setting or a newer effective value', async function () {
  var m = await load('agent-behavior.js');
  var calls = await ready(m);
  m.chooseValue('notes', 'request');   // call 1
  m.chooseValue('meUse', 'off');       // call 2
  put(calls, 2, payload({ meUse: 'off' }, { requestId: calls[2].body.requestId }));
  await tick();
  // The older notes reply was computed before meUse changed and carries meUse auto.
  put(calls, 1, payload({ notes: 'request', meUse: 'auto' }, { requestId: calls[1].body.requestId }));
  await tick();
  var state = m.getAgentBehavior();
  assert.equal(state.policy.meUse, 'off');
  assert.equal(state.policy.notes, 'request');
  assert.equal(state.effective, null, 'an effective flag from overlapping replies is unknown, never stale');
  // A lone newest reply with nothing else in flight is trusted again.
  m.chooseValue('notes', 'auto');
  put(calls, 3, payload({ notes: 'auto' }, { requestId: calls[3].body.requestId }));
  await tick();
  assert.equal(m.getAgentBehavior().effective.issueLinkedNotes, true);
});

test('leaving the page invalidates in-flight work so a late reply cannot revive it', async function () {
  var m = await load('agent-behavior.js');
  var calls = await ready(m);
  m.chooseValue('logs', 'off');
  m.resetAgentBehavior();
  assert.equal(m.getAgentBehavior().status, 'idle');
  put(calls, 1, payload({ logs: 'off' }, { requestId: calls[1].body.requestId }));
  await tick();
  assert.equal(m.getAgentBehavior().status, 'idle');
  assert.equal(m.getAgentBehavior().policy, null);
  // A late answer from an older load is ignored as well.
  var next = deferredFetch();
  var first = m.loadAgentBehavior();
  var second = m.loadAgentBehavior();
  next[1].resolve(reply(200, payload({ logs: 'request' })));
  await second;
  next[0].resolve(reply(200, payload({ logs: 'off' })));
  await first;
  assert.equal(m.getAgentBehavior().policy.logs, 'request');
});

test('the linked-note checkbox is inactive unless Sticky Notes is Auto and Issues is not Off, and keeps its saved choice', async function () {
  var m = await load('agent-behavior.js');
  var calls = await ready(m);
  var box = schema.SETTINGS.filter(function (s) { return s.type === 'checkbox'; })[0];
  var info = m.checkboxStatus(m.getAgentBehavior(), box);
  assert.deepEqual([info.checked, info.inactive, info.reason], [true, false, '']);
  m.chooseValue('notes', 'request');
  info = m.checkboxStatus(m.getAgentBehavior(), box);
  assert.equal(info.inactive, true);
  assert.equal(info.checked, true, 'the saved choice stays displayed');
  assert.match(info.reason, /Sticky Notes is On request/);
  put(calls, 1, payload({ notes: 'request' }, { requestId: calls[1].body.requestId }));
  await tick();
  m.chooseValue('notes', 'auto');
  put(calls, 2, payload({}, { requestId: calls[2].body.requestId }));
  await tick();
  assert.equal(m.checkboxStatus(m.getAgentBehavior(), box).inactive, false);
  m.chooseValue('issues', 'off');
  assert.match(m.checkboxStatus(m.getAgentBehavior(), box).reason, /Issues is Off/);
  // The server's effective flag also counts once nothing is pending.
  var other = await ready(m, { issueLinkedNotes: true });
  var state = Object.assign({}, m.getAgentBehavior(), { effective: { issueLinkedNotes: false } });
  assert.match(m.checkboxStatus(state, box).reason, /not currently apply/);
  assert.ok(other.length);
});
