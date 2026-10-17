var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var AGE = 90 * 86400000;
function attachRemembered(ctx) {
  var name = ctx.devMode ? 'clay_accounts_dev' : 'clay_accounts';
  function digest(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
  function token(req) { var value = ctx.parseCookies(req)[name]; return /^[a-f0-9]{64}$/.test(value || '') ? value : null; }
  function load() {
    try {
      var data = JSON.parse(fs.readFileSync(ctx.file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid remembered account data.');
      Object.keys(data).forEach(function (key) {
        var entry = data[key];
        if (!/^[a-f0-9]{64}$/.test(key) || !entry || !Number.isFinite(entry.until) || !Array.isArray(entry.ids)) delete data[key];
      });
      return data;
    }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  function save(data) {
    Object.keys(data).forEach(function (key) { if (!data[key] || data[key].until <= Date.now()) delete data[key]; });
    fs.mkdirSync(path.dirname(ctx.file), { recursive: true });
    fs.writeFileSync(ctx.file + '.tmp', JSON.stringify(data), { mode: 0o600 }); fs.renameSync(ctx.file + '.tmp', ctx.file);
  }
  function cookie(value, req) {
    return name + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (value ? AGE / 1000 : 0) + (ctx.transport.info(req).secure ? '; Secure' : '');
  }
  function remember(userId, req) {
    if (!req) return null;
    // Remembering a name is optional; a storage failure must not fail a valid login.
    try {
      var data = load(); var previous = token(req); var old = previous && data[digest(previous)];
      var ids = old && old.until > Date.now() && Array.isArray(old.ids) ? old.ids : [];
      var next = crypto.randomBytes(32).toString('hex');
      if (previous) delete data[digest(previous)];
      data[digest(next)] = { until: Date.now() + AGE, ids: [userId].concat(ids.filter(function (id) { return id !== userId; })).slice(0, 5) };
      var keys = Object.keys(data).sort(function (a, b) { return data[a].until - data[b].until; });
      keys.slice(0, Math.max(0, keys.length - 10000)).forEach(function (key) { delete data[key]; });
      save(data); return cookie(next, req);
    } catch (error) { return null; }
  }
  function accounts(req) {
    var value = token(req); var entry = value && load()[digest(value)];
    if (!entry || entry.until <= Date.now() || !Array.isArray(entry.ids)) return [];
    return entry.ids.map(function (id) { return ctx.users.findUserById(id); }).filter(Boolean).map(function (user) {
      return { id: user.id, username: user.username, name: user.profile && user.profile.name || user.displayName || user.username };
    });
  }
  function handleRequest(req, res, url) {
    if (url !== '/auth/accounts') return false;
    function reply(code, data, cookies) { var headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }; if (cookies) headers['Set-Cookie'] = cookies; res.writeHead(code, headers); res.end(JSON.stringify(data)); }
    if (!ctx.users.isMultiUser()) { reply(200, { accounts: [] }); return true; }
    var origin = ctx.transport.info(req).origin;
    if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') { reply(403, { error: 'Use the same Clay address.' }); return true; }
    if (req.method === 'GET') {
      try { reply(200, { accounts: accounts(req) }); } catch (error) { reply(503, { error: 'Remembered accounts are unavailable. You can still sign in.' }); }
      return true;
    }
    if (req.method !== 'POST') { reply(405, { error: 'Method not allowed.' }); return true; }
    if (!origin || req.headers.origin !== origin) { reply(403, { error: 'Use the same Clay address.' }); return true; }
    ctx.read(req, res, function (body) {
      if (typeof body.forget !== 'string' || !body.forget) { reply(400, { error: 'Choose an account to forget.' }); return; }
      try {
      var value = token(req); var data = load(); var key = value && digest(value); var entry = key && data[key];
      if (entry) {
        entry.ids = entry.ids.filter(function (id) { return id !== body.forget; });
        if (!entry.ids.length) delete data[key];
        save(data);
      }
      reply(200, { accounts: accounts(req) }, !entry || !entry.ids.length ? cookie('', req) : undefined);
      } catch (error) { reply(503, { error: 'Could not forget this account. Please try again.' }); }
    }); return true;
  }
  return { remember: remember, handleRequest: handleRequest };
}
module.exports = { attachRemembered: attachRemembered };
