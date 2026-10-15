var http = require('node:http');
var fs = require('node:fs');
var path = require('node:path');
var publicRoot = path.resolve(__dirname, '../../lib/public');
var childProcess = require('node:child_process');
var baseline = process.argv.indexOf('--baseline') !== -1;
var baselineFiles = {};
if (baseline) ['thinking-view.js', 'thinking-lifecycle.js'].forEach(function (name) { baselineFiles[name] = childProcess.execFileSync('git', ['show', '020ab6fc:lib/public/modules/' + name]); });
var reports = [];
var server = http.createServer(function (request, response) {
  var pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/report' && request.method === 'POST') {
    var body = '';
    request.on('data', function (data) { body += data; });
    request.on('end', function () { reports.push(JSON.parse(body)); console.log(body); response.end('ok'); });
    return;
  }
  if (pathname === '/reports') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(reports)); return; }
  if (pathname === '/modules/thinking-view.js' || pathname === '/modules/thinking-lifecycle.js') {
    var saved = baselineFiles[path.basename(pathname)];
    if (saved) { response.setHeader('content-type', 'text/javascript'); response.end(saved); return; }
  }
  if (pathname === '/split') {
    response.setHeader('content-type', 'text/html');
    response.end(fs.readFileSync(path.join(__dirname, 'worker-freeze-split.html')));
    return;
  }
  if (pathname === '/' || pathname === '/p/fixture/') {
    var html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
    html = html.replace('<head>', '<head><script>window.freezeBaseline = ' + baseline + ';</script>');
    html = html.replace('<head>', '<head><script>window.fixtureErrors = []; window.addEventListener("error", function (e) { window.fixtureErrors.push(e.message); }); window.addEventListener("unhandledrejection", function (e) { window.fixtureErrors.push(String(e.reason)); }); window.fixtureSockets = []; window.WebSocket = function () { var socket = this; window.fixtureSockets.push(socket); socket.readyState = 0; socket.send = function () {}; socket.close = function () { socket.readyState = 3; }; setTimeout(function () { socket.readyState = 1; if (socket.onopen) socket.onopen(); }, 0); };</script>');
    html = html.replace(/<script type="module" src="app.js[^\"]*"><\/script>/, '<script type="module" src="/fixture.js"></script>');
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
    return;
  }
  var file = pathname === '/fixture.js' ? path.join(__dirname, 'worker-freeze-browser.js') : path.resolve(publicRoot, '.' + pathname);
  if (pathname !== '/fixture.js' && !file.startsWith(publicRoot + path.sep)) { response.writeHead(404); response.end(); return; }
  fs.readFile(file, function (error, data) {
    if (error) { response.writeHead(404); response.end(); return; }
    var types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(data);
  });
});
server.listen(Number(process.argv[2]) || 0, '127.0.0.1', function () { var url = 'http://127.0.0.1:' + server.address().port; console.log(url); if (process.send) process.send({ url: url }); });
process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });
