var test = require('node:test');
var assert = require('node:assert/strict');
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var WebSocket = require('ws');
var attachSpeech = require('../lib/server-speech').attachSpeech;

test('speech HTTP authenticates, rejects cross-origin writes and isolates personal keys', async function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-speech-http-'));
  var api = attachSpeech({ CONFIG_DIR: root, users: { isMultiUser: function () { return true; } },
    isRequestAuthed: function (req) { return !!req.headers['x-user']; }, getMultiUserFromReq: function (req) { return { id: req.headers['x-user'] }; } });
  var server = http.createServer(function (req, res) { if (!api.handleRequest(req, res, req.url)) { res.writeHead(404); res.end(); } });
  server.on('upgrade', api.handleUpgrade);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  var base = 'http://127.0.0.1:' + server.address().port;
  async function call(user, method, data, origin) {
    var headers = { 'Content-Type': 'application/json' }; if (user) headers['x-user'] = user; if (origin) headers.Origin = origin;
    return fetch(base + '/api/speech/settings', { method: method || 'GET', headers: headers, body: data ? JSON.stringify(data) : undefined });
  }
  try {
    assert.equal((await call(null)).status, 401);
    assert.equal((await call('alice', 'PUT', { provider: 'groq', key: 'secret' }, 'https://evil.example')).status, 403);
    var saved = await call('alice', 'PUT', { provider: 'groq', key: 'secret', owner: 'bob' });
    assert.equal(saved.status, 200); assert.equal(JSON.stringify(await saved.json()).includes('secret'), false);
    var bob = await (await call('bob')).json(); assert.deepEqual(bob.configured, []);
    var alice = await (await call('alice')).json(); assert.deepEqual(alice.configured, ['groq']);
    assert.equal(alice.models.some(function (model) { return /flux/.test(model.id); }), false);
    assert.equal((await call('bob', 'PUT', { selected: 'groq-turbo' })).status, 400);
    assert.equal((await call('bob', 'PUT', { selected: 'openai-live' })).status, 400);
    await call('alice', 'PUT', { provider: 'openai', key: 'openai-secret', selected: 'openai-whisper' });
    var live = await (await call('alice', 'PUT', { selected: 'openai-live' })).json();
    assert.equal(live.selected, 'openai-live'); assert.ok(live.configured.includes('openai'));
    assert.equal(live.models.find(function (model) { return model.id === 'openai-live'; }).mode, 'live');
    assert.equal(JSON.stringify(live).includes('openai-secret'), false);
    var invalid = await fetch(base + '/api/speech/transcribe', { method: 'POST', headers: { 'x-user': 'alice', 'x-speech-model': 'groq-turbo', 'x-speech-language': 'en-US' }, body: 'invalid' });
    assert.equal(invalid.status, 400);
    await new Promise(function (resolve, reject) {
      var socket = new WebSocket(base.replace('http:', 'ws:') + '/api/speech/live', { headers: { 'x-user': 'alice', Origin: 'https://evil.example' } });
      socket.on('open', function () { socket.close(); reject(new Error('Cross-origin websocket accepted')); });
      socket.on('unexpected-response', function (request, response) { assert.equal(response.statusCode, 403); response.resume(); socket.terminate(); resolve(); });
      socket.on('error', function () {});
    });
  } finally { await new Promise(function (resolve) { server.close(resolve); }); fs.rmSync(root, { recursive: true, force: true }); }
});
