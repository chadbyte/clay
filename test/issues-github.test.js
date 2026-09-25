var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var attach = require('../lib/issues-github').attachIssueGithub;
var makeStore = require('../lib/issues-store').createIssuesStore;
function fixture(t, run) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-github-issues-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var store = makeStore({ projectKnowledgeId: 'pk_test', baseDir: dir });
  var issue = store.create({ title: 'A concrete bug', body: 'Reproduction steps' }, { type: 'user', userId: 'u1' });
  var allowed = true; var calls = [];
  var assessments = new Map();
  var context = { assessments: assessments, analyze: async function (before, prompt) { return prompt.indexOf('queries') >= 0 ? JSON.stringify({ queries: ['concrete bug', 'reproduction problem'] }) : JSON.stringify({ decision: 'ambiguous', matches: [{ url: result().url, reason: 'Similar symptoms, needs confirmation.' }] }); }, locks: new Map(), begin: function () { if (!allowed) throw new Error('Access revoked'); return { path: '/repo', knowledgeId: 'pk_test', osIdentity: { uid: 12 } }; },
    read: function (before, ref) { if (!allowed) throw new Error('Access revoked'); return store.read(ref); },
    save: function (before, ref, data, revision) { if (!allowed) throw new Error('Access revoked'); return store.update(ref, data, revision, { type: 'user', userId: 'u1' }); },
    run: async function (cwd, args, identity, input) { calls.push({ args: args, identity: identity, input: input }); return run(args, input); } };
  assessments.set('reviewed', { owner: JSON.stringify(['pk_test', '/repo', undefined, { uid: 12 }]), ref: issue.ref, revision: 1, repository: 'owner/repo', ambiguous: false, expires: Date.now() + 300000 });
  return { api: attach(context), store: store, issue: issue, calls: calls, context: context, dir: dir,
    revoke: function () { allowed = false; }, args: function () { return { ref: issue.ref, expectedRevision: store.read(issue.ref).revision, repository: 'owner/repo', assessment: 'reviewed', title: 'Reviewed title', body: 'Reviewed body', confirm: true }; } };
}
function result() { return { url: 'https://github.com/owner/repo/issues/12', title: 'Existing issue', state: 'OPEN' }; }

test('search is read-only, includes closed issues and preserves caller identity', async function (t) {
  var f = fixture(t, function (args) { return args[0] === 'repo' ? { nameWithOwner: 'owner/repo' } : [result()]; });
  var data = await f.api.search(f.args());
  assert.equal(data.candidates[0].number, 12);
  assert.equal(data.repository, 'owner/repo');
  assert.ok(f.calls[1].args.includes('all'));
  assert.deepEqual(f.calls[1].identity, { uid: 12 });
  assert.equal(f.store.read(f.issue.ref).revision, 1);
});

test('verified link persists independently from sessions and across store reload', async function (t) {
  var f = fixture(t, function () { return result(); });
  var linked = await f.api.link(Object.assign(f.args(), { url: result().url }));
  assert.equal(linked.github.number, 12);
  assert.equal(linked.linkedWorkSessions.length, 0);
  var reload = makeStore({ projectKnowledgeId: 'pk_test', baseDir: f.dir });
  assert.equal(reload.read(f.issue.ref).github.url, result().url);
  assert.equal(reload.readRevision(f.issue.ref, 2).github.url, result().url);
  assert.equal(reload.readRevision(f.issue.ref, 1).github, undefined);
  await assert.rejects(f.api.link({ ref: f.issue.ref, expectedRevision: 1, url: result().url }), /changed/);
  await assert.rejects(f.api.link(Object.assign(f.args(), { url: 'https://github.com/owner/repo/pull/12' })), /issue URL/);
});

test('creation requires review, checks repository, records attempt before POST, and links once', async function (t) {
  var f = fixture(t, function (args, input) {
    if (args[0] === 'repo') return { nameWithOwner: 'owner/repo' };
    assert.ok(f.store.read(f.issue.ref).github.attempt);
    var payload = JSON.parse(input);
    assert.equal(payload.title, 'Reviewed title');
    assert.match(payload.body, /Reviewed body\n\n<!-- clay-issue-/);
    return { html_url: result().url, title: 'Reviewed title', state: 'open' };
  });
  await assert.rejects(f.api.create(Object.assign(f.args(), { confirm: false })), /Review/);
  await assert.rejects(f.api.create(Object.assign(f.args(), { repository: 'wrong/repo' })), /repository changed/);
  var linked = await f.api.create(f.args());
  assert.equal(linked.github.url, result().url);
  await assert.rejects(f.api.create(f.args()), /already connected/);
  assert.equal(f.calls.filter(function (call) { return call.args[0] === 'api'; }).length, 1);
});

test('ambiguous POST failure survives restart and prevents another creation', async function (t) {
  var f = fixture(t, function (args) { if (args[0] === 'repo') return { nameWithOwner: 'owner/repo' }; throw new Error('timeout'); });
  await assert.rejects(f.api.create(f.args()), /could not be confirmed/);
  var restarted = attach(Object.assign({}, f.context, { locks: new Map() }));
  await assert.rejects(restarted.create(f.args()), /previous creation/);
  assert.equal(f.calls.filter(function (call) { return call.args[0] === 'api'; }).length, 1);
  var recovery = attach(Object.assign({}, f.context, { run: async function (cwd, args) { return args.includes('clay-issue-' + f.issue.ref.slice(6) + ' in:body') ? [result()] : []; } }));
  assert.equal((await recovery.search(f.args())).candidates[0].number, 12);
});

test('concurrent requests and revoked access cannot trigger a second external mutation', async function (t) {
  var release;
  var f = fixture(t, function (args) { return new Promise(function (resolve) { release = resolve; }); });
  var first = f.api.create(f.args());
  await assert.rejects(f.api.create(f.args()), /already running/);
  f.revoke(); release({ nameWithOwner: 'owner/repo' });
  await assert.rejects(first, /Access revoked/);
  assert.equal(f.calls.length, 1);
});

test('definitive rejection clears pending state for a corrected retry', async function (t) {
  var f = fixture(t, function (args) { if (args[0] === 'repo') return { nameWithOwner: 'owner/repo' }; var error = new Error('forbidden'); error.status = 403; throw error; });
  await assert.rejects(f.api.create(f.args()), /rejected creation/);
  assert.equal(f.store.read(f.issue.ref).github, undefined);
});

test('service binding enforces live access, OS identity, and server-owned GitHub fields', async function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-github-auth-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var user = { id: 'u1' }; var access = true; var identity = null; var calls = [];
  var session = { localId: 1, ownerId: 'u1', vendor: 'codex' };
  var status = { slug: 'app', path: dir, projectKnowledgeId: 'pk_auth', projectOwnerId: 'u1' };
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return { sessions: new Map([[1, session]]) }; } };
  var service = require('../lib/issues-service').attachIssuesService({ getProjects: function () { return new Map([['app', project]]); },
    isMultiUser: function () { return true; }, findUserById: function (id) { return access && id === 'u1' ? user : null; },
    canAccessProject: function () { return access; }, hasFullProjectAccess: function () { return access; },
    osUsersEnabled: true, getOsUserInfoForActor: function () { return identity; }, baseDir: dir,
    analyzeGithub: async function (before, prompt) { return prompt.indexOf('queries') >= 0 ? JSON.stringify({ queries: ['auth bug', 'access problem'] }) : JSON.stringify({ decision: 'none', matches: [] }); },
    runGithub: async function (cwd, args, actor) { calls.push(actor); return args[0] === 'repo' ? { nameWithOwner: 'owner/repo' } : [result()]; } });
  var driver = service.bindProjectSession({ projectSlug: 'app', session: session });
  var human = service.bindUser({ projectSlug: 'app', userId: 'u1' });
  var issue = await driver.createIssue({ title: 'Auth boundary' });
  await assert.rejects(human.searchGithubIssue({ ref: issue.ref, expectedRevision: 1 }), /OS identity/);
  assert.equal(calls.length, 0);
  identity = { uid: 12, gid: 12, home: '/home/u1', user: 'u1' };
  await human.searchGithubIssue({ ref: issue.ref, expectedRevision: 1 });
  assert.deepEqual(calls[0], identity);
  await assert.rejects(driver.searchGithubIssue({ ref: issue.ref }), /explicit action/);
  assert.throws(function () { human.updateIssue({ ref: issue.ref, expectedRevision: 1, github: { url: result().url } }); }, /server-owned/);
  access = false;
  await assert.rejects(human.searchGithubIssue({ ref: issue.ref, expectedRevision: 1 }), /no longer valid/);
});

test('clear semantic duplicate links automatically without POST', async function (t) {
  var f = fixture(t, function (args) { return args[0] === 'repo' ? { nameWithOwner: 'owner/repo' } : args[1] === 'view' ? result() : [Object.assign(result(), { body: 'Same reproduction under a different title' })]; });
  var api = attach(Object.assign({}, f.context, { analyze: async function (before, prompt) {
    if (prompt.indexOf('queries') >= 0) return JSON.stringify({ queries: ['failure symptom', 'component error'] });
    assert.match(prompt, /Same reproduction/);
    return JSON.stringify({ decision: 'duplicate', matches: [{ url: result().url, reason: 'Same component and reproduction.' }] });
  } }));
  var response = await api.search(f.args());
  assert.equal(response.linked.github.number, 12);
  assert.equal(f.calls.some(function (call) { return call.args[0] === 'api'; }), false);
});

test('creation rejects missing, expired, foreign and unreviewed ambiguous assessments', async function (t) {
  var f = fixture(t, function () { return { nameWithOwner: 'owner/repo' }; });
  await assert.rejects(f.api.create(Object.assign(f.args(), { assessment: undefined })), /Check for duplicates/);
  var assessment = f.context.assessments.get('reviewed');
  assessment.expires = 0;
  await assert.rejects(f.api.create(f.args()), /Check for duplicates/);
  assessment.expires = Date.now() + 60000; assessment.owner = 'another user';
  await assert.rejects(f.api.create(f.args()), /Check for duplicates/);
  assessment.owner = JSON.stringify(['pk_test', '/repo', undefined, { uid: 12 }]); assessment.ambiguous = true;
  await assert.rejects(f.api.create(f.args()), /Review the possible/);
  assert.equal(f.calls.some(function (call) { return call.args[0] === 'api'; }), false);
});

test('no-match assessment enables preview and a single reviewed creation', async function (t) {
  var f = fixture(t, function (args) { return args[0] === 'repo' ? { nameWithOwner: 'owner/repo' } : args[0] === 'api' ? result() : []; });
  f.context.assessments.clear();
  var response = await f.api.search(f.args());
  assert.equal(response.preview, true);
  assert.equal(response.decision, 'none');
  assert.ok(response.assessment);
  var linked = await f.api.create(Object.assign(f.args(), { assessment: response.assessment }));
  assert.equal(linked.github.number, 12);
});

test('failed search and invented model matches cannot authorize creation or linking', async function (t) {
  var f = fixture(t, function (args) { return args[0] === 'repo' ? { nameWithOwner: 'owner/repo' } : [result()]; });
  f.context.assessments.clear();
  var api = attach(Object.assign({}, f.context, { analyze: async function (before, prompt) {
    return prompt.indexOf('queries') >= 0 ? JSON.stringify({ queries: ['bug', 'problem'] }) : JSON.stringify({ decision: 'duplicate', matches: [{ url: 'https://github.com/owner/repo/issues/999', reason: 'Injected URL' }] });
  } }));
  await assert.rejects(api.search(f.args()), /invalid match/);
  assert.equal(f.context.assessments.size, 0);
  var broken = attach(Object.assign({}, f.context, { run: async function () { throw new Error('GitHub unavailable'); } }));
  await assert.rejects(broken.search(f.args()), /GitHub unavailable/);
  assert.equal(f.context.assessments.size, 0);
  assert.equal(f.store.read(f.issue.ref).revision, 1);
});

test('issue edits during comparison prevent an automatic association', async function (t) {
  var f = fixture(t, function (args) { return args[0] === 'repo' ? { nameWithOwner: 'owner/repo' } : [result()]; });
  var api = attach(Object.assign({}, f.context, { analyze: async function (before, prompt) {
    if (prompt.indexOf('queries') >= 0) return JSON.stringify({ queries: ['bug', 'problem'] });
    f.store.update(f.issue.ref, { title: 'A different issue' }, 1, { type: 'user', userId: 'u1' });
    return JSON.stringify({ decision: 'duplicate', matches: [{ url: result().url, reason: 'Same reproduction.' }] });
  } }));
  await assert.rejects(api.search(f.args()), /Issue changed/);
  assert.equal(f.store.read(f.issue.ref).github, undefined);
});
