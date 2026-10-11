var fs = require('fs');
var path = require('path');

function attachNotificationSettings(ctx) {
  var defaultPath = path.join(ctx.CONFIG_DIR, 'notification-preferences.json');
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
    if (ctx.users.isMultiUser()) saved = user.notificationPreferences;
    else {
      try { saved = JSON.parse(fs.readFileSync(defaultPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return { alert: !saved || saved.alert !== false, sound: !saved || saved.sound !== false, configured: !!saved };
  }
  function save(user, values) {
    if (ctx.users.isMultiUser()) {
      var data = ctx.users.loadUsers();
      var current = data.users.find(function (entry) { return entry.id === user.id; });
      if (!current) throw new Error('Account no longer available.');
      current.notificationPreferences = values;
      ctx.users.saveUsers(data);
    } else {
      fs.mkdirSync(ctx.CONFIG_DIR, { recursive: true });
      fs.writeFileSync(defaultPath + '.tmp', JSON.stringify(values), { mode: 0o600 });
      fs.renameSync(defaultPath + '.tmp', defaultPath);
    }
  }
  function handleRequest(req, res, url) {
    if (url !== '/api/user/notifications') return false;
    var user = identity(req);
    if (!user) { reply(res, 401, { error: 'Sign in to manage notifications.' }); return true; }
    if (req.method === 'GET') {
      try { reply(res, 200, read(user)); } catch (error) { reply(res, 500, { error: 'Could not read notification preferences.' }); }
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
      if (!values || typeof values.alert !== 'boolean' || typeof values.sound !== 'boolean') { reply(res, 400, { error: 'Alert and sound must be booleans.' }); return; }
      values = { alert: values.alert, sound: values.sound };
      try { save(user, values); reply(res, 200, values); }
      catch (error) { reply(res, 500, { error: 'Could not save notification preferences. Your draft is retained.' }); }
    });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachNotificationSettings: attachNotificationSettings };
