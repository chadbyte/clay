var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var WebSocket = require('ws');
var fs = require('node:fs');
async function fixture(t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/worktree-controls.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }), output = '';
  child.stderr.on('data', function (chunk) { output += chunk; });
  t.after(async function () { if (child.exitCode === null) { child.send('close'); await new Promise(function (resolve) { child.once('exit', resolve); }); } });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('exit', function (code) { reject(new Error('Fixture exit ' + code + ': ' + output)); }); });
  var origin = 'http://127.0.0.1:' + info.port, cookie = 'relay_auth_user=fixture-owner-token';
  async function post(stage, data, headers) {
    var response = await fetch(origin + '/api/worktree-removal/' + stage, { method: 'POST', headers: Object.assign({ Cookie: cookie, 'Content-Type': 'application/json', 'X-Clay-Worktree-Control': '1' }, headers), body: JSON.stringify(data) });
    return { code: response.status, body: await response.json() };
  }
  return { root: info.root, origin: origin, cookie: cookie, post: post, state: async function () { return (await fetch(origin + '/fixture/state', { headers: { Cookie: cookie } })).json(); } };
}
test('real HTTP boundary refuses foreign, unauthenticated, cross-site and unreviewed deletion', async function (t) {
  var f = await fixture(t), data = { slug: 'repository--review-feature', action: 'delete' };
  assert.equal((await f.post('preview', data, { Cookie: '' })).code, 401);
  assert.equal((await f.post('preview', data, { Cookie: 'relay_auth_user=fixture-foreign-token' })).code, 409);
  assert.equal((await f.post('preview', data, { 'Sec-Fetch-Site': 'cross-site' })).code, 403);
  assert.equal((await f.post('preview', data, { 'X-Clay-Worktree-Control': '' })).code, 403);
  assert.equal((await f.post('execute', { token: 'not-approved' })).code, 409);
  assert.equal((await f.state()).exists, true);
});
test('real project WebSocket icon edit persists and actual runtime closure precedes external Git deletion', async function (t) {
  var f = await fixture(t), ws = new WebSocket(f.origin.replace('http', 'ws') + '/p/repository/ws', { headers: { Cookie: f.cookie } });
  t.after(function () { ws.close(); });
  await new Promise(function (resolve, reject) { ws.once('open', resolve); ws.once('error', reject); });
  var reply = new Promise(function (resolve) { ws.on('message', function (raw) { var message = JSON.parse(raw); if (message.type === 'set_project_icon_result') resolve(message); }); });
  ws.send(JSON.stringify({ type: 'set_project_icon', slug: 'repository--review-feature', icon: '🌿', requestId: 'icon-one' }));
  assert.equal((await reply).ok, true);
  var state = await f.state(); assert.equal(state.config.projects[0].worktreePreferences['repository--review-feature'].icon, '🌿'); assert.equal(state.config.projects[0].icon, '🐳');
  var review = await f.post('preview', { slug: 'repository--review-feature', action: 'delete' }); assert.equal(review.code, 200);
  var result = await f.post('execute', { token: review.body.token }); assert.equal(result.code, 200, JSON.stringify(result.body)); assert.equal(result.body.filesDeleted, true); assert.equal(result.body.runtimeClosed, true);
  state = await f.state(); assert.equal(state.exists, false); assert.equal(state.projects.some(function (p) { return p.slug === 'repository--review-feature'; }), false); assert.ok(state.branch);
  assert.equal((await f.post('execute', { token: review.body.token })).code, 409);
});

test('real ordinary icon editing retains permitted members and syncs recent-project icons', async function (t) {
  var f = await fixture(t), ws = new WebSocket(f.origin.replace('http', 'ws') + '/p/repository/ws', { headers: { Cookie: 'relay_auth_user=fixture-editor-token' } });
  t.after(function () { ws.close(); });
  await new Promise(function (resolve, reject) { ws.once('open', resolve); ws.once('error', reject); });
  function edit(slug, icon, id) {
    return new Promise(function (resolve) {
      function response(raw) { var msg = JSON.parse(raw); if (msg.type === 'set_project_icon_result' && msg.requestId === id) { ws.removeListener('message', response); resolve(msg); } }
      ws.on('message', response); ws.send(JSON.stringify({ type: 'set_project_icon', slug: slug, icon: icon, requestId: id }));
    });
  }
  assert.equal((await edit('repository', '🌱', 'ordinary-editor')).ok, true);
  var state = await f.state(); assert.equal(state.config.projects[0].icon, '🌱');
  var recent = JSON.parse(fs.readFileSync(path.join(f.root, '.clayrc'), 'utf8')).recentProjects;
  assert.equal(recent.find(function (p) { return p.slug === 'repository'; }).icon, '🌱');
  assert.equal((await edit('repository--review-feature', '🌿', 'worktree-editor')).ok, false);
  state = await f.state(); assert.equal(state.config.projects[0].worktreePreferences, undefined);
});

test('production icon service admits accessible nonowner admins and refuses forbidden or foreign ordinary targets', { timeout: 15000 }, async function (t) {
  var f = await fixture(t), sequence = 0;
  async function editAs(actor, slug) {
    var ws = new WebSocket(f.origin.replace('http', 'ws') + '/p/repository/ws', { headers: { Cookie: 'relay_auth_user=fixture-' + actor + '-token' } });
    t.after(function () { ws.close(); });
    await new Promise(function (resolve, reject) { ws.once('open', resolve); ws.once('error', reject); });
    var id = 'authority-' + (++sequence);
    var response = new Promise(function (resolve) {
      ws.on('message', function (raw) { var msg = JSON.parse(raw); if (msg.type === 'set_project_icon_result' && msg.requestId === id) resolve(msg); });
    });
    ws.send(JSON.stringify({ type: 'set_project_icon', slug: slug, icon: '🌱', requestId: id }));
    var result = await response; ws.close(); return result;
  }
  assert.equal((await editAs('shared-admin', 'repository')).ok, true);
  assert.equal((await editAs('guest', 'repository')).ok, false);
  assert.equal((await editAs('editor', 'foreign-private')).ok, false);
  assert.equal((await editAs('shared-admin', 'foreign-private')).ok, false);
  assert.equal((await editAs('shared-admin', 'repository--review-feature')).ok, false);
  var state = await f.state();
  assert.equal(state.config.projects.find(function (p) { return p.slug === 'repository'; }).icon, '🌱');
  assert.equal(state.config.projects.find(function (p) { return p.slug === 'foreign-private'; }).icon, undefined);
});

test('real HTTP checked deletion binds the choice and removes only its reviewed local branch', async function (t) {
  var f = await fixture(t), slug = 'repository--review-feature';
  var keep = await f.post('preview', { slug: slug, action: 'delete' });
  assert.equal(keep.body.deleteBranch, false);
  var forged = await f.post('execute', { token: keep.body.token, deleteBranch: true });
  assert.equal(forged.code, 409); assert.equal((await f.state()).exists, true);
  var review = await f.post('preview', { slug: slug, action: 'delete', deleteBranch: true });
  assert.equal(review.code, 200, JSON.stringify(review.body)); assert.equal(review.body.deleteBranch, true);
  var result = await f.post('execute', { token: review.body.token, deleteBranch: true });
  assert.equal(result.code, 200, JSON.stringify(result.body)); assert.equal(result.body.branchDeleted, true);
  var state = await f.state(); assert.equal(state.exists, false); assert.equal(state.branch, '');
  assert.equal((await f.post('execute', { token: review.body.token, deleteBranch: true })).code, 409);
});
