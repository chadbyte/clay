var http = require("http");
var fs = require("fs");
var path = require("path");
var WebSocketServer = require("ws").WebSocketServer;

var root = path.join(__dirname, "../..");
var fault = null;
var server = http.createServer(function (request, response) {
  var pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/fault") {
    fault = new URL(request.url, "http://localhost").searchParams.get("mode") || null;
    response.writeHead(204);
    response.end();
    return;
  }
  var file = pathname === "/" ? path.join(__dirname, "websocket-connection-browser.html") : null;
  if (pathname === "/modules/app-connection.js") file = path.join(root, "lib/public/modules/app-connection.js");
  if (pathname === "/modules/websocket-lifecycle.js") file = path.join(root, "lib/public/modules/websocket-lifecycle.js");
  if (!file) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": pathname.indexOf("/modules/") === 0 ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
  fs.createReadStream(file).pipe(response);
});
var websocket = new WebSocketServer({ server: server, path: "/ws" });
websocket.on("connection", function (client) {
  client.on("message", function (data) {
    var message;
    try { message = JSON.parse(data.toString()); } catch (e) { return; }
    if (fault === "close") {
      fault = null;
      client.close(1011, "fixture fault");
      return;
    }
    if (message.type === "ping" && fault !== "drop-pong") client.send(JSON.stringify({ type: "pong" }));
  });
});
server.listen(Number(process.argv[2] || 0), "127.0.0.1", function () {
  process.stdout.write(String(server.address().port) + "\n");
});

function shutdown() {
  websocket.close();
  server.close(function () { process.exit(0); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
