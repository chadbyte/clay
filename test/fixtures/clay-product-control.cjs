// HOME/CLAY_HOME are assigned by the parent before any production import.
var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
var root = process.argv[2];
var screenFixture = process.argv.includes('--screen-controls') || process.argv.includes('--serve-screen') ? require('./clay-screen-controls.cjs') : null;
var workspaceFixture = process.argv.includes('--workspace-controls') ? require('./clay-workspace-controls.cjs') : null;
if (workspaceFixture) workspaceFixture.installTransport();
var mateChatFixture = process.argv.includes('--mate-chat') ? require('./clay-mate-chat.cjs') : null;
var schedulingFixture = process.argv.includes('--scheduling') ? require('./clay-scheduling.cjs') : null;
if (schedulingFixture) schedulingFixture.installClock();
var runtimeFixture = process.argv.includes('--runtime-controls') ? require('./clay-runtime-controls.cjs') : null;
if (runtimeFixture) runtimeFixture.installTransport();
var users = require('../../lib/users'), mates = require('../../lib/mates');
users.saveUsers({ multiUser: true, users: [{ id: 'owner', username: 'fixture-owner', role: 'admin' }, { id: 'foreign', username: 'fixture-other', role: 'admin' }], invites: [] });
var mateCtx = mates.buildMateCtx('owner');
mates.ensureBuiltinMates(mateCtx);
var clay = mates.getAllMates(mateCtx).find(function (mate) { return mate.builtinKey === 'clay'; });
var custom = mates.createMate(mateCtx, { name: 'Fixture Mate' });
var yoke = require('../../lib/yoke');
var transport = { forkCalls: 0, rollbackCalls: 0, renameCalls: 0 };
// Only external provider transport is replaced; projects, session persistence,
// SDK bridge, authorization, tools and WebSocket handlers below are production.
yoke.createAdapters = function () {
  function adapter(vendor) {
    var item = { vendor: vendor, init: async function () { return { models: [{ value: 'fixture-model' }], capabilities: { effort: true, fork: true, rollback: true, rewind: false } }; },
      createToolServer: function (definition) { return definition; },
      renameSession: async function () { transport.renameCalls++; },
      forkSession: async function () { transport.forkCalls++; return { sessionId: 'fixture-fork-' + transport.forkCalls }; },
      createQuery: function (options) { if (mateChatFixture) return mateChatFixture.createQuery(options); if (schedulingFixture) return schedulingFixture.createQuery(options); throw new Error('Live model execution is forbidden in this fixture.'); },
      shutdown: function () {} };
    if (vendor === 'codex') item.rollbackThread = async function () { transport.rollbackCalls++; };
    return item;
  }
  transport.latestAdapters = { claude: adapter('claude'), codex: adapter('codex') };
  return { adapters: transport.latestAdapters, auth: { claude: true, codex: true } };
};
var scheduler = require('../../lib/durable-scheduler').attachDurableScheduler({ namespace: 'product-control-fixture', storageDir: path.join(root, 'scheduler') });
var createProject = require('../../lib/project').createProjectContext;
var fixtureAdapters = new WeakMap();
var projects = new Map(), access = { slug: 'target', ownerId: 'owner', visibility: 'private' };
var deps = { getProjects: function () { return projects; }, isMultiUser: users.isMultiUser, onGetProjectAccess: function () { return access; }, canAccessProject: users.canAccessProject,
  findUser: users.findUserById, resolveMate: function (owner, id) { return mates.getMate(mates.buildMateCtx(owner), id); } };
var mateLifecycle;
var mateKnowledge = require('../../lib/mate-knowledge-service').attachMateKnowledgeService(Object.assign({}, deps, {
  listMates: function (owner) { return mates.getAllMates(mates.buildMateCtx(owner)).map(function (mate) { return { id: mate.id, createdBy: mate.createdBy, name: mate.name, dir: mates.getMateDir(mates.buildMateCtx(owner), mate.id) }; }); }
}));
deps.getMateDir = function (owner, id) { return mates.getMateDir(mates.buildMateCtx(owner), id); };
deps.getMateLifecycle = function () { return mateLifecycle; };
var recordServices;
if (process.argv.includes('--project-records')) {
  var recordDeps = Object.assign({}, deps, { findUserById: users.findUserById, canAccessProject: function () { return true; }, hasFullProjectAccess: function () { return true; } });
  recordServices = { issues: require('../../lib/issues-service').attachIssuesService(recordDeps), logs: require('../../lib/project-logs-service').attachProjectLogsService(recordDeps) };
  deps.getRecordServices = function () { return recordServices; };
}
var ownerUi = require('../../lib/server-owner-ui').attachOwnerUi({ isMultiUser: users.isMultiUser, findUser: users.findUserById,
  forEachClient: function (visit) { projects.forEach(function (project, slug) { project.clients.forEach(function (ws) { visit(ws, slug); }); }); } });
var screenNotifications = screenFixture ? screenFixture.notifications(users, projects) : null;
deps.getOwnerUi = function () { return ownerUi; };
deps.getNotifications = function () { return screenNotifications; };
var controls = require('../../lib/clay-product-control').attachClayProductControl(deps);
var workspace = require('../../lib/workspace-query-service').attachWorkspaceQueryService(deps);
function make(slug, mate) {
  var cwd = mate && (process.argv.includes('--mate-knowledge') || process.argv.includes('--scheduling') || process.argv.includes('--mate-chat') || process.argv.includes('--workspace-controls') || screenFixture) ? mates.getMateDir(mateCtx, mate.id) : path.join(root, slug); fs.mkdirSync(cwd, { recursive: true });
  var project = createProject({ osUsers: !!(mateChatFixture && mateChatFixture.osMode || workspaceFixture && workspaceFixture.osMode), durableScheduler: scheduler, onDmMessage: function (ws, msg) { return ownerUi.handleMessage(ws, msg); }, notificationsModule: require("../../lib/project-notifications").attachNotifications({}), cwd: cwd, slug: slug, projectKnowledgeId: process.argv.includes('--project-records') ? 'fixture-' + slug : null, port: 0, projectOwnerId: 'owner', isMate: !!mate, mateId: mate && mate.id,
    isHostAgent: mate && mate.builtinKey === 'clay', canAccessProjectSlug: function (userId, slug) { var project = projects.get(slug); if (!project) return false; var status = project.getStatus(); return users.canAccessProject(userId, status.isMate ? { isMate: true, ownerId: status.projectOwnerId } : access); }, workspaceQueryService: workspace, issuesService: recordServices && recordServices.issues, projectLogsService: recordServices && recordServices.logs, clayProductControl: controls, mateKnowledgeService: mateKnowledge, getProjectAccess: function () {
      if (!mate) return access;
      var live = mates.getMate(mateCtx, mate.id);
      return { isMate: true, ownerId: 'owner', visibility: 'private', lifecycleExecutionPaused: !live || !!live.lifecycleDeletion };
    } });
  fixtureAdapters.set(project, transport.latestAdapters);
  projects.set(slug, project); return project;
}
var source = make('clay-source', clay), target = make('target'), otherMate = make('other-mate', custom);
var sourceSession = source.sm.createSession({ ownerId: 'owner', vendor: 'claude', sessionVisibility: 'private' });
sourceSession._sdkQueryGeneration = 8; sourceSession.abortController = new AbortController();
var session = target.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' });
session.cliSessionId = 'fixture-target'; session.title = 'Original';
target.sm.modelsByVendor = { codex: [{ value: 'fixture-model' }], claude: [{ value: 'fixture-model' }] };
target.sm.capabilitiesByVendor = { codex: { fork: true, rollback: true, effort: true }, claude: { fork: true, rewind: true, effort: true } };
var events = [], ws = { readyState: 1, _clayUser: users.findUserById('owner'), _clayActiveSession: sourceSession.localId, send: function (data) { events.push(JSON.parse(data)); } };
source.clients.add(ws);
var bridge = source.getMcpBridgeHandler(sourceSession.localId, true, 8);
function decode(result) { return JSON.parse(result.content[0].text); }
async function call(name, args) { return decode(await bridge.callTool('clay-workspace', name, args || {})); }
async function inspect(item) { return call('inspect_session_control', { projectSlug: 'target', sessionRef: require('../../lib/workspace-query-service').sessionRef('target', item || session) }); }
var counter = 0;
async function propose(action, value, item) {
  var state = await inspect(item), args = { targetToken: state.targetToken, action: action, why: 'Apply the requested fixture change', requestId: 'request-' + (++counter) };
  if (value !== undefined) args.value = value;
  var promise = call('control_project_session', args);
  await new Promise(function (resolve) { setImmediate(resolve); });
  var ids = Object.keys(sourceSession.pendingAskUser || {});
  return { promise: promise, args: args, id: ids[ids.length - 1] };
}
function answer(proposal, actor, selection) {
  return source.handleHomeAskUserResponse({ toolId: proposal.id, answers: { 0: selection || 'Apply exact change' } }, sourceSession, actor || ws);
}
async function main() {
  try {
    var tools = await bridge.listTools();
    ['discover_product_controls', 'inspect_session_control', 'control_project_session'].forEach(function (name) { assert.ok(tools.some(function (tool) { return tool.name === name; })); });
    var capabilities = await call('discover_product_controls'); assert.ok(capabilities.excluded.includes('workerCreation')); assert.ok(capabilities.excluded.includes('serverSettings')); assert.ok(capabilities.excluded.includes('userSettings'));
    var driverSession = target.sm.createSession({ ownerId: 'owner', vendor: 'codex' }); driverSession._sdkQueryGeneration = 1;
    assert.equal((await target.getMcpBridgeHandler(driverSession.localId, true, 1).listTools()).some(function (tool) { return tool.name === 'control_project_session'; }), false);
    var otherSession = otherMate.sm.createSession({ ownerId: 'owner' }); otherSession._sdkQueryGeneration = 1;
    assert.equal((await otherMate.getMcpBridgeHandler(otherSession.localId, true, 1).listTools()).some(function (tool) { return tool.name === 'control_project_session'; }), false);
    var p = await propose('rename', 'Reviewed name'); assert.equal(session.title, 'Original');
    assert.equal(answer(p, { readyState: 1, _clayUser: users.findUserById('foreign'), _clayActiveSession: sourceSession.localId }), false);
    assert.equal(answer(p, { readyState: 1, _clayUser: ws._clayUser, _clayActiveSession: sourceSession.localId }), false);
    assert.equal(answer(p), true); assert.equal((await p.promise).status, 'completed'); assert.equal(session.title, 'Reviewed name');
    assert.equal((await call('control_project_session', p.args)).status, 'completed'); assert.equal(transport.renameCalls, 1);
    assert.equal((await call('control_project_session', Object.assign({}, p.args, { value: 'Foreign retry' }))).status, 'failed');
    assert.equal(answer(p), false);
    session.ownerId = 'foreign'; assert.equal((await call('control_project_session', p.args)).status, 'failed'); session.ownerId = 'owner';
    var sibling = source.sm.createSessionRaw({ ownerId: 'owner', vendor: 'codex' }); sibling._sdkQueryGeneration = 8;
    var siblingBridge = source.getMcpBridgeHandler(sibling.localId, true, 8);
    assert.equal(decode(await siblingBridge.callTool('clay-workspace', 'control_project_session', p.args)).status, 'failed');
    assert.equal((await call('control_project_session', Object.assign({}, p.args, { action: 'set_server_default_model', requestId: 'excluded-settings' }))).status, 'failed');
    assert.equal((await call('control_project_session', Object.assign({}, p.args, { action: 'create_worker', requestId: 'excluded-worker' }))).status, 'failed');
    p = await propose('rename', 'Cancelled'); answer(p, ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); assert.equal(session.title, 'Reviewed name');
    var state = await inspect(); assert.equal((await call('control_project_session', { targetToken: state.targetToken, action: 'rename', value: 'Forged', confirmed: true, why: 'No', requestId: 'forged' })).status, 'failed');
    var foreign = target.sm.createSession({ ownerId: 'foreign', vendor: 'codex', sessionVisibility: 'shared' }); assert.equal((await inspect(foreign)).status, 'failed');
    var worker = target.sm.createSession({ ownerId: 'owner', vendor: 'codex' }); require('../../lib/session-provenance').markWorker(session, worker, target.sm.sessions); assert.equal((await inspect(worker)).status, 'failed');
    p = await propose('rename', 'Changed worker scope'); worker.title = 'Changed'; assert.equal(answer(p), false); sourceSession.pendingAskUser[p.id].respond.cancel('Scope changed'); assert.equal((await p.promise).status, 'cancelled');
    p = await propose('rename', 'Revoked'); access = { slug: 'target', ownerId: 'foreign', visibility: 'private' }; assert.equal(answer(p), false); sourceSession.pendingAskUser[p.id].respond.cancel('Revoked'); await p.promise; access = { slug: 'target', ownerId: 'owner', visibility: 'private' };
    p = await propose('rename', 'Stale'); session.title = 'Newer'; assert.equal(answer(p), false); sourceSession.pendingAskUser[p.id].respond.cancel('Stale'); await p.promise;
    p = await propose('rename', 'Replaced'); target.sm.sessions.set(session.localId, Object.assign({}, session)); assert.equal(answer(p), false); sourceSession.pendingAskUser[p.id].respond.cancel('Replaced'); await p.promise; target.sm.sessions.set(session.localId, session);
    p = await propose('rename', 'Deleted'); target.sm.sessions.delete(session.localId); assert.equal(answer(p), false); sourceSession.pendingAskUser[p.id].respond.cancel('Deleted'); await p.promise; target.sm.sessions.set(session.localId, session);
    for (var vendor of ['claude', 'codex']) { session.vendor = vendor; p = await propose('model', 'fixture-model'); answer(p); assert.equal((await p.promise).status, 'completed'); assert.equal(session.model, 'fixture-model'); p = await propose('effort', 'medium'); answer(p); assert.equal((await p.promise).status, 'completed'); }
    session.vendor = 'codex'; p = await propose('permission', 'auto'); answer(p); assert.match((await p.promise).error, /not available/);
    p = await propose('permission', 'plan'); answer(p); assert.equal((await p.promise).status, 'completed'); assert.equal(session.permissionMode, 'plan');
    session.queryInstance = { setModel: async function () { throw new Error('Fixture provider rejected model'); } };
    p = await propose('model', 'fixture-model'); answer(p); assert.equal((await p.promise).status, 'failed'); session.queryInstance = null;
    session.history = [{ type: 'user_message', text: 'Before' }, { type: 'delta', text: 'Before answer' }, { type: 'user_message', text: 'Remove this turn' }, { type: 'message_uuid', uuid: 'checkpoint', messageType: 'user', turnId: 'turn-two' }];
    session.messageUUIDs = [{ uuid: 'checkpoint', type: 'user', historyIndex: 3, turnId: 'turn-two' }];
    var foreignEvents = [], foreignViewer = { readyState: 1, _clayUser: users.findUserById('foreign'), _clayActiveSession: foreign.localId, send: function (data) { foreignEvents.push(JSON.parse(data)); } }; target.clients.add(foreignViewer);
    p = await propose('fork', 'checkpoint'); answer(p); var forked = await p.promise; assert.equal(forked.status, 'completed'); assert.equal(transport.forkCalls, 1); assert.ok(forked.forkedSessionRef); assert.equal(foreignViewer._clayActiveSession, foreign.localId); assert.equal(foreignEvents.some(function (event) { return event.type === 'session_switched' || event.type === 'history'; }), false);
    p = await propose('rewind', 'checkpoint'); answer(p); assert.equal((await p.promise).status, 'completed'); assert.equal(transport.rollbackCalls, 1); assert.equal(session.history.some(function (event) { return event.text === 'Remove this turn'; }), false);
    session.isProcessing = true; session.abortController = new AbortController(); state = await inspect();
    var stopped = await call('control_project_session', { targetToken: state.targetToken, action: 'stop', why: 'Stop requested task', requestId: 'stop-target' });
    assert.equal(stopped.status, 'queued'); assert.equal(session.taskStopRequested, true); assert.equal(session._pendingMessageDrainPaused, true); assert.equal(session.abortController.signal.aborted, true);
    p = await propose('effort', 'medium'); answer(p); assert.equal((await p.promise).status, 'failed'); session.isProcessing = false;
    p = await propose('delete'); answer(p); var deleted = await p.promise; assert.equal(deleted.status, 'completed'); assert.equal(deleted.deletedCount, 2); assert.equal(target.sm.sessions.has(session.localId), false); assert.equal(target.sm.sessions.has(worker.localId), false); assert.equal((await call('control_project_session', p.args)).status, 'completed');
    var attached = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: workspace, controlService: controls, sm: source.sm, projectSlug: 'clay-source', getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: clay.id });
    var nativeServer = attached.createMcpServer(yoke.createAdapters().adapters.claude, sourceSession);
    var nativeNames = nativeServer.tools.map(function (tool) { return tool.name; }).sort();
    var bridgeNames = (await bridge.listTools()).filter(function (tool) { return tool.server === 'clay-workspace'; }).map(function (tool) { return tool.name; }).sort();
    assert.deepEqual(nativeNames, bridgeNames);
    var nativeActions = nativeServer.tools.find(function (tool) { return tool.name === 'control_project_session'; }).inputSchema.action.options;
    ['queue_add', 'queue_edit', 'queue_cancel', 'queue_reorder', 'vendor'].forEach(function (action) { assert.ok(nativeActions.includes(action)); });
    var nativeControl = nativeServer.tools.find(function (tool) { return tool.name === 'discover_product_controls'; });
    var roster = users.loadUsers(); users.saveUsers(Object.assign({}, roster, { users: roster.users.filter(function (user) { return user.id !== 'owner'; }) }));
    assert.equal((await nativeControl.handler({})).isError, true);
    users.saveUsers(roster);
    var registry = mates.loadMates(mateCtx); mates.saveMates(mateCtx, Object.assign({}, registry, { mates: registry.mates.filter(function (mate) { return mate.id !== clay.id; }) }));
    assert.equal((await nativeControl.handler({})).isError, true);
    mates.saveMates(mateCtx, registry);
    var next = target.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' });
    p = await propose('rename', 'Must not apply after Stop', next);
    source.stopHomeSession(sourceSession); sourceSession.taskStopRequested = true; sourceSession.abortController.abort();
    assert.equal((await p.promise).status, 'cancelled'); assert.notEqual(next.title, 'Must not apply after Stop');
    sourceSession.taskStopRequested = false; sourceSession.abortController = new AbortController();
    sourceSession.vendor = 'codex'; sourceSession._sdkQueryGeneration = 9;
    assert.deepEqual(await bridge.listTools(), []); await assert.rejects(bridge.callTool('clay-workspace', 'discover_product_controls', {}), /older query/);
    bridge = source.getMcpBridgeHandler(sourceSession.localId, true, 9);
    var resumedControl = (await bridge.listTools()).find(function (tool) { return tool.name === 'control_project_session'; });
    assert.ok(resumedControl);
    ['queue_add', 'queue_edit', 'queue_cancel', 'queue_reorder', 'vendor'].forEach(function (action) { assert.ok(resumedControl.inputSchema.properties.action.enum.includes(action)); });
    sourceSession.taskStopRequested = true; assert.equal((await bridge.listTools()).some(function (tool) { return tool.name === 'control_project_session'; }), false);
    console.log('production control checks passed');
  } finally { projects.forEach(function (project) { project.destroy(); }); await scheduler.shutdown(); }
}
if (process.argv.includes('--serve-screen')) {
  screenFixture.serve({ source: source, sourceSession: sourceSession, target: target, session: session, users: users, ownerUi: ownerUi, call: call });
} else if (screenFixture) {
  screenFixture.run({ root: root, source: source, sourceSession: sourceSession, target: target, session: session, ws: ws, projects: projects,
    users: users, mates: mates, mateCtx: mateCtx, clay: clay, custom: custom, controls: controls, workspace: workspace, make: make, ownerUi: ownerUi, notifications: screenNotifications,
    revoke: function () { access = { slug: 'target', ownerId: 'foreign', visibility: 'private' }; },
    restoreAccess: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'private' }; }
  }).then(async function () { screenNotifications.stopReminder(); await Promise.all(Array.from(projects.values()).map(function (p) { return p.destroy(); })); await scheduler.shutdown(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (process.argv.includes('--serve-mates')) {
  mateLifecycle = require('../../lib/server-mates').attachMates({ users: users, mates: mates, projects: projects, removeProject: function () { throw new Error('Browser fixture only edits profiles'); } }).lifecycle;
  require('./clay-product-control-browser.cjs').start({ source: source, session: sourceSession, target: session, owner: users.findUserById('owner'),
    requestLabel: 'Request Mate profile edit', staleLabel: 'Change Mate before answering',
    state: function () { return mates.getMate(mateCtx, custom.id).name; },
    changeQueue: function () { mates.updateMate(mateCtx, custom.id, { bio: 'Concurrent owner change ' + (++counter) }); },
    request: async function () { var state = await call('inspect_mate_control', { mateId: custom.id }); return call('control_mate_lifecycle', { targetToken: state.targetToken, action: 'profile', patch: { name: 'Reviewed browser Mate' }, why: 'Keep the Mate name recognizable', requestId: 'browser-mate-' + (++counter) }); }
  });
} else if (process.argv.indexOf('--serve-queue') >= 0) {
  session.isProcessing = true;
  var ownerSocket = { readyState: 1, _clayUser: users.findUserById('owner'), _clayActiveSession: session.localId, send: function () {} }; target.clients.add(ownerSocket);
  var queueFile = path.join(require('../../lib/config').CONFIG_DIR, 'pending-message-queues');
  require('./clay-product-control-browser.cjs').start({ source: source, session: sourceSession, target: session, owner: users.findUserById('owner'),
    changeQueue: function () { target.handleMessage(ownerSocket, { type: 'message', text: 'Concurrent owner queue message', clientMessageId: 'fixture-concurrent-' + (++counter) }); },
    state: function () {
      if (!fs.existsSync(queueFile)) return '0 pending messages';
      var data = JSON.parse(fs.readFileSync(path.join(queueFile, fs.readdirSync(queueFile).find(function (file) { return file.endsWith('.json'); })), 'utf8'));
      return data.items.filter(function (item) { return item.state === 'pending'; }).length + ' pending messages';
    },
    request: async function () { var state = await inspect(); return call('control_project_session', { targetToken: state.targetToken, action: 'queue_add', text: 'Review the synthetic project task through its Driver.', why: 'Keep work in the project Driver queue', requestId: 'browser-queue-' + (++counter) }); }
  });
} else if (process.argv.indexOf('--serve') >= 0) {
  require('./clay-product-control-browser.cjs').start({ source: source, session: sourceSession, target: session, owner: users.findUserById('owner'), request: async function () {
    var state = await inspect();
    return call('control_project_session', { targetToken: state.targetToken, action: 'rename', value: 'Reviewed sample name', why: 'Make the project conversation easier to find', requestId: 'browser-' + (++counter) });
  } });
} else if (process.argv.indexOf('--milestone1b') >= 0) {
  require('./clay-product-control-queue.cjs').run(process.argv[process.argv.indexOf('--milestone1b') + 1], {
    source: source, target: target, sourceSession: sourceSession, session: session, ws: ws, projects: projects, users: users, controls: controls, workspace: workspace, clay: clay, yoke: yoke,
    make: make, decode: decode, answer: answer,
    revoke: function () { access = { slug: 'target', ownerId: 'foreign', visibility: 'private' }; },
    grantForeign: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'public' }; },
    restoreAccess: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'private' }; },
  }).then(function () { projects.forEach(function (project) { project.destroy(); }); return scheduler.shutdown(); }).then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (process.argv.indexOf('--corrections') >= 0) {
  require('./clay-product-control-corrections.cjs').run(process.argv[process.argv.indexOf('--corrections') + 1], {
    source: source, target: target, session: session, sourceSession: sourceSession, bridge: bridge, controls: controls, workspace: workspace, clay: clay, ws: ws, projects: projects,
    call: call, inspect: inspect, propose: propose, answer: answer, decode: decode, yoke: yoke, transport: transport, users: users,
    revoke: function () { access = { slug: 'target', ownerId: 'foreign', visibility: 'private' }; },
    restoreAccess: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'private' }; },
  }).then(function () { projects.forEach(function (project) { project.destroy(); }); return scheduler.shutdown(); }).then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (workspaceFixture) {
  workspaceFixture.run({ root: root, source: source, sourceSession: sourceSession, target: target, session: session, ws: ws, projects: projects,
    users: users, mates: mates, mateCtx: mateCtx, clay: clay, custom: custom, controls: controls, workspace: workspace, make: make,
    revoke: function () { access = { slug: 'target', ownerId: 'foreign', visibility: 'private' }; },
    grantForeign: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'public' }; },
    restoreAccess: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'private' }; }
  }).then(async function () { await Promise.all(Array.from(projects.values()).map(function (p) { return p.destroy(); })); await scheduler.shutdown(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (mateChatFixture) {
  mateChatFixture.run({ root: root, source: source, sourceSession: sourceSession, target: otherMate, ws: ws, projects: projects,
    users: users, mates: mates, mateCtx: mateCtx, clay: clay, custom: custom, controls: controls, make: make
  }).then(async function () { await Promise.all(Array.from(projects.values()).map(function (p) { return p.destroy(); })); await scheduler.shutdown(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (schedulingFixture) {
  schedulingFixture.run({ root: root, source: source, sourceSession: sourceSession, target: target, session: session, ws: ws, projects: projects,
    users: users, mates: mates, mateCtx: mateCtx, clay: clay, custom: custom, controls: controls, workspace: workspace, call: call, answer: answer, make: make, scheduler: scheduler,
    revoke: function () { access = { slug: 'target', ownerId: 'foreign', visibility: 'private' }; },
    restoreAccess: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'private' }; }
  }).then(async function () { await Promise.all(Array.from(projects.values()).map(function (p) { return p.destroy(); })); await scheduler.shutdown(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (process.argv.includes('--project-records')) {
  require('./clay-project-records.cjs').run({ root: root, source: source, sourceSession: sourceSession, target: target, session: session, ws: ws, projects: projects,
    users: users, mates: mates, mateCtx: mateCtx, clay: clay, custom: custom, controls: controls, call: call, answer: answer, make: make, services: recordServices,
    revoke: function () { access = { slug: 'target', ownerId: 'foreign', visibility: 'private' }; },
    restoreAccess: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'private' }; }
  }).then(async function () { await Promise.all(Array.from(projects.values()).map(function (p) { return p.destroy(); })); await scheduler.shutdown(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (process.argv.includes('--mate-knowledge')) {
  require('./clay-mate-knowledge.cjs').run({ root: root, source: source, sourceSession: sourceSession, ws: ws, projects: projects, target: target,
    users: users, mates: mates, mateCtx: mateCtx, clay: clay, custom: custom, controls: controls, workspace: workspace, yoke: yoke, mateKnowledge: mateKnowledge,
    call: call, answer: answer, make: make,
  }).then(async function () { await Promise.all(Array.from(projects.values()).map(function (p) { return p.destroy(); })); await scheduler.shutdown(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (process.argv.includes('--mate-lifecycle')) {
  var handler = require('../../lib/server-mates').attachMates({ users: users, mates: mates, projects: projects,
    removeProject: function (slug, awaitCompletion) { return require('../../lib/server-project-removal').removeProjectRuntime(projects, slug, awaitCompletion); } });
  mateLifecycle = handler.lifecycle;
  require('./clay-mate-lifecycle.cjs').run({ root: root, source: source, target: target, sourceSession: sourceSession, ws: ws, projects: projects,
    users: users, mates: mates, mateCtx: mateCtx, clay: clay, controls: controls, workspace: workspace, yoke: yoke, call: call, answer: answer, make: make, handler: handler, fixtureAdapters: fixtureAdapters,
  }).then(async function () { await Promise.all(Array.from(projects.values()).map(function (p) { return p.destroy(); })); await scheduler.shutdown(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else if (runtimeFixture) {
  runtimeFixture.run({ source: source, target: target, sourceSession: sourceSession, session: session, ws: ws, projects: projects, users: users, controls: controls, workspace: workspace, clay: clay, yoke: yoke,
    call: call, inspect: inspect, propose: propose, answer: answer, decode: decode,
    revoke: function () { access = { slug: 'target', ownerId: 'foreign', visibility: 'private' }; },
    restoreAccess: function () { access = { slug: 'target', ownerId: 'owner', visibility: 'private' }; }
  }).then(async function () { await Promise.all(Array.from(projects.values()).map(function (project) { return project.destroy(); })); await scheduler.shutdown(); process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
} else main().then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
