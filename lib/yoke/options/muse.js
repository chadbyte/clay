function map(intent) {
  if (intent.readOnly) throw new Error("Muse SDK 1.4.7 cannot enforce the curator read-only sandbox contract");
  return { MUSE: { mcpServers: intent.readOnly ? [] : intent.sessionBridge || [], readOnly: intent.readOnly === true } };
}
module.exports = { map: map };
