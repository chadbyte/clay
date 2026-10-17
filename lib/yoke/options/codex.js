function map(intent) {
  var config = require("./codex-defaults").getCodexConfig(intent.settings);
  return { CODEX: { approvalPolicy: "never", sandboxMode: intent.readOnly ? "read-only" : config.sandbox,
    webSearchMode: intent.readOnly ? "disabled" : config.webSearch } };
}
module.exports = { map: map };
