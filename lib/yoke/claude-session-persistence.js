function queryEnv(env, inheritedEnv) {
  // A deliberate new message may resume the conversation, but must not replay
  // a tool invocation previously deferred by a hook.
  // The SDK replaces its subprocess environment. Resolve the default only in
  // the process launching Claude, never in the daemon for a mapped worker.
  var source = env === undefined ? (inheritedEnv === undefined ? process.env : inheritedEnv) : env;
  return Object.assign({}, source, { CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME: "1" });
}

function warning(event) {
  var lost = Array.isArray(event.lost) ? event.lost : [];
  var transcript = lost.indexOf("transcript") !== -1;
  var config = lost.indexOf("global_config") !== -1;
  var subject = transcript && config ? "conversation history and its global configuration"
    : transcript ? "conversation history" : config ? "its global configuration" : "some session data";
  var cause = event.errorCode === "ENOSPC" ? " because the disk is full"
    : event.errorCode === "EDQUOT" ? " because the disk quota is exhausted" : "";
  var content = "Claude Code could not save " + subject + cause + ".";
  if (transcript) content += " Resuming an affected conversation may omit recent messages. Save a handoff of the visible work before leaving.";
  if (config) content += " Recent Claude Code configuration changes may not persist.";
  content += " Check available disk space and quota on the system running Clay Studio before continuing.";
  return content;
}

module.exports = { queryEnv: queryEnv, warning: warning };
