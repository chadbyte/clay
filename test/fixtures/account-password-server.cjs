var http = require('node:http');
var fs = require('node:fs');
var path = require('node:path');
var fixture = require('../helpers/account-auth-fixture');
var cleanup = [];
var h = fixture.isolated({ after: function (fn) { cleanup.push(fn); } });
fixture.seed(h, h.users.hashPin('012345'));
var auth = h.server();
var adminCookie = auth.createMultiUserSession('owner').cookie;
var publicRoot = path.resolve(__dirname, '../../lib/public');
var virtualPasskey = process.argv.includes('--virtual-passkey') ? require('../helpers/passkey-browser-fixture').attach() : null;
var app = http.createServer(function (req, res) {
  var url = req.url.split('?')[0];
  if (virtualPasskey && virtualPasskey.handle(req, res, url)) return;
  var originalEnd = res.end;
  res.end = function (body) {
    if (typeof body === 'string' && body.indexOf('<!doctype html>') === 0) {
      var extra = (virtualPasskey ? '<script src="/fixture/passkey-shim.js"></script>' : '') +
        (req.url.indexOf('theme=dark') !== -1 ? '<style>:root{color-scheme:dark!important}</style>' : '');
      body = body.replace('</head>', extra + '</head>');
    }
    return originalEnd.call(res, body);
  };
  if (url === '/fixture/settings') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/html' }, auth.isRequestAuthed(req) ? {} : { 'Set-Cookie': adminCookie }));
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/settings-ui.css"><link rel="stylesheet" href="/css/server-settings-system.css"><style>:root{--text:#171717;--text-muted:#666;--bg:#f2f2ef;--bg-alt:#fff;--border:#ccc;--accent:#5857fc;--input-bg:#fff}body{margin:0;background:var(--bg);color:var(--text);font:13px system-ui}main{max-width:700px;margin:32px auto;padding:24px}.server-settings-section{display:block!important}h2{font-size:20px}[hidden]{display:none!important}</style></head><body><main id="server-settings"><div class="server-settings-section" data-section="security"><h2>Access &amp; security</h2><p class="settings-page-description"></p></div></main><script type="module">import {initAccountAuthSettings,loadAccountAuthSettings} from "/modules/account-auth-settings.js";initAccountAuthSettings();loadAccountAuthSettings();</script></body></html>');
    return;
  }
  if (url.indexOf('/modules/') === 0 || url.indexOf('/css/') === 0) {
    var file = path.resolve(publicRoot, '.' + url);
    if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/css' }); res.end(fs.readFileSync(file)); return;
  }
  if (auth.handleRequest(req, res, url)) return;
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(auth.isRequestAuthed(req) ? '<!doctype html><h1>Workspace access granted</h1><a href="/account/password">Change password</a> <a href="/account/passkeys">Manage passkeys</a> <a href="/account/sessions">Manage sessions</a> <a href="/fixture/settings">Server settings</a><form method="post" action="/auth/logout"><button>Sign out</button></form>' : auth.getAuthPage());
});
async function start() {
  if (process.argv.includes('--password')) {
    var state = h.users.loadUsers(); state.accountAuthMethod = 'password';
    state.users[0].passwordHash = await require('../../lib/account-passwords').hash('fixture only long passphrase');
    state.users[0].pinHash = null; h.users.saveUsers(state);
    adminCookie = auth.createMultiUserSession('owner', state.users[0].passwordHash).cookie;
    if (process.argv.includes('--sessions')) auth.createMultiUserSession('owner', state.users[0].passwordHash, null, false, {
      headers: { host: 'localhost', 'user-agent': 'Mozilla/5.0 Windows Firefox/130.0' }, socket: { remoteAddress: '127.0.0.2' },
    });
  }
  app.listen(0, '127.0.0.1', function () { console.log('Fixture: http://localhost:' + app.address().port + '/fixture/settings'); });
}
start();
function stop() { app.close(function () { cleanup.forEach(function (fn) { fn(); }); process.exit(0); }); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
