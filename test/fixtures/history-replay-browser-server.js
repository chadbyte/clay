var http = require('node:http');
var fs = require('node:fs');
var path = require('node:path');
var publicRoot = path.resolve(__dirname, '../../lib/public');
var server = http.createServer(function (request, response) {
  var pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') {
    var html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
    html = html.replace('<head>', '<head><script>window.fixtureErrors = []; window.addEventListener("error", function (e) { window.fixtureErrors.push(e.message); }); window.addEventListener("unhandledrejection", function (e) { window.fixtureErrors.push(String(e.reason)); }); window.fixtureSockets = []; window.WebSocket = function () { var socket = this; window.fixtureSockets.push(socket); socket.readyState = 0; socket.send = function () {}; socket.close = function () { socket.readyState = 3; }; setTimeout(function () { socket.readyState = 1; if (socket.onopen) socket.onopen(); }, 0); };</script>');
    html = html.replace(/<script type="module" src="app.js[^\"]*"><\/script>/, '<script type="module" src="/fixture.js"></script>');
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
    return;
  }
  var file = pathname === '/fixture.js' ? path.join(__dirname, 'history-replay-browser.js') : path.resolve(publicRoot, '.' + pathname);
  if (pathname !== '/fixture.js' && !file.startsWith(publicRoot + path.sep)) { response.writeHead(404); response.end(); return; }
  fs.readFile(file, function (error, data) {
    if (error) { response.writeHead(404); response.end(); return; }
    var types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(data);
  });
});
server.listen(0, '127.0.0.1', function () { console.log('http://127.0.0.1:' + server.address().port); });
process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
