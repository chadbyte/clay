// Pin each sign-in browser tunnel to a checked public address, preventing DNS rebinding.
var http = require('http');
var net = require('net');
var network = require('./mcp-network');
async function createBrowserProxy() {
  var sockets = new Set();
  var server = http.createServer(function (req, res) { res.writeHead(403); res.end(); });
  server.on('connection', function (socket) {
    sockets.add(socket); socket.once('close', function () { sockets.delete(socket); });
    socket.on('error', function () {});
  });
  server.on('connect', function (req, socket, head) {
    Promise.resolve().then(async function () {
      var url = network.remoteUrl('https://' + req.url);
      var host = url.hostname.replace(/^\[|\]$/g, '');
      var addresses = await network.publicLookup(host);
      if (socket.destroyed) return;
      var upstream = net.connect({ host: addresses[0].address, family: addresses[0].family, port: Number(url.port || 443), timeout: 15000 });
      sockets.add(upstream);
      upstream.once('close', function () { sockets.delete(upstream); socket.destroy(); });
      upstream.on('error', function () { socket.destroy(); });
      upstream.once('timeout', function () { upstream.destroy(); });
      socket.once('close', function () { upstream.destroy(); });
      upstream.once('connect', function () {
        upstream.setTimeout(0);
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(socket); socket.pipe(upstream);
      });
    }).catch(function () { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  });
  await new Promise(function (resolve, reject) { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server: 'http://127.0.0.1:' + server.address().port, close: function () {
    server.close(); sockets.forEach(function (socket) { socket.destroy(); });
  } };
}
module.exports = { createBrowserProxy: createBrowserProxy };
