function map(intent) { return { ANTIGRAVITY: { dangerouslySkipPermissions: !intent.readOnly && (intent.nativeBypass || intent.permissionMode === "bypassPermissions") } }; }
module.exports = { map: map };
