var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var fork = require('node:child_process').fork;
var WebSocket = require('ws');

function fixture() {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, 'fixtures/projects-onboarding-server.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.once('error', reject);
    child.on('message', function (message) { if (message.port) resolve(Object.assign({ child: child }, message)); });
  });
}

function socket(f, route) {
  var ws = new WebSocket('ws://127.0.0.1:' + f.port + route, { headers: { Cookie: 'relay_auth_user=' + f.token } });
  var received = [];
  var waiting = [];
  ws.on('message', function (raw) {
    var msg = JSON.parse(raw);
    var index = waiting.findIndex(function (item) { return item.predicate(msg); });
    if (index === -1) received.push(msg);
    else { var item = waiting.splice(index, 1)[0]; clearTimeout(item.timer); item.resolve(msg); }
  });
  return {
    ws: ws,
    ready: new Promise(function (resolve, reject) { ws.once('open', resolve); ws.once('error', reject); }),
    send: function (msg) { ws.send(JSON.stringify(msg)); },
    take: function (predicate) {
      var index = received.findIndex(predicate);
      if (index !== -1) return Promise.resolve(received.splice(index, 1)[0]);
      return new Promise(function (resolve, reject) {
        var item = { predicate: predicate, resolve: resolve, timer: setTimeout(function () { reject(new Error('WebSocket response timed out')); }, 8000) };
        waiting.push(item);
      });
    },
  };
}

test('fresh Projects flow uses authenticated HTTP and global/project sockets', { timeout: 20000 }, async function (t) {
  var f = await fixture();
  var sockets = [];
  t.after(function () {
    sockets.forEach(function (s) { s.ws.close(); });
    if (f.child.connected) f.child.send('close');
  });
  var base = 'http://127.0.0.1:' + f.port;
  var response = await fetch(base + '/projects', { headers: { Cookie: 'relay_auth_user=' + f.token } });
  var html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /id="projects-hub"/);
  assert.doesNotMatch(html, /data-home-project-slug=/);
  var unauthenticated = await fetch(base + '/projects');
  assert.match(await unauthenticated.text(), /Login/);
  var global = socket(f, '/ws');
  sockets.push(global);
  await global.ready;
  var projects = await global.take(function (msg) { return msg.type === 'projects_updated'; });
  assert.equal(projects.projects.filter(function (p) { return !p.isMate; }).length, 0);
  global.send({ type: 'home_surface_set', preference: { surface: 'projects', onboardingStep: 'project' } });
  var saved = await global.take(function (msg) { return msg.type === 'home_surface_state'; });
  assert.equal(saved.preference.onboardingStep, 'project');
  var otherDevice = socket(f, '/ws');
  sockets.push(otherDevice);
  await otherDevice.ready;
  otherDevice.send({ type: 'home_surface_get' });
  assert.equal((await otherDevice.take(function (msg) { return msg.type === 'home_surface_state'; })).preference.onboardingStep, 'project');
  global.send({ type: 'create_project', name: 'first-project' });
  var created = await global.take(function (msg) { return msg.type === 'add_project_result'; });
  assert.equal(created.ok, true);
  assert.equal(created.slug, 'first-project');
  var reload = await fetch(base + '/projects', { headers: { Cookie: 'relay_auth_user=' + f.token } });
  assert.match(await reload.text(), /data-home-project-slug="first-project"/);
  global.send({ type: 'clone_project', url: 'https://example.com/repo.git' });
  var failedClone = await global.take(function (msg) { return msg.type === 'add_project_result'; });
  assert.equal(failedClone.ok, false);
  var project = socket(f, '/p/first-project/ws');
  sockets.push(project);
  await project.ready;
  await project.take(function (msg) { return msg.type === 'info'; });
  project.send({ type: 'remove_project', slug: 'first-project' });
  assert.equal((await project.take(function (msg) { return msg.type === 'remove_project_result'; })).ok, true);
  var fresh = socket(f, '/ws');
  sockets.push(fresh);
  await fresh.ready;
  var empty = await fresh.take(function (msg) { return msg.type === 'projects_updated'; });
  assert.equal(empty.projects.filter(function (p) { return !p.isMate; }).length, 0);
});
