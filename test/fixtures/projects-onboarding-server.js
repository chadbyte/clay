// Isolated real HTTP/WebSocket app for first-project integration and browser checks.
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-onboarding-'));
process.env.CLAY_HOME = fixtureHome;
var token = 'onboarding:fixture-token';
fs.writeFileSync(path.join(fixtureHome, 'users.json'), JSON.stringify({ multiUser: true, users: [
  { id: 'admin', username: 'admin', displayName: 'First User', role: 'admin', pinHash: 'set' },
], invites: [] }));
var tokens = {};
tokens[token] = 'admin';
fs.writeFileSync(path.join(fixtureHome, 'auth-tokens.json'), JSON.stringify(tokens));
var access = {};
var relay;
function add(directory, name) {
  var slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (access[slug]) return { ok: true, slug: slug, existing: true };
  access[slug] = { slug: slug, visibility: 'private', ownerId: 'admin', allowedUsers: [] };
  relay.addProject(directory, slug, name, null, 'admin');
  return { ok: true, slug: slug };
}
relay = require('../../lib/server').createServer({
  port: 0,
  onGetProjectAccess: function (slug) { return access[slug] || { error: 'Project not found' }; },
  onCreateProject: function (name) {
    var directory = path.join(fixtureHome, name);
    fs.mkdirSync(directory, { recursive: true });
    return add(directory, name);
  },
  onAddProject: function (directory) {
    if (!directory.startsWith(fixtureHome + path.sep)) return { error: 'Fixture directories only' };
    return add(directory, path.basename(directory));
  },
  onCloneProject: function (_url, _user, done) { done({ ok: false, error: 'Cloning is disabled in this isolated fixture.' }); },
  onRemoveProject: function (slug) { delete access[slug]; relay.destroyProject(slug); },
});
var closing = false;
function finish() { fs.rmSync(fixtureHome, { recursive: true, force: true }); process.exit(0); }
function close() {
  if (closing) return;
  closing = true;
  Promise.resolve(relay.destroyAll()).then(function () { relay.server.close(finish); }).catch(finish);
  setTimeout(finish, 2000).unref();
}
process.on('message', function (message) { if (message === 'close') close(); });
process.on('SIGINT', close);
process.on('SIGTERM', close);
relay.server.listen(0, '127.0.0.1', function () {
  var ready = { port: relay.server.address().port, token: token, directory: fixtureHome };
  if (process.send) process.send(ready);
  else process.stdout.write(JSON.stringify(ready) + '\n');
});
