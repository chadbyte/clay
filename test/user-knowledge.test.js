var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var attachService = require('../lib/user-knowledge-service').attachUserKnowledgeService;
var attachProject = require('../lib/project-user-knowledge').attachProjectUserKnowledge;

function fixture(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-you-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var events = [];
  var sessions = new Map();
  var projects = new Map();
  var access = true;
  var users = { alice: {}, bob: {} };
  var deps = {
    baseDir: root, isMultiUser: function () { return true; }, findUser: function (id) { return users[id]; },
    getProject: function (slug) { return projects.get(slug); }, canAccess: function () { return access; },
    resolveMate: function (id, mateId) { return mateId === id + '-clay' ? { builtinKey: 'clay', createdBy: id } : { builtinKey: 'other', createdBy: id }; },
    onReport: function (id) { events.push({ report: id }); }, onChange: function (id, item) { events.push({ owner: id, item: item }); },
  };
  var service = attachService(deps);
  function bind(id, slug, mate) {
    var session = { localId: sessions.size + 1, ownerId: id, sessionVisibility: 'private' };
    sessions.set(session.localId, session);
    var project = { sm: { sessions: sessions, saveSessionFile: function () {} }, getStatus: function () { return { isMate: !!mate, mateId: mate }; } };
    projects.set(slug, project);
    return { tools: service.bind({ projectSlug: slug, session: session }), session: session, project: project, slug: slug };
  }
  return { service: service, deps: deps, bind: bind, events: events, users: users, sessions: sessions, revoke: function () { access = false; } };
}
function report(tools, text) { return tools.report({ observation: text || 'Prefers product-focused reviews', evidence: 'Explain what you inspected before test counts.', evidenceType: 'explicit' }); }
function save(tools, observation, extra) {
  return tools.curate(Object.assign({ reportRef: observation.ref, action: 'save', title: 'Lead with product quality', category: 'working-style', summary: 'Describe inspected behavior before test counts.', body: 'In review reports, lead with the observed product result. Test evidence is supporting detail.', reason: 'Explicit and durable review preference.' }, extra || {}));
}

test('projects and ordinary Mates report; only the owner’s canonical Clay creates, revises or declines knowledge', function (t) {
  var f = fixture(t);
  var project = f.bind('alice', 'project');
  var mate = f.bind('alice', 'mate-other', 'other');
  var clay = f.bind('alice', 'mate-clay', 'alice-clay');
  var observation = report(project.tools);
  assert.equal(f.service.list('alice').items.length, 0);
  assert.equal(f.events.filter(function (e) { return e.item; }).length, 0);
  assert.throws(function () { save(project.tools, observation); }, /canonical Clay/);
  assert.throws(function () { save(mate.tools, observation); }, /canonical Clay/);
  var entry = save(clay.tools, observation).entry;
  assert.equal(project.tools.list({}).items[0].ref, entry.ref);
  assert.equal(project.session.userKnowledgeOwnerId, 'alice');
  var correction = report(mate.tools, 'Apply this specifically to code reviews');
  assert.throws(function () { save(clay.tools, correction, { ref: entry.ref, expectedRevision: 0 }); }, /changed/);
  var updated = save(clay.tools, correction, { ref: entry.ref, expectedRevision: 1, body: 'For code reviews, explain the observed product behavior first.' }).entry;
  assert.equal(updated.revisions, 2);
  assert.equal(f.service.list('alice').total, 1);
  var transient = report(project.tools, 'Currently running a test');
  clay.tools.curate({ reportRef: transient.ref, action: 'decline', reason: 'Temporary task progress.' });
  assert.equal(f.service.activity('alice').total, 2);
  assert.equal(clay.tools.pending({}).total, 0);
  assert.equal(f.events.filter(function (e) { return e.item; })[1].item.action, 'update');
  assert.equal(save(clay.tools, observation).entry.revisions, 2, 'retrying a decided observation cannot create another entry');
});

test('owner boundaries, session liveness and access are checked on each call', function (t) {
  var f = fixture(t);
  var alice = f.bind('alice', 'alice', 'alice-clay');
  var bob = f.bind('bob', 'bob', 'bob-clay');
  var entry = save(alice.tools, report(alice.tools)).entry;
  assert.equal(bob.tools.list({}).total, 0);
  assert.throws(function () { bob.tools.read({ ref: entry.ref }); }, /not found/);
  assert.throws(function () { save(bob.tools, { ref: alice.tools.report({ observation: 'Another preference', evidence: 'Explicit quote' }).ref }); }, /not found/);
  alice.session.sessionVisibility = 'shared';
  assert.throws(function () { alice.tools.list({}); }, /shared conversations/);
  alice.session.sessionVisibility = 'private';
  alice.session.ownerId = 'bob';
  assert.throws(function () { alice.tools.list({}); }, /ownership changed/);
  alice.session.ownerId = 'alice';
  f.revoke();
  assert.throws(function () { alice.tools.list({}); }, /revoked/);
  f.sessions.delete(bob.session.localId);
  assert.throws(function () { bob.tools.list({}); }, /live owner-bound/);
});

test('reports persist across restart; archives disappear from retrieval and injected context', function (t) {
  var f = fixture(t);
  var clay = f.bind('alice', 'clay', 'alice-clay');
  var observation = report(clay.tools);
  assert.equal(report(clay.tools).ref, observation.ref, 'pending retries deduplicate');
  var restored = attachService(f.deps);
  assert.equal(restored.pendingCount('alice'), 1);
  var entry = save(clay.tools, observation).entry;
  var forget = report(clay.tools, 'Stop using that review preference');
  clay.tools.curate({ reportRef: forget.ref, action: 'archive', ref: entry.ref, expectedRevision: 1, reason: 'Explicit forget request.' });
  assert.equal(restored.list('alice').total, 0);
  assert.throws(function () { restored.read('alice', entry.ref); }, /not found/);
  assert.equal(restored.pendingCount('alice'), 0);
});

test('tools bind identity server-side and humans can only read or report', async function (t) {
  var f = fixture(t);
  var clay = f.bind('alice', 'clay', 'alice-clay');
  var ordinary = f.bind('alice', 'ordinary');
  var responses = [];
  var module = attachProject({ service: f.service, slug: 'ordinary', isMultiUser: function () { return true; }, sendTo: function (ws, msg) { responses.push(msg); }, schedule: function () {} });
  var defs = module.getDynamicToolDefs(ordinary.session);
  assert.equal(defs.some(function (d) { return d.name === 'curate_user_knowledge'; }), false);
  assert.equal(module.handleMessage({ _clayUser: { id: 'alice' } }, { type: 'you_curate', action: 'save' }), false);
  module.handleMessage({ _clayUser: { id: 'alice' } }, { type: 'you_report', observation: 'Use concise review reports.', ownerId: 'bob', requestId: 'r1' });
  assert.equal(responses[0].ok, true);
  assert.equal(f.service.pendingCount('alice'), 1);
  assert.equal(f.service.pendingCount('bob'), 0);
  var observation = clay.tools.pending({}).items[0];
  var entry = save(clay.tools, observation).entry;
  module.handleMessage({ _clayUser: { id: 'bob' } }, { type: 'you_read', ref: entry.ref, ownerId: 'alice', requestId: 'r2' });
  assert.equal(responses[1].ok, false);
  module.handleMessage({}, { type: 'you_list' });
  assert.equal(responses[2].ok, false);
  var mcp = module.createMcpServer({ createToolServer: function (definition) { return definition; } }, ordinary.session);
  assert.deepEqual(mcp.tools.map(function (tool) { return tool.name; }), defs.map(function (tool) { return tool.name; }));
  var response = await module.callBridgeTool(ordinary.session, 'read_user_knowledge', { ref: entry.ref });
  assert.equal(JSON.parse(response.content[0].text).ref, entry.ref);
});

test('foreign input and shared Driver ancestry cannot reach personal knowledge', function (t) {
  var f = fixture(t);
  var driver = f.bind('alice', 'project');
  var worker = f.bind('alice', 'worker-project');
  driver.session.sessionOriginId = 'driver-origin';
  worker.session.sessionProvenance = { kind: 'worker', parentSessionOriginId: 'driver-origin' };
  driver.session.sessionVisibility = 'shared';
  assert.throws(function () { worker.tools.list({}); }, /owner-only/);
  driver.session.sessionVisibility = 'private';
  driver.session._mcpForeignInput = true;
  assert.throws(function () { driver.tools.report({ observation: 'Foreign claim', evidence: 'Not from the owner' }); }, /owner-only/);
  assert.throws(function () { worker.tools.list({}); }, /owner-only/);
  driver.session._mcpForeignInput = false;
  driver.session.history = [{type:'user_message',from:'bob',text:'Foreign input'}];
  assert.throws(function () { worker.tools.list({}); }, /owner-only/);
});

test('private knowledge sessions retain owner-only access after persistence and cannot be shared or transferred', function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'you-session-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var options = { cwd:root, sessionsBase:path.join(root,'sessions'), cliSessionsDir:path.join(root,'cli'), send:function () {} };
  var createManager = require('../lib/sessions').createSessionManager;
  var manager = createManager(options);
  var session = manager.createSessionRaw({ ownerId:'alice',userKnowledgeOwnerId:'alice' });
  session.cliSessionId = 'private-you-history';
  session.codexYouToolCatalogVersion = 1;
  manager.saveSessionFile(session);
  assert.ok(manager.setSessionVisibility(session.localId,'shared').error);
  assert.ok(manager.setSessionOwner(session.localId,'bob').error);
  var restored = Array.from(createManager(options).sessions.values()).find(function (s) {return s.cliSessionId==='private-you-history';});
  assert.equal(restored.userKnowledgeOwnerId,'alice');
  assert.equal(restored.codexYouToolCatalogVersion,1);
  var permissions = require('../lib/users-permissions').attachPermissions({findUserById:function(id){return {id:id,role:id==='admin'?'admin':'user'};}});
  assert.equal(permissions.canAccessSession('alice',restored,{visibility:'public'}),true);
  assert.equal(permissions.canAccessSession('admin',restored,{visibility:'public'}),false);
  assert.equal(permissions.canAccessSession('bob',restored,{visibility:'public'}),false);
});

test('memory comments persist as pending observations and show Clay’s decision without direct edits', function (t) {
  var f = fixture(t);
  var clay = f.bind('alice', 'clay', 'alice-clay');
  var entry = save(clay.tools, report(clay.tools)).entry;
  assert.throws(function () { f.service.comment('bob', { ref: entry.ref, body: 'Change this' }, { session: 'human', project: 'clay' }); }, /not found/);
  var comment = f.service.comment('alice', { ref: entry.ref, body: 'Only apply this to code reviews.' }, { session: 'human', project: 'clay' });
  var read = f.service.read('alice', entry.ref);
  assert.equal(read.revisions, 1);
  assert.equal(read.comments[0].status, 'pending');
  assert.equal(f.service.activity('alice').total, 1);
  var restored = attachService(f.deps);
  assert.equal(restored.read('alice', entry.ref).comments[0].body, 'Only apply this to code reviews.');
  clay.tools.curate({ reportRef: comment.ref, action: 'decline', reason: 'This scope is already captured.' });
  read = restored.read('alice', entry.ref);
  assert.equal(read.comments[0].status, 'declined');
  assert.equal(read.comments[0].review.response, 'This scope is already captured.');
  assert.equal(read.revisions, 1);
});

test('unread memories track the owner’s viewed revision, survive restart, and ignore agent reads', function (t) {
  var f = fixture(t);
  var clay = f.bind('alice', 'clay', 'alice-clay');
  var entry = save(clay.tools, report(clay.tools)).entry;
  assert.equal(f.service.attention('alice').unread, 1);
  assert.equal(f.service.attention('bob').unread, 0);
  clay.tools.read({ ref: entry.ref });
  clay.tools.list({});
  assert.equal(f.service.attention('alice').unread, 1, 'agent retrieval never acknowledges');
  assert.throws(function () { f.service.acknowledge('bob', { ref: entry.ref, revision: 1 }); }, /not found/);
  assert.throws(function () { f.service.acknowledge('alice', { ref: entry.ref, revision: 99 }); }, /revision/);
  assert.equal(f.service.acknowledge('alice', { ref: entry.ref, revision: 1 }).unread, 0);
  var restored = attachService(f.deps);
  assert.equal(restored.attention('alice').unread, 0);
  assert.equal(restored.list('alice').items[0].unread, false);
  var update = report(clay.tools, 'Refine review preference');
  save(clay.tools, update, { ref: entry.ref, expectedRevision: 1 });
  assert.equal(restored.attention('alice').unread, 1);
  assert.equal(restored.acknowledge('alice', { ref: entry.ref, revision: 1 }).unread, 1, 'stale acknowledgement cannot clear a newer revision');
  assert.equal(restored.list('alice').items[0].unread, true);
  var archive = report(clay.tools, 'Forget review preference');
  clay.tools.curate({ reportRef: archive.ref, ref: entry.ref, expectedRevision: 2, action: 'archive', reason: 'User asked to forget.' });
  assert.equal(restored.attention('alice').unread, 0);
});

test('human acknowledgement binds the authenticated owner and does not announce another saved memory', function (t) {
  var f = fixture(t);
  var clay = f.bind('alice', 'clay', 'alice-clay');
  var entry = save(clay.tools, report(clay.tools)).entry;
  var replies = [];
  var project = attachProject({ service: f.service, slug: 'clay', isMultiUser: function () { return true; }, sendTo: function (ws,msg) { replies.push(msg); } });
  project.handleMessage({ _clayUser: { id: 'bob' } }, { type: 'you_seen', userId: 'alice', ref: entry.ref, revision: 1 });
  assert.equal(replies.pop().ok, false);
  project.handleMessage({ _clayUser: { id: 'alice' } }, { type: 'you_seen', ref: entry.ref, revision: 1 });
  assert.equal(replies.pop().result.unread, 0);
  assert.equal(f.events[f.events.length-1].item.seen, true);
  assert.equal(f.service.activity('alice').total, 1);
});
