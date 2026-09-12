// Shared, transactional control for Clay-managed per-session Skip Permissions.

function createFullAccessService(ctx) {
  var sm = ctx.sm;
  var transitions = new Map();

  function serialize(session, action) {
    var prior = transitions.get(session.localId) || Promise.resolve();
    var next = prior.catch(function () {}).then(action);
    transitions.set(session.localId, next);
    return next.finally(function () {
      if (transitions.get(session.localId) === next) transitions.delete(session.localId);
    });
  }

  function snapshot(session) {
    return {
      permissionMode: session.permissionMode || null,
      permissionModeBeforeFullAccess: session.permissionModeBeforeFullAccess || null,
      enabled: session.permissionMode === "bypassPermissions",
    };
  }

  function notify(session) {
    if (typeof sm.sendToSession === "function") sm.sendToSession(session, { type: "session_full_access_changed", id: session.localId,
      enabled: session.permissionMode === "bypassPermissions", permissionMode: session.permissionMode });
  }

  async function applyNativeMode(session, enabled) {
    if (!session.queryInstance || typeof session.queryInstance.setPermissionMode !== "function") return;
    // Clay's common permission callback remains the approval authority.
    await session.queryInstance.setPermissionMode(enabled ? "default" : session.permissionMode);
  }

  async function applyEnabled(session, enabled) {
    var previous = snapshot(session);
    if (previous.enabled === !!enabled) return previous;
    if (enabled) {
      session.permissionModeBeforeFullAccess = session.permissionMode || sm.currentPermissionMode || "default";
      session.permissionMode = "bypassPermissions";
    } else {
      session.permissionMode = session.permissionModeBeforeFullAccess || "default";
      session.permissionModeBeforeFullAccess = null;
    }
    try {
      await applyNativeMode(session, !!enabled);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
      notify(session);
      return previous;
    } catch (error) {
      session.permissionMode = previous.permissionMode;
      session.permissionModeBeforeFullAccess = previous.permissionModeBeforeFullAccess;
      throw error;
    }
  }

  function setEnabled(session, enabled) {
    return serialize(session, function () { return applyEnabled(session, enabled); });
  }

  async function applyRestore(session, prior) {
    if (!prior) return;
    var current = snapshot(session);
    session.permissionMode = prior.permissionMode;
    session.permissionModeBeforeFullAccess = prior.permissionModeBeforeFullAccess;
    try {
      await applyNativeMode(session, prior.enabled);
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
      notify(session);
    } catch (error) {
      session.permissionMode = current.permissionMode;
      session.permissionModeBeforeFullAccess = current.permissionModeBeforeFullAccess;
      throw error;
    }
  }

  function restore(session, prior) {
    return serialize(session, function () { return applyRestore(session, prior); });
  }

  return { restore: restore, setEnabled: setEnabled, snapshot: snapshot };
}

module.exports = { createFullAccessService: createFullAccessService };
