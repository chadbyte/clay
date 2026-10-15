// Parent assigns isolated HOME/CLAY_HOME before every production import.
var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
var root = fs.realpathSync(process.argv[2]);
var users = require('../../lib/users'), mates = require('../../lib/mates'), cfg = require('../../lib/config');
users.saveUsers({ multiUser: true, users: [{ id: 'owner', username: 'owner', role: 'admin' }, { id: 'foreign', username: 'foreign', role: 'admin' }], invites: [] });
var mateCtx = mates.buildMateCtx('owner'); mates.ensureBuiltinMates(mateCtx);
var clay = mates.getAllMates(mateCtx).find(function (m) { return m.builtinKey === 'clay'; });
var shutdownHold = null, shutdownFailure = false, failNextAdapter = false, environmentHook = null, queryCalls = 0, shutdownCalls = 0;
var yoke = require('../../lib/yoke');
// Only external model/process transport is replaced. No live model can run.
yoke.createAdapters = function () {
  if (failNextAdapter) { failNextAdapter = false; throw new Error('Fixture external provider transport unavailable'); }
  function adapter(vendor) { return { vendor: vendor, init: async function () { return { models: [], capabilities: {} }; },
    createToolServer: function (definition) { return definition; },
    createQuery: function () { queryCalls++; throw new Error('Live model calls are forbidden.'); },
    shutdownIfIdle: function () { if (environmentHook) environmentHook(); return Promise.resolve(true); },
    shutdown: function () { shutdownCalls++; return shutdownHold || Promise.resolve(!shutdownFailure); } }; }
  return { adapters: { claude: adapter('claude'), codex: adapter('codex') }, auth: { claude: true, codex: true } };
};
yoke.completeOnce = function () { throw new Error('Live completions are forbidden.'); };
var config = process.argv.includes('--reload') ? cfg.loadConfig() : { projects: [], projectsDir: path.join(root, 'projects'), osUsers: false, retainedFixtureSetting: 'must survive' };
fs.mkdirSync(config.projectsDir, { recursive: true }); cfg.saveConfig(config);
var lifecycle = require('../../lib/daemon-project-lifecycle').attachProjectLifecycle({ getConfig: function () { return config; }, setConfig: function (next) { config = next; }, saveConfig: cfg.saveConfig,
  getRelay: function () { return relay; }, findUser: users.findUserById, resolveIdentity: require('../../lib/os-users').resolveOsUserInfo });
var callbacks = require('../../lib/daemon-project-lifecycle-callbacks').attachLifecycleCallbacks({ service: lifecycle });
var access = require('../../lib/daemon-project-access');
var relay = require('../../lib/server').createServer({ port: 0, projectLifecycle: lifecycle,
  onGetProjectAccess: function (slug) { return access.getProjectAccess(config, slug, false); },
  onGetProjectEnv: function (slug) { var item = config.projects.find(function (p) { return p.slug === slug; }); return { envrc: item && item.envrc || '' }; },
  onSetProjectEnv: callbacks.onSetProjectEnv,
  onCreateProject: callbacks.onCreateProject, onAddProject: callbacks.onAddProject, onRemoveProject: callbacks.onRemoveProject,
  onSetProjectTitle: callbacks.onSetProjectTitle,
});
function get(slug) { var found; relay.forEachProject(function (p, key) { if (key === slug) found = p; }); return found; }
var mateDir = mates.getMateDir(mateCtx, clay.id);
relay.addProject(mateDir, 'mate-' + clay.id, 'Clay', null, 'owner', null, { isMate: true, mateId: clay.id, isHostAgent: true });
var source = get('mate-' + clay.id), session = source.getSessionManager().createSessionRaw({ ownerId: 'owner', vendor: 'claude', sessionVisibility: 'private' });
session._sdkQueryGeneration = 1; session.abortController = new AbortController();
var events = [], ws = { readyState: 1, _clayUser: users.findUserById('owner'), _clayActiveSession: session.localId, send: function (data) { events.push(JSON.parse(data)); }, close: function () { this.readyState = 3; } };
source.clients.add(ws);
var bridge = source.getMcpBridgeHandler(session.localId, true, 1), count = 0, serial = 0;
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
function decode(result) { return JSON.parse(result.content[0].text); }
async function call(name, args) { return decode(await bridge.callTool('clay-workspace', name, args)); }
async function inspect(intent) { return call('inspect_project_control', intent); }
async function propose(intent, id) {
  var target = await inspect(intent); assert.ok(target.targetToken, JSON.stringify(target));
  var args = { targetToken: target.targetToken, requestId: id || 'request-' + (++serial), why: 'Verify the requested ordinary project operation' };
  var promise = call('control_project_lifecycle', args); await tick();
  var ids = Object.keys(session.pendingAskUser || {});
  return { promise: promise, args: args, id: ids[ids.length - 1] };
}
function answer(p, actor, choice) { return source.handleHomeAskUserResponse({ toolId: p.id, answers: { 0: choice || 'Apply exact change' } }, session, actor || ws); }
function cancel(p) { var pending = session.pendingAskUser[p.id]; if (pending) pending.respond.cancel('Fixture exact revision changed'); }
async function apply(intent, id) { var p = await propose(intent, id); assert.equal(answer(p), true); return p.promise; }
function diskFault() { var temporary = cfg.configPath() + '.tmp'; fs.mkdirSync(temporary); return function () { fs.rmdirSync(temporary); }; }
async function main() {
  try {
    var names = (await bridge.listTools()).map(function (tool) { return tool.name; });
    ['inspect_project_control', 'control_project_lifecycle'].forEach(function (name) { assert.ok(names.includes(name)); }); count++;
    var p = await propose({ action: 'create', name: 'declined' }); assert.equal(config.projects.length, 0); answer(p, ws, 'Keep unchanged'); var declined = await p.promise; assert.equal(declined.status, 'cancelled', JSON.stringify(declined)); assert.equal(fs.existsSync(path.join(config.projectsDir, 'declined')), false); count++;
    p = await propose({ action: 'create', name: 'alpha' }, 'create-alpha');
    assert.equal(answer(p, { readyState: 1, _clayUser: users.findUserById('foreign'), _clayActiveSession: session.localId }), false);
    assert.equal(answer(p, { readyState: 1, _clayUser: ws._clayUser, _clayActiveSession: session.localId }), false);
    assert.equal(answer(p), true); var created = await p.promise; assert.equal(created.status, 'completed'); var alpha = created.slug;
    assert.ok(fs.existsSync(path.join(config.projectsDir, alpha, '.git'))); assert.ok(get(alpha)); assert.equal(answer(p), false); count++;
    assert.equal((await call('control_project_lifecycle', p.args)).slug, alpha); assert.equal(config.projects.length, 1); count++;
    var first = config.projects[0]; assert.ok(require('../../lib/project-log-context').validId(first.projectKnowledgeId));
    session._sdkQueryGeneration++; bridge = source.getMcpBridgeHandler(session.localId, true, session._sdkQueryGeneration);
    var retry = await inspect({ action: 'create', name: 'alpha' });
    assert.equal((await call('control_project_lifecycle', { targetToken: retry.targetToken, requestId: 'create-alpha', why: 'Retry after new query' })).slug, alpha); assert.equal(config.projects.length, 1); count++;
    retry = await inspect({ name: 'alpha', action: 'create' }); assert.equal((await call('control_project_lifecycle', { targetToken: retry.targetToken, requestId: 'create-alpha', why: 'Same exact intent with reordered JSON keys' })).slug, alpha); count++;
    retry = await inspect({ action: 'create', name: 'different' }); assert.equal((await call('control_project_lifecycle', { targetToken: retry.targetToken, requestId: 'create-alpha', why: 'Conflicting retry' })).status, 'failed'); count++;
    assert.equal((await call('control_project_lifecycle', Object.assign({}, p.args, { confirmed: true }))).status, 'failed'); count++;
    assert.equal((await apply({ action: 'rename', projectSlug: alpha, value: 'Reviewed project' })).status, 'completed'); assert.equal(get(alpha).getStatus().title, 'Reviewed project'); count++;
    p = await propose({ action: 'rename', projectSlug: alpha, value: 'Stale' }); lifecycle.update(alpha, 'rename', 'Newer human title'); assert.equal(answer(p), false); cancel(p); await p.promise; assert.equal(get(alpha).getStatus().title, 'Newer human title'); count++;
    p = await propose({ action: 'rename', projectSlug: alpha, value: 'Revoked' }); config.projects[0].ownerId = 'foreign'; assert.equal(answer(p), false); cancel(p); await p.promise; config.projects[0].ownerId = 'owner'; count++;
    p = await propose({ action: 'create', name: 'stopped' }); source.stopHomeSession(session); session.taskStopRequested = true; session.abortController.abort(); assert.equal((await p.promise).status, 'cancelled'); assert.equal(fs.existsSync(path.join(config.projectsDir, 'stopped')), false); session.taskStopRequested = false; session.abortController = new AbortController(); count++;
    var restore = diskFault();
    try { p = await propose({ action: 'create', name: 'disk-create' }); answer(p); assert.equal((await p.promise).status, 'failed'); assert.equal(fs.existsSync(path.join(config.projectsDir, 'disk-create')), false); } finally { restore(); } count++;
    restore = diskFault();
    try { p = await propose({ action: 'rename', projectSlug: alpha, value: 'Disk rejected' }); answer(p); assert.equal((await p.promise).status, 'failed'); assert.equal(get(alpha).getStatus().title, 'Newer human title'); assert.equal(config.projects[0].title, 'Newer human title'); } finally { restore(); } count++;
    var existing = path.join(config.projectsDir, alpha, 'existing'); fs.mkdirSync(existing);
    var registered = await apply({ action: 'register', path: existing }); assert.equal(registered.status, 'completed'); assert.ok(get(registered.slug)); count++;
    assert.equal((await inspect({ action: 'register', path: config.projects[0].path })).status, 'failed');
    var link = path.join(root, 'alias'); fs.symlinkSync(config.projects[0].path, link); assert.equal((await inspect({ action: 'register', path: link })).status, 'failed'); count++;
    var hidden = path.join(root, 'hidden'); fs.mkdirSync(hidden); config.projects.push({ slug: 'hidden', path: hidden, ownerId: 'foreign', visibility: 'private', projectKnowledgeId: 'proj-hidden' }); relay.addProject(hidden, 'hidden', null, null, 'foreign');
    var child = path.join(hidden, 'child'); fs.mkdirSync(child);
    assert.equal((await inspect({ action: 'register', path: child })).status, 'failed'); assert.equal((await inspect({ action: 'register', path: root })).status, 'failed'); assert.equal((await inspect({ action: 'rename', projectSlug: 'hidden', value: 'No' })).status, 'failed'); count++;
    assert.equal((await inspect({ action: 'remove', projectSlug: source.getStatus().slug })).status, 'failed'); assert.equal((await inspect({ action: 'register', path: mateDir })).status, 'failed'); count++;
    var env = 'FIXTURE_CONTROL=reviewed'; assert.equal((await apply({ action: 'environment', projectSlug: alpha, value: env })).status, 'completed'); assert.equal((await inspect({ action: 'environment', projectSlug: alpha, value: '' })).current.envrc, env); assert.equal((await inspect({ action: 'environment', projectSlug: alpha, value: 'X=$(touch nope)' })).status, 'failed'); count++;
    assert.equal((await apply({ action: 'session_visibility', projectSlug: alpha, value: 'shared' })).status, 'completed'); assert.equal(access.getProjectAccess(config, alpha).sessionVisibilityDefault, 'shared'); count++;
    assert.equal((await apply({ action: 'allowed_users', projectSlug: alpha, value: ['foreign'] })).status, 'completed');
    var observerEvents = [], observer = { readyState: 1, _clayUser: users.findUserById('foreign'), send: function (data) { observerEvents.push(JSON.parse(data)); }, close: function () { this.readyState = 3; } }; get(alpha).clients.add(observer);
    assert.equal((await apply({ action: 'allowed_users', projectSlug: alpha, value: [] })).status, 'completed'); assert.equal(observer.readyState, 3); assert.ok(observerEvents.some(function (event) { return event.type === 'access_revoked'; })); count++;
    assert.equal((await apply({ action: 'visibility', projectSlug: alpha, value: 'public' })).status, 'completed'); assert.equal(access.getProjectAccess(config, alpha).visibility, 'public'); count++;
    var removePath = config.projects.find(function (item) { return item.slug === registered.slug; }).path;
    restore = diskFault(); try { p = await propose({ action: 'remove', projectSlug: registered.slug }); answer(p); assert.equal((await p.promise).status, 'failed'); assert.ok(get(registered.slug)); } finally { restore(); } count++;
    var release; shutdownHold = new Promise(function (resolve) { release = resolve; });
    p = await propose({ action: 'remove', projectSlug: registered.slug }, 'remove-existing'); answer(p); await tick();
    var settled = false; p.promise.then(function () { settled = true; }); await tick(); assert.equal(settled, false); assert.equal(get(registered.slug), undefined);
    assert.equal(config.projects.find(function (item) { return item.slug === registered.slug; }).lifecycleState, 'removing');
    assert.throws(function () { lifecycle.register(removePath, users.findUserById('owner')); }, /intersects|pending/);
    release(true); shutdownHold = null; var removed = await p.promise; assert.equal(removed.status, 'completed'); assert.equal(removed.filesDeleted, false); assert.ok(fs.existsSync(removePath)); count++;
    retry = await inspect({ action: 'remove', projectSlug: registered.slug }); assert.equal((await call('control_project_lifecycle', { targetToken: retry.targetToken, requestId: 'remove-existing', why: 'Retry settled removal' })).status, 'completed'); count++;
    var sourceSnapshot = session._mcpForeignInput; session._mcpForeignInput = true; await assert.rejects(bridge.callTool('clay-workspace', 'inspect_project_control', { action: 'create', name: 'foreign' })); session._mcpForeignInput = sourceSnapshot; count++;
    var ownerSnapshot = users.loadUsers(); users.saveUsers(Object.assign({}, ownerSnapshot, { users: ownerSnapshot.users.filter(function (user) { return user.id !== 'owner'; }) })); await assert.rejects(bridge.callTool('clay-workspace', 'inspect_project_control', { action: 'create', name: 'deleted-owner' })); users.saveUsers(ownerSnapshot); count++;
    session.vendor = 'codex'; session._sdkQueryGeneration++; bridge = source.getMcpBridgeHandler(session.localId, true, session._sdkQueryGeneration); assert.ok((await bridge.listTools()).some(function (tool) { return tool.name === 'control_project_lifecycle'; })); count++;
    // Recreate the service from its real persisted receipts, as after process recovery.
    var savedConfig = cfg.loadConfig(), createReceiptKey = Object.keys(savedConfig.projectControlReceipts).find(function (key) { return savedConfig.projectControlReceipts[key].fingerprint === require('node:crypto').createHash('sha256').update(JSON.stringify({ action: 'create', name: 'alpha' })).digest('hex'); });
    var savedReceipt = savedConfig.projectControlReceipts[createReceiptKey];
    var recovered = require('../../lib/daemon-project-lifecycle').attachProjectLifecycle({ getConfig: function () { return cfg.loadConfig(); }, setConfig: function () { throw new Error('Recovery retry must not write'); }, saveConfig: function () { throw new Error('Recovery retry must not persist'); }, getRelay: function () { throw new Error('Recovery retry must not publish'); } });
    assert.equal(recovered.execute({ action: 'create', name: 'alpha' }, users.findUserById('owner'), { key: createReceiptKey, fingerprint: savedReceipt.fingerprint, ownerId: 'owner' }, function () { throw new Error('Recovery retry must not create'); }).slug, alpha); count++;
    var replaced = await apply({ action: 'create', name: 'replace-target' });
    p = await propose({ action: 'rename', projectSlug: replaced.slug, value: 'Cannot rename replacement' });
    var replacedRecord = config.projects.find(function (item) { return item.slug === replaced.slug; });
    await relay.removeProject(replaced.slug, true); relay.addProject(replacedRecord.path, replacedRecord.slug, null, null, 'owner', null, { projectKnowledgeId: replacedRecord.projectKnowledgeId });
    assert.equal(answer(p), false); cancel(p); await p.promise; count++;
    p = await propose({ action: 'rename', projectSlug: replaced.slug, value: 'Cannot rename deleted' });
    await lifecycle.remove(replaced.slug, 'owner'); assert.equal(answer(p), false); cancel(p); await p.promise; count++;
    p = await propose({ action: 'create', name: 'registry-race' }); lifecycle.create('human-race', users.findUserById('owner')); assert.equal(answer(p), false); cancel(p); await p.promise; assert.equal(config.projects.some(function (item) { return item.slug === 'registry-race'; }), false); count++;
    var conflictPath = path.join(config.projectsDir, 'conflict'); fs.mkdirSync(conflictPath);
    p = await propose({ action: 'create', name: 'conflict' }); answer(p); assert.equal((await p.promise).status, 'failed'); assert.ok(fs.existsSync(conflictPath)); count++;
    var danglingPath = path.join(config.projectsDir, 'dangling'); fs.symlinkSync(path.join(root, 'missing'), danglingPath);
    p = await propose({ action: 'create', name: 'dangling' }); answer(p); assert.equal((await p.promise).status, 'failed'); assert.ok(fs.lstatSync(danglingPath).isSymbolicLink()); count++;
    // A real failed external Git transport replaces the claimed directory.
    var shimDir = path.join(root, 'git-shim'); fs.mkdirSync(shimDir);
    fs.writeFileSync(path.join(shimDir, 'git'), '#!' + process.execPath + '\nvar fs = require("fs"), path = require("path"), cwd = process.cwd(); fs.renameSync(cwd, cwd + ".held"); fs.mkdirSync(cwd); fs.writeFileSync(path.join(cwd, "replacement-sentinel"), "retain"); process.exit(1);\n', { mode: 0o700 });
    var originalPath = process.env.PATH; process.env.PATH = shimDir + path.delimiter + originalPath;
    try { p = await propose({ action: 'create', name: 'partial-cleanup' }); answer(p); var partial = await p.promise; assert.equal(partial.status, 'failed'); assert.match(partial.error, /cleanup skipped/); assert.equal(fs.readFileSync(path.join(config.projectsDir, 'partial-cleanup', 'replacement-sentinel'), 'utf8'), 'retain'); } finally { process.env.PATH = originalPath; } count++;
    var failedRemoval = await apply({ action: 'create', name: 'shutdown-failure' }); shutdownFailure = true;
    try { p = await propose({ action: 'remove', projectSlug: failedRemoval.slug }, 'failed-runtime-removal'); answer(p); assert.equal((await p.promise).status, 'failed'); assert.equal(config.projects.find(function (item) { return item.slug === failedRemoval.slug; }).lifecycleState, 'removing'); assert.equal((await call('control_project_lifecycle', p.args)).status, 'failed'); assert.throws(function () { lifecycle.register(path.join(config.projectsDir, failedRemoval.slug), users.findUserById('owner')); }, /intersects|pending/); } finally { shutdownFailure = false; } count++;
    var transfer = await apply({ action: 'create', name: 'transfer-target' }); var targetSession = get(transfer.slug).getSessionManager().createSessionRaw({ ownerId: 'owner' });
    assert.equal((await apply({ action: 'owner', projectSlug: transfer.slug, value: 'foreign' })).status, 'completed'); assert.equal(get(transfer.slug).getStatus().projectOwnerId, 'foreign'); assert.equal(targetSession.ownerId, 'owner'); assert.equal((await inspect({ action: 'rename', projectSlug: transfer.slug, value: 'No longer owned' })).status, 'failed'); count++;
    p = await propose({ action: 'create', name: 'permission-revoked' });
    var usersBeforeRevocation = users.loadUsers(); users.saveUsers(Object.assign({}, usersBeforeRevocation, { users: usersBeforeRevocation.users.map(function (user) { return user.id === 'owner' ? Object.assign({}, user, { role: 'user', permissions: { createProject: false, projectSettings: false } }) : user; }) }));
    assert.equal(answer(p), false); cancel(p); await p.promise; assert.equal((await inspect({ action: 'environment', projectSlug: alpha, value: 'X=1' })).status, 'failed'); users.saveUsers(usersBeforeRevocation); count++;
    p = await propose({ action: 'remove', projectSlug: alpha }); get(alpha).getSessionManager().createSessionRaw({ ownerId: 'owner' }); assert.equal(answer(p), false); cancel(p); await p.promise; count++;
    p = await propose({ action: 'create', name: 'base-replaced' });
    var oldBase = config.projectsDir + '.held'; fs.renameSync(config.projectsDir, oldBase); fs.mkdirSync(config.projectsDir);
    assert.equal(answer(p), false); cancel(p); await p.promise; fs.rmdirSync(config.projectsDir); fs.renameSync(oldBase, config.projectsDir); count++;
    var interruptedRemoval = await apply({ action: 'create', name: 'stop-during-removal' });
    var releaseInterrupted; shutdownHold = new Promise(function (resolve) { releaseInterrupted = resolve; });
    p = await propose({ action: 'remove', projectSlug: interruptedRemoval.slug }); answer(p); await tick(); session.taskStopRequested = true; session.abortController.abort(); releaseInterrupted(true); shutdownHold = null;
    var interrupted = await p.promise; assert.equal(interrupted.status, 'failed'); assert.equal(interrupted.outcome, 'removal_reserved_runtime_pending'); assert.equal(lifecycle.canRestore(config.projects.find(function (item) { return item.slug === interruptedRemoval.slug; })), false); assert.equal(config.projects.find(function (item) { return item.slug === interruptedRemoval.slug; }).lifecycleState, 'removing'); session.taskStopRequested = false; session.abortController = new AbortController(); count++;
    var raceRemoval = await apply({ action: 'create', name: 'changed-during-removal' });
    var releaseRace; shutdownHold = new Promise(function (resolve) { releaseRace = resolve; }); p = await propose({ action: 'remove', projectSlug: raceRemoval.slug }); answer(p); await tick();
    config.projects.find(function (item) { return item.slug === raceRemoval.slug; }).title = 'Concurrent registration revision'; releaseRace(true); shutdownHold = null;
    assert.equal((await p.promise).status, 'failed'); assert.equal(config.projects.find(function (item) { return item.slug === raceRemoval.slug; }).title, 'Concurrent registration revision'); count++;
    var largeEnvironment = 'FIXTURE_LONG=' + 'x'.repeat(3000); var tooLarge = await inspect({ action: 'environment', projectSlug: alpha, value: largeEnvironment });
    assert.equal((await call('control_project_lifecycle', { targetToken: tooLarge.targetToken, requestId: 'review-too-long', why: 'Bound review length' })).status, 'failed'); assert.notEqual(config.projects.find(function (item) { return item.slug === alpha; }).envrc, largeEnvironment); count++;
    var deps = { getProjects: function () { var items = new Map(); relay.forEachProject(function (p, slug) { items.set(slug, p); }); return items; }, isMultiUser: users.isMultiUser,
      projectLifecycle: lifecycle, lifecyclePermissions: function (user) { return users.getEffectivePermissions(user, false); },
      onGetProjectAccess: function (slug) { return access.getProjectAccess(config, slug); }, canAccessProject: users.canAccessProject, findUser: users.findUserById,
      resolveMate: function (owner, id) { return mates.getMate(mates.buildMateCtx(owner), id); } };
    var nativeModule = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: require('../../lib/workspace-query-service').attachWorkspaceQueryService(deps), controlService: require('../../lib/clay-product-control').attachClayProductControl(deps), sm: source.getSessionManager(), projectSlug: source.getStatus().slug, getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: clay.id });
    var native = nativeModule.createMcpServer(yoke.createAdapters().adapters.claude, session);
    var nativeNames = native.tools.map(function (tool) { return tool.name; }).sort();
    var resumedNames = (await bridge.listTools()).filter(function (tool) { return tool.server === 'clay-workspace'; }).map(function (tool) { return tool.name; }).sort();
    assert.deepEqual(nativeNames, resumedNames); assert.ok(nativeNames.includes('control_project_lifecycle')); count++;
    events.length = 0; source.handleMessage(ws, { type: 'create_project', name: 'human-handler' });
    var humanCreated = events.find(function (event) { return event.type === 'add_project_result'; }); assert.equal(humanCreated.ok, true); assert.ok(get(humanCreated.slug)); count++;
    events.length = 0; source.handleMessage(ws, { type: 'set_project_title', slug: humanCreated.slug, title: 'Human project title' });
    assert.equal(events.find(function (event) { return event.type === 'set_project_title_result'; }).ok, true); assert.equal(get(humanCreated.slug).getStatus().title, 'Human project title'); count++;
    events.length = 0; source.handleMessage(ws, { type: 'remove_project', slug: humanCreated.slug }); await tick(); await tick();
    assert.equal(events.find(function (event) { return event.type === 'remove_project_result'; }).ok, true); assert.equal(get(humanCreated.slug), undefined); count++;
    config.osUsers = true; assert.throws(function () { lifecycle.update(alpha, 'allowed_users', ['foreign']); }, /OS filesystem/); assert.throws(function () { lifecycle.create('os-user-missing', users.findUserById('owner')); }, /provisioned Linux/); config.osUsers = false; count++;

    assert.equal(config.retainedFixtureSetting, 'must survive'); assert.equal(JSON.parse(fs.readFileSync(cfg.configPath())).retainedFixtureSetting, 'must survive'); count++;
    console.log(count + ' production project lifecycle scenarios passed');
  } finally { shutdownHold = null; await relay.destroyAll(); }
}
if (process.argv.includes('--correction')) {
  require('./clay-project-lifecycle-corrections.cjs').run(process.argv[process.argv.indexOf('--correction') + 1], {
    root: root, users: users, cfg: cfg, source: source, session: session, ws: ws, relay: relay, lifecycle: lifecycle, callbacks: callbacks, events: events,
    get: get, tick: tick, apply: apply, propose: propose, answer: answer, inspect: inspect, call: call, cancel: cancel, diskFault: diskFault,
    config: function () { return config; },
    shutdownFailure: function (value) { shutdownFailure = value; }, shutdownHold: function (value) { shutdownHold = value; },
    failAdapter: function () { failNextAdapter = true; }, environmentHook: function (fn) { environmentHook = fn; },
    queryCalls: function () { return queryCalls; }, shutdownCalls: function () { return shutdownCalls; },
    reconstruct: function () {
      config = cfg.loadConfig();
      var fresh = require('../../lib/daemon-project-lifecycle').attachProjectLifecycle({ getConfig: function () { return config; }, setConfig: function (next) { config = next; }, saveConfig: cfg.saveConfig,
        getRelay: function () { return relay; }, findUser: users.findUserById, resolveIdentity: require('../../lib/os-users').resolveOsUserInfo });
      Object.assign(lifecycle, fresh);
    },
  }).then(async function () { shutdownFailure = false; shutdownHold = null; await relay.destroyAll(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (process.argv.includes('--serve-recovery')) {
  var browserCreated = callbacks.onCreateProject('browser-recovery', users.findUserById('owner'));
  shutdownFailure = true;
  lifecycle.remove(browserCreated.slug, 'owner').catch(function (error) {
    shutdownFailure = false;
    var opId = error.lifecycleResult.operationId;
    require('./clay-product-control-browser.cjs').start({ requestLabel: 'Review pending project recovery', source: source, session: session, owner: users.findUserById('owner'), target: session,
      state: function () { return config.projects.some(function (item) { return item.slug === browserCreated.slug; }) ? 'Pending removal: browser-recovery' : 'Registration removed; project files retained'; },
      request: async function () { var target = await inspect({ action: 'reconcile', projectSlug: browserCreated.slug, value: opId }); return call('control_project_lifecycle', { targetToken: target.targetToken, requestId: 'browser-recovery-' + (++serial), why: 'Finish the previously saved removal after confirming runtime closure' }); },
    });
  });
} else if (process.argv.includes('--serve')) {
  lifecycle.create('browser-project', users.findUserById('owner'));
  require('./clay-product-control-browser.cjs').start({ requestLabel: 'Request project rename', staleLabel: 'Change project before answering', source: source, session: session, owner: users.findUserById('owner'), target: session,
    state: function () { var project = config.projects.find(function (item) { return item.slug === 'browser-project'; }); return project.title || project.slug; },
    changeQueue: function () { lifecycle.update('browser-project', 'rename', 'Newer human project title'); },
    request: async function () { var target = await inspect({ action: 'rename', projectSlug: 'browser-project', value: 'Reviewed project title' }); return call('control_project_lifecycle', { targetToken: target.targetToken, requestId: 'browser-' + (++serial), why: 'Make the project easier to recognize' }); },
  });
} else main().then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
