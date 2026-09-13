// Exact-query projection of SDK-owned tools into the project stdio MCP bridge.

var sessionToolTransport = require("./yoke/session-tool-transport");

function normalizeInputSchema(inputSchema) {
  if (inputSchema && typeof inputSchema.type === "string") return inputSchema;
  try {
    var zod = require("zod");
    var schema = inputSchema && inputSchema.safeParse ? inputSchema : zod.object(inputSchema || {});
    return zod.toJSONSchema(schema);
  } catch (e) {
    return { type: "object", properties: {} };
  }
}

function createSessionQueryToolBridge(ctx) {
  function defs(queryGeneration) {
    if (!ctx.session || !ctx.sdk || !Number.isInteger(queryGeneration)) return [];
    return ctx.sdk.getQueryToolDefs(ctx.session, queryGeneration) || [];
  }

  function listTools(queryGeneration, normalizeToolSchema) {
    var tools = [];
    var queryTools = defs(queryGeneration);
    var normalize = normalizeToolSchema || normalizeInputSchema;
    for (var i = 0; i < queryTools.length; i++) {
      var server = sessionToolTransport.bridgeServerForTool(queryTools[i].name);
      if (!server) continue;
      tools.push({
        server: server,
        name: queryTools[i].name,
        description: queryTools[i].description || queryTools[i].name,
        inputSchema: normalize(queryTools[i].inputSchema),
      });
    }
    return tools;
  }

  function callTool(queryGeneration, serverName, toolName, args) {
    var queryTools = defs(queryGeneration);
    for (var i = 0; i < queryTools.length; i++) {
      if (sessionToolTransport.bridgeServerForTool(queryTools[i].name) !== serverName || queryTools[i].name !== toolName) continue;
      if (typeof queryTools[i].handler !== "function") return Promise.reject(new Error("Session tool handler unavailable: " + serverName + "/" + toolName));
      return Promise.resolve(queryTools[i].handler(args || {}));
    }
    return null;
  }

  return { listTools: listTools, callTool: callTool };
}

module.exports = { createSessionQueryToolBridge: createSessionQueryToolBridge, normalizeInputSchema: normalizeInputSchema };
