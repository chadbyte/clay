var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var os = require('node:os');
var EventEmitter = require('node:events');
var api = require('../lib/linear-api');
var attachStore = require('../lib/linear-store').attachLinearStore;
var attach = require('../lib/project-session-linear').attachSessionLinear;
var url = 'https://linear.app/acme/issue/ENG-123/title';
function issue() { return { id: 'issue-uuid', identifier: 'ENG-123', title: 'Repair login', url: url, state: { name: 'In Progress', type: 'started' }, description: 'Requirements', comments: { nodes: [{ id: 'comment', body: 'Context', user: { name: 'Person' } }], pageInfo: { hasNextPage: false, endCursor: null } } }; }
function fixture(t) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-linear-'));
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var storage = attachStore(directory);
  storage.save('owner', 'private-key', { id: 'workspace', name: 'Acme' });
  var session = { localId: 1, ownerId: 'owner', title: 'Work', linearLinks: [] };
  var sm = { sessions: new Map([[1, session]]), saveSessionFile: function () { return true; }, broadcastSessionList: function () {}, switchSession: function () {} };
  var ctx = { storage: storage, sm: sm, projectSlug: 'project', isMultiUser: function () { return true; }, canUse: function () { return true; }, canRead: function (caller, target) { return caller.ownerId === target.ownerId; },
    canAccess: function (ws) { return ws.readyState === 1 && ws._clayUser && ws._clayUser.id === 'owner'; }, canRefresh: function (ws, target) { return ws._clayUser.id === target.ownerId; },
    sendTo: function (ws, msg) { ws.messages.push(msg); }, query: async function (key) { assert.equal(key, 'private-key'); return { issue: issue(), issues: { nodes: [issue()] } }; } };
  var bridge = attach(ctx);
  return { directory: directory, storage: storage, session: session, sm: sm, ctx: ctx, bridge: bridge,
    call: function (name, args) { return bridge.callBridgeTool(session, name, args || {}); } };
}
async function tick() { await new Promise(function (resolve) { setImmediate(resolve); }); }

test('Linear references reject hostile URLs and normalize title/hash variants', function () {
  ['https://linear.app.evil/acme/issue/ENG-123', 'https://user@linear.app/acme/issue/ENG-123', 'http://linear.app/acme/issue/ENG-123', 'https://linear.app/acme/issue/ENG-0', 'https://linear.app/acme/project/123'].forEach(function (value) { assert.throws(function () { api.parseReference(value); }); });
  assert.equal(api.parseReference(url + '#comment').url, 'https://linear.app/acme/issue/ENG-123');
});
test('Linear API uses a fixed endpoint and variables, rejects partial errors and oversized responses', async function () {
  var response = await api.query('secret', 'query($id: String!) { issue(id: $id) { id } }', { id: 'ENG-123' }, async function (endpoint, options) {
    assert.equal(endpoint, 'https://api.linear.app/graphql'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'secret'); assert.equal(JSON.parse(options.body).variables.id, 'ENG-123');
    return new Response(JSON.stringify({ data: { issue: { id: '123' } } }));
  });
  assert.equal(response.issue.id, '123');
  await assert.rejects(api.query('secret', '', {}, async function () { return new Response(JSON.stringify({ data: {}, errors: [{ message: 'secret' }] })); }), /Could not read/);
  await assert.rejects(api.query('secret', '', {}, async function () { return new Response('a'.repeat(1024 * 1024 + 1)); }), /too large/);
});
test('read verifies workspace and identifier and returns comments; search uses bounded variables', async function () {
  var detail = await api.readIssue('key', url, null, async function () { return { issue: issue() }; });
  assert.equal(detail.comments[0].author, 'Person'); assert.equal(detail.description, 'Requirements');
  await assert.rejects(api.readReference('key', url.replace('/acme/', '/other/'), async function () { return { issue: issue() }; }), /different Linear workspace/);
  var result = await api.search('key', 'login " }', async function (key, query, variables) {
    assert.match(query, /first: 20/); assert.equal(variables.text, 'login " }'); return { issues: { nodes: [issue()] } };
  });
  assert.equal(result[0].description, undefined); assert.equal(result[0].identifier, 'ENG-123');
});
test('credentials are encrypted, account-bound, restart-safe and absent from views', function (t) {
  var f = fixture(t), disk = fs.readFileSync(path.join(f.directory, 'linear/owner.json'), 'utf8');
  assert.ok(!disk.includes('private-key')); assert.ok(!JSON.stringify(f.storage.view('owner')).includes('private-key'));
  assert.equal(attachStore(f.directory).key('owner'), 'private-key'); assert.equal(f.storage.key('other'), null);
  fs.writeFileSync(path.join(f.directory, 'linear/other.json'), disk);
  assert.throws(function () { f.storage.key('other'); });
  assert.throws(function () { f.storage.key('../owner'); });
  f.storage.save('owner', null); assert.equal(f.storage.key('owner'), null);
});
test('tools link, deduplicate, persist bounded metadata and unlink without Linear writes', async function (t) {
  var f = fixture(t);
  assert.ok(!(await f.call('link_session_linear', { url: url })).isError);
  await f.call('link_session_linear', { url: url + '#comment' });
  assert.equal(f.session.linearLinks.length, 1); assert.equal(f.session.linearLinks[0].description, undefined);
  var got = JSON.parse((await f.call('get_session_linear', { url: url })).content[0].text);
  assert.equal(got.matchingSessions[0].sessionId, 1);
  await f.call('unlink_session_linear', { url: url }); assert.deepEqual(f.session.linearLinks, []);
});
test('revoked account, project and session ownership cannot persist a late link', async function (t) {
  for (var kind of ['account', 'project', 'owner']) {
    var f = fixture(t);
    f.ctx.query = async function () {
      if (kind === 'account') f.storage.save('owner', null);
      if (kind === 'project') f.ctx.canUse = function () { return false; };
      if (kind === 'owner') f.session.ownerId = 'other';
      return { issue: issue() };
    };
    assert.equal((await f.call('link_session_linear', { url: url })).isError, true);
    assert.deepEqual(f.session.linearLinks, []);
  }
});
test('failed session persistence rolls back and failed refresh marks status stale', async function (t) {
  var f = fixture(t); f.sm.saveSessionFile = function () { return false; };
  assert.equal((await f.call('link_session_linear', { url: url })).isError, true); assert.equal(f.session.linearLinks.length, 0);
  f.sm.saveSessionFile = function () { return true; }; await f.call('link_session_linear', { url: url });
  f.ctx.query = async function () { throw new Error('offline'); };
  await f.call('get_session_linear'); assert.equal(f.session.linearLinks[0].stale, true);
});
test('unlink during refresh wins over the response snapshot', async function (t) {
  var f = fixture(t); await f.call('link_session_linear', { url: url });
  var release; f.ctx.query = function () { return new Promise(function (resolve) { release = resolve; }); };
  var task = f.call('get_session_linear'); await f.call('unlink_session_linear', { url: url });
  release({ issue: issue() }); await task; assert.deepEqual(f.session.linearLinks, []);
});
test('panel detail reads use the viewer connection and access is rechecked before reply', async function (t) {
  var f = fixture(t), ws = { readyState: 1, _clayUser: { id: 'owner' }, _clayActiveSession: 1, messages: [] };
  f.bridge.handleMessage(ws, { type: 'linear_read', requestId: 'read', args: { url: url } }); await tick();
  assert.equal(ws.messages[0].result.issue.description, 'Requirements');
  ws.messages = []; f.ctx.query = async function () { ws._clayUser = { id: 'other' }; return { issue: issue() }; };
  f.bridge.handleMessage(ws, { type: 'linear_read', requestId: 'read2', args: { url: url } }); await tick();
  assert.deepEqual(ws.messages, []);
});
test('late websocket linking cannot save after connection access is revoked', async function (t) {
  var f = fixture(t), ws = { readyState: 1, _clayUser: { id: 'owner' }, _clayActiveSession: 1, messages: [] };
  f.ctx.query = async function () { ws.readyState = 3; return { issue: issue() }; };
  f.bridge.handleMessage(ws, { type: 'linear_link', args: { url: url, sessionId: 1 } }); await tick();
  assert.deepEqual(f.session.linearLinks, []);
});
test('native and bridge tool names are exact and safe to approve', function (t) {
  var f = fixture(t), check = require('../lib/sdk-bridge').createSDKBridge({ cwd: process.cwd(), sessionManager: {}, adapter: {}, send: function () {} }).checkToolWhitelist;
  var config = f.bridge.createMcpServer({ createToolServer: function (value) { return value; } }, f.session);
  assert.equal(config.name, 'clay-linear'); assert.equal(config.tools.length, 5);
  config.tools.forEach(function (tool) { assert.equal(check(tool.name, {}).behavior, 'allow'); assert.equal(check(tool.permissionName, {}).behavior, 'allow'); assert.equal(check('mcp__foreign__' + tool.name, {}), null); });
});
test('Linear links survive a session manager restart', function (t) {
  var f = fixture(t), create = require('../lib/sessions').createSessionManager;
  var options = { cwd: path.join(f.directory, 'project'), sessionsBase: f.directory, cliSessionsDir: path.join(f.directory, 'cli'), send: function () {} };
  var manager = create(options), session = manager.createSessionRaw({ cliSessionId: 'linear', ownerId: 'owner' });
  session.linearLinks = [api.summary(issue())]; session.codexLinearToolCatalogVersion = 1; manager.saveSessionFile(session);
  var restored = create(options), found;
  restored.sessions.forEach(function (item) { if (item.cliSessionId === 'linear') found = item; });
  assert.equal(found.linearLinks[0].identifier, 'ENG-123'); assert.equal(found.codexLinearToolCatalogVersion, 1);
});
test('renderer shows Linear issue and GitHub PR together with escaping', async function () {
  var ui = await import('../lib/public/modules/session-github.js');
  var item = api.summary(issue()); item.title = '<script>bad</script>';
  var markup = ui.githubWorkMarkup({ linearLinks: [item], githubLinks: [{ url: 'https://github.com/a/b/pull/1', kind: 'pr', number: 1, title: 'Fix', state: 'open', repository: 'a/b' }] }, false);
  assert.match(markup, /ENG-123/); assert.match(markup, /In Progress/); assert.match(markup, /github.com\/a\/b\/pull\/1/); assert.ok(!markup.includes('<script>'));
});

test('status refresh coalesces the same issue across sessions without crossing account connections', async function (t) {
  var f = fixture(t); await f.call('link_session_linear', { url: url });
  var other = { localId: 2, ownerId: 'owner', linearLinks: f.session.linearLinks.slice() }; f.sm.sessions.set(2, other);
  var calls = 0; f.ctx.query = async function () { calls++; return { issue: issue() }; };
  await Promise.all([f.call('get_session_linear'), f.bridge.callBridgeTool(other, 'get_session_linear', {})]);
  assert.equal(calls, 1);
  f.storage.save('owner', 'new-key', { id: 'workspace', name: 'Acme' });
  var third = { localId: 3, ownerId: 'owner', linearLinks: f.session.linearLinks.slice() }; f.sm.sessions.set(3, third);
  f.ctx.query = async function (key) { assert.equal(key, 'new-key'); calls++; return { issue: issue() }; };
  await f.bridge.callBridgeTool(third, 'get_session_linear', {}); assert.equal(calls, 2);
});


test('agent tools read requirements and search issues using the session owner connection', async function (t) {
  var f = fixture(t);
  var read = JSON.parse((await f.call('read_linear_issue', { url: url })).content[0].text);
  assert.equal(read.description, 'Requirements'); assert.equal(read.comments[0].body, 'Context');
  var search = JSON.parse((await f.call('search_linear_issues', { query: 'login' })).content[0].text);
  assert.equal(search.items[0].identifier, 'ENG-123');
  f.ctx.query = async function () { f.session.ownerId = 'other'; return { issue: issue() }; };
  assert.equal((await f.call('read_linear_issue', { url: url })).isError, true);
});
