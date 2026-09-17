// Canonical, server-owned permission selection validation. The requested mode
// is persisted separately from the SDK mode because Clay keeps the final
// canUseTool decision for GUI sessions.

function normalize(mode) {
  if (mode === "default" || mode === "auto" || mode === "plan" || mode === "acceptEdits" || mode === "bypassPermissions") return mode;
  return null;
}

function capabilities(session, defaultVendor) {
  var vendor = session && session.vendor || defaultVendor || "claude";
  return {
    auto: vendor === "claude",
    mcpOverride: vendor === "claude" && !!(session && session.queryInstance &&
      typeof session.queryInstance.setMcpPermissionModeOverride === "function"),
  };
}

function supportsAuto(session, defaultVendor) {
  return capabilities(session, defaultVendor).auto;
}

function validate(session, mode, defaultVendor) {
  var requested = normalize(mode);
  if (!requested) return { ok: false, error: "Unknown permission mode." };
  if (requested === "auto" && !supportsAuto(session, defaultVendor)) {
    return { ok: false, error: "Auto permissions are not available for this session." };
  }
  return { ok: true, mode: requested };
}

function clientState(session, fallback, defaultVendor) {
  var requested = session && session.permissionMode || fallback || "default";
  return {
    requestedPermissionMode: requested,
    effectivePermissionMode: session && session.effectivePermissionMode || null,
    permissionCapabilities: capabilities(session, defaultVendor),
    mcpPermissionModeOverrides: session && session.mcpPermissionModeOverrides || {},
  };
}

module.exports = { validate: validate, clientState: clientState, supportsAuto: supportsAuto, capabilities: capabilities };
