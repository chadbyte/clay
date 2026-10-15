// Isolate storage and forbid provider processes before any production import.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoke-executable-'));
process.env.HOME = root; process.env.CLAY_HOME = path.join(root, '.clay'); process.env.CODEX_HOME = path.join(root, '.codex');
require('./helpers/yoke-no-provider-processes.cjs');
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process');
var discovery = require('../lib/yoke/discovery');
var registry = require('../lib/yoke/vendor-registry').VENDOR_REGISTRY;
var createAdapter = require('../lib/yoke/adapters/antigravity').createAntigravityAdapter;
var native = path.join(root, 'agy'); fs.writeFileSync(native, 'fixture only'); fs.chmodSync(native, 0o700);
var noexec = path.join(root, 'not-executable'); fs.writeFileSync(noexec, 'fixture only'); fs.chmodSync(noexec, 0o600);
var script = path.join(root, 'cli.js'); fs.writeFileSync(script, '// fixture only'); fs.chmodSync(script, 0o600);
test.after(function() { fs.rmSync(root, { recursive: true, force: true }); });
function withWhich(t) {
  var original = cp.execFileSync, calls = [];
  cp.execFileSync = function(command, args) {
    assert.ok(command === 'which' || command === 'where', 'only discovery is permitted');
    calls.push(args); return native + '\n';
  };
  t.after(function() { cp.execFileSync = original; });
  return calls;
}
async function ready(env, selected) {
  var paths = [];
  var adapter = createAdapter({ cwd: root, _fetchModels: async function(binary) { paths.push(binary); return ['fixture-model']; } });
  assert.equal(registry.antigravity.resolveExecutable({ env: env }), selected);
  assert.deepEqual((await adapter.init({ env: env })).models, ['fixture-model']);
  assert.deepEqual(paths, [selected]);
  await adapter.shutdown();
}
test('Antigravity production discovery and init use exactly the same valid override and PATH resolver', async function(t) {
  var calls = withWhich(t);
  assert.equal(registry.antigravity.resolveExecutable, require('../lib/yoke/providers/antigravity-executable').resolve);
  await ready({ ANTIGRAVITY_CLI_PATH: native }, native);
  assert.equal(calls.length, 0, 'valid override wins without consulting PATH');
  await ready({}, native);
  assert.equal(calls.length, 2, 'discovery and init each select the same PATH result');
});
test('missing, empty, nonexecutable and directory explicit overrides refuse discovery and init without fallback', async function(t) {
  var calls = withWhich(t);
  for (var invalid of [path.join(root, 'missing'), '', noexec, root]) {
    var env = { ANTIGRAVITY_CLI_PATH: invalid };
    assert.throws(function() { registry.antigravity.resolveExecutable({ env: env }); }, /Invalid explicit/);
    assert.equal(discovery.installed({ env: env, registry: { antigravity: registry.antigravity } }).antigravity, false);
    var adapter = createAdapter({ cwd: root, _fetchModels: function() { assert.fail('invalid executable must not reach model fetch'); } });
    await assert.rejects(adapter.init({ env: env }), /Invalid explicit/);
  }
  assert.equal(calls.length, 0, 'an explicit refusal never falls back to PATH');
});
test('Antigravity mapped-user refusal precedes daemon overrides and model fetching', async function(t) {
  var calls = withWhich(t), env = { ANTIGRAVITY_CLI_PATH: native };
  assert.equal(registry.antigravity.resolveExecutable({ user: 'owner', env: env }), null);
  assert.equal(discovery.installed({ user: 'owner', env: env, registry: { antigravity: registry.antigravity } }).antigravity, false);
  await assert.rejects(createAdapter({ _fetchModels: function() { assert.fail('no mapped execution'); } }).init({ linuxUser: 'owner', env: env }), /mapped OS-user/);
  assert.equal(calls.length, 0);
});
test('shared runtime wrapper never adds its own PATH fallback or rejects a readable JS entry', function(t) {
  var calls = withWhich(t);
  assert.equal(discovery.bundledResolver(function() { return null; }, 'agy')(), null);
  assert.throws(function() { discovery.bundledResolver(function() { throw new Error('runtime unavailable'); }, 'agy')(); }, /runtime unavailable/);
  assert.equal(discovery.bundledResolver(function() { return script; }, 'claude')(), script);
  assert.equal(discovery.validEntry(script, true), true);
  assert.equal(discovery.validEntry(script, false), false);
  assert.equal(calls.length, 0);
});
test('registered Claude, Codex, Kiro and ACP runtime resolvers share explicit refusal with discovery', function(t) {
  var cases = [
    ['CLAUDE_CODE_PATH', registry.claude, require('../lib/yoke/providers/claude-executable').resolve, true],
    ['CLAY_CODEX_PATH', registry.codex, require('../lib/yoke/codex-app-server').findCodexPath, false],
    ['KIRO_CLI_PATH', registry.kiro, require('../lib/yoke/kiro-acp-server').findKiroPath, false],
    ['OPENCODE_CLI_PATH', registry.opencode, function() { var profiles = require('../lib/yoke/acp-agent-profiles'); return profiles.findAcpAgentPath(profiles.getAcpAgentProfile('opencode')); }, false],
  ];
  cases.forEach(function(row) {
    var name = row[0], previous = process.env[name];
    t.after(function() { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
    for (var invalid of [path.join(root, 'missing'), '', noexec, root]) {
      process.env[name] = invalid;
      assert.throws(row[2], /Invalid explicit/, name);
      assert.throws(function() { row[1].resolveExecutable({}); }, /Invalid explicit/, name);
    }
    process.env[name] = native;
    assert.equal(row[2](), native); assert.equal(row[1].resolveExecutable({}), native);
    process.env[name] = script;
    if (row[3]) { assert.equal(row[2](), script); assert.equal(row[1].resolveExecutable({}), script); }
    else assert.throws(row[2], /Invalid explicit/);
  });
});
test('fork history uses an actual provider reader independently of its name and unsupported readers refuse', async function() {
  var read = require('../lib/yoke/session-history').read;
  var expected = [{ type: 'user_message', text: 'fixture' }], args;
  var provider = { vendor: 'independent-engine', providerContract: { readSessionHistory: function() { args = Array.from(arguments); return Promise.resolve(expected); } } };
  assert.equal(await read(provider, root, '/project', 'fork-id'), expected);
  assert.deepEqual(args, [root, '/project', 'fork-id']);
  assert.throws(function() { read({ vendor: 'unsupported' }, root, '/project', 'id'); }, /unavailable/);
  assert.throws(function() { read({ providerContract: { readSessionHistory: true } }, root, '/project', 'id'); }, /unavailable/);
});

test('provider quota aliases normalize before the shared product processor consumes them', function() {
  var normalize = require('../lib/yoke/adapters/claude').contractTestKit.normalizeEvent;
  assert.equal(normalize({ type: 'rate_limit_event', rate_limit_info: { overageInUse: true } }).rateLimitInfo.isUsingOverage, true);
  assert.equal(normalize({ type: 'rate_limit_event', rate_limit_info: { isUsingOverage: true } }).rateLimitInfo.isUsingOverage, true);
  assert.equal(normalize({ type: 'rate_limit_event', rate_limit_info: {} }).rateLimitInfo.isUsingOverage, false);
});
