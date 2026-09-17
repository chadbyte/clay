// Serialized, transactional owner for every per-session permission selection.
// Skip is Clay-managed and deliberately maps the SDK to default.

function createFullAccessService(ctx) {
  var sm = ctx.sm;
  var transitions = new Map();
  function serialize(session, action) {
    var prior = transitions.get(session.localId) || Promise.resolve();
    var next = prior.catch(function () {}).then(action);
    transitions.set(session.localId, next);
    return next.finally(function () { if (transitions.get(session.localId) === next) transitions.delete(session.localId); });
  }
  function snapshot(session) {
    return { permissionMode: session.permissionMode || null, permissionModeBeforeFullAccess: session.permissionModeBeforeFullAccess || null,
      effectivePermissionMode: session.effectivePermissionMode || null, permissionModeFallbackReason: session.permissionModeFallbackReason || null,
      enabled: session.permissionMode === "bypassPermissions" };
  }
  function persist(session) {
    sm.saveSessionFile(session);
    sm.broadcastSessionList();
    if (typeof sm.sendToSession === "function") sm.sendToSession(session, { type: "session_full_access_changed", id: session.localId,
      enabled: session.permissionMode === "bypassPermissions", permissionMode: session.permissionMode });
  }
  async function setNative(session, mode) {
    if (!session.queryInstance || typeof session.queryInstance.setPermissionMode !== "function") return;
    await session.queryInstance.setPermissionMode(mode === "bypassPermissions" ? "default" : mode);
  }
  async function applyMode(session, mode) {
    var previous = snapshot(session);
    if (previous.permissionMode === mode) return previous;
    // Clear stale confirmation before the setter. An init/status event may
    // arrive while it is pending; do not clear that newer observation later.
    session.effectivePermissionMode = null;
    session.permissionModeFallbackReason = null;
    try {
      await setNative(session, mode);
    } catch (error) {
      session.effectivePermissionMode = previous.effectivePermissionMode;
      session.permissionModeFallbackReason = previous.permissionModeFallbackReason;
      throw error;
    }
    session.permissionMode = mode;
    session.permissionModeBeforeFullAccess = mode === "bypassPermissions" ? (previous.permissionMode || sm.currentPermissionMode || "default") : null;
    try { persist(session); return previous; }
    catch (error) {
      session.permissionMode = previous.permissionMode;
      session.permissionModeBeforeFullAccess = previous.permissionModeBeforeFullAccess;
      session.effectivePermissionMode = previous.effectivePermissionMode;
      session.permissionModeFallbackReason = previous.permissionModeFallbackReason;
      try { await setNative(session, previous.permissionMode || "default"); }
      catch (rollbackError) {
        session.effectivePermissionMode = null;
        session.permissionModeFallbackReason = "Permission rollback failed: " + (rollbackError.message || rollbackError);
      }
      throw error;
    }
  }
  function setMode(session, mode) { return serialize(session, function () { return applyMode(session, mode); }); }
  function setEnabled(session, enabled) {
    return serialize(session, function () {
      return applyMode(session, enabled ? "bypassPermissions" : (session.permissionModeBeforeFullAccess || "default"));
    });
  }
  function restore(session, prior) {
    if (!prior) return Promise.resolve();
    return serialize(session, async function () {
      var current = snapshot(session);
      // Runtime-effective state is an observation, not part of the selection
      // snapshot. Clear it before the native setter and preserve any newer
      // init/status event that arrives while the acknowledgement is pending.
      session.effectivePermissionMode = null;
      session.permissionModeFallbackReason = null;
      try {
        await setNative(session, prior.permissionMode || "default");
      } catch (error) {
        session.effectivePermissionMode = current.effectivePermissionMode;
        session.permissionModeFallbackReason = current.permissionModeFallbackReason;
        throw error;
      }
      session.permissionMode = prior.permissionMode;
      session.permissionModeBeforeFullAccess = prior.permissionModeBeforeFullAccess;
      try { persist(session); }
      catch (error) {
        session.permissionMode = current.permissionMode;
        session.permissionModeBeforeFullAccess = current.permissionModeBeforeFullAccess;
        session.effectivePermissionMode = null;
        session.permissionModeFallbackReason = null;
        try { await setNative(session, current.permissionMode || "default"); }
        catch (rollbackError) {
          session.effectivePermissionMode = null;
          session.permissionModeFallbackReason = "Permission rollback failed: " + (rollbackError.message || rollbackError);
        }
        throw error;
      }
    });
  }
  return { restore: restore, setEnabled: setEnabled, setMode: setMode, snapshot: snapshot };
}
module.exports = { createFullAccessService: createFullAccessService };
