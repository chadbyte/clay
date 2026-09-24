var fs = require("fs");
var path = require("path");
var attachRequestAccess = require("./project-request-access").attachRequestAccess;
var resolveFilePath = require("./project-file-path").resolveFilePath;
var fileError = require("./project-file-path").fileError;

var MIME_TYPES = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".bmp": "image/bmp", ".ico": "image/x-icon",
};

function attachFileHTTP(ctx) {
  var access = ctx.requestAccess || attachRequestAccess(Object.assign({}, ctx, {
    getOsUserInfoForWs: ctx.getOsUserInfoForReq,
  }));

  function handleHTTP(req, res, urlPath) {
    var download = urlPath.startsWith("/api/file/download?");
    if (req.method !== "GET" || (!download && !urlPath.startsWith("/api/file?"))) return false;
    try {
      var scope = access.fileScope(req);
      var requested = new URLSearchParams(urlPath.substring(urlPath.indexOf("?"))).get("path");
      var file = resolveFilePath(ctx.cwd, requested, scope);
      var mime = MIME_TYPES[path.extname(file).toLowerCase()];
      if (!download && !mime) {
        res.writeHead(403); res.end("Only image files"); return true;
      }
      var content = scope.identity ? ctx.fsAsUser("read_binary", { file: file }, scope.identity).buffer : fs.readFileSync(file);
      var headers = {
        "Content-Type": download ? "application/octet-stream" : mime,
        "Content-Length": content.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      };
      if (download) {
        var name = path.basename(requested).replace(/[\x00-\x1f\x7f"\\]/g, "_") || "download";
        var ascii = name.replace(/[^\x20-\x7e]/g, "_");
        var encoded = encodeURIComponent(name).replace(/[!'()*]/g, function (character) {
          return "%" + character.charCodeAt(0).toString(16).toUpperCase();
        });
        headers["Content-Disposition"] = "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded;
      }
      res.writeHead(200, headers);
      res.end(content);
    } catch (error) {
      var result = fileError(error);
      res.writeHead(result.status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(result.message);
    }
    return true;
  }
  return { handleHTTP: handleHTTP };
}

module.exports = { attachFileHTTP: attachFileHTTP };
