// Request-specific review mapping. The caller supplies a query/turn-bound
// receipt; all replies, including asynchronous ones, pass through that receipt.
var dynamicToolNames = require("./codex-dynamic-tool-names");
var codexUserInput = require("./codex-user-input");
function create(options) {
  var state = options.state;
  var canUseTool = options.canUseTool;
  var callDynamicTool = options.callDynamicTool;
  var onElicitation = options.onElicitation;
  var onUserInputRequest = options.onUserInputRequest;
  var canonicalDynamicPermissionToolName = options.canonicalDynamicPermissionToolName;
  return function(msg, requestReceipt) {
    var method = msg.method;
    var requestServer = requestReceipt;
    // Keep the existing explicit allow result contract.
    function isApproved(decision) {
      if (!decision) return false;
      if (decision === true) return true;
      if (decision.behavior === "allow") return true;
      return false;
    }

    // Command approval request
    if (method === "item/commandExecution/requestApproval") {
      var cmdParams = msg.params || {};
      if (cmdParams.itemId && cmdParams.command) {
        state.commandInputs[cmdParams.itemId] = cmdParams.command;
      }
      if (canUseTool) {
        Promise.resolve().then(function() {
          if (!requestReceipt.current()) return { behavior: "deny" };
          return canUseTool("Bash", { command: cmdParams.command }, { signal: requestReceipt.signal, toolUseID: cmdParams.itemId });
        }).then(function(decision) {
          var approved = isApproved(decision);
          // Response must be wrapped in { decision: ... } object per app-server protocol
          requestServer.respond(msg.id, { decision: approved ? "accept" : "decline" });
        }).catch(function(err) {
          console.error("[yoke/codex] canUseTool error:", err.message);
          requestServer.respond(msg.id, { decision: "decline" });
        });
      } else {
        requestServer.respond(msg.id, { decision: "decline" });
      }
      return;
    }

    // Session-bound tools supplied at thread creation. Codex sends these as a
    // server request and waits for the client to execute and answer it.
    if (method === "item/tool/call") {
      var dynamicParams = msg.params || {};
      var resolvedDynamicTool = (state.dynamicToolCatalog || dynamicToolNames.createCatalog([])).resolve(dynamicParams.tool, dynamicParams.namespace);
      if (resolvedDynamicTool.error) {
        requestServer.respond(msg.id, {
          contentItems: [{ type: "inputText", text: "Error: " + resolvedDynamicTool.error }],
          success: false,
        });
        return;
      }
      var dynamicToolName = resolvedDynamicTool.name;
      if (!callDynamicTool) {
        requestServer.respond(msg.id, {
          contentItems: [{ type: "inputText", text: "Session tool handler is unavailable" }],
          success: false,
        });
        return;
      }
      function executeDynamicTool() {
        if (!requestReceipt.current()) return Promise.resolve();
        return Promise.resolve(callDynamicTool(dynamicToolName, dynamicParams.arguments || {})).then(function (result) {
          var content = result && Array.isArray(result.content) ? result.content : [];
          var contentItems = content.map(function (item) {
            return { type: "inputText", text: item && item.text ? item.text : JSON.stringify(item) };
          });
          if (contentItems.length === 0) {
            contentItems.push({ type: "inputText", text: typeof result === "string" ? result : JSON.stringify(result) });
          }
          requestServer.respond(msg.id, { contentItems: contentItems, success: !(result && result.isError) });
        });
      }
      var permissionToolName = canonicalDynamicPermissionToolName(dynamicToolName);
      var permission = canUseTool
        ? Promise.resolve(canUseTool(permissionToolName, dynamicParams.arguments || {}, {
          toolUseID: dynamicParams.callId || String(msg.id),
          signal: requestReceipt.signal,
        }))
        : Promise.resolve({ behavior: "allow" });
      permission.then(function (decision) {
        if (!isApproved(decision)) {
          requestServer.respond(msg.id, {
            contentItems: [{ type: "inputText", text: "Tool use was not approved" }],
            success: false,
          });
          return;
        }
        return executeDynamicTool();
      }).catch(function (err) {
        requestServer.respond(msg.id, {
          contentItems: [{ type: "inputText", text: "Error: " + (err.message || String(err)) }],
          success: false,
        });
      });
      return;
    }

    // MCP elicitation shares the YOKE user-input lifecycle when available.
    if (method === "mcpServer/elicitation/request") {
      var mcpParams = msg.params || {};
      var mcpMeta = mcpParams._meta || {};
      console.log("[yoke/codex] MCP approval request:", (mcpMeta.tool || "?"), "server=" + (mcpParams.serverName || "?"));
      if (onUserInputRequest) {
        codexUserInput.handleElicitation(requestServer, msg, onUserInputRequest, requestReceipt.signal);
      } else if (onElicitation) {
        var request = {
          serverName: mcpParams.serverName || (mcpMeta.tool || "Tool"),
          message: mcpParams.message || mcpParams.prompt || "",
          mode: mcpParams.url ? "url" : "form",
          url: mcpParams.url || null,
          elicitationId: mcpParams.elicitationId || null,
          requestedSchema: mcpParams.requestedSchema || null,
        };
        if (!request.requestedSchema && Array.isArray(mcpParams.questions) && mcpParams.questions.length > 0) {
          var schema = { type: "object", properties: {}, required: [] };
          for (var qi = 0; qi < mcpParams.questions.length; qi++) {
            var q = mcpParams.questions[qi];
            var qid = q.id || ("question_" + (qi + 1));
            schema.required.push(qid);
            if (Array.isArray(q.options) && q.options.length > 0) {
              schema.properties[qid] = {
                type: "string",
                description: q.question || q.prompt || qid,
                enum: q.options.map(function(opt) { return opt && (opt.value || opt.label) ? (opt.value || opt.label) : ""; }).filter(Boolean),
              };
            } else {
              schema.properties[qid] = {
                type: "string",
                description: q.question || q.prompt || qid,
              };
            }
          }
          request.requestedSchema = schema;
        }
        Promise.resolve().then(function() {
          if (!requestReceipt.current()) return { action: "cancel" };
          return onElicitation(request, { signal: requestReceipt.signal });
        }).then(function(result) {
          var resultAction = result && result.action === "reject" ? "decline" : result && result.action;
          requestServer.respond(msg.id, resultAction === "accept" || resultAction === "decline"
            ? Object.assign({}, result, { action: resultAction })
            : { action: "cancel" });
        }).catch(function(err) {
          console.error("[yoke/codex] elicitation_response send failed:", err.message || err);
          requestServer.respond(msg.id, { action: "cancel" });
        });
      } else if (canUseTool) {
        Promise.resolve().then(function() {
          if (!requestReceipt.current()) return { behavior: "deny" };
          return canUseTool("mcp__" + (mcpParams.serverName || "unknown") + "__" + (mcpMeta.tool || "call"), mcpParams, { signal: requestReceipt.signal });
        }).then(function(decision) {
          requestServer.respond(msg.id, { action: isApproved(decision) ? "accept" : "decline" });
        }).catch(function(err) {
          console.error("[yoke/codex] MCP canUseTool error:", err.message);
          requestServer.respond(msg.id, { action: "decline" });
        });
      } else {
        requestServer.respond(msg.id, { action: "decline" });
      }
      return;
    }

  };
}
module.exports = { create: create };
