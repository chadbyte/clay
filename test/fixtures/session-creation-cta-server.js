var http = require("http");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "../..");
var publicRoot = path.join(root, "lib/public");

function contentType(file) {
  if (/\.css$/.test(file)) return "text/css";
  if (/\.js$/.test(file)) return "text/javascript";
  if (/\.html$/.test(file)) return "text/html";
  if (/\.png$/.test(file)) return "image/png";
  if (/\.svg$/.test(file)) return "image/svg+xml";
  return "application/octet-stream";
}

var server = http.createServer(function (req, res) {
  var requestPath = req.url.split("?")[0];
  var file = requestPath === "/" ? path.join(__dirname, "session-creation-cta.html") : path.join(publicRoot, requestPath);
  if (file.indexOf(publicRoot) !== 0 && file !== path.join(__dirname, "session-creation-cta.html")) {
    res.writeHead(404); res.end("Not found"); return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, "127.0.0.1", function () {
  process.stdout.write("http://127.0.0.1:" + server.address().port + "\n");
});

function close() { server.close(function () { process.exit(0); }); }
process.on("SIGINT", close);
process.on("SIGTERM", close);
