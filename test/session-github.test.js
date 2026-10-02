var test = require('node:test');
var assert = require('node:assert/strict');
var github = require('../lib/session-github');
var attach = require('../lib/project-session-github').attachSessionGithub;
var url = 'https://github.com/chadbyte/clay/pull/542';
function world(run) {
  var session = { localId: 1, title: 'Voice', githubLinks: [] };
  var sm = { sessions: new Map([[1, session]]), saveSessionFile: function () {}, broadcastSessionList: function () {} };
  var ctx = { cwd: '/tmp', sm: sm, canUse: function () { return true; }, identity: function () { return null; }, canRead: function (caller, other) { return !other.hidden; }, canRefresh: function () { return true; }, run: run || async function () { return { url: url, title: 'Voice', state: 'MERGED', statusCheckRollup: [] }; } };
  var attached = attach(ctx);
  return { session: session, sm: sm, ctx: ctx, api: attached, call: function (name, args) { return attached.getDynamicToolDefs(session).find(function (tool) { return tool.name === name; }).handler(args || {}); } };
}
test('GitHub URL parser rejects lookalikes, shell arguments, invalid numbers and credentials', function () {
  ['http://github.com/a/b/issues/1', 'https://github.com.evil/a/b/issues/1', 'https://me@github.com/a/b/issues/1', 'https://github.com/a/b/issues/0', 'https://github.com/a/b/issues/999999999999999999', 'https://github.com/a/b/issues/1/evil', '--repo evil'].forEach(function (input) { assert.throws(function () { github.parseReference(input); }); });
  assert.equal(github.parseReference(url + '#discussion').url, url);
});
test('provider metadata is verified and only bounded display data is kept', async function () {
  var result = await github.readReference('/tmp', url, null, async function (cwd, args) {
    assert.deepEqual(args.slice(0, 5), ['pr', 'view', '542', '--repo', 'chadbyte/clay']);
    return { url: url, title: '<script>title</script>', state: 'OPEN', isDraft: true, body: 'private body', statusCheckRollup: [{ name: 'CI', conclusion: 'FAILURE', detailsUrl: 'javascript:alert(1)' }] };
  });
  assert.equal(result.state, 'draft'); assert.equal(result.body, undefined); assert.equal(result.checks[0].url, '');
  await assert.rejects(github.readReference('/tmp', url, null, async function () { return { url: url.replace('542', '999') }; }));
});
test('linking is verified, deduplicated, and unlinking changes only the session', async function () {
  var w = world();
  assert.equal(w.session.githubLinks.length, 0);
  assert.equal((await w.call('link_session_github', { url: url })).isError, undefined);
  await w.call('link_session_github', { url: url + '#anchor' });
  assert.equal(w.session.githubLinks.length, 1); assert.equal(w.session.githubLinks[0].state, 'merged');
  await w.call('unlink_session_github', { url: url }); assert.deepEqual(w.session.githubLinks, []);
});
test('failed authentication never attaches a link; revoked access after fetch never writes', async function () {
  var w = world(async function () { throw new Error('unavailable'); });
  assert.equal((await w.call('link_session_github', { url: url })).isError, true); assert.equal(w.session.githubLinks.length, 0);
  w.ctx.run = async function () { w.ctx.canUse = function () { return false; }; return { url: url, state: 'OPEN' }; };
  assert.equal((await w.call('link_session_github', { url: url })).isError, true); assert.equal(w.session.githubLinks.length, 0);
});
test('refresh keeps failed status explicitly stale and is throttled', async function () {
  var w = world(); await w.call('link_session_github', { url: url });
  var calls = 0; w.ctx.run = async function () { calls++; throw new Error('offline'); };
  await w.call('get_session_github'); await w.call('get_session_github');
  assert.equal(calls, 1); assert.equal(w.session.githubLinks[0].stale, true); assert.equal(w.session.githubLinks[0].state, 'merged');
});
test('session search returns only visible linked work and stale handlers fail closed', async function () {
  var w = world(); await w.call('link_session_github', { url: url });
  w.sm.sessions.set(2, { localId: 2, hidden: true, githubLinks: w.session.githubLinks });
  var result = JSON.parse((await w.call('get_session_github', { url: url })).content[0].text);
  assert.deepEqual(result.matchingSessions.map(function (item) { return item.sessionId; }), [1]);
  w.sm.sessions.delete(1); assert.equal((await w.call('get_session_github')).isError, true);
});
test('unlink during refresh wins over the in-flight snapshot', async function () {
  var w = world(); await w.call('link_session_github', { url: url });
  var release; w.ctx.run = function () { return new Promise(function (resolve) { release = resolve; }); };
  var refresh = w.call('get_session_github');
  await w.call('unlink_session_github', { url: url });
  release({ url: url, state: 'OPEN' }); await refresh;
  assert.deepEqual(w.session.githubLinks, []);
});
test('native, MCP and stdio definitions share handlers and exact permission names', async function () {
  var w = world();
  var config = w.api.createMcpServer({ createToolServer: function (value) { return value; } }, w.session);
  assert.equal(config.name, 'clay-github'); assert.equal(config.tools.length, 3);
  assert.equal(w.api.getBridgeTools(w.session, function (shape) { return shape; }).length, 3);
  var check = require('../lib/sdk-bridge').createSDKBridge({ cwd: process.cwd(), sessionManager: {}, adapter: {}, send: function () {} }).checkToolWhitelist;
  config.tools.forEach(function (tool) { assert.equal(check(tool.name, {}).behavior, 'allow'); assert.equal(check(tool.permissionName, {}).behavior, 'allow'); assert.equal(check('mcp__evil__' + tool.name, {}), null); });
  assert.equal((await w.api.callBridgeTool(w.session, 'link_session_github', { url: url })).isError, undefined);
});
test('GitHub associations survive session storage restart', function (t) {
  var fs = require('node:fs'); var path = require('node:path'); var os = require('node:os');
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-github-roundtrip-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var options = { cwd: path.join(root, 'project'), sessionsBase: path.join(root, 'sessions'), cliSessionsDir: path.join(root, 'cli'), send: function () {} };
  var create = require('../lib/sessions').createSessionManager;
  var first = create(options); var session = first.createSessionRaw({ cliSessionId: 'github-session', vendor: 'claude' });
  session.title = 'Linked task'; session.githubLinks = [{ url: url, kind: 'pr', number: 542, state: 'merged' }]; first.saveSessionFile(session);
  var second = create(options); var restored = Array.from(second.sessions.values()).find(function (item) { return item.cliSessionId === 'github-session'; });
  assert.deepEqual(restored.githubLinks, session.githubLinks);
});
test('client renders safe direct links, state icons, and no empty row', async function () {
  var ui = await import('../lib/public/modules/session-github.js');
  assert.equal(ui.githubWorkMarkup({}, false), '');
  assert.equal(ui.githubWorkMarkup({ githubLinks: [{ url: 'javascript:alert(1)' }] }, false), '');
  var html = ui.githubWorkMarkup({ githubLinks: [{ url: url, number: 542, kind: 'pr', title: '<script>bad</script>', repository: 'chadbyte/clay', state: 'merged' }] }, false);
  assert.match(html, /git-merge/); assert.match(html, /target="_blank" rel="noopener noreferrer"/); assert.doesNotMatch(html, /<script>/);
});
test('authorized sessions without OS isolation use host GitHub authentication', async function () {
  var calls = 0;
  var w = world(async function (cwd, args, identity) {
    calls++; assert.equal(identity, null);
    return { url: url, state: 'OPEN', title: 'Host-authenticated work' };
  });
  w.ctx.osUsers = false;
  assert.equal((await w.call('link_session_github', { url: url })).isError, undefined);
  assert.equal(calls, 1); assert.equal(w.session.githubLinks[0].state, 'open');
});
test('OS-isolated sessions require a mapping and never fall back to host credentials', async function () {
  var calls = 0;
  var mapped = { user: 'member', uid: 1001, gid: 1001, home: '/home/member' };
  var w = world(async function (cwd, args, identity) {
    calls++; assert.equal(identity, mapped); return { url: url, state: 'OPEN' };
  });
  w.ctx.osUsers = true;
  assert.equal((await w.call('link_session_github', { url: url })).isError, true);
  assert.equal(calls, 0); assert.deepEqual(w.session.githubLinks, []);
  w.ctx.identity = function () { return mapped; };
  assert.equal((await w.call('link_session_github', { url: url })).isError, undefined);
  assert.equal(calls, 1);
});
test('session rows show the latest issue and PR, then count only undisplayed work', async function () {
  var ui = await import('../lib/public/modules/session-github.js');
  var older = { url: 'https://github.com/a/b/issues/1', kind: 'issue', number: 1, title: 'Older', state: 'closed' };
  var recent = { url: 'https://github.com/a/b/issues/2', kind: 'issue', number: 2, title: 'Recent', state: 'open' };
  var pr = { url: 'https://github.com/a/b/pull/3', kind: 'pr', number: 3, title: 'PR', state: 'draft' };
  var olderPr = { url: 'https://github.com/a/b/pull/4', kind: 'pr', number: 4, title: 'Older PR', state: 'closed' };
  var session = { githubLinks: [older, olderPr, recent, pr] };
  assert.deepEqual(ui.orderedGithubWork(session).map(function (link) { return link.number; }), [2, 3, 4, 1]);
  var compact = ui.githubWorkMarkup(session, false);
  assert.equal((compact.match(/<a /g) || []).length, 1);
  assert.match(compact, />\+3<\/button>/);
  assert.match(compact, /href="https:\/\/github.com\/a\/b\/issues\/2"/);
  var row = ui.githubWorkMarkup(session, false, false, true);
  assert.equal((row.match(/<a /g) || []).length, 2);
  assert.match(row, /href="https:\/\/github.com\/a\/b\/issues\/2"/);
  assert.match(row, /href="https:\/\/github.com\/a\/b\/pull\/3"/);
  assert.match(row, />\+2<\/button>/);
  assert.equal((ui.githubWorkMarkup(session, false, true).match(/<a /g) || []).length, 4);
  var prs = { githubLinks: [olderPr, pr] };
  assert.equal((ui.githubWorkMarkup(prs, false, false, true).match(/<a /g) || []).length, 1);
  assert.match(ui.githubWorkMarkup(prs, false, false, true), />\+1<\/button>/);
  assert.doesNotMatch(ui.githubWorkMarkup({ githubLinks: [recent] }, false), /github-work-more/);
  assert.equal(ui.orderedGithubWork({ githubLinks: [pr] })[0], pr);
  assert.deepEqual(session.githubLinks, [older, olderPr, recent, pr]);
});
test('explicitly relinking an older issue makes it recent; refresh preserves that order', async function () {
  var w = world(async function (cwd, args) { return { url: 'https://github.com/a/b/issues/' + args[2], title: 'Issue', state: 'OPEN' }; });
  var first = 'https://github.com/a/b/issues/1'; var second = 'https://github.com/a/b/issues/2';
  await w.call('link_session_github', { url: first }); await w.call('link_session_github', { url: second });
  await w.call('link_session_github', { url: first });
  assert.deepEqual(w.session.githubLinks.map(function (link) { return link.number; }), [2, 1]);
  await w.call('get_session_github');
  assert.deepEqual(w.session.githubLinks.map(function (link) { return link.number; }), [2, 1]);
});

async function settleRefreshes() {
  for (var i = 0; i < 12; i++) await new Promise(function (resolve) { setImmediate(resolve); });
}
function addLinkedSession(w, id, owner) {
  var session = { localId: id, ownerId: owner, githubLinks: [{ url: url, repository: 'chadbyte/clay', kind: 'pr', number: 542, title: 'Voice', state: 'open', checks: [{ name: 'CI', state: 'SUCCESS' }] }] };
  w.sm.sessions.set(id, session);
  return session;
}
test('list refresh updates inactive sessions, deduplicates lookups and preserves PR details', async function () {
  var calls = 0;
  var w = world(async function (cwd, args) {
    calls++;
    assert.equal(args[6], 'title,state,url,isDraft');
    return { url: url, title: 'Voice', state: 'MERGED' };
  });
  var first = addLinkedSession(w, 2, 'owner');
  var second = addLinkedSession(w, 3, 'owner');
  var broadcasts = 0;
  w.sm.broadcastSessionList = function () { broadcasts++; };
  w.api.handleMessage({}, { type: 'session_github_refresh', sessionIds: [2, 3, 2] });
  await settleRefreshes();
  assert.equal(calls, 1);
  assert.equal(first.githubLinks[0].state, 'merged');
  assert.equal(second.githubLinks[0].state, 'merged');
  assert.equal(first.githubLinks[0].checks[0].state, 'SUCCESS');
  assert.equal(broadcasts, 2);
});
test('list refresh excludes unauthorized sessions and separates credential scopes', async function () {
  var calls = 0;
  var w = world(async function () { calls++; return { url: url, title: 'Voice', state: 'MERGED' }; });
  addLinkedSession(w, 2, 'one'); addLinkedSession(w, 3, 'two');
  var denied = addLinkedSession(w, 4, 'denied');
  w.ctx.canRefresh = function (ws, session) { return session.ownerId !== 'denied'; };
  w.api.handleMessage({}, { type: 'session_github_refresh', sessionIds: [2, 3, 4] });
  await settleRefreshes();
  assert.equal(calls, 2);
  assert.equal(denied.githubLinks[0].state, 'open');
});
test('status polling backs off failures, retains state and recovers', async function (t) {
  var now = 1000000; t.mock.method(Date, 'now', function () { return now; });
  var calls = 0; var offline = true;
  var w = world(async function () { calls++; if (offline) throw new Error('offline'); return { url: url, state: 'MERGED', title: 'Voice' }; });
  var session = addLinkedSession(w, 2, 'owner');
  async function poll() { w.api.handleMessage({}, { type: 'session_github_refresh', sessionIds: [2] }); await settleRefreshes(); }
  await poll(); now += 60001; await poll();
  assert.equal(calls, 2); assert.equal(session.githubLinks[0].state, 'open'); assert.equal(session.githubLinks[0].stale, true);
  now += 60001; await poll(); assert.equal(calls, 2);
  offline = false; now += 60001; await poll();
  assert.equal(calls, 3); assert.equal(session.githubLinks[0].state, 'merged'); assert.equal(session.githubLinks[0].stale, false);
});
test('unchanged status does not broadcast and closed issues are eventually rechecked', async function (t) {
  var now = 1000000; t.mock.method(Date, 'now', function () { return now; });
  var issueUrl = 'https://github.com/chadbyte/clay/issues/1';
  var calls = 0; var state = 'CLOSED'; var broadcasts = 0;
  var w = world(async function () { calls++; return { url: issueUrl, title: 'Issue', state: state }; });
  var session = addLinkedSession(w, 2, 'owner');
  session.githubLinks = [await github.readReference('/tmp', issueUrl, null, w.ctx.run)];
  calls = 0; w.sm.broadcastSessionList = function () { broadcasts++; };
  async function poll() { w.api.handleMessage({}, { type: 'session_github_refresh', sessionIds: [2] }); await settleRefreshes(); }
  await poll(); now += 60001; await poll();
  assert.equal(calls, 1); assert.equal(broadcasts, 0);
  state = 'OPEN'; now += 300001; await poll();
  assert.equal(calls, 2); assert.equal(broadcasts, 1); assert.equal(session.githubLinks[0].state, 'open');
});
test('queued refresh rechecks viewer authorization and unlink wins during status lookup', async function () {
  var release; var calls = 0;
  var w = world(function () { calls++; return new Promise(function (resolve) { release = resolve; }); });
  var first = addLinkedSession(w, 2, 'one'); addLinkedSession(w, 3, 'two');
  var permitted = true;
  w.ctx.canRefresh = function (ws, session) { return session.localId === 2 || permitted; };
  w.api.handleMessage({}, { type: 'session_github_refresh', sessionIds: [2, 3] });
  await settleRefreshes(); assert.equal(calls, 1);
  permitted = false; first.githubLinks = [];
  release({ url: url, title: 'Voice', state: 'MERGED' }); await settleRefreshes();
  assert.equal(calls, 1); assert.deepEqual(first.githubLinks, []);
  assert.equal(w.sm.sessions.get(3).githubLinks[0].state, 'open');
});
test('background status polling does not suppress full agent detail refresh', async function () {
  var fields = [];
  var w = world(async function (cwd, args) { fields.push(args[6]); return { url: url, title: 'Voice', state: 'OPEN', reviewDecision: 'APPROVED' }; });
  w.session.githubLinks = addLinkedSession(w, 2).githubLinks;
  w.api.handleMessage({ _clayActiveSession: 1 }, { type: 'session_github_refresh' });
  await settleRefreshes(); await w.call('get_session_github');
  assert.equal(fields.length, 2); assert.match(fields[1], /reviewDecision/);
  assert.equal(w.session.githubLinks[0].review, 'APPROVED');
});

test('client refresh includes visible inactive rows, skips hidden pages and resumes when stale', async function (t) {
  var ui = await import('../lib/public/modules/session-github.js');
  var state = (await import('../lib/public/modules/store.js')).store;
  var wsRef = await import('../lib/public/modules/ws-ref.js');
  var savedState = state.snap(); var savedWs = wsRef.getWs();
  var savedDocument = global.document; var savedWindow = global.window;
  t.after(function () { state.set(savedState); wsRef.setWs(savedWs); global.document = savedDocument; global.window = savedWindow; });
  var now = 1000000; t.mock.method(Date, 'now', function () { return now; });
  function row(id, top, width) { return { dataset: { githubSessionId: String(id) }, getBoundingClientRect: function () { return { top: top, bottom: top + 30, left: 0, right: width, width: width, height: 30 }; } }; }
  global.window = { innerWidth: 1000, innerHeight: 800 };
  global.document = { hidden: false, querySelectorAll: function () { return [row(2, 100, 200), row(3, 900, 200), row(4, 200, 0)]; } };
  var sent = [];
  wsRef.setWs({ readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } });
  state.set({ currentSlug: 'clay', githubWorkProject: 'clay', connected: true, dmMode: false, githubWorkRefresh: null, githubWorkSessions: [{ id: 1, active: true, githubLinks: [{ url: url }] }] });
  ui.refreshGithubWork(); ui.refreshGithubWork();
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].sessionIds, [1, 2]);
  now += 60001; document.hidden = true; ui.refreshGithubWork(); assert.equal(sent.length, 1);
  document.hidden = false; ui.refreshGithubWork(); assert.equal(sent.length, 2);
  state.set({ currentSlug: 'another' }); now += 60001; ui.refreshGithubWork(); assert.equal(sent.length, 2);
});
test('stale icons keep their known status and expose the failed refresh', async function () {
  var ui = await import('../lib/public/modules/session-github.js');
  var html = ui.githubWorkMarkup({ githubLinks: [{ url: url, kind: 'pr', number: 542, state: 'merged', stale: true, checkedAt: 1000000 }] });
  assert.match(html, /github-state-merged/); assert.match(html, /git-merge/);
  assert.match(html, /last known status; refresh unavailable/); assert.match(html, /Checked/);
});
