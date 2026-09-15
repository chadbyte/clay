// Authenticated user-wide cursor sharing preference service.

function attachCursorSharingService(deps) {
  var users = deps.users;
  var forEachAppClient = deps.forEachAppClient;

  function actor(ws) {
    if (!users.isMultiUser()) return { userId: "default", user: true };
    var claimed = ws && ws._clayUser && ws._clayUser.id;
    var user = claimed ? users.findUserById(claimed) : null;
    return user ? { userId: user.id, user: user } : { userId: null, user: null };
  }

  function send(ws, enabled, requestId, error) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "cursor_sharing_state", requestId: requestId || null, ready: !error, accountAvailable: !error, accountId: ws._clayUser ? ws._clayUser.id : "default", cursorSharing: error ? undefined : enabled, error: error || "" }));
  }

  function read(userId) {
    try { return { ok: true, cursorSharing: users.getCursorSharing(userId) }; }
    catch (e) { return { error: "Cursor sharing preference could not be read." }; }
  }

  function save(userId, enabled) {
    try { return users.setCursorSharing(userId, enabled); }
    catch (e) { return { error: "Cursor sharing preference could not be saved." }; }
  }

  function sendStateTo(ws) {
    var who = actor(ws);
    if (!who.user) { send(ws, true, null, "Your account is no longer available."); return; }
    var result = read(who.userId);
    send(ws, result.cursorSharing, null, result.error);
  }

  function broadcast(userId, enabled, except) {
    forEachAppClient(function (client) {
      if (client === except) return;
      if (users.isMultiUser() && (!client._clayUser || client._clayUser.id !== userId)) return;
      send(client, enabled);
    });
  }

  function handleMessage(ws, msg) {
    if (!msg || ["cursor_sharing_get", "cursor_sharing_set"].indexOf(msg.type) === -1) return false;
    var requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 200) : null;
    var who = actor(ws);
    if (!who.user) { send(ws, true, requestId, "Your account is no longer available."); return true; }
    if (msg.type === "cursor_sharing_get") {
      var readResult = read(who.userId);
      send(ws, readResult.cursorSharing, requestId, readResult.error);
      return true;
    }
    if (typeof msg.enabled !== "boolean") { send(ws, true, requestId, "enabled must be a boolean"); return true; }
    var result = save(who.userId, msg.enabled);
    if (!result || !result.ok) { send(ws, true, requestId, result && result.error || "Preference could not be saved."); return true; }
    send(ws, result.cursorSharing, requestId);
    broadcast(who.userId, result.cursorSharing, ws);
    return true;
  }

  return { handleMessage: handleMessage, sendStateTo: sendStateTo };
}

module.exports = { attachCursorSharingService: attachCursorSharingService };
