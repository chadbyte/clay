// Typed human recovery routes; never accepts an owner chosen by the client.
function attachOwnershipRoutes(ctx) {
  function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  function authorize(req, slug) {
    var actor = ctx.getUser(req), project = ctx.projects.get(slug);
    var account = actor && ctx.users.findUserById(actor.id);
    if (!ctx.users.isMultiUser() || !account || account.role !== 'admin' || ctx.users.getEffectivePermissions(account, ctx.osUsers).projectSettings === false) throw new Error('Administrator and Project Settings permission required.');
    if (!project || project.getStatus().isMate || slug.startsWith('mate-') || slug.includes('--')) throw new Error('Choose an ordinary parent project.');
    return account;
  }
  function handleRequest(req, res, url) {
    var match = /^\/api\/project-settings\/([a-z0-9_-]+)\/ownership$/.exec(url);
    if (!match) return false;
    var slug = match[1];
    try { authorize(req, slug); } catch (error) { send(res, 403, { error: error.message }); return true; }
    if (!ctx.service) { send(res, 503, { error: 'Live ownership recovery is unavailable on this server. Ask the operator to update the server and verify its account mapping.' }); return true; }
    if (req.method === 'GET') {
      try { send(res, 200, ctx.service.inspect(slug)); } catch (error) { send(res, 409, { error: error.message }); }
    } else if (req.method === 'POST') {
      var origin = req.headers.origin, foreign = false;
      try { foreign = !!origin && new URL(origin).host !== req.headers.host; } catch (error) { foreign = true; }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '') || req.headers['sec-fetch-site'] === 'cross-site' || foreign) { send(res, 403, { error: 'Use the authenticated same-origin recovery form.' }); return true; }
      var body = '', tooLarge = false;
      req.on('data', function (chunk) { if (body.length + chunk.length > 2048) { tooLarge = true; return; } body += chunk; });
      req.on('end', function () {
        try {
          if (tooLarge) throw new Error('Request too large.');
          var data = JSON.parse(body);
          if (Object.keys(data).length !== 1 || typeof data.revision !== 'string' || !/^[a-f0-9]{64}$/.test(data.revision)) throw new Error('Review the exact recovery check first.');
          var result = ctx.service.apply(slug, data.revision, function () { authorize(req, slug); });
          send(res, result.ok ? 200 : 409, result);
        } catch (error) { send(res, 409, { error: error.message }); }
      });
    } else send(res, 405, { error: 'Method not allowed.' });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachOwnershipRoutes: attachOwnershipRoutes };
