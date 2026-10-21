var test = require('node:test'), assert = require('node:assert/strict');
var readerModule = require('../lib/yoke/claude-task-reader');
var service = require('../lib/project-background-tasks');
function event(tasks) { return { type: 'system', subtype: 'background_tasks_changed', session_id: 'parent-session', tasks: tasks }; }
function task(id, type, run) { return { task_id: id, task_type: type || 'local_agent', run_id: run || 'run-1' }; }
test('native agent reads verify exact task against SDK inventory and bound directory', async function () {
  var calls = [], query = {};
  var sdk = { listSubagents: async function (id, opts) { calls.push([id, opts]); return ['agent-a', 'agent-b']; }, getSubagentMessages: async function (id, agent, opts) {
    calls.push([id, agent, opts]); return [{ type: 'assistant', message: { content: [{ type: 'text', text: 'Actual response' }, { type: 'tool_use', id: 'tool', name: 'Read', input: { file: 'x' } }] } }];
  } };
  var reader = readerModule.createReader(async function () { return sdk; }, function () { return query; }, '/owned-project');
  reader.observe(event([task('agent-a')]));
  var result = await reader.read({ taskId: 'agent-a', runId: 'run-1' });
  assert.equal(result.messages[0].text, 'Actual response'); assert.equal(result.messages[1].role, 'tool');
  assert.deepEqual(calls[0], ['parent-session', { dir: '/owned-project' }]); assert.equal(calls[1][1], 'agent-a'); assert.equal(calls[1][2].limit, 101);
  await assert.rejects(reader.read({ taskId: 'agent-b', runId: 'run-1' }), /unavailable/);
  await assert.rejects(reader.read({ taskId: 'agent-a', runId: 'old-run' }), /unavailable/);
  sdk.listSubagents = async function () { return ['agent-b']; };
  await assert.rejects(reader.read({ taskId: 'agent-a', runId: 'run-1' }), /not available/);
});
test('shell reads use native query output, bound length, and keep completed output inspectable', async function () {
  var query = { getTaskOutput: async function (id) { assert.equal(id, 'shell-a'); return { output: 'x'.repeat(20000), truncated: true }; } };
  var reader = readerModule.createReader(null, function () { return query; }, '/owned'); reader.observe(event([task('shell-a', 'local_bash')])); reader.observe(event([]));
  var result = await reader.read({ taskId: 'shell-a', runId: 'run-1' }); assert.equal(result.output.length, 8192); assert.equal(result.active, false); assert.equal(result.truncated, true);
  reader.close(); await assert.rejects(reader.read({ taskId: 'shell-a', runId: 'run-1' }), /unavailable/);
});
test('late query, parent and run changes reject asynchronous task reads', async function () {
  var release, query = {}, reader = readerModule.createReader(async function () { return { listSubagents: function () { return new Promise(function (resolve) { release = resolve; }); } }; }, function () { return query; }, '/owned');
  reader.observe(event([task('a')])); var pending = reader.read({ taskId: 'a', runId: 'run-1' }); await new Promise(setImmediate);
  reader.observe(event([task('a', 'local_agent', 'run-2')])); release(['a']); await assert.rejects(pending, /changed/);
});
test('worker IPC read correlation, failures and closure are bounded', async function () {
  var sent, requests = readerModule.createRequests({ send: function (message) { sent = message; return true; } });
  var pending = requests.request({ taskId: 'a' }); assert.equal(sent.type, 'read_background_task'); requests.receive({ requestId: 'foreign', data: {} }); requests.receive({ requestId: sent.requestId, data: { kind: 'agent' } }); assert.equal((await pending).kind, 'agent');
  pending = requests.request({ taskId: 'b' }); requests.close(); await assert.rejects(pending, /closed/);
  var response; await readerModule.respond(null, { requestId: 'x' }, function (value) { response = value; }); assert.match(response.error, /unavailable/);
});
function fixture() {
  var session = { localId: 1, sessionOriginId: 'origin', ownerId: 'owner', _sdkQueryGeneration: 1, cwd: '/owned', queryInstance: { readBackgroundTask: async function () { return { kind: 'agent', messages: [] }; } } };
  service.remember(session, [Object.assign(task('a'), { active: true })]);
  var ws = { readyState: 1, _clayUser: { id: 'owner' } }, replies = [], allowed = true;
  var ctx = { sm: { sessions: new Map([[1, session]]) }, getSessionForWs: function () { return session; }, getProjectAccess: function () { return {}; },
    usersModule: { isMultiUser: function () { return true; }, findUserById: function () { return allowed; }, canAccessProject: function () { return allowed; }, canAccessSession: function (id) { return allowed && id === 'owner'; } }, sendTo: function (ws, data) { replies.push(data); } };
  return { session: session, ws: ws, replies: replies, handler: service.attach(ctx), revoke: function () { allowed = false; }, message: { type: 'background_task_read', requestId: 'req', sessionOriginId: 'origin', taskId: 'a', runId: 'run-1' } };
}
test('project task service uses exact authenticated session and refuses foreign runs/origins', async function () {
  var f = fixture(); f.handler.handleMessage(f.ws, f.message); await new Promise(setImmediate); assert.equal(f.replies[0].data.kind, 'agent');
  f.handler.handleMessage(f.ws, Object.assign({}, f.message, { runId: 'foreign' })); await new Promise(setImmediate); assert.match(f.replies[1].error, /unavailable/);
  f.handler.handleMessage(f.ws, Object.assign({}, f.message, { sessionOriginId: 'foreign' })); await new Promise(setImmediate); assert.match(f.replies[2].error, /unavailable/);
  f.revoke(); f.handler.handleMessage(f.ws, f.message); await new Promise(setImmediate); assert.equal(f.replies.length, 3);
});
test('project task service discards delayed results after revoke, query replacement and session hop', async function () {
  var f = fixture(), release; f.session.queryInstance.readBackgroundTask = function () { return new Promise(function (resolve) { release = resolve; }); };
  f.handler.handleMessage(f.ws, f.message); f.revoke(); release({ kind: 'agent' }); await new Promise(setImmediate); assert.equal(f.replies.length, 0);
  f = fixture(); f.session.queryInstance.readBackgroundTask = function () { return new Promise(function (resolve) { release = resolve; }); };
  f.handler.handleMessage(f.ws, f.message); f.session.queryInstance = {}; release({ kind: 'agent' }); await new Promise(setImmediate); assert.equal(f.replies.length, 0);
});
test('task Stop addresses only the selected live native task without aborting the session', async function () {
  var f = fixture(), stopped = null; f.session.queryInstance.stopTask = async function (id) { stopped = id; };
  f.handler.handleMessage(f.ws, Object.assign({}, f.message, { type: 'background_task_stop' })); await new Promise(setImmediate); assert.equal(stopped, 'a'); assert.equal(f.replies[0].data.stopRequested, true);
});
test('catalog preserves bounded completed identities and resets on new query generations', function () {
  var f = fixture(); var list = service.remember(f.session, []); assert.equal(list[0].active, false); f.session._sdkQueryGeneration++; assert.deepEqual(service.remember(f.session, []), []);
});
test('same-run membership refresh does not invalidate an in-flight read', async function () {
  var release, query = {}, reader = readerModule.createReader(async function () { return {
    listSubagents: function () { return new Promise(function (resolve) { release = resolve; }); },
    getSubagentMessages: async function () { return []; }
  }; }, function () { return query; }, '/owned');
  reader.observe(event([task('a')])); var pending = reader.read({ taskId: 'a', runId: 'run-1' }); await new Promise(setImmediate);
  reader.observe(event([task('a'), task('b')])); release(['a']); assert.equal((await pending).kind, 'agent');
  var f = fixture(); f.session.queryInstance.readBackgroundTask = function () { return new Promise(function (resolve) { release = resolve; }); };
  f.handler.handleMessage(f.ws, f.message); service.remember(f.session, [task('a'), task('b')]); release({ kind: 'agent' }); await new Promise(setImmediate); assert.equal(f.replies[0].data.kind, 'agent');
});
test('real Claude adapter handles expose task reads through both native and mapped transports', async function () {
  var kit = require('../lib/yoke/adapters/claude').contractTestKit;
  var events = [event([task('shell-a', 'local_bash')])];
  var raw = { getTaskOutput: async function () { return { output: 'native text' }; }, [Symbol.asyncIterator]: function () { return { next: async function () { return events.length ? { value: events.shift(), done: false } : { done: true }; } }; } };
  var handle = kit.createQueryHandle(raw, kit.createMessageQueue(), new AbortController(), '/owned');
  await handle[Symbol.asyncIterator]().next(); assert.equal((await handle.readBackgroundTask({ taskId: 'shell-a', runId: 'run-1' })).output, 'native text');
  var receive, sent;
  var workerHandle = kit.createWorkerQueryHandle({ process: { killed: false, exitCode: null }, onMessage: function (fn) { receive = fn; }, send: function (message) { sent = message; return true; } });
  var pending = workerHandle.readBackgroundTask({ taskId: 'shell-a', runId: 'run-1' }); assert.equal(sent.type, 'read_background_task');
  receive({ type: 'background_task_response', requestId: sent.requestId, data: { output: 'mapped text' } }); assert.equal((await pending).output, 'mapped text');
});
test('installed SDK reads the exact isolated native subagent transcript and pagination', function () {
  var output = require('node:child_process').execFileSync(process.execPath, [require('node:path').join(__dirname, 'fixtures/claude-task-sdk.cjs')], { encoding: 'utf8', timeout: 10000 });
  assert.match(output, /Real SDK parent\/agent transcript and pagination verified/);
});
test('Stop is never blocked by an in-flight read and remains available without a reader', async function () {
  var f = fixture(), release, stopped = [];
  f.session.queryInstance.readBackgroundTask = function () { return new Promise(function (resolve) { release = resolve; }); };
  f.session.queryInstance.stopTask = async function (id) { stopped.push(id); };
  f.handler.handleMessage(f.ws, f.message);
  f.handler.handleMessage(f.ws, Object.assign({}, f.message, { type: 'background_task_stop', requestId: 'stop' }));
  await new Promise(setImmediate); assert.deepEqual(stopped, ['a']);
  release({ kind: 'agent' }); await new Promise(setImmediate);
  delete f.session.queryInstance.readBackgroundTask;
  f.handler.handleMessage(f.ws, Object.assign({}, f.message, { type: 'background_task_stop', requestId: 'stop2' }));
  await new Promise(setImmediate); assert.deepEqual(stopped, ['a', 'a']);
});
test('a changed owner invalidates a pending task read even when the actor still has access', async function () {
  var f = fixture(), release;
  f.session.queryInstance.readBackgroundTask = function () { return new Promise(function (resolve) { release = resolve; }); };
  f.handler.handleMessage(f.ws, f.message); f.session.ownerId = 'replacement-owner'; release({ kind: 'agent' });
  await new Promise(setImmediate); assert.deepEqual(f.replies, []);
});
test('native assistant previews preserve exact task binding and ignore user/tool-only content', function () {
  var f = fixture(), sent = []; f.session.vendor = 'claude'; f.session.taskIdMap = { tool: 'a' };
  function send(session, msg) { sent.push(msg); }
  var event = { messageRole: 'assistant', parentToolUseId: 'tool', uuid: 'message-1', content: [{ type: 'text', text: 'Observed assistant message' }] };
  assert.equal(service.observeMessage(f.session, event, send), true); assert.equal(sent[0].preview.text, 'Observed assistant message'); assert.equal(sent[0].taskId, 'a');
  assert.equal(sent[0].preview.vendor, 'claude'); assert.ok(Number.isFinite(sent[0].preview.timestamp));
  var timestamp = sent[0].preview.timestamp;
  assert.equal(service.observeMessage(f.session, event, send), false);
  service.observeMessage(f.session, Object.assign({}, event, { content: [{ type: 'text', text: 'Updated text' }] }), send);
  assert.equal(sent[1].preview.timestamp, timestamp, 'message updates retain their original received time');
  assert.equal(service.observeMessage(f.session, Object.assign({}, event, { messageRole: 'user' }), send), false);
  assert.equal(service.observeMessage(f.session, Object.assign({}, event, { parentToolUseId: 'foreign' }), send), false);
  assert.equal(service.observeMessage(f.session, Object.assign({}, event, { content: [{ type: 'tool_use', name: 'Read' }] }), send), false);
  f.session._sdkQueryGeneration++; assert.equal(service.observeMessage(f.session, event, send), false);
});
