// Real app/HTTP authentication/WS/project services, with isolated storage and
// provider transports fenced before any product imports. No fixture Git commits.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-appearance-pane-'));
os.homedir = function () { return root; };
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CLAY_CONFIG = path.join(root, '.clay/daemon.json');
process.env.CODEX_HOME = path.join(root, '.codex');
process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
process.env.CLAY_DEV = '';
fs.mkdirSync(process.env.CLAY_HOME, { recursive: true });
// Two custom palettes (one per variant) so live sync can be checked with non-default colours.
fs.mkdirSync(path.join(process.env.CLAY_HOME, 'themes'), { recursive: true });
function palette(name, variant, base00, base06) {
  return JSON.stringify({ name: name, variant: variant, base00: base00, base01: '1A2A3A', base02: '2A3A4A', base03: '5A6A7A', base04: '8A9AAA', base05: 'AABBCC', base06: base06, base07: 'FFFFFF',
    base08: 'FF5555', base09: '5555FF', base0A: 'FFCC00', base0B: '22CC88', base0C: '22CCCC', base0D: '5599FF', base0E: 'CC77FF', base0F: 'CC9966' });
}
fs.writeFileSync(path.join(process.env.CLAY_HOME, 'themes', 'fixture-night.json'), palette('Fixture Night', 'dark', '102030', 'EEEEFF'));
fs.writeFileSync(path.join(process.env.CLAY_HOME, 'themes', 'fixture-day.json'), palette('Fixture Day', 'light', 'FFF4E0', '221100'));
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
var splitStore, splitModule = require('../../lib/session-split-groups'), attachSplit = splitModule.attachSplitGroups;
splitModule.attachSplitGroups = function (ctx) { var attached = attachSplit(ctx); splitStore = attached.store; return attached; };
var viewStore, viewModule = require('../../lib/project-split-views'), attachViews = viewModule.attachProjectSplitViews;
viewModule.attachProjectSplitViews = function (ctx) { var attached = attachViews(ctx); viewStore = attached.store; return attached; };
var relay = require('../../lib/server').createServer({ port: 0, onGetProjectAccess: function () { return access; } });
var cwd = path.join(root, 'reuse'); fs.mkdirSync(cwd); cwd = fs.realpathSync(cwd);
fs.writeFileSync(path.join(cwd, 'expansion.txt'), 'Isolated file pane expansion fixture.\n');
relay.addProject(cwd, 'reuse', 'Pane reuse fixture', null, 'owner', null, { projectKnowledgeId: 'pane-reuse-fixture' });
var project;
relay.forEachProject(function (value, slug) { if (slug === 'reuse') project = value; });
var sm = project.getSessionManager(), provenance = require('../../lib/session-provenance');
function create(title) {
  var session = sm.createSessionRaw({ ownerId: 'owner', vendor: 'codex', model: 'fixture', effort: 'medium' });
  session.title = title; session.history = [{ type: 'delta', text: 'Saved ' + title }, { type: 'done' }];
  sm.saveSessionFile(session); return session;
}
var driver = create('Driver'), worker = create('Worker');
provenance.markWorker(driver, worker, sm.sessions); sm.saveSessionFile(worker);
var made = splitStore.createOwned('owner', { members: [driver.localId, worker.localId], pair: { driverId: driver.localId, workerId: worker.localId } });
if (!made.ok) throw new Error(JSON.stringify(made));
// Workers live in Driver pills; two visible panes are two ordinary sessions.
var companion = create('Companion');
var origins = [driver.sessionOriginId, companion.sessionOriginId];
var view = viewStore.create('owner', null, { name: 'Appearance view', layout: 'columns', expectedRevision: 0,
  sessionOrigins: origins, activeSessionOriginId: driver.sessionOriginId,
  tree: require('../../lib/split-view-layout').createPreset(origins, 'columns') },
  origins.map(function (origin) { return { originId: origin, ownerId: 'owner', linuxUser: null }; }));
if (!view.ok) throw new Error(JSON.stringify(view));
var standalone = create('Standalone');
var original = relay.server.listeners('request'); relay.server.removeAllListeners('request');
relay.server.on('request', function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture/login') {
    res.writeHead(302, { 'Set-Cookie': 'relay_auth_user=pane-fixture-token; Path=/; HttpOnly; SameSite=Strict', Location: '/p/reuse/' }); res.end(); return;
  }
  if (url.pathname === '/fixture/info') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ driverId: driver.localId, workerId: worker.localId, standaloneId: standalone.localId })); return; }
  if (url.pathname === '/fixture/switch' && req.method === 'POST') {
    var id = Number(url.searchParams.get('id'));
    project.clients.forEach(function (ws) { if (!ws._clayPane && ws._clayUser && ws._clayUser.id === 'owner') project.handleMessage(ws, { type: 'switch_session', id: id }); });
    res.end('{}'); return;
  }
  original.forEach(function (handler) { handler(req, res); });
});
async function stop() { await relay.destroyAll(); relay.server.close(); fs.rmSync(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
relay.server.listen(0, '127.0.0.1', function () {
  var info = { port: relay.server.address().port, root: root };
  console.log(JSON.stringify(info)); if (process.send) process.send(info);
});
