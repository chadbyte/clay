var liveQuery = require('./helpers/live-query-fixture.cjs');
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

function sessionContext(session) {
  var sessions = new Map([[session.localId, session]]);
  return { sm: { sessions: sessions, saveSessionFile: function () { return true; }, broadcastSessionList: function () {} }, isMate: true,
    canUse: function () { return true; }, canRead: function () { return true; }, identity: function () { return null; }, osUsers: false };
}

test('Mate parity exposes owner-bound GitHub, Notes and Markdown tools through native and bridge definitions', function (t) {
  var session = { localId: 1, ownerId: 'owner', mode: 'gui', history: [], githubLinks: [] };
  var github = require('../lib/project-session-github').attachSessionGithub(Object.assign(sessionContext(session), { cwd: process.cwd(), run: function () { return Promise.resolve(); } }));
  var notes = require('../lib/project-session-notes').attachSessionNotes(Object.assign(sessionContext(session), { nm: { list: function () { return []; } }, send: function () {} }));
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mate-docs-')); t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var documents = require('../lib/project-session-document').attachSessionDocument({ cwd: root, isMate: true, sendToSession: function () {}, getOsUserInfoForSession: function () { return null; } });
  assert.equal(github.getDynamicToolDefs(session).length, 3);
  assert.equal(notes.getToolDefs(session).length > 0, true);
  assert.equal(documents.getToolDefs(session).length, 2);
  var adapter = { createToolServer: function (value) { return value; } };
  assert.equal(github.createMcpServer(adapter, session).name, 'clay-github');
  assert.equal(notes.createMcpServer(adapter, session).name, 'clay-notes');
  assert.equal(documents.createMcpServer(adapter, session).name, 'clay-documents');
});

test('Mate Scheduled Tasks remain explicitly excluded from project Driver orchestration', function () {
  var session = { localId: 2, ownerId: 'owner', mode: 'gui', history: [] };
  var service = require('../lib/project-scheduled-tasks').attachScheduledTasks({
    cwd: process.cwd(), sm: { sessions: new Map([[2, session]]) }, registry: { getAll: function () { return []; } },
    isMate: true, sendTo: function () {}, isDriverOperatedSession: function () { return false; }, canUseSession: function () { return true; },
  });
  assert.deepEqual(service.getToolDefs(session), []);
  assert.equal(service.getSystemPrompt(session), '');
});

test('Mate Notes and Documents execute native handlers and reject retained handlers after session replacement', async function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mate-parity-')); t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var session = { localId: 1, ownerId: 'owner', mode: 'gui', history: [] }, sessions = new Map([[1, session]]), notesRows = [], sent = [];
  function canUse(value) { return sessions.get(value.localId) === value && value.ownerId === 'owner'; }
  var notes = require('../lib/project-session-notes').attachSessionNotes({ isMate: true, canUseSession: canUse,
    nm: { list: function () { return notesRows; }, create: function (value) { var row = Object.assign({ id: 'note-1', state: 'open' }, value); notesRows.push(row); return row; } }, send: function () {} });
  var documents = require('../lib/project-session-document').attachSessionDocument({ cwd: root, isMate: true, canUseSession: canUse, sendToSession: function (id, msg) { sent.push({ id: id, msg: msg }); } });
  var write = notes.getToolDefs(session).find(function (tool) { return tool.name === 'write_note'; });
  var list = notes.getToolDefs(session).find(function (tool) { return tool.name === 'list_notes'; });
  assert.equal((await write.handler({ text: 'Remember the user-requested follow-up' })).isError, undefined);
  assert.equal(JSON.parse((await list.handler({})).content[0].text).length, 1);
  fs.writeFileSync(path.join(root, 'draft.md'), '# Fixture');
  var present = documents.getToolDefs(session).find(function (tool) { return tool.name === 'present_markdown_edit'; });
  assert.equal(JSON.parse((await present.handler({ path: 'draft.md' })).content[0].text).ready, true);
  assert.equal(sent[0].id, 1); assert.equal(sent[0].msg.content, '# Fixture');
  sessions.set(1, Object.assign({}, session));
  assert.equal((await list.handler({})).isError, true); assert.equal((await write.handler({ text: 'late' })).isError, true);
  assert.equal((await present.handler({ path: 'draft.md' })).isError, true); assert.equal(notesRows.length, 1); assert.equal(sent.length, 1);
});

test('scheduled/resumed Mate queries obtain external tools through SDK native and exact-query catalogs across supported transports', async function (t) {
  var createBridge = require('../lib/sdk-bridge').createSDKBridge;
  var createProxy = require('../lib/mcp-proxy').createProxy;
  var createQueryBridge = require('../lib/mcp-query-bridge').createQueryBridge;
  var vendors = ['claude', 'codex', 'kiro', 'opencode', 'kimi', 'grok', 'copilot', 'qwen', 'junie'];
  for (var vendor of vendors) {
    var session = { localId: 1, ownerId: 'owner', vendor: vendor, mode: 'gui', cliSessionId: 'resume-1', history: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
    var sessions = new Map([[1, session]]), captures = [], active = true, names = ['initial'];
    var sm = { sessions: sessions, modelsByVendor: { [vendor]: [] }, capabilitiesByVendor: { [vendor]: {} }, availableModels: [], saveSessionFile: function () {}, broadcastSessionList: function () {}, sendAndRecord: function () {}, sendToSession: function () {} };
    function getServers() {
      if (!active) return {};
      return { 'remote-fixture': createProxy('remote-fixture', names.map(function (name) { return { name: name, inputSchema: { type: 'object' } }; }), function (name) { return { content: [{ type: 'text', text: name }] }; }) };
    }
    var adapter;
    if (vendor === 'claude') {
      adapter = require('../lib/yoke/adapters/claude').createClaudeAdapter({ cwd: process.cwd(), loadSDK: function () { return Promise.resolve({ query: function (args) { captures.push(args.options); return liveQuery.create(); } }); } });
    } else {
      adapter = { vendor: vendor, createQuery: function (options) { captures.push(options); return Promise.resolve(liveQuery.create()); } };
    }
    var bridge = createBridge({ cwd: process.cwd(), slug: 'mate-fixture', isMate: true, sessionManager: sm, adapter: adapter,
      adapters: Object.fromEntries([[vendor, adapter]]), send: function () {}, getRemoteMcpServers: getServers, canUseSessionTools: function () { return active && sessions.get(1) === session; } });
    await bridge.startQuery(session, 'Scheduled Mate work', null, null);
    await liveQuery.retire(session);
    names.push('added_after_resume');
    await bridge.startQuery(session, 'Resumed scheduled Mate work', null, null);
    assert.equal(captures.length, 2, vendor);
    if (vendor === 'claude') {
      var native = captures[1].mcpServers['remote-fixture'].instance._registeredTools.added_after_resume;
      assert.equal((await (native.handler || native.callback)({})).content[0].text, 'added_after_resume');
    } else if (vendor === 'codex') {
      assert.ok(captures[1].sessionMcpServer.args.includes('--session-only'));
      var dynamic = captures[1].dynamicTools.find(function (tool) { return tool.name === 'mcp__remote-fixture__added_after_resume'; });
      assert.equal((await dynamic.handler({})).content[0].text, 'added_after_resume');
      await assert.rejects(captures[0].dynamicTools.find(function (tool) { return tool.name === 'mcp__remote-fixture__initial'; }).handler({}), /current authorized query/);
    } else {
      assert.ok(captures[1].adapterOptions[vendor === 'kiro' ? 'KIRO' : 'ACP'].mcpServers[0].args.includes('--query-generation'), vendor);
    }
    var generation = session._sdkQueryGeneration;
    var exact = createQueryBridge({ valid: function () { return active && sessions.get(1) === session && session._sdkQueryGeneration === generation; }, getServers: getServers });
    assert.equal(exact.list().length, 2, vendor); assert.equal((await exact.call('remote-fixture', 'added_after_resume', {})).content[0].text, 'added_after_resume');
    await liveQuery.retire(session);
    active = false; assert.deepEqual(exact.list(), []); await assert.rejects(exact.call('remote-fixture', 'initial', {}));
  }
});

test('Mate GitHub tools execute verified native and bridge handlers while retaining private session authority', async function () {
  var session = { localId: 1, ownerId: 'owner', mode: 'gui', history: [], githubLinks: [] }, sessions = new Map([[1, session]]), calls = 0;
  var github = require('../lib/project-session-github').attachSessionGithub({ cwd: '/tmp', isMate: true,
    sm: { sessions: sessions, saveSessionFile: function () { return true; }, broadcastSessionList: function () {} },
    canUse: function (value) { return value === session && sessions.get(1) === value; }, canRead: function (caller, other) { return other.ownerId === caller.ownerId; }, identity: function () { return null; },
    run: async function (cwd, args) { calls++; assert.equal(args[1], 'view'); return { url: 'https://github.com/example/repo/issues/1', title: 'Fixture', state: 'OPEN' }; } });
  var link = github.getDynamicToolDefs(session).find(function (tool) { return tool.name === 'link_session_github'; });
  assert.equal((await link.handler({ url: 'https://github.com/example/repo/issues/1' })).isError, undefined);
  var read = await github.callBridgeTool(session, 'get_session_github', {});
  assert.equal(JSON.parse(read.content[0].text).links.length, 1); assert.ok(calls > 0);
  sessions.delete(1); assert.equal((await link.handler({ url: 'https://github.com/example/repo/issues/1' })).isError, true);
});

test('actual project coordinator registers Mate built-ins and routes exact-query MCP through the source project', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mcp-coordinator-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var exec = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'fixtures/mcp-project-context.cjs'), root], {
    env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, 'config'), SUDO_USER: '', CLAY_CONFIG: '' }), timeout: 30000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(exec.status, 0, exec.stdout + exec.stderr); assert.match(exec.stdout, /production coordinator parity/);
});
