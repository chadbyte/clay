'use strict';
// Preview of the Worker update notice on the real production app, for the shared Browser.
// Starts the isolated appearance-pane fixture (fenced providers/Git, temp storage), then
// serves it through a small proxy that seeds sample notices into the page and swallows
// outgoing pair_result_* messages. No provider, PTY or real recovery action is possible.
//   node test/fixtures/pair-notice-preview.cjs [port]
//   open http://127.0.0.1:<port>/preview?n=3&split=0      (n=1..3 notices, split=0 native chat / 1 split panes)
var cp = require('node:child_process'), http = require('node:http'), net = require('node:net'), path = require('node:path');
var child = cp.fork(path.join(__dirname, 'appearance-pane-server.cjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
var SEED = function () {
  var m = document.cookie.match(/(?:^|; )wbxq=([^;]*)/);
  var q = new URLSearchParams(m ? decodeURIComponent(m[1]) : '');
  var n = Number(q.get('n') || 3), split = q.get('split') === '1';
  var LONG = 'Delivery could not be confirmed. ' + 'verylongunbrokenidentifier_'.repeat(8);
  var all = [
    { id: 'one', state: 'uncertain', message: LONG, response: 'Completed result text', hasCompletedResult: true, canRetry: true, confirmDuplicate: true, revision: 'r1' },
    { id: 'two', state: 'pending', message: 'Waiting for the Driver to accept the result.', response: 'second result', hasCompletedResult: true, canRetry: true, confirmDuplicate: false, revision: 'r2' },
    { id: 'three', state: 'blocked', message: 'Blocked until the Driver starts a turn.', hasCompletedResult: false, revision: 'r3' }
  ];
  // The app re-renders on connect, session activation and split restore, each of which can clear
  // the notice or re-hide the native chat. Re-apply the sample state until the page is left;
  // nothing here waits in a loop, and every step tolerates the app not being ready yet.
  var modules = null, loading = false, patched = false;
  function load() {
    if (modules || loading) return;
    loading = true;
    Promise.all([import('/p/reuse/modules/store.js'), import('/p/reuse/modules/pair-result-status.js'), import('/p/reuse/modules/ws-ref.js')]).then(function (list) {
      modules = { store: list[0].store, status: list[1], ref: list[2] };
    }, function () { loading = false; });
  }
  setInterval(function () {
    try {
      var host = document.getElementById('split-host'), app = document.getElementById('app');
      if (!app) return;
      load();
      if (!modules) return;
      var ws = modules.ref.getWs();
      if (ws && !patched) {
        patched = true; var send = ws.send.bind(ws);
        ws.send = function (data) { if (/"pair_result_/.test(data)) { console.log('captured', data); return; } return send(data); };
      }
      if (!split && host) { app.classList.remove('split-native-hidden'); host.style.display = 'none'; }
      var sid = modules.store.get('activeSessionId');
      if (sid && !document.getElementById('pair-result-status')) modules.status.handlePairResultStatus({ sessionId: sid, items: all.slice(0, n) });
    } catch (error) { console.log('preview seed waiting: ' + error.message); }
  }, 400);
};
function rewrite(body) { return body.replace('</body>', '<script>(' + SEED.toString() + ')();</script></body>'); }
var upstream = null;
child.once('message', function (info) {
  upstream = info.port;
  var server = http.createServer(function (req, res) {
    if (req.url.indexOf('/preview') === 0) { var q = req.url.slice('/preview'.length); res.writeHead(302, { Location: '/fixture/login' + '', 'Set-Cookie': 'wbxq=' + encodeURIComponent(q) + '; Path=/' }); return res.end(); }
    var proxied = http.request({ host: '127.0.0.1', port: upstream, path: req.url, method: req.method, headers: Object.assign({}, req.headers, { 'accept-encoding': 'identity' }) }, function (up) {
      var type = String(up.headers['content-type'] || '');
      if (/text\/html/.test(type) && /\/p\/reuse\/?$/.test(req.url.split('?')[0])) {
        var chunks = []; up.on('data', function (c) { chunks.push(c); }); up.on('end', function () {
          var body = rewrite(Buffer.concat(chunks).toString('utf8')); var headers = Object.assign({}, up.headers); delete headers['content-length']; res.writeHead(up.statusCode, headers); res.end(body);
        });
      } else { res.writeHead(up.statusCode, up.headers); up.pipe(res); }
    });
    proxied.on('error', function () { res.statusCode = 502; res.end('upstream unavailable'); });
    req.pipe(proxied);
  });
  server.on('upgrade', function (req, socket, head) {
    var up = net.connect(upstream, '127.0.0.1', function () {
      up.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + Object.keys(req.headers).map(function (k) { return k + ': ' + req.headers[k]; }).join('\r\n') + '\r\n\r\n'); if (head && head.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    up.on('error', function () { socket.destroy(); }); socket.on('error', function () { up.destroy(); });
  });
  server.listen(Number(process.argv[2]) || 0, '127.0.0.1', function () {
    console.log('preview: http://127.0.0.1:' + server.address().port + '/preview?n=3&split=0');
  });
  function stop() { child.kill('SIGTERM'); server.close(); process.exit(0); }
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
});
