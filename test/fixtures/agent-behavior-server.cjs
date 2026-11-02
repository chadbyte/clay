// Isolated preview of Personal > Agent behavior. Boots the REAL Clay server code
// in a throwaway HOME/CLAY_HOME/CLAY_CONFIG/CODEX_HOME (mkdtemp), bound to
// 127.0.0.1 only. Providers, accounts, updater and Git remotes are fenced off
// before any product module loads, so nothing real is read, written or called.
//
// Safe invocation (use Node 22):
//   PATH=/Users/chad/.nvm/versions/node/v22.22.1/bin:$PATH \
//     node test/fixtures/agent-behavior-server.cjs [port] [--multi] [--fail]
//
//   port     optional TCP port (default 0 = pick a free one)
//   --multi  two fake accounts (alice, bob) instead of solo mode; sign in with
//            /__fixture/alice or /__fixture/bob to check owner isolation
//   --fail   PUT /api/user/agent-behavior answers 500 until /__fixture/recover
//            is requested (checks the error and Retry path by hand); a running
//            server can also be switched with /__fixture/fail
//
// Solo mode (default) has no accounts. The script prints the URL to open; stop
// it with Ctrl+C and the temporary directory is removed.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
var args = process.argv.slice(2);
var multi = args.indexOf('--multi') >= 0;
var failSaves = args.indexOf('--fail') >= 0;
var port = Number(args.filter(function (arg) { return /^\d+$/.test(arg); })[0] || 0);
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-agent-behavior-'));
os.homedir = function () { return root; };
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CLAY_CONFIG = path.join(root, '.clay/daemon.json');
process.env.CODEX_HOME = path.join(root, '.codex');
process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
process.env.CLAY_DEV = '';
fs.mkdirSync(process.env.CLAY_HOME, { recursive: true });
['execFile', 'execFileSync', 'spawn', 'spawnSync'].forEach(function (name) {
  var original = cp[name];
  cp[name] = function (command, argv) {
    if (/^(claude|codex|copilot|opencode)$/.test(path.basename(String(command)))) throw new Error('Provider execution is forbidden in this fixture');
    if (command === 'git' && (argv || []).some(function (arg) { return ['commit', 'commit-tree', 'push', 'fetch', 'pull'].indexOf(arg) >= 0; })) throw new Error('Fixture commits and remote Git are forbidden');
    return original.apply(cp, arguments);
  };
});
var yoke = require('../../lib/yoke');
yoke.createAdapters = function () {
  var adapters = {};
  ['claude', 'codex'].forEach(function (vendor) {
    adapters[vendor] = { vendor: vendor,
      init: async function () { return { models: [{ value: 'fixture', displayName: 'Fixture' }], slashCommands: [], capabilities: {} }; },
      createToolServer: function (value) { return value; }, shutdown: function () {},
      createQuery: function () { throw new Error('Provider execution is forbidden'); } };
  });
  return { adapters: adapters, auth: { claude: true, codex: true } };
};
yoke.completeOnce = function () { return Promise.reject(new Error('Live completion forbidden')); };
require('../../lib/updater').fetchVersion = function () { return Promise.resolve(null); };
require('../../lib/updater').fetchLatestVersion = function () { return Promise.resolve(null); };
require('../../lib/claude-hook-installer').installNotificationHook = function () { return { installed: [], errors: [] }; };
require('../../lib/claude-hook-installer').installAllowList = function () { return { installed: [], errors: [] }; };

var schema = require('../../lib/agent-behavior-schema');
var configModule = require('../../lib/config');
var config = { port: 0, hostname: 'agent-behavior-fixture', platform: 'linux' };
configModule.saveConfig(config);
if (multi) {
  require('../../lib/users').saveUsers({ multiUser: true, invites: [], users: [
    { id: 'alice', username: 'alice', displayName: 'Alice', role: 'admin', pinHash: 'fixture-only' },
    { id: 'bob', username: 'bob', displayName: 'Bob', role: 'user', pinHash: 'fixture-only' }] });
  fs.writeFileSync(path.join(process.env.CLAY_HOME, 'auth-tokens.json'), JSON.stringify({ 'ab-alice': 'alice', 'ab-bob': 'bob' }));
}
var opts = {
  port: port,
  onGetProjectAccess: function (slug) { return { slug: slug, ownerId: multi ? 'alice' : 'default', visibility: 'public', allowedUsers: [] }; },
};
if (!multi) {
  opts.onGetDaemonConfig = function () { return config; };
  opts.onUpdateAgentBehavior = function (changes) {
    var checked = schema.validateChanges(changes);
    if (checked.error) return { error: checked.error };
    var next = Object.assign({}, schema.explicit(config.agentBehavior), checked.value);
    config.agentBehavior = next; configModule.saveConfig(config);
    return { ok: true, policy: schema.normalize(next) };
  };
}
var relay = require('../../lib/server').createServer(opts);
var projectDir = path.join(root, 'sample'); fs.mkdirSync(projectDir);
relay.addProject(projectDir, 'sample', 'Sample', null, multi ? 'alice' : undefined);
var handlers = relay.server.listeners('request'); relay.server.removeAllListeners('request');
relay.server.on('request', function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  var who = /^\/__fixture\/(alice|bob)$/.exec(url.pathname);
  if (who) { res.writeHead(302, { 'Set-Cookie': 'relay_auth_user=ab-' + who[1] + '; Path=/; HttpOnly; SameSite=Strict', Location: '/p/sample/' }); res.end(); return; }
  if (url.pathname === '/__fixture/recover') { failSaves = false; res.end('ok'); return; }
  if (url.pathname === '/__fixture/fail') { failSaves = true; res.end('ok'); return; }
  if (url.pathname === '/__fixture/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ agentBehavior: config.agentBehavior || null, users: multi ? require('../../lib/users').loadUsers().users.map(function (u) { return { id: u.id, agentBehavior: u.agentBehavior || null }; }) : null })); return; }
  if (url.pathname === '/api/user/agent-behavior' && req.method === 'PUT' && failSaves) {
    res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not save agent behavior' })); return;
  }
  handlers.forEach(function (handler) { handler(req, res); });
});
async function stop() { try { await relay.destroyAll(); } catch (error) { /* shutting down */ } relay.server.close(); fs.rmSync(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
process.on('message', function (message) { if (message === 'close') stop(); });
relay.server.listen(port, '127.0.0.1', function () {
  var base = 'http://127.0.0.1:' + relay.server.address().port;
  var info = { port: relay.server.address().port, root: root, multi: multi, url: multi ? base + '/__fixture/alice' : base + '/p/sample/' };
  console.log('Agent behavior preview: ' + info.url + (multi ? ' (also ' + base + '/__fixture/bob)' : ''));
  if (process.send) process.send(info);
});
