// HTTP keeps the observed result reachable after the target project's sockets close.
var crypto = require('crypto');
function attachWorktreeHttp(ctx) {
  function reply(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  function handleRequest(req, res, url) {
    if (url !== '/api/worktree-removal/preview' && url !== '/api/worktree-removal/execute') return false;
    if (!ctx.isRequestAuthed(req)) { reply(res, 401, { ok: false, error: 'Authentication required.' }); return true; }
    if (!ctx.service) { reply(res, 503, { ok: false, error: 'Worktree removal is unavailable in this server runtime.' }); return true; }
    if (req.method !== 'POST' || req.headers['x-clay-worktree-control'] !== '1' ||
        (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json' ||
        req.headers['sec-fetch-site'] && ['same-origin', 'none'].indexOf(req.headers['sec-fetch-site']) < 0) {
      reply(res, 403, { ok: false, error: 'Use the worktree menu in Clay Studio.' }); return true;
    }
    var actor = ctx.getMultiUserFromReq(req), userId = actor && actor.id || null;
    function validate() {
      var current = ctx.getMultiUserFromReq(req);
      if (!ctx.isRequestAuthed(req) || (current && current.id || null) !== userId) throw new Error('The authenticated owner session changed.');
    }
    var connection = crypto.createHash('sha256').update(req.headers.cookie || '').digest('hex');
    var body = '', bytes = 0, oversized = false;
    req.setEncoding('utf8');
    req.on('data', function (chunk) { bytes += Buffer.byteLength(chunk); if (bytes > 4096) { if (!oversized) reply(res, 413, { ok: false, error: 'Request is too large.' }); oversized = true; } else body += chunk; });
    req.on('end', function () {
      if (oversized) return;
      Promise.resolve().then(function () {
        validate(); var data = JSON.parse(body);
        return url.endsWith('/preview') ? ctx.service.preview(data.slug, data.action, userId, connection, data.deleteBranch) : ctx.service.execute(data.token, userId, connection, validate, data.deleteBranch);
      }).then(function (result) { reply(res, 200, result); }, function (error) { reply(res, 409, Object.assign({ ok: false, error: error.message }, error.lifecycleResult || {})); });
    });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachWorktreeHttp: attachWorktreeHttp };
