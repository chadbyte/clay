// Static server for the elicitation form browser fixture.
var http = require("node:http");
var fs = require("node:fs");
var path = require("node:path");
var root = path.resolve(__dirname, "../..");
var server = http.createServer(function (request, response) {
  var pathname = new URL(request.url, "http://127.0.0.1").pathname;
  var file = pathname === "/" ? path.join(__dirname, "elicitation-form-browser.html") : path.join(root, pathname.replace(/^\//, ""));
  if (!file.startsWith(root)) { response.writeHead(403); response.end("Forbidden"); return; }
  fs.readFile(file, function (error, content) {
    if (error) { response.writeHead(404); response.end("Not found"); return; }
    var type = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : "text/javascript";
    response.writeHead(200, { "Content-Type": type }); response.end(content);
  });
});
server.listen(Number(process.env.PORT || 0), "127.0.0.1", function () {
  process.stdout.write("ELICITATION_FORM_URL=http://127.0.0.1:" + server.address().port + "/\n");
});
