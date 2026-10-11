var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var permissions = require('../lib/users-permissions').attachPermissions({
  findUserById: function (id) { return { id: id, role: id === 'admin' ? 'admin' : 'user' }; }
});
var access = require('../lib/daemon-project-access');
var createSessionManager = require('../lib/sessions').createSessionManager;

test('Mate ownership overrides public visibility, grants, shared sessions and administrator privileges', function () {
  [ {isMate:true}, {slug:'mate-private'} ].forEach(function (marker) {
    var project = Object.assign({ownerId:'alice', visibility:'public', allowedUsers:['bob','admin']}, marker);
    var session = {ownerId:'alice', sessionVisibility:'shared'};
    ['bob', 'admin', null].forEach(function (id) {
      assert.equal(permissions.canAccessProject(id, project), false);
      assert.equal(permissions.canAccessSession(id, session, project), false);
    });
    assert.equal(permissions.canAccessProject('alice', project), true);
    assert.equal(permissions.canAccessSession('alice', session, project), true);
    assert.equal(permissions.canAccessProject('admin', Object.assign({}, project, {ownerId:null})), false);
    assert.equal(permissions.canAccessSession('alice', {ownerId:'bob',sessionVisibility:'shared'}, project), false);
  });
  assert.equal(permissions.canAccessProject('admin', {visibility:'private',ownerId:'alice'}), true);
  assert.equal(permissions.canAccessSession('bob', {ownerId:'alice',sessionVisibility:'shared'}, {visibility:'public'}), true);
});

test('Mate ACL and defaults cannot be changed even with stale shared configuration', function () {
  var project = {slug:'mate-private',ownerId:'alice',visibility:'public',allowedUsers:['bob'],sessionVisibilityDefault:'shared'};
  var config = {projects:[project]};
  var before = JSON.stringify(config);
  var record = access.getProjectAccess(config, project.slug, false);
  assert.equal(record.isMate, true);
  assert.equal(record.visibility, 'private');
  assert.deepEqual(record.allowedUsers, []);
  assert.equal(record.sessionVisibilityDefault, 'private');
  assert.ok(access.setAllowedUsers(config, project.slug, ['admin']).error);
  assert.ok(access.setSessionVisibilityDefault(config, project.slug, 'shared').error);
  assert.equal(JSON.stringify(config), before);
});

test('Mate sessions are private at creation, mutation and legacy restore', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'mate-private-'));
  t.after(function () { fs.rmSync(root, {recursive:true,force:true}); });
  var options = {isMate:true,cwd:root,sessionsBase:path.join(root,'sessions'),cliSessionsDir:path.join(root,'cli'),send:function () {}};
  var sm = createSessionManager(options);
  ['createSession','createSessionRaw'].forEach(function (method) {
    var session = sm[method]({ownerId:'alice',sessionVisibility:'shared'});
    assert.equal(session.isMate, true);
    assert.equal(session.sessionVisibility, 'private');
    assert.ok(sm.setSessionVisibility(session.localId, 'shared').error);
    assert.ok(sm.setSessionOwner(session.localId, 'bob').error);
    assert.equal(session.ownerId, 'alice');
    assert.equal(sm.mapSessionForClient(session).sessionVisibility, 'private');
  });
  fs.writeFileSync(path.join(sm.sessionsDir,'legacy.jsonl'), JSON.stringify({type:'meta',localId:90,cliSessionId:'legacy',ownerId:'alice',sessionVisibility:'shared',sessionVisibilityExplicit:true})+'\n'+JSON.stringify({type:'user_message',text:'private history'})+'\n');
  var restored = Array.from(createSessionManager(options).sessions.values()).find(function (session) { return session.cliSessionId === 'legacy'; });
  assert.equal(restored.isMate, true);
  assert.equal(restored.sessionVisibility, 'private');
  assert.equal(restored.history[0].text, 'private history');
  assert.equal(permissions.canAccessSession('admin',restored,{visibility:'public'}),false);
});

test('Mate update and deletion events reach only sockets owned by the requester', function () {
  var attachMates = require('../lib/server-mates').attachMates;
  var sockets = ['alice','alice','bob','admin',null].map(function (id) {
    return {_clayUser:id ? {id:id}:null, readyState:1, received:[],send:function (data) {this.received.push(JSON.parse(data));}};
  });
  var controller = attachMates({
    users:{isMultiUser:function () {return true;}},
    mates:{buildMateCtx:function (id) {return {userId:id};}, updateMate:function (ctx) {return ctx.userId==='alice' ? {id:'private',createdBy:'alice'}:null;},getMate:function () {return {id:'private'};},deleteMate:function () {return {};},getAllMates:function () {return [];},getMissingBuiltinKeys:function () {return [];}},
    projects:new Map([['ordinary',{getStatus:function () {return {isMate:false};},forEachClient:function (fn) {sockets.forEach(fn);}}]]),
    removeProject:function () {}
  });
  controller.handleMessage(sockets[0],{type:'mate_update',mateId:'private',updates:{name:'Secret'}});
  controller.handleMessage(sockets[0],{type:'mate_delete',mateId:'private'});
  sockets.slice(0,2).forEach(function (socket) {assert.deepEqual(socket.received.map(function (m) {return m.type;}),['mate_updated','mate_deleted']);});
  sockets.slice(2).forEach(function (socket) {assert.deepEqual(socket.received,[]);});
});

test('custom Mate avatars require owner registry membership and cannot be publicly cached', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(),'mate-avatar-private-'));
  t.after(function () {fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'mate-avatars'));
  fs.writeFileSync(path.join(root,'mate-avatars','private.png'),'private image');
  var handler = require('../lib/server-settings').attachSettings({
    CONFIG_DIR:root,opts:{},users:{isMultiUser:function () {return true;}},
    getMultiUserFromReq:function (req) {return req.user;},
    mates:{buildMateCtx:function (id) {return {userId:id};},getMate:function (ctx,id) {return ctx.userId==='alice' && id==='private' ? {id:id}:null;}}
  });
  ['alice','bob','admin',null].forEach(function (id) {
    var response = {writeHead:function (status,headers) {this.status=status;this.headers=headers;},end:function (body) {this.body=body;}};
    handler.handleRequest({method:'GET',user:id ? {id:id}:null},response,'/api/mate-avatar/private');
    assert.equal(response.status,id==='alice' ? 200:404);
    if(id==='alice') assert.equal(response.headers['Cache-Control'],'private, no-store');
    else assert.equal(response.body,undefined);
  });
});


test('Mate registry updates cannot change ownership or identity', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(),'mate-registry-private-'));
  t.after(function () {fs.rmSync(root,{recursive:true,force:true});});
  var script = [
    "var assert = require('node:assert/strict');",
    "var mates = require('./lib/mates');",
    "var alice = {userId:'alice',multiUser:true};",
    "var bob = {userId:'bob',multiUser:true};",
    "var mate = mates.createMate(alice,{vendor:'codex'});",
    "var saved = mates.updateMate(alice,mate.id,{createdBy:'bob',id:'replacement',name:'Renamed',builtinKey:'clay'});",
    "assert.equal(saved.builtinKey,undefined);",
    "assert.equal(saved.createdBy,'alice'); assert.equal(saved.id,mate.id); assert.equal(saved.name,'Renamed');",
    "assert.equal(mates.getMate(bob,mate.id),null);",
    "assert.equal(mates.updateMate(bob,mate.id,{name:'Stolen'}),null);",
    "assert.equal(mates.getMate(alice,mate.id).createdBy,'alice');"
  ].join('\n');
  var result = require('node:child_process').spawnSync(process.execPath,['-e',script],{
    cwd:path.join(__dirname,'..'), env:Object.assign({},process.env,{CLAY_HOME:root,CLAY_CONFIG:path.join(root,'daemon.json'),CLAY_DEV:''}),encoding:'utf8'
  });
  assert.equal(result.status,0,result.stderr || result.stdout);
});

test('workspace query access never falls back to administrator or public ACL for foreign Mates', function () {
  var evaluator = require('../lib/workspace-query-access').attachWorkspaceQueryAccess({
    isMultiUser:function () {return true;},resolveMate:function () {return null;},
    onGetProjectAccess:function () {return {visibility:'public',ownerId:'admin'};},
    canAccessProject:permissions.canAccessProject
  });
  assert.deepEqual(evaluator.evaluate({userId:'admin'},{isMate:true,mateId:'private',slug:'mate-private',projectOwnerId:'alice'}),{owned:false,accessible:false});
});
