// Authenticated user-wide New session vendor preference service.

function attachDefaultVendorService(deps) {
  var users = deps.users;
  var homeChatHandler = deps.homeChatHandler;
  var forEachAppClient = deps.forEachAppClient;
  var revisions = {};
  var epoch = deps.serverEpoch || require("crypto").randomBytes(12).toString("hex");

  function multiUser() { return users.isMultiUser() === true; }
  function actor(ws) {
    if (!multiUser()) return { userId: "default", user: true };
    var claimed = ws && ws._clayUser && ws._clayUser.id;
    var user = claimed ? users.findUserById(claimed) : null;
    return user ? { userId: user.id, user: user } : { userId: null, user: null };
  }
  function sameActor(ws, userId) { var current = actor(ws); return current.user && current.userId === userId; }
  function send(ws, message) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ serverEpoch: epoch }, message))); }
  function revision(userId) { return revisions[userId] || 0; }
  function installedVendors(ws, who) {
    var found;
    try { found = homeChatHandler.findMateProject(multiUser() ? who.userId : null, null, true); } catch (e) { return []; }
    if (!found || !found.ctx || typeof found.ctx.getVendorModelAvailability !== "function") return [];
    var socket = Object.create(ws || null);
    socket._clayUser = who.user === true ? null : who.user;
    var choices = found.ctx.getVendorModelAvailability(socket) || [];
    return choices.filter(function (choice) { return choice && choice.installed === true; }).map(function (choice) { return choice.id; });
  }
  function broadcast(userId, message, except) {
    forEachAppClient(function (client) { if (client === except || !sameActor(client, userId)) return; send(client, message); });
  }
  function handle(ws, msg, projectSlug) {
    if (!msg || ["default_vendor_get", "default_vendor_set"].indexOf(msg.type) === -1) return false;
    var requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 200) : null;
    var who = actor(ws);
    if (!who.user) { send(ws, { type: "default_vendor_state", requestId: requestId, accountAvailable: false, accountId: null, projectSlug: projectSlug || null, installedVendors: [], preference: null, error: "Your account is no longer available." }); return true; }
    var installed = installedVendors(ws, who);
    if (msg.type === "default_vendor_get") {
      var saved = users.getDefaultVendorPreference(who.userId);
      send(ws, { type: "default_vendor_state", requestId: requestId, projectSlug: projectSlug || null, accountAvailable: true, accountId: who.userId, installedVendors: installed, preference: saved.vendor, preferencePresent: saved.present, ready: !saved.error, canonicalRevision: revision(who.userId), error: saved.error || "" });
      return true;
    }
    if (msg.vendor !== "" && (typeof msg.vendor !== "string" || installed.indexOf(msg.vendor) === -1)) {
      send(ws, { type: "default_vendor_state", requestId: requestId, projectSlug: projectSlug || null, accountAvailable: true, accountId: who.userId, installedVendors: installed, preference: users.getDefaultVendorPreference(who.userId).vendor, ready: false, canonicalRevision: revision(who.userId), error: "That vendor is not installed or authorized." });
      return true;
    }
    var savedResult = users.setDefaultVendorPreference(who.userId, msg.vendor);
    if (!savedResult.ok) { send(ws, { type: "default_vendor_state", requestId: requestId, projectSlug: projectSlug || null, accountAvailable: true, accountId: who.userId, installedVendors: installed, ready: false, error: savedResult.error }); return true; }
    revisions[who.userId] = revision(who.userId) + 1;
    var state = { type: "default_vendor_state", requestId: null, projectSlug: projectSlug || null, accountAvailable: true, accountId: who.userId, installedVendors: installed, preference: msg.vendor || null, preferencePresent: !!msg.vendor, ready: true, canonicalRevision: revisions[who.userId], error: "" };
    var broadcastState = Object.assign({}, state);
    delete broadcastState.projectSlug;
    broadcast(who.userId, broadcastState, ws);
    send(ws, Object.assign({}, state, { requestId: requestId }));
    return true;
  }
  return { handleMessage: handle };
}

module.exports = { attachDefaultVendorService: attachDefaultVendorService };
