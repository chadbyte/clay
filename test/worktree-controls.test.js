var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var cp = require('node:child_process');
// Isolate all storage before imports; use existing commit objects, never fixture commits.
var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-worktree-controls-')));
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, 'storage');
delete process.env.SUDO_USER; delete process.env.SUDO_HOME;
var serviceModule = require('../lib/daemon-worktree-controls');
var context = require('../lib/project-log-context');
var preferences = require('../lib/worktree-preferences');
var configModule = require('../lib/config');
var accessModule = require('../lib/daemon-project-access');
var identities = require('../lib/worktree-identity');
var lifecycle = require('../lib/project-lifecycle-runtime');
var scan = require('../lib/daemon-projects');
var sync = require('../lib/daemon-sync').daemonSync;
var source = path.resolve(__dirname, '..');
var common = cp.execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: source, encoding: 'utf8' }).trim();
var head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
function git(cwd, args) { return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: 'pipe' }).trim(); }
function fixture() {
  var base = fs.mkdtempSync(path.join(root, 'case-')), repo = path.join(base, 'repo'), target = path.join(base, 'feature'); fs.mkdirSync(repo);
  git(repo, ['init', '--quiet']);
  fs.writeFileSync(path.join(repo, '.git/objects/info/alternates'), path.resolve(source, common, 'objects') + '\n');
  git(repo, ['update-ref', 'refs/heads/main', head]); git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(repo, ['sparse-checkout', 'init', '--cone']); git(repo, ['sparse-checkout', 'set', 'fixture-no-files']); git(repo, ['reset', '--hard', 'HEAD']);
  git(repo, ['worktree', 'add', '--quiet', '-b', 'feature', target]);
  var cfg = { projects: [{ slug: 'repo', path: repo, projectKnowledgeId: 'pk_test', ownerId: 'owner', visibility: 'private' }] };
  var marker = context.resolveWorktreeContext(target, 'pk_test', { branch: 'feature' });
  var statuses = { repo: { slug: 'repo', path: repo, projectKnowledgeId: 'pk_test' }, 'repo--feature': Object.assign({ slug: 'repo--feature', path: target, projectKnowledgeId: 'pk_test', isWorktree: true }, marker) };
  var mapped = null, effects = [];
  var projects = new Map(), failSave = false, stop = function () { return true; }, saves = 0, broadcasts = 0;
  Object.keys(statuses).forEach(function (slug) { projects.set(slug, { getStatus: function () { return statuses[slug]; }, destroy: function () { return stop(); } }); });
  var runtime = lifecycle.attachLifecycleRuntime({ projects: projects });
  var relay = {
    forEachProject: function (fn) { projects.forEach(fn); },
    getProjectLifecycleTargets: runtime.targets, closeProjectLifecycle: runtime.close,
    getProjects: function () { return Array.from(projects.values()).map(function (p) { return p.getStatus(); }); },
    setProjectIcon: function (slug, icon) { effects.push('publish'); statuses[slug].icon = icon; return true; },
    broadcastAll: function () { broadcasts++; },
    addProject: function (value, slug, name, icon, owner, meta) { statuses[slug] = Object.assign({ slug: slug, path: value, icon: icon, isWorktree: true }, meta); projects.set(slug, { getStatus: function () { return statuses[slug]; }, destroy: function () { return true; } }); return true; },
    removeProject: function (slug) { projects.delete(slug); },
  };
  var users = { owner: { id: 'owner', role: 'admin' }, foreign: { id: 'foreign', role: 'admin' }, admin: { id: 'admin', role: 'admin' } };
  var permissions = require('../lib/users-permissions').attachPermissions({ findUserById: function (id) { return users[id]; } });
  function attach() { return serviceModule.attachWorktreeControls({
    getConfig: function () { return cfg; }, setConfig: function (next) { cfg = next; }, saveConfig: function (next) { if (failSave) throw new Error('disk full'); fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify(next)); effects.push('save'); saves++; },
    getRelay: function () { return relay; }, users: { isMultiUser: function () { return true; }, getEffectivePermissions: permissions.getEffectivePermissions, canAccessProject: permissions.canAccessProject },
    syncRecent: function (projects) { assert.deepEqual(projects, JSON.parse(fs.readFileSync(path.join(base, 'config.json'), 'utf8')).projects); assert.equal(statuses.repo.icon || null, configModule.loadClayrc().recentProjects?.find(function (p) { return p.path === repo; })?.icon || null); effects.push('sync'); configModule.syncClayrc(projects); },
    findUser: function (id) { return users[id]; }, osIdentity: function () { return mapped; }, storageDir: path.join(base, 'storage'), unregister: function (parent, slug) { scan.unregisterWorktreeSlug(parent, slug); },
  }); }
  return { base: base, repo: repo, target: target, statuses: statuses, projects: projects, relay: relay, service: attach(), restart: attach,
    effects: effects, config: function () { return cfg; }, reload: function () { cfg = JSON.parse(fs.readFileSync(path.join(base, 'config.json'))); },
    mapping: function (value) { mapped = value; }, failSave: function (value) { failSave = value; }, stop: function (fn) { stop = fn; }, user: users,
    saves: function () { return saves; }, broadcasts: function () { return broadcasts; } };
}
function preview(f, action) { return f.service.preview('repo--feature', action || 'delete', 'owner', 'browser'); }
function execute(f, review, user, connection) { return f.service.execute(review.token, user || 'owner', connection || 'browser'); }

test.after(function () { sync.stop(); fs.rmSync(root, { recursive: true, force: true }); });
test('independent icon edit persists before publication, survives restart, rescan and parent edit', function () {
  var f = fixture();
  assert.equal(f.service.setIcon('repo--feature', '🌿', 'owner').ok, true);
  assert.equal(f.service.setIcon('repo', '🐳', 'owner').ok, true);
  assert.equal(f.statuses['repo--feature'].icon, '🌿');
  f.reload(); f.service = f.restart();
  scan.scanAndRegisterWorktrees(f.relay, f.repo, 'repo', '🐳', 'owner', 'pk_test', null, f.config());
  assert.equal(f.statuses['repo--feature'].icon, '🌿');
  scan.unregisterWorktreeSlug('repo', 'repo--feature'); f.projects.delete('repo--feature');
  scan.rescanWorktrees(f.relay, f.repo, 'repo', '🐳', 'owner', f.config(), 'pk_test');
  assert.equal(f.statuses['repo--feature'].icon, '🌿');
  assert.equal(f.service.setIcon('repo--feature', null, 'owner').ok, true);
  assert.equal(preferences.icon(f.config(), 'repo', 'repo--feature', f.target, f.statuses['repo--feature'].changeSetId), null);
  assert.equal(preferences.icon(f.config(), 'repo', 'repo--feature', f.target, 'cs_replacement'), null);
  scan.unregisterWorktreeSlug('repo', 'repo--feature');
});
test('icon persistence failure and foreign/admin actors cannot publish or mutate config', function () {
  var f = fixture(), original = JSON.stringify(f.config()); f.failSave(true);
  assert.equal(f.service.setIcon('repo--feature', '🌿', 'owner').ok, false);
  assert.equal(JSON.stringify(f.config()), original); assert.equal(f.statuses['repo--feature'].icon, undefined); assert.equal(f.broadcasts(), 0);
  f.failSave(false);
  ['foreign', 'admin', null].forEach(function (id) { assert.equal(f.service.setIcon('repo--feature', '🌿', id).ok, false); });
});
test('cancelled preview has no side effects; confirmation is exact and connection-bound', async function () {
  var f = fixture(), review = preview(f);
  assert.equal(f.saves(), 0); assert.equal(f.projects.has('repo--feature'), true); assert.equal(fs.existsSync(f.target), true);
  await assert.rejects(execute(f, review, 'owner', 'other'), /another connection/);
  await assert.rejects(execute(f, review), /expired/);
  assert.equal(fs.existsSync(f.target), true);
});
test('actual external worktree delete waits for closure and keeps parent, sibling and branch', async function () {
  var f = fixture(), sibling = path.join(f.base, 'sibling'); git(f.repo, ['worktree', 'add', '--quiet', '-b', 'sibling', sibling]);
  var release; f.stop(function () { return new Promise(function (resolve) { release = resolve; }); });
  var pending = execute(f, preview(f));
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(fs.existsSync(f.target), true); assert.equal(f.service.busy('repo'), true);
  scan.rescanWorktrees(f.relay, f.repo, 'repo', '🐳', 'owner', f.config(), 'pk_test');
  assert.equal(f.projects.has('repo--feature'), false);
  release(true); var result = await pending;
  assert.equal(result.runtimeClosed, true); assert.equal(result.filesDeleted, true); assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.existsSync(f.repo), true); assert.equal(fs.existsSync(sibling), true); assert.equal(git(f.repo, ['rev-parse', 'feature']), head);
  f.reload(); assert.equal(f.config().projectLifecycleOperations[result.operationId].phase, 'completed');
});
test('exclusion retains dirty files, branch and Git membership and survives restart/rescan', async function () {
  var f = fixture(); fs.writeFileSync(path.join(f.target, 'local.txt'), 'keep');
  var result = await execute(f, preview(f, 'exclude'));
  assert.equal(result.filesDeleted, false); assert.equal(fs.readFileSync(path.join(f.target, 'local.txt'), 'utf8'), 'keep');
  assert.match(git(f.repo, ['worktree', 'list', '--porcelain']), new RegExp(f.target));
  f.reload(); scan.scanAndRegisterWorktrees(f.relay, f.repo, 'repo', '🐳', 'owner', 'pk_test', null, f.config());
  assert.equal(f.projects.has('repo--feature'), false);
});
test('dirty tracked, untracked, ignored, locked and wrong repository targets fail closed', function () {
  var f = fixture();
  var tracked = git(f.target, ['ls-files']).split('\n').find(function (file) { return fs.existsSync(path.join(f.target, file)); });
  fs.appendFileSync(path.join(f.target, tracked), '\nchanged'); assert.throws(function () { preview(f); }, /changed, untracked/); git(f.target, ['restore', '--', tracked]);
  fs.writeFileSync(path.join(f.target, 'untracked.txt'), 'keep'); assert.throws(function () { preview(f); }, /changed, untracked/); fs.unlinkSync(path.join(f.target, 'untracked.txt'));
  fs.appendFileSync(path.join(f.repo, '.git/info/exclude'), '\nignored.txt\n'); fs.writeFileSync(path.join(f.target, 'ignored.txt'), 'keep'); assert.throws(function () { preview(f); }, /changed, untracked/); fs.unlinkSync(path.join(f.target, 'ignored.txt'));
  git(f.repo, ['worktree', 'lock', f.target]); assert.throws(function () { preview(f); }, /locked/); git(f.repo, ['worktree', 'unlock', f.target]);
  assert.throws(function () { identities.inspect(f.repo, f.repo, null, true); }, /main repository/);
  var other = fixture(); assert.throws(function () { identities.inspect(f.repo, other.target, null, true); }, /not a linked/);
  var alias = path.join(f.base, 'alias'); fs.symlinkSync(f.target, alias); assert.throws(function () { identities.inspect(f.repo, alias, null, true); }, /symlink/);
});
test('revocation, permission loss and directory/HEAD replacement across review or closure refuse deletion', async function () {
  var f = fixture(), review = preview(f); delete f.user.owner;
  await assert.rejects(execute(f, review), /Only the project owner/); assert.equal(fs.existsSync(f.target), true);
  f = fixture(); review = preview(f); git(f.target, ['checkout', '--detach', '--quiet']);
  await assert.rejects(execute(f, review), /changed/);
  f = fixture(); review = preview(f); f.stop(function () { fs.renameSync(f.target, f.target + '-moved'); fs.mkdirSync(f.target); return true; });
  await assert.rejects(execute(f, review)); assert.equal(fs.existsSync(f.target + '-moved'), true); assert.equal(f.service.busy('repo'), true);
});
test('runtime refusal preserves pending registration and never deletes or rescans it', async function () {
  var f = fixture(); f.stop(function () { return false; });
  await assert.rejects(execute(f, preview(f)), function (error) { return error.lifecycleResult.runtimeClosureConfirmed === false && error.lifecycleResult.persisted === true; });
  assert.equal(fs.existsSync(f.target), true); assert.equal(f.service.busy('repo'), true);
  f.reload(); scan.scanAndRegisterWorktrees(f.relay, f.repo, 'repo', null, 'owner', 'pk_test', null, f.config()); assert.equal(f.projects.has('repo--feature'), false);
});
test('reservation persistence failure leaves runtime and directory intact', async function () {
  var f = fixture(), review = preview(f); f.failSave(true);
  await assert.rejects(execute(f, review), function (error) { return !error.lifecycleResult && /disk full/.test(error.message); });
  assert.equal(f.projects.has('repo--feature'), true); assert.equal(fs.existsSync(f.target), true); assert.equal(f.service.busy('repo'), false);
});
test('post-delete save failure reports observed disk removal and keeps the reservation', async function () {
  var f = fixture(); f.stop(function () { f.failSave(true); return true; });
  await assert.rejects(execute(f, preview(f)), function (error) { return error.lifecycleResult.filesDeleted === true && error.lifecycleResult.runtimeClosureConfirmed === true; });
  assert.equal(fs.existsSync(f.target), false); assert.equal(f.service.busy('repo'), true); assert.equal(git(f.repo, ['rev-parse', 'feature']), head);
});

test('registered foreign roots and nested runtime scopes are refused even with valid Git membership', function () {
  var f = fixture(); f.config().projects.push({ slug: 'foreign', path: f.base, ownerId: 'foreign' });
  assert.throws(function () { preview(f); }, /intersects another registered project/);
  f = fixture(); f.projects.set('unrelated-slug', { getStatus: function () { return { path: path.join(f.target, 'nested') }; } });
  assert.throws(function () { preview(f); }, /registered runtime is inside/);
});
test('new dirty files, revoked owner, mapped identity and unknown shutdown across async closure are fail closed', async function () {
  var f = fixture(); f.stop(function () { fs.writeFileSync(path.join(f.target, 'new-untracked'), 'keep'); return true; });
  await assert.rejects(execute(f, preview(f)), /changed, untracked/); assert.equal(fs.existsSync(f.target), true);
  f = fixture(); f.stop(function () { delete f.user.owner; return true; });
  await assert.rejects(execute(f, preview(f)), /Only the project owner/); assert.equal(fs.existsSync(f.target), true);
  f = fixture(); f.stop(function () { return undefined; });
  await assert.rejects(execute(f, preview(f)), /not acknowledged/); assert.equal(fs.existsSync(f.target), true);
  f = fixture(); f.config().osUsers = true;
  var mapped = { uid: process.getuid(), gid: process.getgid(), home: root, user: 'fixture' }; f.mapping(mapped);
  var review = preview(f); f.mapping(Object.assign({}, mapped, { home: path.join(root, 'changed-home') }));
  await assert.rejects(execute(f, review), /changed/); assert.equal(fs.existsSync(f.target), true);
});
test('same-path runtime replacement and expired reviews cannot authorize deletion', async function () {
  var f = fixture(), review = preview(f), old = f.projects.get('repo--feature');
  f.projects.set('repo--feature', { getStatus: old.getStatus, destroy: old.destroy });
  await assert.rejects(execute(f, review), /changed/); assert.equal(fs.existsSync(f.target), true);
  f = fixture(); review = preview(f); var now = Date.now;
  try { Date.now = function () { return now() + 300001; }; await assert.rejects(execute(f, review), /expired/); }
  finally { Date.now = now; }
  assert.equal(fs.existsSync(f.target), true);
});
test('internal linked worktree deletion removes only its own directory and keeps its branch', async function () {
  var f = fixture(), internal = path.join(f.repo, 'feature');
  git(f.repo, ['worktree', 'move', f.target, internal]); f.statuses['repo--feature'].path = internal;
  var result = await execute(f, preview(f)); assert.equal(result.filesDeleted, true);
  assert.equal(fs.existsSync(internal), false); assert.equal(fs.existsSync(f.repo), true); assert.equal(git(f.repo, ['rev-parse', 'feature']), head);
});

test('locked worktrees can retain independent icons and be excluded without unlocking or removing files', async function () {
  var f = fixture(); git(f.repo, ['worktree', 'lock', f.target]);
  assert.equal(f.service.setIcon('repo--feature', '🌿', 'owner').ok, true);
  assert.throws(function () { preview(f); }, /locked/);
  var result = await execute(f, preview(f, 'exclude'));
  assert.equal(result.filesDeleted, false); assert.equal(fs.existsSync(f.target), true);
  assert.match(git(f.repo, ['worktree', 'list', '--porcelain']), /locked/);
});

test('worktree execution pause requires exact live path and change-set identity', function () {
  var f = fixture(), status = f.statuses['repo--feature'];
  ['excluded', 'lifecycleState'].forEach(function (field) {
    var record = { path: f.target, changeSetId: status.changeSetId };
    record[field] = field === 'excluded' ? true : 'removing';
    f.config().projects[0].worktreePreferences = { 'repo--feature': record };
    assert.equal(f.service.getAccess('repo--feature').lifecycleExecutionPaused, true);
    var retiredIdentity = Object.assign({}, status);
    var original = status.changeSetId; status.changeSetId = 'cs_replacement';
    assert.equal(f.service.getAccess('repo--feature').lifecycleExecutionPaused, false);
    assert.equal(f.service.getAccess('repo--feature', retiredIdentity).lifecycleExecutionPaused, true, 'the retiring context keeps its own exact pause binding');
    status.changeSetId = original; status.path = f.target + '-replacement';
    assert.equal(f.service.getAccess('repo--feature').lifecycleExecutionPaused, false);
    status.path = f.target;
    assert.equal(accessModule.getProjectAccess(f.config(), 'repo--feature', false).lifecycleExecutionPaused, field === 'lifecycleState');
    var wrongSlug = Object.assign({}, status, { slug: 'repo--sibling' });
    assert.equal(accessModule.getProjectAccess(f.config(), 'repo--feature', false, wrongSlug).lifecycleExecutionPaused, field === 'lifecycleState');
  });
});
test('a real same-path recreated worktree ignores an old exclusion and can save a fresh icon', async function () {
  var f = fixture(), old = f.statuses['repo--feature'].changeSetId;
  await execute(f, preview(f, 'exclude'));
  git(f.repo, ['worktree', 'remove', '--', f.target]);
  git(f.repo, ['worktree', 'add', '--quiet', f.target, 'feature']);
  scan.rescanWorktrees(f.relay, f.repo, 'repo', null, 'owner', f.config(), 'pk_test');
  assert.notEqual(f.statuses['repo--feature'].changeSetId, old);
  assert.equal(f.service.getAccess('repo--feature').lifecycleExecutionPaused, false);
  assert.equal(f.service.setIcon('repo--feature', '🌱', 'owner').ok, true);
  scan.unregisterWorktreeSlug('repo', 'repo--feature');
});
test('ordinary icon authority retains accessible admins and permitted members while worktrees require the owner', function () {
  var f = fixture(); f.config().projects[0].allowedUsers = ['admin', 'foreign'];
  assert.equal(f.service.setIcon('repo', '🌱', 'admin').ok, true);
  f.user.foreign.role = 'user'; f.user.foreign.permissions = { projectSettings: true };
  assert.equal(f.service.setIcon('repo', '🌿', 'foreign').ok, true);
  assert.equal(f.service.setIcon('repo--feature', '🌿', 'foreign').ok, false);
  assert.equal(f.service.setIcon('repo--feature', '🌿', 'admin').ok, false);
  f.user.foreign.permissions.projectSettings = false;
  assert.equal(f.service.setIcon('repo', '🌿', 'foreign').ok, false);
  f.config().projects[0].allowedUsers = [];
  assert.equal(f.service.setIcon('repo', '🌿', 'admin').ok, false);
});
test('ordinary icons save before recent-project sync and publication; save failure preserves every surface', function () {
  var f = fixture();
  assert.equal(f.service.setIcon('repo', '🌱', 'owner').ok, true);
  assert.deepEqual(f.effects, ['save', 'sync', 'publish']);
  var recent = configModule.loadClayrc().recentProjects.find(function (p) { return p.path === f.repo; });
  assert.equal(recent.icon, '🌱');
  var disk = fs.readFileSync(configModule.clayrcPath(), 'utf8');
  f.effects.length = 0; f.failSave(true);
  var result = f.service.setIcon('repo', '🌿', 'owner');
  assert.equal(result.ok, false); assert.equal(result.persisted, false);
  assert.deepEqual(f.effects, []); assert.equal(f.config().projects[0].icon, '🌱'); assert.equal(f.statuses.repo.icon, '🌱');
  assert.equal(fs.readFileSync(configModule.clayrcPath(), 'utf8'), disk);
  f.failSave(false); assert.equal(f.service.setIcon('repo', null, 'owner').ok, true);
  recent = configModule.loadClayrc().recentProjects.find(function (p) { return p.path === f.repo; });
  assert.equal(recent.icon, undefined);
});

test('stale pending preferences do not block recreation registration, access or fresh icon persistence', function () {
  var f = fixture(), status = f.statuses['repo--feature'], oldId = status.changeSetId;
  f.config().projects[0].worktreePreferences = { 'repo--feature': { path: f.target, changeSetId: oldId, icon: '🐳', lifecycleState: 'removing' } };
  git(f.repo, ['worktree', 'remove', '--', f.target]); git(f.repo, ['worktree', 'add', '--quiet', f.target, 'feature']);
  f.projects.delete('repo--feature'); scan.unregisterWorktreeSlug('repo', 'repo--feature');
  scan.scanAndRegisterWorktrees(f.relay, f.repo, 'repo', null, 'owner', 'pk_test', null, f.config());
  assert.notEqual(f.statuses['repo--feature'].changeSetId, oldId);
  assert.equal(f.statuses['repo--feature'].icon, null);
  assert.equal(f.service.getAccess('repo--feature').lifecycleExecutionPaused, false);
  assert.equal(f.service.setIcon('repo--feature', '🌱', 'owner').ok, true);
  assert.equal(f.config().projects[0].worktreePreferences['repo--feature'].lifecycleState, undefined);
  scan.unregisterWorktreeSlug('repo', 'repo--feature');
});
test('genuine pending closure stays fenced after reload and incomplete identity never clears its pause', async function () {
  var f = fixture(), identity = Object.assign({}, f.statuses['repo--feature']); f.stop(function () { return false; });
  await assert.rejects(execute(f, preview(f)));
  f.reload(); f.service = f.restart();
  assert.equal(f.service.getAccess('repo--feature').lifecycleExecutionPaused, true, 'no runtime identity after restart remains uncertain');
  assert.equal(f.service.getAccess('repo--feature', identity).lifecycleExecutionPaused, true);
  assert.equal(f.service.getAccess('repo--feature', { slug: identity.slug, path: identity.path }).lifecycleExecutionPaused, true);
  scan.scanAndRegisterWorktrees(f.relay, f.repo, 'repo', null, 'owner', 'pk_test', null, f.config());
  scan.rescanWorktrees(f.relay, f.repo, 'repo', null, 'owner', f.config(), 'pk_test');
  assert.equal(f.projects.has('repo--feature'), false);
  assert.equal(f.service.busy('repo'), true);
  // A replaced preference cannot erase the independent durable shutdown reservation.
  f.config().projects[0].worktreePreferences['repo--feature'] = { path: f.target, changeSetId: 'cs_replacement' };
  assert.equal(f.service.busy('repo'), true);
});

function branchReview(f) { return f.service.preview('repo--feature', 'delete', 'owner', 'browser', true); }
var older = git(source, ['rev-parse', 'HEAD^']);
test('selected merged local branch is deleted only after acknowledged runtime and directory removal; remote ref remains', async function () {
  var f = fixture(); git(f.repo, ['update-ref', 'refs/remotes/origin/feature', head]);
  var release; f.stop(function () { return new Promise(function (resolve) { release = resolve; }); });
  var review = branchReview(f); assert.equal(review.deleteBranch, true);
  var pending = execute(f, review); await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(git(f.repo, ['show-ref', '--verify', '--hash', 'refs/heads/feature']), head); assert.equal(fs.existsSync(f.target), true);
  release(true); var result = await pending;
  assert.equal(result.filesDeleted, true); assert.equal(result.branchDeleted, true); assert.equal(fs.existsSync(f.target), false);
  assert.throws(function () { git(f.repo, ['show-ref', '--verify', 'refs/heads/feature']); });
  assert.equal(git(f.repo, ['rev-parse', 'refs/remotes/origin/feature']), head); assert.equal(git(f.repo, ['rev-parse', 'HEAD']), head);
});
test('branch choice defaults off, cannot upgrade a keep token, and Exclude refuses branch deletion', async function () {
  var f = fixture(), review = preview(f); assert.equal(review.deleteBranch, false);
  await assert.rejects(f.service.execute(review.token, 'owner', 'browser', null, true), /choice does not match/);
  assert.equal(fs.existsSync(f.target), true); assert.equal(f.saves(), 0);
  assert.throws(function () { f.service.preview('repo--feature', 'exclude', 'owner', 'browser', true); }, /Exclude always keeps/);
  assert.throws(function () { f.service.preview('repo--feature', 'delete', 'owner', 'browser', 'true'); }, /Invalid local branch/);
});
test('checked review cancellation and detached HEAD retain all refs without effects', async function () {
  var f = fixture(); branchReview(f); assert.equal(f.saves(), 0); assert.equal(f.projects.has('repo--feature'), true);
  git(f.target, ['checkout', '--detach', '--quiet']);
  var review = preview(f); assert.equal(review.localBranch, false);
  assert.throws(function () { branchReview(f); }, /Detached HEAD/);
  var result = await execute(f, review); assert.equal(result.branchDeleted, false); assert.equal(git(f.repo, ['rev-parse', 'feature']), head);
});
test('unmerged branch and branches checked out in parent or sibling fail before runtime effects', function () {
  var f = fixture(); git(f.repo, ['update-ref', 'refs/heads/main', older]);
  assert.throws(function () { branchReview(f); }, /not merged/); assert.equal(f.saves(), 0);
  f = fixture(); git(f.repo, ['worktree', 'add', '--quiet', '--force', path.join(f.base, 'sibling'), 'feature']);
  assert.throws(function () { branchReview(f); }, /another worktree/); assert.equal(f.saves(), 0);
  f = fixture(); git(f.repo, ['checkout', '--quiet', '--ignore-other-worktrees', 'feature']);
  assert.throws(function () { branchReview(f); }, /current parent branch/); assert.equal(f.saves(), 0);
});
test('changed branch tip, parent HEAD and parent ref invalidate a checked review', async function () {
  var changes = [function (f) { git(f.repo, ['update-ref', 'refs/heads/feature', older]); },
    function (f) { git(f.repo, ['update-ref', 'refs/heads/main', older]); },
    function (f) { git(f.repo, ['update-ref', 'refs/heads/replaced-parent', head]); git(f.repo, ['symbolic-ref', 'HEAD', 'refs/heads/replaced-parent']); }];
  for (var change of changes) {
    var f = fixture(), review = branchReview(f); change(f);
    await assert.rejects(execute(f, review), /changed|not merged/); assert.equal(fs.existsSync(f.target), true); assert.equal(f.saves(), 0);
  }
});
test('branch or parent changes across shutdown keep the directory and pending operation', async function () {
  for (var ref of ['refs/heads/feature', 'refs/heads/main']) {
    var f = fixture(), review = branchReview(f);
    f.stop(function () { git(f.repo, ['update-ref', ref, older]); return true; });
    await assert.rejects(execute(f, review), function (error) { return error.lifecycleResult.filesDeleted === false && error.lifecycleResult.branchDeleted === false; });
    assert.equal(fs.existsSync(f.target), true); assert.equal(f.service.busy('repo'), true);
  }
});
test('checked branch removal revalidates account, owner permission and OS identity across shutdown', async function () {
  var changes = [function (f) { delete f.user.owner; }, function (f) { f.user.owner.role = 'user'; f.user.owner.permissions = { deleteProject: false }; }, function (f) { f.mapping({ uid: 999999, gid: 999999, user: 'invalid' }); }];
  for (var change of changes) {
    var f = fixture(), review = branchReview(f); f.stop(function () { change(f); return true; });
    await assert.rejects(execute(f, review)); assert.equal(fs.existsSync(f.target), true); assert.equal(git(f.repo, ['rev-parse', 'feature']), head);
  }
});
test('post-directory branch failure reports partial effects and never replays even after reload', async function () {
  var f = fixture(), review = branchReview(f), original = identities.remove;
  identities.remove = function (snapshot, osUser) { var result = original(snapshot, osUser); git(f.repo, ['update-ref', 'refs/heads/feature', older]); return result; };
  try {
    await assert.rejects(execute(f, review), function (error) { return error.lifecycleResult.filesDeleted === true && error.lifecycleResult.branchDeleted === false && error.lifecycleResult.retrySafe === false && error.lifecycleResult.runtimeClosureConfirmed === true; });
  } finally { identities.remove = original; }
  assert.equal(fs.existsSync(f.target), false); assert.equal(git(f.repo, ['rev-parse', 'feature']), older); assert.equal(f.service.busy('repo'), true);
  f.reload(); f.service = f.restart(); assert.equal(f.service.busy('repo'), true);
  await assert.rejects(execute(f, review), /expired/); assert.equal(git(f.repo, ['rev-parse', 'feature']), older);
  var op = Object.values(f.config().projectLifecycleOperations)[0]; assert.equal(op.phase, 'pending'); assert.equal(op.worktreeReview.branch.tip, head);
});
test('prepared exact-ref deletion refuses a same-tip symbolic replacement without touching its target', async function () {
  var f = fixture(), snapshot = identities.inspect(f.repo, f.target, null, true), branches = require('../lib/worktree-branch');
  var bound = branches.inspect(snapshot, null, false); identities.remove(snapshot, null);
  // Replacement after review, before the prepared write, must be retained.
  git(f.repo, ['symbolic-ref', 'refs/heads/feature', 'refs/heads/main']);
  await assert.rejects(branches.remove(snapshot, bound, null), /symbolic ref/);
  assert.equal(git(f.repo, ['rev-parse', 'HEAD']), head); assert.equal(git(f.repo, ['symbolic-ref', 'refs/heads/feature']), 'refs/heads/main');
});
test('tip, symbolic-ref and sibling checkout races at transaction preparation fail closed', async function () {
  var transactions = require('../lib/worktree-ref-transaction'), original = transactions.remove;
  for (var kind of ['tip', 'symbolic', 'sibling', 'parent']) {
    var f = fixture(), snapshot = identities.inspect(f.repo, f.target, null, true), branches = require('../lib/worktree-branch');
    var bound = branches.inspect(snapshot, null, false); identities.remove(snapshot, null);
    transactions.remove = function (root, input, osUser, validate) {
      if (kind === 'tip') git(f.repo, ['update-ref', 'refs/heads/feature', older]);
      if (kind === 'symbolic') git(f.repo, ['symbolic-ref', 'refs/heads/feature', 'refs/heads/main']);
      if (kind === 'sibling') git(f.repo, ['worktree', 'add', '--quiet', path.join(f.base, 'race-sibling'), 'feature']);
      if (kind === 'parent') { git(f.repo, ['update-ref', 'refs/heads/other', head]); git(f.repo, ['symbolic-ref', 'HEAD', 'refs/heads/other']); }
      return original(root, input, osUser, validate);
    };
    try { await assert.rejects(branches.remove(snapshot, bound, null)); }
    finally { transactions.remove = original; }
    assert.equal(git(f.repo, ['rev-parse', 'feature']), kind === 'tip' ? older : head);
  }
});
test('branch preparation rechecks live account validation after directory removal and aborts its locked ref', async function () {
  var f = fixture(), transactions = require('../lib/worktree-ref-transaction'), original = transactions.remove;
  var review = branchReview(f);
  transactions.remove = function (root, input, osUser, validate) { delete f.user.owner; return original(root, input, osUser, validate); };
  try {
    await assert.rejects(execute(f, review), function (error) { return error.lifecycleResult.filesDeleted === true && error.lifecycleResult.branchDeleted === false; });
  } finally { transactions.remove = original; }
  assert.equal(fs.existsSync(f.target), false); assert.equal(git(f.repo, ['rev-parse', 'feature']), head); assert.equal(f.service.busy('repo'), true);
});
