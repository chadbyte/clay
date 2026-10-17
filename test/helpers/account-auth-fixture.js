var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var vm = require('node:vm');
var EventEmitter = require('node:events');
function isolated(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-pin-auth-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var cache = {};
  var state = { failUsers: false, failConfig: false };
  var configFile = path.join(root, 'daemon.json');
  var config = {
    CONFIG_DIR: root, isDevMode: false,
    configPath: function () { return configFile; },
    loadConfig: function () { return fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {}; },
    saveConfig: function (data) { if (state.failConfig) throw new Error('config unavailable'); fs.writeFileSync(configFile, JSON.stringify(data)); },
  };
  var isolatedFs = Object.assign({}, fs, { renameSync: function (from, to) {
    if (state.failUsers && to === path.join(root, 'users.json')) throw new Error('users unavailable');
    if (state.failTokens && to === path.join(root, 'auth-tokens.json')) throw new Error('tokens unavailable');
    if (state.failAttempts && to === path.join(root, 'auth-attempts.json')) throw new Error('attempts unavailable');
    return fs.renameSync(from, to);
  } });
  function load(name) {
    if (cache[name]) return cache[name].exports;
    if (name === 'config') return config;
    if (name === 'mates') return { buildMateCtx: function () { return {}; }, ensureBuiltinMates: function () {} };
    if (name === 'dicebear-avatar') return {};
    var file = path.join(__dirname, '../../lib', name + '.js');
    var mod = { exports: {} };
    cache[name] = mod;
    var wrapper = vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file });
    wrapper(function (id) { return id === 'fs' ? isolatedFs : id.indexOf('./') === 0 ? load(id.slice(2)) : require(id); }, mod, mod.exports, file, path.dirname(file));
    return mod.exports;
  }
  var users = load('users');
  var pages = {};
  ['pinPageHtml', 'adminSetupPageHtml', 'multiUserLoginPageHtml', 'smtpLoginPageHtml'].forEach(function (key) { pages[key] = function () { return ''; }; });
  function server() { return load('server-auth').attachAuth({ users: users, smtp: { isEmailLoginEnabled: function () { return false; } }, pages: pages }); }
  return { root: root, users: users, load: load, server: server, config: config, state: state };
}

function request(handler, method, url, body, cookie) {
  var req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { cookie: cookie || '' };
  req.socket = { remoteAddress: '127.0.0.1' };
  var result = {};
  var res = { writeHead: function (code, headers) { result.code = code; result.headers = headers || {}; }, end: function (text) { result.body = JSON.parse(text); } };
  assert.equal(handler.handleRequest(req, res, url), true);
  req.emit('data', JSON.stringify(body));
  req.emit('end');
  return result;
}

function seed(h, pinHash, extras) {
  fs.writeFileSync(path.join(h.root, 'users.json'), JSON.stringify({ multiUser: true, users: [Object.assign({ id: 'owner', username: 'Owner', role: 'admin', pinHash: pinHash }, extras)], invites: [] }));
}


module.exports = { isolated: isolated, request: request, seed: seed };
