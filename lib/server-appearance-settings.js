var fs = require('fs');
var path = require('path');

function attachAppearanceSettings(ctx) {
  var defaultPath = path.join(ctx.CONFIG_DIR, 'appearance-preferences.json');
  function reply(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function identity(req) {
    if (!ctx.isRequestAuthed(req)) return null;
    if (!ctx.users.isMultiUser()) return { id: 'default' };
    return ctx.getMultiUserFromReq(req);
  }
  function read(user) {
    var saved;
    if (ctx.users.isMultiUser()) saved = user.appearancePreferences;
    else {
      try { saved = JSON.parse(fs.readFileSync(defaultPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return Object.assign({ theme: saved && saved.theme || null, mode: saved && saved.mode || null, configured: !!saved }, saved && saved.lightTheme ? { lightTheme: saved.lightTheme } : {}, saved && saved.darkTheme ? { darkTheme: saved.darkTheme } : {});
  }
  function save(user, values) {
    if (ctx.users.isMultiUser()) {
      var data = ctx.users.loadUsers();
      var current = data.users.find(function (entry) { return entry.id === user.id; });
      if (!current) throw new Error('Account no longer available.');
      current.appearancePreferences = values;
      ctx.users.saveUsers(data);
    } else {
      fs.mkdirSync(ctx.CONFIG_DIR, { recursive: true });
      fs.writeFileSync(defaultPath + '.tmp', JSON.stringify(values), { mode: 0o600 });
      fs.renameSync(defaultPath + '.tmp', defaultPath);
    }
  }
  function handleRequest(req, res, url) {
    if (url !== '/api/user/appearance') return false;
    var user = identity(req);
    if (!user) { reply(res, 401, { error: 'Sign in to manage appearance.' }); return true; }
    if (req.method === 'GET') {
      try { reply(res, 200, read(user)); } catch (error) { reply(res, 500, { error: 'Could not read appearance preferences.' }); }
      return true;
    }
    if (req.method !== 'PUT') { reply(res, 405, { error: 'Method not allowed.' }); return true; }
    if (req.headers['x-clay-settings'] !== '1' || (req.headers['sec-fetch-site'] && ['same-origin', 'none'].indexOf(req.headers['sec-fetch-site']) < 0)) {
      reply(res, 403, { error: 'Save preferences from Clay.' }); return true;
    }
    var body = ''; var tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', function (chunk) { body += chunk; if (body.length > 4096 && !tooLarge) { tooLarge = true; reply(res, 413, { error: 'Request too large.' }); } });
    req.on('end', function () {
      if (tooLarge) return;
      user = identity(req);
      if (!user) { reply(res, 401, { error: 'Sign in again.' }); return; }
      var values;
      try { values = JSON.parse(body); } catch (error) { reply(res, 400, { error: 'Invalid JSON.' }); return; }
      if (!values || (values.theme !== null && (typeof values.theme !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(values.theme))) || [null, 'light', 'dark'].indexOf(values.mode) < 0) { reply(res, 400, { error: 'Invalid appearance preference.' }); return; }
      if (['lightTheme', 'darkTheme'].some(function (field) { return values[field] !== undefined && (typeof values[field] !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(values[field])); })) { reply(res, 400, { error: 'Invalid theme pair.' }); return; }
      var previous;
      try { previous = read(user); } catch (error) { reply(res, 500, { error: 'Could not read appearance preferences.' }); return; }
      values = Object.assign({}, previous.lightTheme ? { lightTheme: previous.lightTheme } : {}, previous.darkTheme ? { darkTheme: previous.darkTheme } : {}, values);
      values = Object.assign({ theme: values.theme, mode: values.mode }, values.lightTheme ? { lightTheme: values.lightTheme } : {}, values.darkTheme ? { darkTheme: values.darkTheme } : {});
      try { save(user, values); reply(res, 200, values); }
      catch (error) { reply(res, 500, { error: 'Could not save appearance preferences. Your draft is retained.' }); }
    });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachAppearanceSettings: attachAppearanceSettings };
