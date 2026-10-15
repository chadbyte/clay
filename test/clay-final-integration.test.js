var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
var WebSocket = require('ws');
function inbox(ws) {
  var messages = [], pending = [];
  ws.on('message', function (bytes) {
    var msg = JSON.parse(String(bytes)); messages.push(msg);
    pending.slice().forEach(function (item) { if (item.match(msg)) { clearTimeout(item.timer); pending.splice(pending.indexOf(item), 1); item.resolve(msg); } });
  });
  return function (match) {
    var found = messages.find(match); if (found) return Promise.resolve(found);
    return new Promise(function (resolve, reject) { var item = { match: match, resolve: resolve, timer: setTimeout(function () { reject(new Error('Expected production event was absent. Seen: ' + messages.map(function (msg) { return msg.type; }).join(', '))); }, 8000) }; pending.push(item); });
  };
}
test('final canonical catalog and global/project Home consent integrate with authenticated production routes', async function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-final-integration-test-')), child, sockets = [], output = '';
  try {
    child = cp.fork(path.join(__dirname, 'fixtures/clay-final-integration.cjs'), [root], { env: Object.assign({}, process.env, { HOME: root, CLAY_HOME: path.join(root, '.clay'), CLAY_CONFIG: path.join(root, '.clay/daemon.json'), CODEX_HOME: path.join(root, '.codex'), SUDO_USER: '', SUDO_HOME: '', CLAY_DEV: '' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', function (bytes) { output += bytes; }); child.stderr.on('data', function (bytes) { output += bytes; });
    var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (message) { clearTimeout(timer); resolve(message); }); child.once('exit', function (code) { clearTimeout(timer); reject(new Error('Fixture exited ' + code + ': ' + output)); }); });
    var origin = 'http://127.0.0.1:' + info.port, headers = { Cookie: 'relay_auth_user=fixture-owner-token' };
    async function json(url) { var response = await fetch(origin + url, { headers: headers }); var data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data; }
    var catalog = await json('/fixture/catalog'); assert.equal(catalog.status, 'passed'); assert.equal(catalog.native, 28); assert.equal(catalog.dynamic, 28); assert.equal(catalog.resumed, 28); assert.equal(catalog.rows.length, 6); assert.equal(catalog.disconnectedPrInventory, true); t.diagnostic('28 canonical product tools match native, fresh/resumed Claude/Codex/Muse bridge and both exact allowlists; stale query and ordinary-session exclusions pass.');
    var template = fs.readFileSync(path.join(root, '.clay/mates/owner', info.sourceSlug.substring(5), 'AGENTS.md'), 'utf8');
    assert.match(template, /Use verified product controls/); assert.doesNotMatch(template, /Read-only by design/);
    var instruction = require('../lib/yoke/instructions');
    ['codex', 'copilot', 'qwen'].forEach(function (vendor) { assert.match(instruction.scanAndMerge(path.resolve(__dirname, '..'), vendor), /For every new or changed product feature/); });
    for (var mode of ['global', 'project']) {
      var ws = new WebSocket(origin.replace('http', 'ws') + (mode === 'global' ? '/ws' : '/p/' + info.sourceSlug + '/ws'), { headers: Object.assign({ Origin: origin }, headers) }); sockets.push(ws); var receive = inbox(ws);
      await new Promise(function (resolve, reject) { ws.once('open', resolve); ws.once('error', reject); });
      ws.send(JSON.stringify({ type: 'clay_ui_ready', version: 1 }));
      ws.send(JSON.stringify({ type: 'home_mate_session_open', mateId: info.sourceSlug.substring(5), sessionId: 'local:' + info.sourceSessionId, requestId: 'integration-' + mode }));
      var history = await receive(function (msg) { return msg.type === 'home_mate_history'; }); assert.equal(history.sessionId, 'local:' + info.sourceSessionId);
      var proposal = json('/fixture/propose?viewer=' + (mode === 'global' ? 'global' : 'mate') + '&target=beta');
      var question = await receive(function (msg) { return msg.type === 'home_mate_question'; }); assert.ok(question.questions.length);
      ws.send(JSON.stringify({ type: 'home_mate_question_response', mateId: question.mateId, sessionId: question.sessionId, requestId: question.requestId, toolId: question.toolId, answers: { 0: 'Apply exact change' } }));
      var result = await proposal; assert.equal(result.status, 'delivered'); assert.equal(result.visible, 'unknown');
      var offer = await receive(function (msg) { return msg.type === 'clay_navigation_offer'; });
      ws.send(JSON.stringify({ type: 'clay_navigation_claim', deliveryId: offer.deliveryId }));
      var apply = await receive(function (msg) { return msg.type === 'clay_navigation_apply'; }); assert.equal(apply.target.projectSlug, 'beta');
      ws.send(JSON.stringify({ type: 'clay_navigation_ack', deliveryId: apply.deliveryId, status: 'accepted' }));
      ws.close(); await new Promise(function (resolve) { ws.once('close', resolve); });
      t.diagnostic(mode + ' route: exact Home session, owner review/response, offer and live claim pass through actual server/global/project handlers.');
    }
    var target = new WebSocket(origin.replace('http', 'ws') + '/p/beta/ws', { headers: Object.assign({ Origin: origin }, headers) }); sockets.push(target); var targetReceive = inbox(target);
    await new Promise(function (resolve, reject) { target.once('open', resolve); target.once('error', reject); });
    var state = await json('/fixture/state'); target.send(JSON.stringify({ type: 'switch_session', id: state.betaSessionId }));
    var switched = await targetReceive(function (msg) { return msg.type === 'session_switched' && msg.id === state.betaSessionId; }); assert.ok(switched.hasHistory);
    var delta = await targetReceive(function (msg) { return msg.type === 'delta' && msg.text === 'BETA_RENDERED_DESTINATION'; }); assert.equal(delta.text, 'BETA_RENDERED_DESTINATION');
  } finally {
    sockets.forEach(function (ws) { ws.terminate(); });
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(function (resolve) { child.once('exit', resolve); setTimeout(function () { if (child.exitCode === null) child.kill('SIGKILL'); resolve(); }, 3000).unref(); }); }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
