var attachStore = require('./linear-store').attachLinearStore;
var api = require('./linear-api');
function attachLinear(ctx) {
  var storage = attachStore(ctx.CONFIG_DIR), pending = new Map();
  function owner(req) {
    if (!ctx.isRequestAuthed(req)) return null;
    if (!ctx.users.isMultiUser()) return 'default';
    var user = ctx.getMultiUserFromReq(req);
    return user && user.id;
  }
  function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
  function handleRequest(req, res, url) {
    if (url !== '/api/linear/connection') return false;
    var id = owner(req);
    if (!id) { json(res, 401, { error: 'Sign in to connect Linear.' }); return true; }
    var origin = req.headers.origin;
    try { if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== req.headers.host)) throw new Error(); }
    catch (error) { json(res, 403, { error: 'Invalid request origin.' }); return true; }
    if (req.method === 'GET') {
      try { json(res, 200, storage.view(id)); } catch (error) { json(res, 500, { error: 'Could not read Linear connection.' }); }
      return true;
    }
    if (req.method !== 'PUT' && req.method !== 'DELETE') { json(res, 405, { error: 'Method not allowed.' }); return true; }
    // A disconnect or newer save invalidates an older validation in flight.
    var operation = {}; pending.set(id, operation);
    var chunks = [], size = 0;
    req.on('data', function (chunk) { size += chunk.length; if (size <= 8192) chunks.push(chunk); });
    req.on('end', async function () {
      try {
        if (size > 8192) throw new Error('Request is too large.');
        var token = null, workspace = null;
        if (req.method === 'PUT') {
          var body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof body.key !== 'string' || !body.key.trim() || body.key.length > 4096 || /[\r\n]/.test(body.key)) throw new Error('Enter a valid Linear API key.');
          token = body.key.trim();
          var data = await (ctx.query || api.query)(token, 'query ClayConnection { organization { id name urlKey } }');
          if (!data.organization || !data.organization.id) throw new Error('Linear workspace is unavailable.');
          workspace = { id: data.organization.id, name: data.organization.name, slug: data.organization.urlKey };
        }
        if (pending.get(id) !== operation || owner(req) !== id || res.destroyed) throw new Error('Connection changed. Please try again.');
        json(res, 200, storage.save(id, token, workspace));
      } catch (error) { if (!res.destroyed) json(res, 400, { error: 'Could not update Linear connection. Check your API key and try again.' }); }
      finally { if (pending.get(id) === operation) pending.delete(id); }
    });
    req.on('error', function () { if (pending.get(id) === operation) pending.delete(id); });
    return true;
  }
  return { handleRequest: handleRequest, storage: storage };
}
module.exports = { attachLinear: attachLinear };
