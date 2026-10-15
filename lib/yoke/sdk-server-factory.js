// Shared SDK server envelope; transport projection remains inside YOKE.
function load() {
  var sdk = require("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.createSdkMcpServer !== "function" || typeof sdk.tool !== "function") throw new Error("SDK tool server implementation is unavailable.");
  return { createSdkMcpServer: sdk.createSdkMcpServer, tool: sdk.tool };
}
module.exports = { load: load };
