// Authenticated Personal "Agent behavior" settings: GET returns the account's
// policy with the catalog the page renders; PUT merges validated changes and
// answers with the saved policy only after it is persisted.
var schema = require("./agent-behavior-schema");
var ROUTE = "/api/user/agent-behavior";
var MAX_BODY = 8192;

function attachAgentBehaviorSettings(ctx) {
  var users = ctx.users;
  var getMultiUserFromReq = ctx.getMultiUserFromReq;
  var opts = ctx.opts || {};

  function send(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function owner(req) {
    if (!users.isMultiUser()) return { id: "default" };
    var mu = getMultiUserFromReq(req);
    return mu ? { id: mu.id } : null;
  }

  function read(user) {
    if (users.isMultiUser()) return users.getAgentBehavior(user.id);
    var config = typeof opts.onGetDaemonConfig === "function" ? opts.onGetDaemonConfig() : {};
    return schema.normalize(config && config.agentBehavior);
  }

  function reply(res, policy, extra) {
    send(res, 200, Object.assign({ ok: true, policy: policy, effective: schema.effective(policy), catalog: schema.catalog() }, extra || {}));
  }

  function handleRequest(req, res, fullUrl) {
    if (fullUrl !== ROUTE || (req.method !== "GET" && req.method !== "PUT")) return false;
    var user = owner(req);
    if (!user) { send(res, 401, { error: "unauthorized" }); return true; }
    if (req.method === "GET") { reply(res, read(user)); return true; }
    var startedMulti = users.isMultiUser();
    var body = "";
    var tooLarge = false;
    req.on("data", function (chunk) {
      if (tooLarge) return;
      body += chunk;
      if (body.length > MAX_BODY) tooLarge = true;
    });
    req.on("end", function () {
      if (tooLarge) { send(res, 413, { error: "Request too large" }); return; }
      // The body arrives asynchronously: authentication may have been revoked,
      // replaced or the account mode changed since the request started.
      var current = owner(req);
      if (!current || current.id !== user.id || users.isMultiUser() !== startedMulti) { send(res, 401, { error: "unauthorized" }); return; }
      var data;
      try { data = JSON.parse(body); } catch (error) { send(res, 400, { error: "Invalid request" }); return; }
      if (!data || typeof data !== "object") { send(res, 400, { error: "Invalid request" }); return; }
      var result;
      if (users.isMultiUser()) result = users.updateAgentBehavior(user.id, data.changes);
      else if (typeof opts.onUpdateAgentBehavior === "function") result = opts.onUpdateAgentBehavior(data.changes);
      else result = { error: "Agent behavior cannot be saved on this server" };
      if (result.error) { send(res, /^Could not save/.test(result.error) ? 500 : 400, { error: result.error }); return; }
      if (typeof ctx.onAgentBehaviorChanged === "function") {
        try { ctx.onAgentBehaviorChanged(user.id, result.policy); } catch (error) { /* The setting is already saved. */ }
      }
      reply(res, result.policy, data.requestId ? { requestId: String(data.requestId).slice(0, 80) } : null);
    });
    return true;
  }

  return { handleRequest: handleRequest, ROUTE: ROUTE };
}

module.exports = { attachAgentBehaviorSettings: attachAgentBehaviorSettings };
