var fs = require('fs');
var path = require('path');
var renderer = require('./plantuml-renderer');
var filePaths = require('./project-file-path');

function error(status, message) { return Object.assign(new Error(message), { status: status }); }
function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (chunk) {
      size += Buffer.byteLength(chunk);
      if (size > 650000) { chunks = []; reject(error(413, 'Diagram request is too large.')); return; }
      chunks.push(chunk);
    });
    req.on('aborted', function () { reject(error(400, 'Request cancelled.')); });
    req.on('error', reject);
    req.on('end', function () {
      if (size > 650000) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(error(400, 'Invalid diagram request.')); }
    });
  });
}

function attachWireframeHTTP(ctx) {
  function projectAccess(req) {
    if (!ctx.requestAccess.canAccessProject(req, ctx.slug)) throw error(403, 'Project access is not permitted.');
  }
  function save(req, body, source) {
    var scope = ctx.requestAccess.fileScope(req);
    var requested = body.path;
    if (typeof requested !== 'string' || !/\.puml$/i.test(requested) || requested.indexOf('\0') !== -1 || path.isAbsolute(requested)) {
      throw error(400, 'Choose a project-relative .puml path.');
    }
    var root = fs.realpathSync(ctx.cwd);
    var target = path.resolve(root, requested);
    var parent = filePaths.resolveFilePath(root, path.dirname(target), { projectBound: true });
    target = path.join(parent, path.basename(target));
    try {
      if (scope.identity) ctx.fsAsUser('write', { file: target, content: source, flag: 'wx' }, scope.identity);
      else fs.writeFileSync(target, source, { encoding: 'utf8', flag: 'wx' });
    } catch (e) {
      if (e.code === 'EEXIST' || /EEXIST/.test(String(e.stderr || ''))) throw error(409, 'A file already exists at this path. Choose a new name.');
      throw e;
    }
    return path.relative(root, target).split(path.sep).join('/');
  }
  function handleHTTP(req, res, urlPath) {
    if (urlPath !== '/api/wireframe/render' && urlPath !== '/api/wireframe/save') return false;
    function fail(e) {
      if (res.destroyed || res.writableEnded) return;
      var mapped = filePaths.fileError(e);
      res.writeHead(e.status || mapped.status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(e.status ? e.message : mapped.message);
    }
    try {
      projectAccess(req);
      if (req.method !== 'POST') throw error(405, 'Use POST for wireframes.');
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '') || req.headers['sec-fetch-site'] === 'cross-site') throw error(415, 'Use a same-origin JSON request.');
    } catch (e) { fail(e); return true; }
    var controller = new AbortController();
    function cancel() { controller.abort(); }
    res.once('close', cancel);
    readBody(req).then(function (body) {
      if (controller.signal.aborted) return;
      projectAccess(req);
      if (!body || typeof body.source !== 'string') throw error(400, 'Diagram source is required.');
      var source = renderer.prepareSource(body.source, body.language === 'salt' ? 'diagram.salt' : 'diagram.puml');
      if (urlPath === '/api/wireframe/save') {
        var saved = save(req, body, source);
        res.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ path: saved }));
        return;
      }
      return (ctx.renderPlantUml || renderer.renderPlantUml)(source, { signal: controller.signal }).then(function (svg) {
        if (controller.signal.aborted) return;
        projectAccess(req);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
        res.end(svg);
      });
    }).catch(fail).finally(function () { res.removeListener('close', cancel); });
    return true;
  }
  return { handleHTTP: handleHTTP };
}
module.exports = { attachWireframeHTTP: attachWireframeHTTP };
