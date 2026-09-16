// Authenticated user-wide context display preference service.

function attachContextViewService(deps) {
  var users = deps.users;
  var forEachAppClient = deps.forEachAppClient;
  var revisions = {};
  var epoch = deps.serverEpoch || require("crypto").randomBytes(12).toString("hex");

  function actor(ws) {
    if (users.isMultiUser() !== true) return { userId: "default", user: true };
    var claimed = ws && ws._clayUser && ws._clayUser.id;
    var user = claimed ? users.findUserById(claimed) : null;
    return user ? { userId: user.id, user: user } : { userId: null, user: null };
  }
  function sameActor(ws, userId) {
    var current = actor(ws);
    return current.user && current.userId === userId;
  }
  function send(ws, message) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ serverEpoch: epoch }, message)));
  }
  function revision(userId) { return revisions[userId] || 0; }
  function broadcast(userId, message, except) {
    forEachAppClient(function (client) { if (client === except || !sameActor(client, userId)) return; send(client, message); });
  }
  function handleMessage(ws, msg) {
    if (!msg || ["context_view_get", "context_view_set"].indexOf(msg.type) === -1) return false;
    var requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 200) : null;
    var who = actor(ws);
    if (!who.user) {
      send(ws, { type: "context_view_state", requestId: requestId, accountAvailable: false, accountId: null, mode: null, error: "Your account is no longer available." });
      return true;
    }
    if (msg.type === "context_view_get") {
      var current = users.getContextViewPreference(who.userId);
      send(ws, { type: "context_view_state", requestId: requestId, accountAvailable: true, accountId: who.userId, mode: current.mode, preferencePresent: current.present, canonicalRevision: revision(who.userId), ready: !current.error, error: current.error || "" });
      return true;
    }
    var saved = users.setContextViewPreference(who.userId, msg.mode);
    if (!saved.ok) {
      send(ws, { type: "context_view_state", requestId: requestId, accountAvailable: true, accountId: who.userId, canonicalRevision: revision(who.userId), ready: false, error: saved.error });
      return true;
    }
    revisions[who.userId] = revision(who.userId) + 1;
    var state = { type: "context_view_state", requestId: null, accountAvailable: true, accountId: who.userId, mode: msg.mode, preferencePresent: true, canonicalRevision: revisions[who.userId], ready: true, error: "" };
    broadcast(who.userId, state, ws);
    send(ws, Object.assign({}, state, { requestId: requestId }));
    return true;
  }
  return { handleMessage: handleMessage };
}

module.exports = { attachContextViewService: attachContextViewService };
