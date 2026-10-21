var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
// These modules accept storage and access dependencies; no users/provider/runtime
// module is imported. Every production-service instance gets temporary storage.
var views = require('../lib/project-split-views');
var schema = require('../lib/split-view-layout');
var workspace = require('../lib/project-view-workspace');
var documents = require('../lib/project-split-view-document');
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fixture(t, options) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-view-foundation-'));
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var users = new Map([['alice', { id: 'alice', linuxUser: 'alice-os' }], ['bob', { id: 'bob', linuxUser: 'bob-os' }]]);
  var sessions = new Map();
  ['a', 'b', 'c', 'foreign'].forEach(function (origin, i) { sessions.set(i + 1, { localId: i + 1, sessionOriginId: origin, ownerId: origin === 'foreign' ? 'bob' : 'alice', title: origin }); });
  var ws = { readyState: 1, _clayUser: users.get('alice'), allowed: true }, deleted;
  var ctx = { slug: 'alpha', osUsers: true, clients: new Set([ws]),
    sm: { sessionsDir: directory, sessions: sessions, addOnSessionDeleted: function (fn) { deleted = fn; } },
    usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return users.get(id); } },
    canAccessProject: function (socket) { return socket.allowed; },
    canAccessSession: function (socket, session) { return socket._clayUser.id === session.ownerId; },
    getLinuxUserForSession: function (session) { return session.ownerId + '-os'; },
    getOsUserInfoForWs: function (socket) { return { username: socket._clayUser.linuxUser }; },
    sendTo: function (socket, msg) { socket.messages = socket.messages || []; socket.messages.push(msg); } };
  Object.assign(ctx, options || {});
  var attached = views.attachProjectSplitViews(ctx);
  return { directory: directory, attached: attached, service: attached.forConnection(ws), ctx: ctx, ws: ws, users: users, sessions: sessions,
    reopen: function () { return views.createSplitViewsStore({ sessionsDir: directory, slug: 'alpha' }).state('alice', 'alice-os'); },
    remove: function (id) { var session = sessions.get(id); sessions.delete(id); deleted(id, session); } };
}
function input(origins, revision) {
  return { projectSlug: 'alpha', accountId: 'alice', expectedRevision: revision, name: 'View', sessionOrigins: origins,
    layout: 'balanced', tree: schema.createPreset(origins, 'balanced'), activeSessionOriginId: origins[0] || null };
}
function filePane(id, name, mode) {
  return { instanceId: id, kind: 'file', open: true, placement: 'docked', resource: { path: name, mode: mode || 'follow', rendered: true } };
}
function tools() {
  return { version: 1, panes: [filePane('file-a', 'docs/a.md', 'pin'),
    { instanceId: 'pty-a', kind: 'terminal', open: true, placement: 'docked', resource: { id: 1, identity: 'pty-uuid', runtimeId: 'runtime-uuid' } },
    { instanceId: 'browser-a', kind: 'browser', open: false, placement: 'overlay', resource: { id: 'browser-uuid', runtimeId: 'runtime-uuid', sessionOriginId: 'a' } }],
    tree: { axis: 'horizontal', ratio: .37, left: { id: 'file-a' }, right: { id: 'pty-a' } }, activePaneId: 'file-a' };
}
function update(created, composition, revision) {
  return Object.assign(input((created.view.sessions || created.view.sessionRefs).map(function (session) { return session.sessionOriginId || session.originId; }), revision === undefined ? created.revision : revision),
    { id: created.view.id, expectedViewRevision: created.view.revision, workspace: composition });
}
test('real service saves and reloads zero, one and multiple sessions without losing membership', function (t) {
  var f = fixture(t);
  [[], ['a'], ['b', 'c']].forEach(function (origins, i) {
    var msg = input(origins, i);
    msg.workspace = workspace.legacy({ sessionRefs: origins.map(function (origin) { return { originId: origin }; }), tree: msg.tree, activeSessionOriginId: msg.activeSessionOriginId });
    var saved = f.service.create(msg);
    assert.equal(saved.ok, true, saved.error);
    var stored = f.reopen().views.find(function (view) { return view.id === saved.view.id; });
    assert.deepEqual(stored.workspace, saved.view.workspace);
    assert.deepEqual(stored.sessionRefs.map(function (ref) { return ref.originId; }), origins);
    assert.deepEqual(f.service.state().views.find(function (view) { return view.id === stored.id; }).workspace, stored.workspace);
  });
  assert.equal(f.service.create(input(['a'], 3)).ok, false, 'membership remains exclusive');
});
test('tool-only View persists pin, runtime identity, geometry, close and overlay state through existing WS service', function (t) {
  var f = fixture(t), msg = Object.assign(input([], 0), { workspace: tools(), type: 'project_split_view_create', requestId: 'create' });
  assert.equal(f.attached.handleMessage(f.ws, msg), true);
  var created = f.ws.messages.find(function (message) { return message.type === 'project_split_view_result'; });
  assert.equal(created.ok, true, created.error);
  assert.deepEqual(f.reopen().views[0].workspace, tools());
  var next = tools(); next.panes[0].resource.mode = 'follow'; next.panes[0].resource.path = 'docs/b.md';
  next.panes[1].open = false; next.tree = { id: 'file-a' };
  var saved = f.service.update(update(created, next)); assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(f.reopen().views[0].workspace, next);
  next = clone(next); next.panes[0].placement = 'overlay'; next.tree = null;
  saved = f.service.update(update(saved, next)); assert.equal(saved.ok, true, saved.error);
  assert.equal(f.reopen().views[0].workspace.panes[0].placement, 'overlay');
  var before = fs.readFileSync(f.attached.store.filePath, 'utf8');
  for (var i = 0; i < 3; i++) f.service.state();
  assert.equal(fs.readFileSync(f.attached.store.filePath, 'utf8'), before, 'descriptor reads have no persistence or runtime effects');
});
test('legacy normalization preserves bytes, revisions, refs, geometry and deterministic identities until explicit save', function (t) {
  var f = fixture(t), created = f.service.create(input(['a', 'b'], 0));
  assert.equal(created.ok, true);
  var before = fs.readFileSync(f.attached.store.filePath, 'utf8'), raw = JSON.parse(before);
  assert.equal(raw.projects.alpha.owners['user:alice'].views[0].workspace, undefined);
  var normalized = documents.normalizeDocument(raw), first = f.reopen().views[0];
  assert.deepEqual(normalized.projects.alpha.owners['user:alice'].views[0], first);
  assert.equal(first.revision, 1); assert.deepEqual(first.tree, created.view.tree);
  assert.deepEqual(first.workspace, f.reopen().views[0].workspace);
  assert.equal(fs.readFileSync(f.attached.store.filePath, 'utf8'), before);
  var saved = f.service.update(update(created, first.workspace)); assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(f.reopen().views[0].workspace, first.workspace);
  assert.deepEqual(f.reopen().views[0].sessionRefs, first.sessionRefs);
  assert.equal(JSON.parse(fs.readFileSync(f.attached.store.filePath, 'utf8')).projects.alpha.owners['user:alice'].views[0].workspace.version, 1);
});
test('malformed, foreign and executable-looking descriptors are rejected atomically', function (t) {
  var f = fixture(t);
  var mutations = [
    function (w) { w.panes[0].kind = 'shell'; }, function (w) { w.panes[0].resource.command = 'echo forbidden'; },
    function (w) { w.panes[0].resource.path = '../secret'; }, function (w) { w.panes[0].resource.ownerId = 'bob'; },
    function (w) { w.panes[0].resource.projectSlug = 'beta'; }, function (w) { w.panes[0].resource.mode = 'unknown'; },
    function (w) { w.panes[1].resource.identity = ''; }, function (w) { w.panes[1].resource.id = 0; },
    function (w) { w.panes[1].instanceId = w.panes[0].instanceId; }, function (w) { w.panes.push(clone(w.panes[1])); w.panes[3].instanceId = 'duplicate-resource'; },
    function (w) { w.tree.left.id = 'unknown'; }, function (w) { w.tree.ratio = 1; },
    function (w) { w.activePaneId = 'browser-a'; }, function (w) { w.tree = null; },
    function (w) { w.version = 2; }, function (w) { w.panes = null; },
    function (w) { w.panes[0].kind = 'session'; w.panes[0].resource = { originId: 'foreign' }; },
    function (w) { for (var i = 0; i < workspace.MAX_TOOLS; i++) { var pane = filePane('extra-' + i, 'x.md'); pane.open = false; w.panes.push(pane); } }
  ];
  mutations.forEach(function (mutate) {
    var w = tools(); mutate(w);
    var result = f.service.create(Object.assign(input([], 0), { workspace: w }));
    assert.equal(result.ok, false, JSON.stringify(w)); assert.equal(f.attached.store.state('alice', 'alice-os').revision, 0);
  });
  assert.equal(fs.existsSync(f.attached.store.filePath), false);
});
test('exact scope and revisions reject stale clients, identity changes, foreign refs and resource rebinding', function (t) {
  var f = fixture(t), created = f.service.create(Object.assign(input([], 0), { workspace: tools() }));
  assert.equal(created.ok, true);
  var cases = [
    { expectedRevision: 0 }, { expectedViewRevision: 0 }, { expectedViewRevision: undefined },
    { projectSlug: 'beta' }, { accountId: 'bob' }, { accountId: undefined }, { id: 'foreign-view' },
    { sessionOrigins: ['foreign'], tree: { id: 'foreign' }, activeSessionOriginId: 'foreign' }
  ];
  cases.forEach(function (fields) { assert.equal(!!f.service.update(Object.assign(update(created, tools()), fields)).ok, false); });
  var changed = tools(); changed.panes[1].resource.identity = 'replacement';
  assert.equal(f.service.update(update(created, changed)).ok, false);
  assert.equal(f.service.update(Object.assign(update(created, tools()), { workspace: undefined })).code, 'workspace_required');
  assert.equal(f.reopen().revision, 1);
  var other = { readyState: 1, allowed: true, _clayUser: f.users.get('bob') }; f.ctx.clients.add(other);
  assert.deepEqual(f.attached.forConnection(other).state().views, []);
  assert.equal(!!f.attached.forConnection(other).update(Object.assign(update(created, tools()), { accountId: 'bob', expectedRevision: 0 })).ok, false);
  f.ws.readyState = 3; assert.equal(f.service.update(update(created, tools())).code, 'forbidden');
  f.ws.readyState = 1; f.users.get('alice').linuxUser = 'replacement-os'; assert.equal(f.service.state().code, 'forbidden');
});
test('workspace session deletion retains the View and other tools down to empty membership', function (t) {
  var f = fixture(t), msg = input(['a'], 0);
  msg.workspace = { version: 1, panes: [{ instanceId: 'session-a', kind: 'session', open: true, placement: 'docked', resource: { originId: 'a' } }, filePane('file-a', 'a.md', 'pin')],
    tree: { axis: 'horizontal', ratio: .6, left: { id: 'session-a' }, right: { id: 'file-a' } }, activePaneId: 'session-a' };
  var saved = f.service.create(msg); assert.equal(saved.ok, true, saved.error);
  f.remove(1);
  var current = f.reopen().views[0];
  assert.equal(current.id, saved.view.id); assert.deepEqual(current.sessionRefs, []);
  assert.equal(current.activeSessionOriginId, null); assert.equal(current.tree, null);
  assert.deepEqual(current.workspace.panes, [filePane('file-a', 'a.md', 'pin')]);
  assert.deepEqual(current.workspace.tree, { id: 'file-a' }); assert.equal(current.workspace.activePaneId, 'file-a');
});
test('failed writes preserve the exact persisted composition and allow a correlated retry', function (t) {
  var fail = false, f = fixture(t, { persist: function (file, data) { if (fail) throw new Error('isolated write failure'); fs.writeFileSync(file, data); } });
  var saved = f.service.create(Object.assign(input([], 0), { workspace: tools() })); assert.equal(saved.ok, true);
  var before = fs.readFileSync(f.attached.store.filePath, 'utf8'), next = tools(); next.panes[0].resource.mode = 'follow';
  fail = true; var failed = f.service.update(update(saved, next)); assert.equal(failed.code, 'storage');
  assert.equal(fs.readFileSync(f.attached.store.filePath, 'utf8'), before);
  assert.deepEqual(f.service.state().views[0].workspace, tools()); assert.equal(f.reopen().revision, 1);
  fail = false; assert.equal(f.service.update(update(saved, next)).ok, true); assert.equal(f.reopen().revision, 2);
});
test('one View updates through empty, singleton and multiple membership using the same service and instance identities', function (t) {
  var f = fixture(t), saved = f.service.create(input([], 0)), viewId = saved.view.id;
  [['a'], ['a', 'b'], ['b'], []].forEach(function (origins) {
    var msg = Object.assign(input(origins, saved.revision), { id: viewId, expectedViewRevision: saved.view.revision });
    msg.workspace = workspace.legacy({ sessionRefs: origins.map(function (origin) { return { originId: origin }; }), tree: msg.tree, activeSessionOriginId: msg.activeSessionOriginId });
    saved = f.service.update(msg); assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.view.id, viewId); assert.deepEqual(f.reopen().views[0].workspace, msg.workspace);
  });
  assert.equal(f.reopen().views.length, 1); assert.equal(f.reopen().views[0].tree, null);
});
test('extended Views preserve pane state on metadata edits and refuse destructive legacy transfers', function (t) {
  var f = fixture(t), msg = input(['a'], 0);
  var saved = f.service.create(msg); assert.equal(saved.ok, true);
  var edit = { id: saved.view.id, expectedRevision: 1, expectedViewRevision: 1, projectSlug: 'alpha', accountId: 'alice', name: 'Saved workspace' };
  assert.equal(f.service.rename(Object.assign({}, edit, { expectedViewRevision: 0 })).ok, false);
  var renamed = f.service.rename(edit); assert.equal(renamed.ok, true);
  assert.deepEqual(renamed.view.workspace, saved.view.workspace);
  var legacy = f.service.create(input(['b', 'c'], 2)); assert.equal(legacy.ok, true);
  var moved = f.service.move({ projectSlug: 'alpha', accountId: 'alice', expectedRevision: 3, expectedViewRevision: renamed.view.revision,
    sourceViewId: renamed.view.id, sourceSessionOriginId: 'a', targetViewId: legacy.view.id,
    targetSessionOrigins: ['a', 'b', 'c'], tree: schema.createPreset(['a', 'b', 'c'], 'balanced'), layout: 'balanced', activeSessionOriginId: 'a' });
  assert.equal(moved.code, 'workspace_required'); assert.equal(f.reopen().revision, 3);
});
test('invalid persisted workspace fails closed and live session identity revocation never deletes saved bindings', function (t) {
  var f = fixture(t), saved = f.service.create(input(['a'], 0)); assert.equal(saved.ok, true);
  var bytes = fs.readFileSync(f.attached.store.filePath, 'utf8');
  f.sessions.get(1).ownerId = 'bob';
  assert.deepEqual(f.service.state().views, []);
  assert.equal(!!f.service.update(update(saved, saved.view.workspace)).ok, false);
  assert.equal(fs.readFileSync(f.attached.store.filePath, 'utf8'), bytes);
  assert.equal(f.reopen().views[0].sessionRefs[0].ownerId, 'alice');
  var document = JSON.parse(bytes); document.projects.alpha.owners['user:alice'].views[0].workspace.panes[0].resource.originId = 'foreign';
  fs.writeFileSync(f.attached.store.filePath, JSON.stringify(document));
  assert.equal(f.reopen().code, 'storage'); assert.throws(function () { documents.normalizeDocument(document); });
});

test('production runtime prefixes persist and atomic workspace moves preserve tools and pane identities', function(t) {
  var f = fixture(t), a = input(['a'], 0);
  a.workspace = workspace.legacy({ sessionRefs: [{originId:'a'}], tree:a.tree, activeSessionOriginId:'a' });
  a.workspace.panes.push({instanceId:'terminal',kind:'terminal',open:true,placement:'docked',resource:{id:1,identity:'pty',runtimeId:'runtime:actual'}});
  a.workspace.tree = {axis:'horizontal',ratio:.4,left:a.workspace.tree,right:{id:'terminal'}};
  var source = f.service.create(a); assert.equal(source.ok,true,source.error);
  var target = f.service.create(input(['b'], source.revision)); assert.equal(target.ok,true,target.error);
  var movedPane = source.view.workspace.panes[0], next = clone(target.view.workspace);
  next.panes.push(clone(movedPane)); next.tree = {axis:'vertical',ratio:.3,left:next.tree,right:{id:movedPane.instanceId}};
  var request = {accountId:'alice',projectSlug:'alpha',expectedRevision:target.revision,expectedViewRevision:source.view.revision,
    expectedTargetViewRevision:target.view.revision,sourceViewId:source.view.id,targetViewId:target.view.id,sourceSessionOriginId:'a',
    targetSessionOrigins:['b','a'],tree:{axis:'vertical',ratio:.3,left:{id:'b'},right:{id:'a'}},layout:'balanced',activeSessionOriginId:'b',targetWorkspace:next,active:true};
  var stale = Object.assign({},request,{expectedTargetViewRevision:0}); assert.equal(f.service.move(stale).ok,false);
  var result = f.service.move(request); assert.equal(result.ok,true,result.error);
  var disk = f.reopen(); assert.equal(disk.activeViewId,target.view.id);
  var remaining = disk.views.find(function(v){return v.id===source.view.id;});
  assert.equal(remaining.sessionRefs.length,0); assert.deepEqual(remaining.workspace.tree,{id:'terminal'});
  assert.equal(disk.views.find(function(v){return v.id===target.view.id;}).workspace.panes[1].instanceId,movedPane.instanceId);
});

test('saved Terminal attachment checks current runtime, owner, identity and permission without creating a PTY', function() {
  var attach = require('../lib/project-view-terminal-binding').attachSaved, sm = {}, attached = [], errors = [];
  var terminal = {ownerId:'alice',identity:'exact',exited:false,kind:'shell'};
  var ctx = {sm:sm,tm:{inspect:function(){return terminal;},attach:function(id){attached.push(id);}},usersModule:{getEffectivePermissions:function(){return {terminal:true};}},sendTo:function(ws,msg){errors.push(msg);}};
  var ws = {_clayUser:{id:'alice'}}, msg = {id:1,savedBinding:{identity:'exact',runtimeId:require('../lib/clay-control-target-projection').runtime(sm)}};
  assert.equal(attach(ctx,ws,msg),true); assert.deepEqual(attached,[1]);
  ['identity','runtimeId'].forEach(function(key){var bad=clone(msg);bad.savedBinding[key]='stale';attach(ctx,ws,bad);});
  attach(ctx,{_clayUser:{id:'foreign'}},msg);
  terminal.exited=true;attach(ctx,ws,msg);
  assert.deepEqual(attached,[1]);assert.equal(errors.length,4);
});

test('View presentation defaults remain compatible and focus/expansion use the exact shared revision guard', function(t) {
  var f=fixture(t), created=f.service.create(input(['a'],0));assert.equal(created.ok,true);
  assert.equal(created.view.workspace.presentation,undefined);
  var value=clone(created.view.workspace);value.panes.push(filePane('file-focus','a.md','pin'));value.tree={axis:'horizontal',ratio:.6,left:value.tree,right:{id:'file-focus'}};
  value.presentation={focusedSessionOriginId:'a',expandedPaneId:'file-focus'};
  var update=Object.assign(input(['a'],created.revision),{id:created.view.id,expectedViewRevision:created.view.revision,workspace:value});
  var result=f.service.update(update);assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(f.reopen().views[0].workspace.presentation,value.presentation);
  assert.equal(f.service.update(update).ok,false,'stale focus changes cannot overwrite a newer View');
  ['foreign','missing'].forEach(function(id){var invalid=clone(value);invalid.presentation.focusedSessionOriginId=id;assert.equal(workspace.validate(invalid,{sessionRefs:[{originId:'a'}],tree:{id:'a'}}).ok,false);});
  var invalid=clone(value);invalid.presentation.expandedPaneId=invalid.panes[0].instanceId;assert.equal(workspace.validate(invalid,{sessionRefs:[{originId:'a'}],tree:{id:'a'}}).ok,false);
  invalid=clone(value);invalid.panes[1].open=false;assert.equal(workspace.validate(invalid,{sessionRefs:[{originId:'a'}],tree:{id:'a'}}).ok,false);
  var canonical=require('../lib/clay-view-workspace-input');assert.equal(canonical.schema.safeParse(value).success,true);assert.match(canonical.reviewText({workspace:value},created.view),/presentation/);
});

test('registered workbenches persist through the authoritative View service with bounded typed identities', async function (t) {
  var registry = (await import('../lib/public/modules/workbench-panels.js')).WORKBENCH_PANELS;
  assert.deepEqual(Object.keys(registry).sort(), workspace.workbenchNames.slice().sort());
  var f = fixture(t), value = { version: 1, panes: [], tree: null, activePaneId: null };
  workspace.workbenchNames.forEach(function (name, index) {
    var id = 'workbench-' + index;
    value.panes.push({ instanceId: id, kind: 'workbench', open: true, placement: 'docked', resource: { name: name } });
    value.tree = value.tree ? { axis: 'horizontal', ratio: .5, left: value.tree, right: { id: id } } : { id: id };
  });
  value.activePaneId = value.panes[0].instanceId;
  var saved = f.service.create(Object.assign(input([], 0), { workspace: value }));
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(f.reopen().views[0].workspace, value);
  assert.equal((await import('../lib/public/modules/view-workspace-validation.js')).validWorkspaceView({ sessions: [], tree: null, workspace: value }), true);
  var wrong = clone(value); wrong.panes[0].resource.name = 'settings';
  assert.equal(f.service.update(update(saved, wrong)).ok, false, 'only registered UI panels are accepted');
  wrong = clone(value); wrong.panes[0].resource.command = 'run';
  assert.equal(f.service.update(update(saved, wrong)).ok, false, 'descriptors never dispatch arbitrary operations');
  wrong = clone(value); wrong.panes[1].resource.name = wrong.panes[0].resource.name;
  assert.equal(f.service.update(update(saved, wrong)).ok, false, 'a singleton workbench cannot have duplicate identities');
  assert.deepEqual(f.reopen().views[0].workspace, value, 'failed writes leave the saved composition intact');
});
