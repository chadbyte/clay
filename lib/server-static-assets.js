var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// This helper runs only after the caller's existing routing and authorization.
// Re-read and hash the actual bytes: timestamps/length cannot detect every edit.
function matches(header, etag) {
  if (typeof header !== 'string') return false;
  if (header.trim() === '*') return true;
  var tag = '(?:W/)?"[\x21\x23-\x7e\x80-\xff]*"';
  if (!new RegExp('^[ \t]*' + tag + '(?:[ \t]*,[ \t]*' + tag + ')*[ \t]*$').test(header)) return false;
  return (header.match(new RegExp(tag, 'g')) || []).some(function (value) { return value.replace(/^W\//, '') === etag; });
}
function createStaticAssets(publicDir) {
  return function serveStatic(urlPath, req, res) {
    if (urlPath === '/') urlPath = '/index.html';
    var filePath = path.join(publicDir, urlPath);
    if (!filePath.startsWith(publicDir + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return true;
    }
    var content;
    try { content = fs.readFileSync(filePath); } catch (error) { return false; }
    var ext = path.extname(filePath);
    var mime = MIME_TYPES[ext] || 'application/octet-stream';
    var isImage = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].indexOf(ext) >= 0;
    var headers = { 'Content-Type': mime + (isImage ? '' : '; charset=utf-8'),
      'Cache-Control': isImage ? 'public, max-age=86400, immutable' : 'no-cache' };
    if ((ext === '.js' || ext === '.css') && (req.method === 'GET' || req.method === 'HEAD')) {
      headers.ETag = '"' + crypto.createHash('sha256').update(content).digest('hex') + '"';
      if (matches(req.headers['if-none-match'], headers.ETag)) {
        res.writeHead(304, headers); res.end(); return true;
      }
    }
    res.writeHead(200, headers); res.end(content); return true;
  };
}
module.exports = { createStaticAssets: createStaticAssets };
