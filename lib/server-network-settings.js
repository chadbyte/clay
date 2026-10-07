var { normalizeAllowedOrigins, describeConfiguredOrigins } = require("./network-origins");

var MAX_BODY_BYTES = 220000;

function attachNetworkSettings(ctx) {
  function reply(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }

  function authorized(req, res) {
    if (!ctx.isRequestAuthed(req)) {
      reply(res, 401, { error: "Authentication required." });
      return false;
    }
    if (ctx.users.isMultiUser()) {
      var user = ctx.getMultiUserFromReq(req);
      if (!user || user.role !== "admin") {
        reply(res, 403, { error: "Only server administrators can manage network settings." });
        return false;
      }
    }
    return true;
  }

  function handleRequest(req, res, fullUrl) {
    if (fullUrl !== "/api/server/network") return false;
    if (!authorized(req, res)) return true;
    if (req.method === "GET") {
      reply(res, 200, describeConfiguredOrigins(ctx.getConfiguredOrigins()));
      return true;
    }
    if (req.method !== "PUT") {
      reply(res, 405, { error: "Method not allowed." });
      return true;
    }
    // A custom header forces cross-origin browsers to preflight. OPTIONS never
    // reaches this handler: the global preflight handler in server.js answers
    // first and allows only GET and Content-Type, so a cross-origin PUT with
    // this header is refused by the browser. Keep both checks below, and keep
    // that handler from allowing PUT or custom headers (see the preflight test).
    if (req.headers["x-clay-network-settings"] !== "1" ||
        (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json" ||
        (req.headers["sec-fetch-site"] && ["same-origin", "none"].indexOf(req.headers["sec-fetch-site"]) === -1)) {
      reply(res, 403, { error: "Save network settings from the Clay settings page." });
      return true;
    }
    var body = "";
    var size = 0;
    var oversized = false;
    // Decode as a stream so multibyte characters split across chunks stay intact.
    req.setEncoding("utf8");
    req.on("data", function (chunk) {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        if (!oversized) reply(res, 413, { error: "Network settings are too large." });
        oversized = true;
        return;
      }
      body += chunk;
    });
    req.on("end", function () {
      if (oversized) return;
      if (!authorized(req, res)) return;
      var data;
      try { data = JSON.parse(body); } catch (e) {
        reply(res, 400, { error: "The request was not valid JSON." });
        return;
      }
      var origins;
      try {
        origins = normalizeAllowedOrigins(data && data.allowedOrigins);
      } catch (e) {
        var result = { error: e.message };
        if (typeof e.index === "number") {
          result.index = e.index;
          result.reason = e.entryReason;
        }
        reply(res, 400, result);
        return;
      }
      try {
        if (typeof ctx.opts.onSetAllowedOrigins !== "function") {
          reply(res, 503, { error: "Network settings cannot be saved in this server runtime." });
          return;
        }
        ctx.opts.onSetAllowedOrigins(origins);
        reply(res, 200, { allowedOrigins: origins, invalid: [] });
      } catch (e) {
        reply(res, 500, { error: "Could not save network settings. Your previous settings are unchanged." });
      }
    });
    return true;
  }

  return { handleRequest: handleRequest };
}

module.exports = { attachNetworkSettings: attachNetworkSettings };
