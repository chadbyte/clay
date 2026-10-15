// Isolate storage and forbid provider processes before production imports.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-query-contract-'));
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CODEX_HOME = path.join(root, '.codex');
var cp = require('node:child_process');
['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'].forEach(function (name) {
  cp[name] = function () { throw new Error('External processes are forbidden in this contract fixture.'); };
});
var transport = require('../lib/yoke/session-tool-transport');
var createBridge = require('../lib/sdk-bridge').createSDKBridge;
var claude = require('../lib/yoke/adapters/claude').createClaudeAdapter({ cwd: root });
var codex = require('../lib/yoke/adapters/codex').createCodexAdapter({ cwd: root });
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

function fixture(t, provider, options) {
  options = options || {};
  var captured, ended = false, pending, first = true, calls = 0;
  var session = { localId: 1, vendor: provider.vendor, cliSessionId: options.resume ? 'existing-thread' : null,
    pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var handle = { pushMessage: function () { return true; }, close: function () { ended = true; if (pending) pending({ done: true }); },
    setMcpPermissionModeOverride: function () {},
    [Symbol.asyncIterator]: function () { return { next: function () {
      if (first && !options.noConfirmation) { first = false; return Promise.resolve({ done: false, value: { yokeType: 'session_started', sessionId: session.cliSessionId || 'new-thread' } }); }
      if (ended) return Promise.resolve({ done: true });
      return new Promise(function (resolve) { pending = resolve; });
    } }; } };
  var records = [], mounted = [], adapter = Object.assign({}, provider, {
    init: function () { return Promise.resolve({ models: [], capabilities: {} }); },
    supportedModels: function () { return Promise.resolve([]); },
    userInputCapability: { mode: 'native', native: true },
    createToolServer: function (definition) { mounted.push(definition); return options.mountFailure ? null : definition; },
    createQuery: function (query) { captured = query; return Promise.resolve(handle); },
  });
  if (options.omitToolServer) delete adapter.createToolServer;
  if (Object.prototype.hasOwnProperty.call(options, 'toolServerFactory')) adapter.createToolServer = options.toolServerFactory;
  if (options.fallbackInput) session.debateSetupMode = true;
  var adapters = {}; adapters[adapter.vendor] = adapter;
  var sessions = new Map([[1, session]]), authorized = true;
  var defs = ['begin_scheduled_task_interview', 'propose_scheduled_task', 'list_scheduled_tasks', 'read_scheduled_task', 'update_scheduled_task',
    'read_mate_schedule', 'create_issue', 'search_user_knowledge', 'link_session_linear', 'shared_browser'].map(function (name) {
    return { name: name, description: name, inputSchema: {}, handler: function () { calls++; return Promise.resolve({ content: [] }); } };
  });
  if (options.toolNames) defs = defs.filter(function (tool) { return options.toolNames.indexOf(tool.name) >= 0; });
  var bridge = createBridge({ cwd: root, adapter: adapter, adapters: adapters, send: function () {},
    sessionManager: { sessions: sessions, availableModels: [], saveSessionFile: function () {}, broadcastSessionList: function () {}, sendAndRecord: function (target, event) { records.push(event); }, sendToSession: function () {} },
    canUseSessionTools: function () { return authorized; },
    getSessionToolDefs: function () { return authorized ? defs : []; },
    getRemoteMcpServers: function () { return { external: { instance: { _registeredTools: { probe: {
      description: 'Isolated external probe', _clayInputSchema: { type: 'object', properties: {} }, handler: function () { return { content: [] }; },
    } } } } }; },
  });
  t.after(function () { handle.close(); });
  return { records: records, bridge: bridge, session: session, mounted: mounted, sessions: sessions,
    start: function () { return bridge.startQuery(session, 'Inspect contract', null, null); },
    query: function () { return captured; }, calls: function () { return calls; },
    revoke: function () { authorized = false; } };
}

['claude', 'codex'].forEach(function (name) {
  test(name + ' adapters expose the same init-free contract as their registry entry', function () {
    var adapter = name === 'claude' ? claude : codex;
    assert.strictEqual(transport.contract(adapter), transport.contract(name));
  });
});

test('unrecognized adapters default to unsupported without creating success declarations', function () {
  assert.deepEqual(transport.capability({ vendor: 'unknown' }), { supported: false, kind: 'none' });
  assert.equal(transport.availableForSession({ vendor: 'unknown' }).available, false);
  assert.equal(transport.needsRecovery({ vendor: 'unknown' }, { cliSessionId: 'old' }, 'questions', 1), false);
});

test('legacy catalog compatibility belongs to the provider contract', function () {
  var session = { cliSessionId: 'legacy', codexDynamicToolCatalogVersion: 4, codexSharedBrowserToolCatalogVersion: 5 };
  assert.equal(transport.availableForSession(Object.assign({ vendor: 'codex' }, session)).available, false);
  assert.equal(transport.needsRecovery(codex, session, 'browser', 6), true);
  codex.queryContract.recordCatalog(session, { schedules: 5, browser: 6 });
  assert.equal(transport.needsRecovery(codex, session, 'browser', 6), false);
  assert.equal(transport.availableForSession(Object.assign({ vendor: 'codex' }, session)).available, true);
});

[claude, { vendor: 'unrelated-native', queryContract: claude.queryContract }].forEach(function (provider) {
  test(provider.vendor + ' mounts both schedule families through the native contract', async function (t) {
    var f = fixture(t, provider);
    assert.equal(await f.start(), true);
    assert.ok(f.mounted.some(function (item) { return item.name === 'clay-scheduled-tasks'; }));
    assert.ok(f.mounted.some(function (item) { return item.name === 'clay-mate-schedules'; }));
    assert.equal(f.query().dynamicTools.some(function (item) { return item.name === 'mcp__external__probe'; }), false);
    assert.equal(f.session.permissionCapabilities.mcpOverride, true);
    assert.equal(f.session.permissionCapabilities.auto, true);
  });
});

var independent = { vendor: 'independent-dynamic', queryContract: Object.assign({}, codex.queryContract, {
  catalogVersion: function (session, family) { return (session.testCatalog || {})[family] || 0; },
  recordCatalog: function (session, versions) { session.testCatalog = Object.assign({}, versions); },
}) };
[codex, independent].forEach(function (provider) {
  test(provider.vendor + ' fresh/resumed catalogs use lifetime semantics and exact-query recovery', async function (t) {
    var f = fixture(t, provider);
    assert.equal(await f.start(), true);
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(f.query().userInputMode, 'fallback');
    assert.match(f.query().appendSystemPrompt, /blocking question tool/);
    assert.ok(f.query().dynamicTools.some(function (item) { return item.name === 'mcp__external__probe'; }));
    assert.equal(f.query().sessionMcpServer, undefined);
    assert.equal(provider.queryContract.catalogVersion(f.session, 'browser'), 6);
    assert.equal(provider.queryContract.catalogVersion(f.session, 'schedules'), 5);
    assert.equal(provider.queryContract.catalogVersion(f.session, 'questions'), 1);
    assert.equal(f.session.permissionCapabilities.mcpOverride, false, 'a stub setter does not grant support');
    if (provider === independent) assert.equal(f.session.codexDynamicToolCatalogVersion, undefined);
    var resumed = fixture(t, provider, { resume: true });
    assert.equal(await resumed.start(), true);
    var query = resumed.query();
    assert.ok(query.sessionMcpServer.args.indexOf('--query-generation') >= 0);
    assert.ok(query.sessionMcpServer.args.indexOf('--session-only') >= 0);
    assert.equal(query.sessionMcpServer.name, 'clay-session-tools');
    await query.callDynamicTool('read_mate_schedule', {});
    assert.equal(resumed.calls(), 1);
    resumed.revoke();
    await assert.rejects(query.callDynamicTool('read_mate_schedule', {}), /no longer available/);
    assert.equal(resumed.calls(), 1);
    assert.equal(provider.queryContract.catalogVersion(resumed.session, 'browser'), 0, 'resume never stamps a new catalog');
  });
});

[claude, codex, independent].forEach(function (provider) {
  test(provider.vendor + ' denies retained callbacks after Stop, replacement, or generation change', async function (t) {
    var f = fixture(t, provider, { resume: true });
    await f.start();
    var query = f.query();
    var external = query.dynamicTools.find(function (tool) { return tool.name === 'mcp__external__probe'; });
    f.session.taskStopRequested = true;
    await assert.rejects(query.callDynamicTool('create_issue', {}), /no longer available/);
    assert.equal((await query.canUseTool('create_issue', {}, {})).behavior, 'deny');
    assert.equal((await query.onElicitation({})).action, 'cancel');
    if (external) await assert.rejects(external.handler({}), /current authorized query/);
    f.session.taskStopRequested = false;
    f.sessions.set(1, Object.assign({}, f.session));
    await assert.rejects(query.callDynamicTool('create_issue', {}), /no longer available/);
    f.sessions.set(1, f.session);
    f.session._sdkQueryGeneration++;
    await assert.rejects(query.callDynamicTool('create_issue', {}), /no longer available/);
    assert.equal(f.calls(), 0);
  });
});

test('conversation catalogs without confirmation or a revision reader remain unknown', async function (t) {
  var f = fixture(t, independent, { noConfirmation: true });
  await f.start();
  assert.equal(f.session.testCatalog, undefined);
  var missingReader = { vendor: 'no-reader', queryContract: { toolTransport: 'dynamic', catalogLifetime: 'conversation' } };
  assert.equal(transport.needsRecovery(missingReader, { cliSessionId: 'existing' }, 'questions', 1), true);
  missingReader.queryContract.catalogVersion = function () { return NaN; };
  assert.equal(transport.needsRecovery(missingReader, { cliSessionId: 'existing' }, 'questions', 1), true);
});

test('a declared SDK transport that cannot mount its tools fails startup truthfully', async function (t) {
  var f = fixture(t, claude, { mountFailure: true });
  assert.equal(await f.start(), false);
  assert.equal(f.query(), undefined);
});

[undefined, null, '', 'arbitrary', true, {}, []].forEach(function (kind) {
  test('invalid declared tool transport normalizes to the refusal kind: ' + String(kind), function () {
    assert.deepEqual(transport.capability({ vendor: 'invalid-transport', queryContract: { toolTransport: kind } }), { supported: false, kind: 'none' });
  });
});

['list_scheduled_tasks', 'read_mate_schedule'].forEach(function (name) {
  [{ omitToolServer: true }, { toolServerFactory: undefined }, { toolServerFactory: null }, { toolServerFactory: {} }, { toolServerFactory: 'factory' }].forEach(function (option, index) {
    test(name + ' rejects a missing or nonfunction native factory, case ' + index, async function (t) {
      var f = fixture(t, { vendor: 'invalid-native', queryContract: claude.queryContract }, Object.assign({ toolNames: [name] }, option));
      assert.equal(await f.start(), false);
      assert.equal(f.query(), undefined);
      assert.equal(f.session.queryInstance, null);
      assert.equal(f.mounted.length, 0);
      assert.ok(f.records.some(function (event) { return event.type === 'error'; }));
      assert.ok(f.records.some(function (event) { return event.type === 'done' && event.code === 1; }));
    });
  });
});

test('SDK fallback questions also fail startup when their native mount is unavailable', async function (t) {
  for (var options of [{ omitToolServer: true }, { toolServerFactory: null }, { mountFailure: true }]) {
    var f = fixture(t, { vendor: 'invalid-native', queryContract: claude.queryContract }, Object.assign({ toolNames: [], fallbackInput: true }, options));
    assert.equal(await f.start(), false);
    assert.equal(f.query(), undefined);
    assert.ok(f.records.some(function (event) { return event.type === 'error'; }));
  }
});

['muse', 'independent-msp'].forEach(function(name) {
  [false, true].forEach(function(resume) {
    test(name + ' stdio contract preserves current-generation scope on ' + (resume ? 'resume' : 'start'), async function(t) {
      var registry = require('../lib/yoke/vendor-registry').getVendorInfo('muse');
      var provider = { vendor: name, providerContract: registry, queryContract: registry.queryContract };
      var f = fixture(t, provider, { resume: resume });
      assert.equal(await f.start(), true);
      var bridge = f.query().adapterOptions.MUSE.mcpServers[0];
      var index = bridge.args.indexOf('--query-generation');
      assert.equal(bridge.args[index + 1], String(f.session._sdkQueryGeneration));
      assert.ok(bridge.args.includes('--session-only'));
      assert.equal(transport.capability(provider).kind, 'stdio-mcp');
      assert.equal(transport.needsRecovery(provider, f.session, 'schedules', 5), false);
      f.revoke(); await assert.rejects(f.query().callDynamicTool('create_issue', {}), /no longer available/);
    });
  });
});

test('Muse read-only curator intent refuses unavailable sandbox semantics', function() {
  assert.throws(function() { require('../lib/yoke/query-options').map('muse', { readOnly: true, nativeBypass: true }); }, /read-only sandbox/);
});
