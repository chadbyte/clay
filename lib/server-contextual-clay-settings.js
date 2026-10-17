// Authenticated personal preferences, using the shared users/config persistence.
function attachContextualClaySettings(ctx) {
  function reply(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function identity(req) {
    if (!ctx.isRequestAuthed(req)) return null;
    return ctx.users.isMultiUser() ? ctx.getMultiUserFromReq(req) : { id: 'default' };
  }
  function handleRequest(req, res, url) {
    if (url !== '/api/user/contextual-clay-geometry') return false;
    var user = identity(req);
    if (!user) { reply(res, 401, { error: 'Sign in to manage popover preferences.' }); return true; }
    if (req.method === 'GET') {
      try { reply(res, 200, { geometry: ctx.users.getContextualClayGeometry(user.id) }); }
      catch (error) { reply(res, 500, { error: 'Could not read popover preference.' }); }
      return true;
    }
    if (req.method !== 'PUT') { reply(res, 405, { error: 'Method not allowed.' }); return true; }
    if (req.headers['x-clay-settings'] !== '1' || (req.headers['sec-fetch-site'] && ['same-origin', 'none'].indexOf(req.headers['sec-fetch-site']) < 0)) {
      reply(res, 403, { error: 'Save preferences from Clay.' }); return true;
    }
    var body = ''; var tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', function (chunk) { body += chunk; if (body.length > 1024 && !tooLarge) { tooLarge = true; reply(res, 413, { error: 'Request too large.' }); } });
    req.on('end', function () {
      if (tooLarge) return;
      var live = identity(req);
      if (!live || live.id !== user.id) { reply(res, 401, { error: 'Sign in again.' }); return; }
      try {
        var result = ctx.users.setContextualClayGeometry(live.id, JSON.parse(body));
        reply(res, result.error ? 400 : 200, result);
      } catch (error) { reply(res, 400, { error: 'Could not save popover preference.' }); }
    });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachContextualClaySettings: attachContextualClaySettings };
