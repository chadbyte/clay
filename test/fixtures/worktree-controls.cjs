// Disposable production-server fixture. Existing commit objects only; providers disabled.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-worktree-ui-')));
process.env.HOME = root; process.env.CLAY_HOME = path.join(root, '.clay'); process.env.CLAY_CONFIG = path.join(root, '.clay/daemon.json');
delete process.env.SUDO_USER; delete process.env.SUDO_HOME;
var source = path.resolve(__dirname, '../..');
function git(cwd, args) { return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: 'pipe' }).trim(); }
var common = path.resolve(source, git(source, ['rev-parse', '--git-common-dir'])), head = git(source, ['rev-parse', 'HEAD']);
var repo = path.join(root, 'repository'), target = path.join(root, 'review-feature'); fs.mkdirSync(repo);
git(repo, ['init', '--quiet']); fs.writeFileSync(path.join(repo, '.git/objects/info/alternates'), path.join(common, 'objects') + '\n');
git(repo, ['update-ref', 'refs/heads/main', head]); git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
git(repo, ['sparse-checkout', 'init', '--cone']); git(repo, ['sparse-checkout', 'set', 'fixture-no-files']); git(repo, ['reset', '--hard', 'HEAD']);
git(repo, ['worktree', 'add', '--quiet', '-b', 'review-feature', target]);
// Guard every later process call against accidental provider or commit execution.
['execFile', 'execFileSync', 'spawn', 'spawnSync'].forEach(function (name) {
  var original = cp[name]; cp[name] = function (command, args) {
    if (/^(claude|codex|copilot|opencode)(?:\.exe)?$/.test(path.basename(String(command)))) throw new Error('Provider processes disabled.');
    if (command === 'git' && (args || []).some(function (arg) { return ['commit', 'commit-tree', 'push', 'pull', 'fetch'].indexOf(arg) >= 0; })) throw new Error('Commits and remote Git disabled.');
    return original.apply(cp, arguments);
  };
});
var cfgModule = require('../../lib/config'); cfgModule.ensureConfigDir();
var users = require('../../lib/users');
users.saveUsers({ multiUser: true, users: [
  { id: 'owner', username: 'owner', displayName: 'Fixture Owner', role: 'admin', pinHash: 'fixture-only' },
  { id: 'foreign', username: 'foreign', displayName: 'Other Owner', role: 'admin', pinHash: 'fixture-only' },
  { id: 'shared-admin', username: 'shared-admin', role: 'admin', pinHash: 'fixture-only' },
  { id: 'guest', username: 'guest', role: 'user', pinHash: 'fixture-only' },
  { id: 'editor', username: 'editor', role: 'user', pinHash: 'fixture-only', permissions: { projectSettings: true } },
], invites: [] });
fs.writeFileSync(path.join(process.env.CLAY_HOME, 'auth-tokens.json'), JSON.stringify({ 'fixture-owner-token': 'owner', 'fixture-foreign-token': 'foreign', 'fixture-editor-token': 'editor', 'fixture-shared-admin-token': 'shared-admin', 'fixture-guest-token': 'guest' }));
var yoke = require('../../lib/yoke'), createAdapters = yoke.createAdapters;
yoke.createAdapters = function (options) {
  var state = createAdapters(options);
  Object.keys(state.adapters).forEach(function (vendor) {
    state.adapters[vendor].init = function () { return Promise.resolve({ models: [], slashCommands: [] }); };
    state.adapters[vendor].createQuery = function () { throw new Error('Provider execution disabled.'); };
  }); return state;
};
yoke.completeOnce = function () { return Promise.reject(new Error('Provider completion disabled.')); };
require('../../lib/updater').fetchVersion = function () { return Promise.resolve(null); };
require('../../lib/updater').fetchLatestVersion = function () { return Promise.resolve(null); };
require('../../lib/claude-hook-installer').installNotificationHook = function () { return { installed: [], errors: [] }; };
require('../../lib/claude-hook-installer').installAllowList = function () { return { installed: [], errors: [] }; };
var scans = require('../../lib/daemon-projects');
var cfg = { projects: [{ slug: 'repository', path: repo, title: 'Worktree review', ownerId: 'owner', visibility: 'private', allowedUsers: ['editor', 'shared-admin', 'guest'], icon: '🐳', projectKnowledgeId: 'pk_fixture' }] };
var foreignPath = path.join(root, 'foreign-private'); fs.mkdirSync(foreignPath);
cfg.projects.push({ slug: 'foreign-private', path: foreignPath, ownerId: 'foreign', visibility: 'private', projectKnowledgeId: 'pk_foreign' });
var relay, service = require('../../lib/daemon-worktree-controls').attachWorktreeControls({
  getConfig: function () { return cfg; }, setConfig: function (next) { cfg = next; }, saveConfig: cfgModule.saveConfig,
  getRelay: function () { return relay; }, users: users, findUser: users.findUserById, osIdentity: function () { return null; }, syncRecent: cfgModule.syncClayrc, storageDir: cfgModule.CONFIG_DIR,
  unregister: scans.unregisterWorktreeSlug,
});
relay = require('../../lib/server').createServer({ port: 0, worktreeControls: service,
  onGetProjectAccess: service.getAccess,
  onSetProjectIcon: service.setIcon,
  onRemoveProject: function () { return { ok: false, error: 'Use worktree controls.' }; },
});
relay.addProject(repo, 'repository', 'Worktree review', '🐳', 'owner', null, { projectKnowledgeId: 'pk_fixture' });
relay.addProject(foreignPath, 'foreign-private', 'Foreign private', null, 'foreign', null, { projectKnowledgeId: 'pk_foreign' });
scans.scanAndRegisterWorktrees(relay, repo, 'repository', '🐳', 'owner', 'pk_fixture', null, cfg, function () { return cfg; });
relay.forEachProject(function (project) {
  var sm = project.getSessionManager(), session = sm.createSessionRaw({ ownerId: 'owner', vendor: 'claude' });
  session.title = 'Disposable worktree review'; sm.sendAndRecord(session, { type: 'delta', text: 'This isolated preview uses a disposable Git worktree. Providers are disabled.' }); sm.sendAndRecord(session, { type: 'done' }); sm.saveSessionFile(session);
});
var original = relay.server.listeners('request'); relay.server.removeAllListeners('request');
relay.server.on('request', function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture/login') {
    var foreign = url.searchParams.get('user') === 'foreign';
    res.writeHead(302, { 'Set-Cookie': 'relay_auth_user=fixture-' + (foreign ? 'foreign' : 'owner') + '-token; Path=/; HttpOnly; SameSite=Strict', Location: '/p/repository/' }); res.end(); return;
  }
  if (url.pathname === '/fixture/state' && (req.headers.cookie || '').includes('relay_auth_user=fixture-owner-token')) {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ config: cfg, exists: fs.existsSync(target), branch: git(repo, ['for-each-ref', '--format=%(objectname)', 'refs/heads/review-feature']), projects: relay.getProjects() })); return;
  }
  if (process.env.CLAY_WORKTREE_SOURCE === '1' && /\/pane-assets\/app-[^/]+\.js$/.test(url.pathname)) {
    res.setHeader('Content-Type', 'text/javascript'); res.end('import ' + JSON.stringify(url.pathname.replace(/pane-assets\/[^/]+$/, 'app.js')) + ';'); return;
  }
  if (/^\/p\/repository(?:--review-feature)?\/$/.test(url.pathname)) {
    var end = res.end, write = res.write, chunks = [];
    res.write = function (chunk) { if (chunk) chunks.push(Buffer.from(chunk)); return true; };
    res.end = function (chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      var html = Buffer.concat(chunks).toString();
      html = html.replace('</body>', '<button id="fixture-worktree-menu" style="position:fixed;right:12px;bottom:12px;z-index:9999">Fixture worktree menu</button><script>document.getElementById("fixture-worktree-menu").onclick = function (event) { event.stopPropagation(); document.querySelector(\'a[href="/p/repository--review-feature/"]\').dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true})); };</script></body>');
      res.write = write; return end.call(res, html);
    };
  }
  original.forEach(function (handler) { handler(req, res); });
});
var closing = false;
function close() {
  if (closing) return; closing = true; require('../../lib/daemon-sync').daemonSync.stop();
  Promise.resolve(relay.destroyAll()).then(function () { relay.server.close(function () { fs.rmSync(root, { recursive: true, force: true }); process.exit(0); }); });
}
process.on('SIGTERM', close); process.on('SIGINT', close); process.on('message', function (message) { if (message === 'close') close(); });
relay.server.listen(Number(process.argv[2] || 0), '127.0.0.1', function () {
  var info = { port: relay.server.address().port, root: root, source: process.env.CLAY_WORKTREE_SOURCE === '1' };
  console.log(JSON.stringify(info)); if (process.send) process.send(info);
});
