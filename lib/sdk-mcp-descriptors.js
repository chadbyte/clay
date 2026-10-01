// Extract serializable tool descriptors from MCP server instances.
// Used for IPC to worker processes (McpSdkServerConfigWithInstance is not serializable).
function extractMcpDescriptors(mcpServers) {
  if (!mcpServers) return null;
  // Claude's adapter uses Zod v3 for JSON Schema tools; other servers use v4.
  // Use the MCP SDK's version-aware converter for both kinds of registered tool.
  var toJSONSchema = require("@modelcontextprotocol/sdk/server/zod-json-schema-compat.js").toJsonSchemaCompat;
  var descriptors = [];
  var names = Object.keys(mcpServers);
  for (var i = 0; i < names.length; i++) {
    var serverName = names[i];
    var server = mcpServers[serverName];
    if (!server || !server.instance || !server.instance._registeredTools) continue;
    var tools = [];
    var toolNames = Object.keys(server.instance._registeredTools);
    for (var j = 0; j < toolNames.length; j++) {
      var toolName = toolNames[j];
      var toolDef = server.instance._registeredTools[toolName];
      var inputSchema = { type: "object", properties: {} };
      try {
        if (toolDef.inputSchema) inputSchema = toJSONSchema(toolDef.inputSchema);
      } catch (e) {
        throw new Error("Cannot serialize MCP tool schema " + serverName + "/" + toolName + ": " + e.message);
      }
      tools.push({
        name: toolName,
        description: toolDef.description || toolName,
        inputSchema: inputSchema,
      });
    }
    if (tools.length > 0) descriptors.push({ serverName: serverName, tools: tools });
  }
  return descriptors.length > 0 ? descriptors : null;
}

module.exports = { extractMcpDescriptors: extractMcpDescriptors };
