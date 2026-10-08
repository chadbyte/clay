var http = require("node:http");
var fs = require("node:fs");
var path = require("node:path");
var sources = {};
var renderer = require("../../lib/plantuml-renderer");
var os = require("node:os");
var scratch = fs.mkdtempSync(path.join(os.tmpdir(), "clay-wireframe-browser-"));
var wireframes = require("../../lib/project-wireframe-http").attachWireframeHTTP({ cwd: scratch, slug: "fixture",
  requestAccess: { canAccessProject: function () { return true; }, fileScope: function () { return { projectBound: true }; } } });
process.on("exit", function () { fs.rmSync(scratch, { recursive: true, force: true }); });
var root = path.resolve(__dirname, "../..");
var server = http.createServer(function (request, response) {
  var pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (wireframes.handleHTTP(request, response, pathname)) return;
  if (pathname === "/fixture/source" && request.method === "POST") {
    var chunks = [];
    request.on("data", function (chunk) { chunks.push(chunk); });
    request.on("end", function () {
      var data = JSON.parse(Buffer.concat(chunks).toString());
      sources[data.path] = data.content;
      response.writeHead(200); response.end("OK");
    });
    return;
  }
  if (pathname === "/api/file/plantuml") {
    var file = new URL(request.url, "http://127.0.0.1").searchParams.get("path");
    try { var source = renderer.prepareSource(sources[file], file); }
    catch (error) { response.writeHead(error.status || 422); response.end(error.message); return; }
    renderer.renderPlantUml(source).then(function (svg) {
      response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(svg);
    }).catch(function (error) { response.writeHead(error.status || 500); response.end(error.message); });
    return;
  }
  var file = pathname === "/" ? path.join(__dirname, "plantuml-browser.html") : path.join(root, pathname.replace(/^\//, ""));
  if (!file.startsWith(root) && !file.startsWith(__dirname)) { response.writeHead(403); response.end("Forbidden"); return; }
  fs.readFile(file, function (error, content) {
    if (error) { response.writeHead(404); response.end("Not found"); return; }
    var type = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : "text/javascript";
    response.writeHead(200, { "Content-Type": type }); response.end(content);
  });
});
server.listen(0, "127.0.0.1", function () {
  process.stdout.write("PLANTUML_UI_URL=http://127.0.0.1:" + server.address().port + "/\n");
});
