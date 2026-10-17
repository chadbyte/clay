// Isolate before imports; provider execution is forbidden even on failure paths.
var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoke-runtime-services-'));
process.env.HOME = root; process.env.CLAY_HOME = path.join(root, '.clay'); process.env.CODEX_HOME = path.join(root, '.codex');
require('./helpers/yoke-no-provider-processes.cjs');
var registry = require('../lib/yoke/vendor-registry').VENDOR_REGISTRY;
var options = require('../lib/yoke/query-options');
var usage = require('../lib/yoke/usage');
test.after(function() { fs.rmSync(root, { recursive: true, force: true }); });

function alias(vendor) { return { vendor: 'independent-provider', providerContract: registry[vendor] }; }

test('actual Claude option mapping follows common intent independently of provider name', function() {
  var intent = { settings: {}, nativePermissionMode: 'auto', thinking: { mode: 'budget', budget: 3200 },
    disableHooks: true, resumeAt: 'exact-message', isolation: { user: 'mapped-owner', home: '/isolated', projectPath: root, workerState: { exact: true } } };
  var actual = options.map(alias('claude'), intent);
  assert.deepEqual(actual, options.map('claude', intent));
  assert.equal(actual.CLAUDE.permissionMode, 'auto');
  assert.equal(actual.CLAUDE.thinking.budgetTokens, 3200);
  assert.equal(actual.CLAUDE.settings.disableAllHooks, true);
  assert.equal(actual.CLAUDE.resumeSessionAt, 'exact-message');
  assert.equal(actual.CLAUDE.linuxUser, 'mapped-owner');
  assert.equal(actual.CLAUDE._workerState.exact, true);
  assert.equal(options.map('claude', { readOnly: true, nativeBypass: true }).CLAUDE.allowDangerouslySkipPermissions, false);
});

test('curator restrictions and stored runtime defaults survive option translation', function() {
  var intent = { readOnly: true, settings: { codexSandbox: 'danger-full-access', codexWebSearch: 'live' } };
  assert.deepEqual(options.map(alias('codex'), intent), { CODEX: { approvalPolicy: 'never', sandboxMode: 'read-only', webSearchMode: 'disabled' } });
  var defaults = options.map('codex', { settings: {} }).CODEX;
  assert.equal(defaults.sandboxMode, 'danger-full-access');
  assert.equal(defaults.webSearchMode, 'live');
  assert.equal(options.map('codex', { settings: { codexSandbox: 'invalid', codexWebSearch: 'invalid' } }).CODEX.sandboxMode, 'read-only');
});

test('every registered adapter has its implemented option mapper and ACP bridges retain exact identity', function() {
  Object.keys(registry).forEach(function(vendor) {
    assert.equal(typeof registry[vendor].mapQueryOptions, 'function', vendor);
    assert.ok(options.map(vendor, { settings: {}, sessionBridge: [] }));
  });
  var bridge = [{ args: ['--session', '17', '--query-generation', '8'] }];
  assert.strictEqual(options.map('opencode', { sessionBridge: bridge }).ACP.mcpServers, bridge);
  assert.strictEqual(options.map('kiro', { settings: { kiroEngine: 'v3', kiroMode: 'vibe' }, sessionBridge: bridge }).KIRO.mcpServers, bridge);
});

test('invalid option/recovery implementations fail truthfully; unsupported providers do not gain features', function() {
  assert.deepEqual(options.map({ vendor: 'unknown' }, {}), {});
  assert.throws(function() { options.map({ vendor: 'independent', mapQueryOptions: true }, {}); }, /unavailable/);
  assert.throws(function() { options.map({ vendor: 'independent', mapQueryOptions: function() { return null; } }, {}); }, /Invalid/);
  var recovery = require('../lib/yoke/response-recovery').attachResponseRecovery({});
  assert.equal(recovery.begin({ vendor: 'unknown' }, {}), null);
  assert.equal(recovery.stopping({ vendor: 'unknown' }), false);
});

test('provider settings codecs retain legacy messages and validate typed patches without effects', function() {
  var settings = require('../lib/yoke/settings'), original = { codexSandbox: 'workspace-write' };
  var change = settings.change({ type: 'set_codex_sandbox', sandbox: 'read-only' }, original, alias('codex'));
  assert.deepEqual(change.patch, { codexSandbox: 'read-only' });
  assert.equal(change.messages[0].type, 'codex_config');
  assert.equal(original.codexSandbox, 'workspace-write');
  assert.throws(function() { settings.change({ type: 'set_codex_sandbox', sandbox: 'arbitrary' }, original); }, /Unsupported/);
  assert.equal(settings.change({ type: 'arbitrary' }, original), null);
});

test('context normalizers preserve zero and distinguish observed, estimated, unsupported and invalid', function() {
  assert.equal(usage.context({ totalTokens: 0, maxTokens: 1000 }, alias('claude')).context.usedTokens, 0);
  assert.equal(usage.context({ input_tokens: 123, contextWindow: 1000 }, alias('codex')).context.measurement, 'observed');
  assert.equal(usage.context({ input_tokens: 1001, contextWindow: 1000 }, alias('codex')).context.usedTokens, null);
  assert.equal(usage.context({ input_tokens: 123, contextWindow: 1000 }, 'unknown').context.measurement, 'unavailable');
  assert.equal(usage.turnContext({ usage: { input_tokens: 999999 } }).usedTokens, null);
  assert.equal(usage.turnContext({ lastStreamInputTokens: 123 }).measurement, 'estimated');
  assert.equal(usage.accounting({ input_tokens: 0, inputTokens: 0, cache_read_input_tokens: 12 }).inputTokens, 0);
});

test('legacy quota compatibility is projected by provider codec, not client identity checks', function() {
  var old = { type: 'rate_limit', status: 'rejected' };
  assert.equal(usage.clientEvent(old, alias('codex')).ignored, true);
  assert.equal(usage.clientEvent(old, alias('claude')).ignored, undefined);
  var current = { type: 'rate_limit_usage', source: 'account_snapshot', quotaWindows: [{ usedPercent: 0 }] };
  assert.deepEqual(usage.clientEvent(current, alias('codex')), current);
});

test('OAuth host/callback and known command validation are independent of registered vendor spelling', function() {
  var login = require('../lib/yoke/login-protocol');
  var url = 'https://auth.openai.com/authorize?state=one&code_challenge=two&redirect_uri=' + encodeURIComponent('http://127.0.0.1:1455/callback');
  assert.equal(login.loginUrl(url, alias('codex')), url);
  assert.equal(login.loginUrl(url, alias('claude')), null);
  assert.equal(login.loginUrl(url.replace('auth.openai.com', 'evil.example'), alias('codex')), null);
  assert.equal(login.command(alias('codex'), true), 'codex login');
  assert.throws(function() { login.command({ providerContract: { loginCommand: 'sh -c malicious; command' } }, false); }, /unavailable/);
});

test('authentication normalization uses actual provider grammar and rejects ordinary prose/paid results', function() {
  var auth = require('../lib/yoke/auth-events');
  var reply = 'Failed to authenticate: OAuth session expired and could not be refreshed.';
  assert.equal(auth.normalize({ yokeType: 'result', cost: 0 }, reply, alias('claude')).authenticationRequired, true);
  assert.equal(auth.normalize({ yokeType: 'result', cost: 1 }, reply, alias('claude')).authenticationRequired, false);
  assert.equal(auth.normalize({ yokeType: 'result', cost: 0 }, reply, 'unknown').authenticationRequired, false);
});

test('installation discovery calls declared resolvers, respects isolation, and fails closed without one', function() {
  var calls = 0, fakeRegistry = { independent: { osUserIsolation: true, resolveExecutable: function(options) { calls++; assert.equal(options.user, 'owner'); return '/known/provider'; } },
    unisolated: { osUserIsolation: false, resolveExecutable: function() { assert.fail('must not inspect daemon installation'); } }, unknown: {} };
  var discovered = require('../lib/yoke/discovery').installed({ user: 'owner', registry: fakeRegistry });
  assert.deepEqual(discovered, { independent: true, unisolated: false, unknown: false });
  assert.equal(calls, 1);
  var override = path.join(root, 'explicit-provider'); fs.writeFileSync(override, 'fixture'); fs.chmodSync(override, 0o700);
  assert.equal(require('../lib/yoke/discovery').pathResolver('uninstalled-provider', 'TEST_PROVIDER_PATH')({ env: { TEST_PROVIDER_PATH: override } }), override);
});

test('legacy terminal resumption and writer conflicts are described by implementations', function() {
  assert.equal(alias('claude').providerContract.supportsLegacyGuiResume({ cliSessionId: 'existing' }), true);
  assert.equal(registry.codex.supportsLegacyGuiResume, undefined);
  var errors = require('../lib/yoke/errors');
  assert.equal(errors.classify(alias('codex'), 'thread-store conflict: active writer').kind, 'session_writer_conflict');
  assert.equal(errors.classify('unknown', 'thread-store conflict: active writer'), null);
});

test('published capability descriptions exclude backend implementations', function() {
  var metadata = require('../lib/yoke/vendor-registry').publicInfo();
  assert.equal(metadata.claude.configuration.thinking.budget, true);
  assert.equal(metadata.codex.configuration.sandbox.state, 'codexSandbox');
  assert.equal(metadata.claude.browserLoginSupported, true);
  assert.equal(metadata.kiro.browserLoginSupported, false);
  assert.equal(metadata.claude.recoveryFactory, undefined);
  assert.equal(metadata.claude.notificationHooks, undefined);
  assert.equal(metadata.codex.settings, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), metadata);
});

test('an independent adapter can implement confirmed-termination recovery without a vendor-name gate', async function() {
  var scheduled = new Map(), timer = 0, restarted = [], records = [], release;
  var session = { localId: 9, vendor: 'independent', ownerId: 'owner', isProcessing: true };
  var sessions = new Map([[9, session]]);
  session.queryInstance = { stopAndWait: function() { return new Promise(function(resolve) { release = resolve; }); } };
  var service = require('../lib/yoke/response-recovery').attachResponseRecovery({ getProvider: function() { return alias('claude'); }, sessions: sessions,
    setTimeout: function(fn, ms) { scheduled.set(++timer, { fn: fn, ms: ms }); return timer; }, clearTimeout: function(id) { scheduled.delete(id); }, waitMs: 100, stopMs: 10,
    changed: function() {}, record: function(target, event) { records.push(event); }, send: function() {}, broadcast: function() {},
    restart: function(target, payload) { restarted.push(payload); } });
  var payload = { text: 'Exact owner request', images: [{ data: 'exact' }] };
  service.begin(session, payload);
  var deadline = Array.from(scheduled.values()).find(function(entry) { return entry.ms === 100; });
  assert.ok(deadline);
  var waiting = deadline.fn();
  assert.equal(service.stopping(session), true);
  assert.equal(restarted.length, 0);
  release(); await waiting;
  for (var i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(restarted.length, 1);
  assert.deepEqual(restarted[0], payload);
  assert.ok(records.some(function(event) { return event.type === 'info' && /stopped/.test(event.text); }));
  service.dispose();
});

test('invalid mode declarations and context projections cannot fabricate support or measurements', function() {
  var modes = require('../lib/session-permission-mode');
  assert.equal(modes.capabilities({ vendor: 'independent' }, null, { queryContract: { permissionModes: 'auto' } }).auto, false);
  assert.throws(function() { require('../lib/yoke/user-input').selectMode({}, 'unsupported'); }, /Unsupported/);
  var bad = { providerContract: { normalizeContext: function() { return { usedTokens: NaN, windowTokens: 1000, measurement: 'observed' }; } } };
  assert.equal(usage.context({}, bad).context.usedTokens, null);
  assert.equal(usage.context({}, bad).context.measurement, 'unavailable');
  var inflated = usage.clientEvent({ type: 'result', modelUsage: { model: { contextSnapshot: { valid: true, inputTokens: 1001, contextWindow: 1000 } } } }, alias('codex'));
  assert.equal(inflated.context.usedTokens, null);
  assert.equal(inflated.context.measurement, 'unavailable');
});

test('provider replacement during confirmed termination cannot replay the uncertain old attempt', async function() {
  var provider = alias('claude'), timer, release, restarts = 0;
  var session = { localId: 11, vendor: 'independent', ownerId: 'owner' };
  session.queryInstance = { stopAndWait: function() { return new Promise(function(resolve) { release = resolve; }); } };
  var recovery = require('../lib/yoke/response-recovery').attachResponseRecovery({ getProvider: function() { return provider; }, sessions: new Map([[11, session]]),
    setTimeout: function(fn, ms) { if (ms === 100) timer = fn; return ms; }, clearTimeout: function() {}, waitMs: 100, stopMs: 10,
    changed: function() {}, record: function() {}, send: function() {}, broadcast: function() {}, restart: function() { restarts++; } });
  recovery.begin(session, { text: 'Do not replay' }); timer();
  provider = { vendor: 'unsupported' };
  release();
  for (var i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(restarts, 0);
  recovery.cancel(session); recovery.dispose();
});

test('guard rejects forked legacy and native SDK workers before any process starts', function() {
  var cp = require('node:child_process');
  ['../lib/sdk-worker.js', '../lib/yoke/adapters/claude-worker.js', '../lib/yoke/kiro-acp-server.js'].forEach(function(script) {
    assert.throws(function() { cp.fork(script); }, /forbidden/);
  });
});

test('provider model descriptions preserve beta compatibility without host model-name parsing', function() {
  var models = require('../lib/yoke/providers/claude-model-descriptions').list(['claude-sonnet-4-6', { value: 'claude-opus-4-6', description: 'SDK description' }]);
  assert.equal(models[0].supportsBetaContext, true);
  assert.match(models[0].description, /best combination of speed and intelligence/);
  assert.equal(models[1].supportsBetaContext, false);
  assert.equal(models[1].description, 'SDK description');
});
