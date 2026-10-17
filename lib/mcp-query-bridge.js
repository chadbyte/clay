var descriptors = require('./yoke/sdk-mcp-descriptors').extractMcpDescriptors;
function createQueryBridge(ctx) {
  function valid() {
    if (!ctx.valid()) throw new Error('MCP tools require the current authorized query.');
  }
  function list() {
    if (!ctx.valid()) return [];
    var servers = descriptors(ctx.getServers()) || [], tools = [];
    servers.forEach(function (server) {
      server.tools.forEach(function (tool) { tools.push(Object.assign({ server: server.serverName }, tool)); });
    });
    return tools;
  }
  async function call(serverName, toolName, args) {
    valid();
    var server = ctx.getServers()[serverName], tool = server && server.instance && server.instance._registeredTools[toolName];
    if (!tool || typeof (tool.handler || tool.callback) !== 'function') throw new Error('MCP tool is unavailable.');
    var result = await (tool.handler || tool.callback)(args || {});
    valid(); return result;
  }
  function dynamicDefs() {
    return list().map(function (tool) {
      return { name: 'mcp__' + tool.server + '__' + tool.name, permissionName: 'mcp__' + tool.server + '__' + tool.name,
        description: tool.description, inputSchema: tool.inputSchema, queryBound: true,
        handler: function (args) { return call(tool.server, tool.name, args); } };
    });
  }
  return { list: list, call: call, dynamicDefs: dynamicDefs };
}
module.exports = { createQueryBridge: createQueryBridge };
