var fs = require("fs");
var filePaths = require("./project-file-path");
var renderer = require("./plantuml-renderer");

function attachPlantUmlHTTP(ctx) {
  var wireframes = require("./project-wireframe-http").attachWireframeHTTP(ctx);
  function handleHTTP(req, res, urlPath) {
    if (wireframes.handleHTTP(req, res, urlPath)) return true;
    if (!urlPath.startsWith("/api/file/plantuml?")) return false;
    function fail(error) {
      if (res.destroyed) return;
      var mapped = filePaths.fileError(error);
      res.writeHead(error.status || mapped.status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(error.status ? error.message : mapped.message);
    }
    if (req.method !== "GET") { fail({ status: 405, message: "Use GET to preview a diagram." }); return true; }
    var scope;
    var requested;
    var source;
    try {
      scope = ctx.requestAccess.fileScope(req);
      requested = new URLSearchParams(urlPath.substring(urlPath.indexOf("?"))).get("path");
      var file = filePaths.resolveFilePath(ctx.cwd, requested, scope);
      if (!renderer.isPlantUmlFile(file)) throw { status: 415, message: "Select a PlantUML or Salt file to preview." };
      var stat = scope.identity ? ctx.fsAsUser("stat", { file: file }, scope.identity) : fs.statSync(file);
      if (stat.size > renderer.MAX_SOURCE_BYTES) throw { status: 413, message: "Diagram is too large to preview (100 KB maximum)." };
      source = scope.identity ? ctx.fsAsUser("read", { file: file, readContent: true }, scope.identity).content : fs.readFileSync(file, "utf8");
      source = renderer.prepareSource(source, requested);
    } catch (error) { fail(error); return true; }
    var controller = new AbortController();
    function cancel() { controller.abort(); }
    if (res.once) res.once("close", cancel);
    (ctx.renderPlantUml || renderer.renderPlantUml)(source, { signal: controller.signal }).then(function (svg) {
      if (res.destroyed || controller.signal.aborted) return;
      try { ctx.requestAccess.fileScope(req); }
      catch (error) { fail(error); return; }
      res.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
      res.end(svg);
    }).catch(fail).finally(function () { if (res.removeListener) res.removeListener("close", cancel); });
    return true;
  }
  return { handleHTTP: handleHTTP };
}

module.exports = { attachPlantUmlHTTP: attachPlantUmlHTTP };
