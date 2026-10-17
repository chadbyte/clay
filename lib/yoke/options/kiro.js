function map(intent) {
  var config = require("./kiro-defaults").getKiroConfig(intent.settings);
  return { KIRO: { engine: config.engine, mode: config.mode, mcpServers: intent.sessionBridge } };
}
module.exports = { map: map };
