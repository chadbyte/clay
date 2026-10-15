var itemInput = require("./muse-items").itemInput;

function normalizeMcpServers(servers) {
  var config = {};
  if (servers == null) return config;
  if (!Array.isArray(servers)) throw new Error("Invalid Muse session MCP servers");
  for (var i = 0; i < servers.length; i++) {
    var server = servers[i] || {};
    if (!server.name || !server.command || typeof server.name !== "string" || typeof server.command !== "string" || !Array.isArray(server.args || [])) throw new Error("Invalid Muse session MCP server");
    if (["__proto__", "constructor", "prototype"].includes(server.name) || Object.prototype.hasOwnProperty.call(config, server.name)) throw new Error("Invalid or duplicate Muse MCP server name");
    var env = {};
    var entries = Array.isArray(server.env) ? server.env : [];
    for (var j = 0; j < entries.length; j++) if (entries[j] && entries[j].name) env[entries[j].name] = String(entries[j].value == null ? "" : entries[j].value);
    config[server.name] = {
      transport: "stdio",
      command: server.command,
      args: server.args || [],
      env: env,
      mode: "required"
    };
  }
  return config;
}

function chooseApprovalDecision(request, canUseTool, signal) {
  var choices = Array.isArray(request && request.availableChoices) ? request.availableChoices : [];
  if (!choices.length || typeof canUseTool !== "function") return Promise.reject(new Error("Muse approval cannot be decided safely"));
  if (signal && signal.aborted) return Promise.reject(new Error("Muse approval cancelled"));
  return Promise.resolve(canUseTool(request.toolName || "Tool", itemInput({
    args: request.rawArgs
  }), {
    request: request,
    signal: signal
  })).then(function(result) {
    if (signal && signal.aborted) throw new Error("Muse approval cancelled");
    var allowed = result && result.behavior === "allow";
    if (!allowed && !(result && result.behavior === "deny")) throw new Error("Muse approval returned an unsupported decision");
    for (var i = 0; i < choices.length; i++) if (choices[i].scope === "once" && (choices[i].decision === (allowed ? "approved" : "denied") || !allowed && choices[i].decision === "abort")) {
      var decision = {
        choiceId: choices[i].choiceId
      };
      if (choices[i].acceptsFeedback && result.message) decision.feedback = result.message;
      return decision;
    }
    throw new Error("Muse approval has no matching safe choice");
  });
}

module.exports = {
  normalizeMcpServers: normalizeMcpServers,
  chooseApprovalDecision: chooseApprovalDecision
};
