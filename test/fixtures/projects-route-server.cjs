// Real app/HTTP authentication/WS/project services, with isolated storage and
// provider transports fenced before any product imports. No fixture Git commits.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-projects-route-'));
os.homedir = function () { return root; };
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CLAY_CONFIG = path.join(root, '.clay/daemon.json');
process.env.CODEX_HOME = path.join(root, '.codex');
process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
process.env.CLAY_DEV = '';
fs.mkdirSync(process.env.CLAY_HOME, { recursive: true });
['execFile', 'execFileSync', 'spawn', 'spawnSync'].forEach(function (name) {
  var original = cp[name];
  cp[name] = function (command, args) {
    if (/^(claude|codex|copilot|opencode)$/.test(path.basename(String(command)))) throw new Error('Provider execution is forbidden in this fixture');
    if (command === 'git' && (args || []).some(function (arg) { return ['commit', 'commit-tree', 'push', 'fetch', 'pull'].indexOf(arg) >= 0; })) throw new Error('Fixture commits and remote Git are forbidden');
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
var users = require('../../lib/users');
users.saveUsers({ multiUser: true, users: [{ id: 'owner', username: 'pane-owner', role: 'admin', pinHash: 'fixture-only' },
  { id: 'replacement-owner', username: 'replacement-owner', role: 'member', pinHash: 'fixture-only' }], invites: [] });
fs.writeFileSync(path.join(process.env.CLAY_HOME, 'auth-tokens.json'), JSON.stringify({ 'pane-fixture-token': 'owner', 'pane-replacement-token': 'replacement-owner' }));
var access = { slug: 'reuse', ownerId: 'owner', visibility: 'private', allowedUsers: [] };
var relay = require('../../lib/server').createServer({ port: 0, onGetProjectAccess: function () { return access; } });
// "zero" serves an owner with no projects; "populated" adds one ordinary project.
if (process.argv[2] === 'populated') {
  var cwd = path.join(root, 'reuse'); fs.mkdirSync(cwd);
  relay.addProject(cwd, 'reuse', 'Route fixture', null, 'owner', null, { projectKnowledgeId: 'projects-route-fixture' });
}
async function stop() { await relay.destroyAll(); relay.server.close(); fs.rmSync(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
relay.server.listen(0, '127.0.0.1', function () {
  var info = { port: relay.server.address().port, root: root };
  console.log(JSON.stringify(info)); if (process.send) process.send(info);
});
