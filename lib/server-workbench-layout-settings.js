// User Settings deliberately have no canonical Clay control endpoint.
function attachWorkbenchLayoutSettings(ctx) {
  function reply(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function identity(req) {
    if (!ctx.isRequestAuthed(req)) return null;
    var user = ctx.users.isMultiUser() ? ctx.getMultiUserFromReq(req) : { id: 'default' };
    return user && (!ctx.users.isMultiUser() || ctx.users.findUserById(user.id)) ? user.id : null;
  }
  function handleRequest(req, res, url) {
    if (url !== '/api/user/workbench-layout') return false;
    var accountId = identity(req);
    if (!accountId) { reply(res, 401, { error: 'Sign in to manage workbench layout.' }); return true; }
    if (req.headers['x-clay-account-id'] !== accountId) { reply(res, 403, { error: 'Account changed. Reload and try again.' }); return true; }
    if (req.method === 'GET') {
      try { reply(res, 200, ctx.users.getWorkbenchLayoutPreference(accountId)); }
      catch (error) { reply(res, 500, { error: 'Workbench layout could not be loaded. Try again.' }); }
      return true;
    }
    if (req.method !== 'PUT') { reply(res, 405, { error: 'Method not allowed.' }); return true; }
    if (req.headers['x-clay-settings'] !== '1' || req.headers['sec-fetch-site'] && ['same-origin', 'none'].indexOf(req.headers['sec-fetch-site']) < 0) {
      reply(res, 403, { error: 'Save preferences from Clay.' }); return true;
    }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) throw new Error('Foreign origin'); }
      catch (error) { reply(res, 403, { error: 'Save preferences from Clay.' }); return true; }
    }
    var body = '', finished = false;
    req.setEncoding('utf8');
    req.on('data', function (chunk) {
      if (finished) return;
      body += chunk;
      if (Buffer.byteLength(body) > 1024) { finished = true; body = ''; reply(res, 413, { error: 'Request too large.' }); }
    });
    req.on('aborted', function () { finished = true; });
    req.on('error', function () { finished = true; });
    req.on('end', function () {
      if (finished) return; finished = true;
      if (identity(req) !== accountId) { reply(res, 401, { error: 'Account changed. Sign in again.' }); return; }
      var input;
      try { input = JSON.parse(body); } catch (error) { reply(res, 400, { error: 'Invalid JSON.' }); return; }
      if (!input || Array.isArray(input) || Object.keys(input).length !== 2 || !Object.prototype.hasOwnProperty.call(input, 'mode') || !Object.prototype.hasOwnProperty.call(input, 'revision')) {
        reply(res, 400, { error: 'Invalid workbench preference.' }); return;
      }
      try {
        var result = ctx.users.setWorkbenchLayoutPreference(accountId, input.mode, input.revision);
        reply(res, result.error ? result.status || 400 : 200, result);
      } catch (error) { reply(res, 500, { error: 'Workbench layout could not be saved. Your previous layout is retained.' }); }
    });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachWorkbenchLayoutSettings: attachWorkbenchLayoutSettings };
