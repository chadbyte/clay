// Preserve the server's JSON Schema across SDK and stdio projections.
function validateDefinitions(definitions) {
  var z = require('zod');
  var names = new Set();
  return definitions.map(function (definition) {
    if (!definition || !/^[a-zA-Z0-9_.-]{1,128}$/.test(definition.name) || names.has(definition.name) || Object.prototype.hasOwnProperty.call(Object.prototype, definition.name)) throw new Error('Unsupported MCP tool catalog.');
    names.add(definition.name);
    var parsed = z.fromJSONSchema(definition.inputSchema || { type: 'object', properties: {} });
    if (!parsed.shape) throw new Error('MCP tools must accept an object.');
    return parsed;
  });
}
function createProxy(name, definitions, invoke) {
  var sdk = require('@anthropic-ai/claude-agent-sdk');
  var schemas = validateDefinitions(definitions);
  var tools = definitions.map(function (definition, index) {
    return sdk.tool(definition.name, definition.description || definition.name, schemas[index].shape, function (args) { return invoke(definition.name, args); });
  });
  var server = sdk.createSdkMcpServer({ name: name, version: '1.0.0', tools: tools });
  definitions.forEach(function (definition, index) {
    var tool = server.instance._registeredTools[definition.name];
    tool.inputSchema = schemas[index];
    tool._clayInputSchema = definition.inputSchema || { type: 'object', properties: {} };
  });
  server.instance.server.setRequestHandler(require('@modelcontextprotocol/sdk/types.js').ListToolsRequestSchema, function () {
    return { tools: definitions.map(function (definition) {
      return { name: definition.name, description: definition.description, inputSchema: definition.inputSchema || { type: 'object', properties: {} } };
    }) };
  });
  return server;
}
module.exports = { createProxy: createProxy, validateDefinitions: validateDefinitions };
