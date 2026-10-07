var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var EventEmitter = require('node:events');
var attach = require('../lib/project-wireframe-http').attachWireframeHTTP;
var source = '@startsalt\n{ [Continue] }\n@endsalt';
function fixture(overrides) {
  var cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-wireframe-'));
  var context = Object.assign({ cwd: cwd, slug: 'project', requestAccess: {
    canAccessProject: function () { return true; }, fileScope: function () { return { projectBound: true }; },
  }, renderPlantUml: function () { return Promise.resolve('<svg/>'); } }, overrides);
  var handler = attach(context).handleHTTP;
  return { cwd: cwd, context: context, close: function () { fs.rmSync(cwd, { recursive: true, force: true }); },
    request: function (route, body, options) {
      options = options || {};
      var req = Object.assign(new EventEmitter(), { method: options.method || 'POST', headers: options.headers || { 'content-type': 'application/json' } });
      var res = new EventEmitter();
      res.writeHead = function (status, headers) { res.status = status; res.headers = headers; };
      var done = new Promise(function (resolve) { res.end = function (text) { res.body = text; resolve(res); }; });
      assert.equal(handler(req, res, '/api/wireframe/' + route), true);
      req.emit('data', Buffer.from(options.raw || JSON.stringify(body))); req.emit('end');
      return done;
    } };
}
test('inline renderer accepts source without a project file and returns isolated SVG', async function () {
  var f = fixture();
  try {
    var res = await f.request('render', { source: source });
    assert.equal(res.status, 200); assert.equal(res.body, '<svg/>');
    assert.match(res.headers['Content-Security-Policy'], /sandbox/);
    assert.deepEqual(fs.readdirSync(f.cwd), []);
  } finally { f.close(); }
});
test('save creates a project source file and never overwrites an existing file', async function () {
  var f = fixture();
  try {
    var res = await f.request('save', { source: source, path: 'design.puml' });
    assert.equal(res.status, 201); assert.equal(fs.readFileSync(path.join(f.cwd, 'design.puml'), 'utf8'), source);
    res = await f.request('save', { source: source + '\nchanged', path: 'design.puml' });
    assert.equal(res.status, 409); assert.equal(fs.readFileSync(path.join(f.cwd, 'design.puml'), 'utf8'), source);
  } finally { f.close(); }
});
test('save rejects escaping parents, absolute paths, symlinks, and unrelated extensions', async function () {
  var f = fixture();
  try {
    fs.symlinkSync(os.tmpdir(), path.join(f.cwd, 'escape'));
    for (var requested of ['../outside.puml', '/tmp/outside.puml', 'escape/outside.puml', 'file.js']) {
      var res = await f.request('save', { source: source, path: requested });
      assert.ok(res.status === 400 || res.status === 403, requested + ': ' + res.status);
    }
    fs.symlinkSync('/tmp/nonexistent-wireframe', path.join(f.cwd, 'existing.puml'));
    assert.equal((await f.request('save', { source: source, path: 'existing.puml' })).status, 409);
  } finally { f.close(); }
});
test('source endpoint validates bodies, size, methods, and cross-site content', async function () {
  var f = fixture();
  try {
    for (var item of [
      [{}, {}, 400], [{ source: 'x'.repeat(100001) }, {}, 413], [{ source: source }, { raw: '{' }, 400],
      [{ source: source }, { method: 'GET' }, 405], [{ source: source }, { headers: { 'content-type': 'text/plain' } }, 415],
      [{ source: source }, { headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } }, 415],
      [{ source: source }, { raw: 'x'.repeat(650001) }, 413],
    ]) assert.equal((await f.request('render', item[0], item[1])).status, item[2]);
  } finally { f.close(); }
});
test('render rechecks live project access and saving checks file permission', async function () {
  var allowed = true;
  var f = fixture({ requestAccess: { canAccessProject: function () { return allowed; }, fileScope: function () { throw Object.assign(new Error('Not permitted'), { code: 'FILE_FORBIDDEN' }); } },
    renderPlantUml: function () { allowed = false; return Promise.resolve('<svg/>'); } });
  try {
    assert.equal((await f.request('render', { source: source })).status, 403);
    assert.equal((await f.request('save', { source: source, path: 'test.puml' })).status, 403);
    allowed = true;
    assert.equal((await f.request('save', { source: source, path: 'test.puml' })).status, 403);
    assert.deepEqual(fs.readdirSync(f.cwd), []);
  } finally { f.close(); }
});
test('save uses mapped OS identity and exclusive write flags', async function () {
  var identity = { uid: 42 }; var calls = [];
  var f = fixture({ requestAccess: { canAccessProject: function () { return true; }, fileScope: function () { return { identity: identity }; } },
    fsAsUser: function (operation, args, user) { calls.push({ operation: operation, args: args, user: user }); } });
  try {
    assert.equal((await f.request('save', { source: source, path: 'test.puml' })).status, 201);
    assert.equal(calls[0].operation, 'write'); assert.equal(calls[0].args.flag, 'wx'); assert.equal(calls[0].user, identity);
  } finally { f.close(); }
});
test('wireframe presentation stays session-bound and does not create files', async function () {
  var f = fixture(); var sent = [];
  var documents = require('../lib/project-session-document').attachSessionDocument({ cwd: f.cwd, sendToSession: function (id, message) { sent.push({ id: id, message: message }); } });
  try {
    var tool = documents.getToolDefs({ localId: 14 }).find(function (item) { return item.name === 'present_wireframe'; });
    assert.equal((await tool.handler({ id: 'login', source: source })).isError, undefined);
    assert.equal(sent[0].id, 14); assert.equal(sent[0].message.type, 'wireframe_present');
    assert.equal(sent[0].message.source, source); assert.deepEqual(fs.readdirSync(f.cwd), []);
    assert.equal((await tool.handler({ id: '../../bad', source: source })).isError, true);
    assert.equal((await tool.handler({ id: 'login', source: '@startsalt\n{' })).isError, true);
    var unbound = documents.getToolDefs().find(function (item) { return item.name === 'present_wireframe'; });
    assert.equal((await unbound.handler({ id: 'login', source: source })).isError, true);
    assert.match(documents.getSystemPrompt(), /edits happen through conversation/);
  } finally { f.close(); }
});
