// Muse's sessionMcp configuration is supplied on both start and resume.
module.exports = {
  toolTransport: "stdio-mcp",
  catalogLifetime: "query",
  permissionModes: ["auto"],
  interruptionMessage: "Interrupted · What should Muse do instead?",
};
