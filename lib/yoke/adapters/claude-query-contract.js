// Init-free provider transport obligations, shared by the registry and adapter.
module.exports = {
  questionInput: function(name, input) { return name === "AskUserQuestion" ? input : null; },
  toolTransport: "sdk-mcp",
  catalogLifetime: "query",
  permissionModes: ["auto"],
  mcpPermissionOverrides: true,
  interruptionMessage: "Interrupted · What should Claude do instead?",
};
