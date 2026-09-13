// Authenticated user-wide Default AI service for the user-island picker.

var runtime = require("./default-ai-runtime");

function attachDefaultAiService(deps) {
  var users = deps.users;
  var homeChatHandler = deps.homeChatHandler;
  var forEachAppClient = deps.forEachAppClient;
  var canonicalRevisions = {};
  var serverEpoch = deps.serverEpoch || require("crypto").randomBytes(12).toString("hex");

  function isMultiUser() {
    return users.isMultiUser() === true;
  }

  function actor(ws) {
    if (!isMultiUser()) return { userId: "default", user: true };
    var claimed = ws && ws._clayUser && ws._clayUser.id;
    var current = claimed ? users.findUserById(claimed) : null;
    return current ? { userId: current.id, user: current } : { userId: null, user: null };
  }

  function sameActor(ws, expectedUserId) {
    var current = actor(ws);
    return current.user && current.userId === expectedUserId ? current : null;
  }

  function send(ws, message) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ serverEpoch: serverEpoch }, message)));
  }

  function canonicalRevision(userId) {
    return canonicalRevisions[userId] || 0;
  }

  function advanceCanonicalRevision(userId) {
    canonicalRevisions[userId] = canonicalRevision(userId) + 1;
    return canonicalRevisions[userId];
  }

  function accountError(ws, requestId, type, vendor) {
    var payload = {
      type: type || "default_ai_state",
      requestId: requestId || null,
      ready: false,
      accountAvailable: false,
      accountId: null,
      error: "Your account is no longer available.",
    };
    if (vendor) payload.vendor = vendor;
    send(ws, payload);
  }

  function catalogSocket(ws, actorInfo) {
    var socket = Object.create(ws || null);
    socket._clayUser = actorInfo.user === true ? null : actorInfo.user;
    return socket;
  }

  function findProject(actorInfo) {
    try {
      return homeChatHandler.findMateProject(isMultiUser() ? actorInfo.userId : null, null, true);
    } catch (error) {
      return { error: error };
    }
  }

  function installedVendors(found) {
    if (!found || !found.ctx || typeof found.ctx.getVendorModelAvailability !== "function") return [];
    var choices = found.ctx.getVendorModelAvailability() || [];
    return choices.filter(function (choice) {
      return choice && choice.installed === true;
    }).map(function (choice) {
      return choice.id;
    });
  }

  async function resolve(ws, actorInfo, preferenceOverride) {
    if (!sameActor(ws, actorInfo.userId)) return { ready: false, accountAvailable: false, error: "Your account is no longer available." };
    var found = findProject(actorInfo);
    if (found && found.error) return { ready: false, accountAvailable: true, error: found.error.message || String(found.error), installedVendors: [] };
    if (!found || !found.ctx || typeof found.ctx.getVendorModelCatalog !== "function") {
      return { ready: false, accountAvailable: true, error: "Clay Default AI is unavailable.", installedVendors: installedVendors(found) };
    }
    var installed = installedVendors(found);
    var result;
    try {
      result = await runtime.resolveDefaultAiRuntime({
        identity: { userId: actorInfo.userId, multiUser: isMultiUser() },
        getPreference: function () {
          if (preferenceOverride) return { present: true, source: "draft", preference: preferenceOverride };
          return users.getDefaultAiPreference(actorInfo.userId);
        },
        getAvailability: function () { return installed; },
        getCatalog: async function (vendor) {
          if (!sameActor(ws, actorInfo.userId)) throw new Error("Your account is no longer available.");
          var currentActor = actor(ws);
          var catalog = await found.ctx.getVendorModelCatalog(catalogSocket(ws, currentActor), vendor);
          if (!sameActor(ws, actorInfo.userId)) throw new Error("Your account is no longer available.");
          return catalog;
        },
      });
    } catch (error) {
      if (!sameActor(ws, actorInfo.userId)) return { ready: false, accountAvailable: false, error: "Your account is no longer available.", installedVendors: installed };
      throw error;
    }
    result.installedVendors = installed;
    result.accountAvailable = !!sameActor(ws, actorInfo.userId);
    if (!result.accountAvailable) return { ready: false, accountAvailable: false, error: "Your account is no longer available.", installedVendors: installed };
    return result;
  }

  async function resolveCanonical(ws, actorInfo) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var before = canonicalRevision(actorInfo.userId);
      var result = await resolve(ws, actorInfo, null);
      if (!sameActor(ws, actorInfo.userId)) return result;
      if (before === canonicalRevision(actorInfo.userId)) {
        result.canonicalRevision = before;
        return result;
      }
    }
    return {
      ready: false,
      accountAvailable: true,
      installedVendors: [],
      canonicalRevision: canonicalRevision(actorInfo.userId),
      error: "Default AI changed while it was loading. Retry the request.",
    };
  }

  function stateMessage(result, requestId) {
    return {
      type: "default_ai_state",
      requestId: requestId || null,
      preference: result.preference || null,
      source: result.source || null,
      selection: result.ready ? { vendor: result.vendor, model: result.model, effort: result.effort } : null,
      installedVendors: result.installedVendors || [],
      accountAvailable: result.accountAvailable !== false,
      accountId: result.accountId || null,
      canonicalRevision: typeof result.canonicalRevision === "number" ? result.canonicalRevision : 0,
      ready: result.ready === true,
      error: result.error || "",
      catalog: result.catalog || null,
    };
  }

  function broadcast(userId, message, except) {
    var seen = [];
    forEachAppClient(function (client) {
      if (client === except || seen.indexOf(client) !== -1) return;
      var current = actor(client);
      if (!current.user || current.userId !== userId) return;
      seen.push(client);
      send(client, message);
    });
  }

  function replyState(ws, actorInfo, requestId) {
    return resolveCanonical(ws, actorInfo).then(function (result) {
      if (!sameActor(ws, actorInfo.userId)) return;
      result.accountId = actorInfo.userId;
      send(ws, stateMessage(result, requestId));
      return result;
    });
  }

  function handleGet(ws, who, requestId) {
    replyState(ws, who, requestId).catch(function (error) {
      if (sameActor(ws, who.userId)) send(ws, { type: "default_ai_state", requestId: requestId, ready: false, accountAvailable: true, accountId: who.userId, canonicalRevision: canonicalRevision(who.userId), error: error.message || String(error) });
    });
  }

  function handleCatalogGet(ws, who, msg, requestId) {
    var vendor = typeof msg.vendor === "string" ? msg.vendor : "";
    resolve(ws, who, { vendor: vendor, model: "", effort: "" }).then(function (result) {
      if (!sameActor(ws, who.userId)) return;
      send(ws, {
        type: "default_ai_catalog",
        requestId: requestId,
        vendor: result.vendor || vendor,
        installedVendors: result.installedVendors || [],
        accountAvailable: result.accountAvailable !== false,
        accountId: who.userId,
        canonicalRevision: canonicalRevision(who.userId),
        selection: result.ready ? { vendor: result.vendor, model: result.model, effort: result.effort } : null,
        catalog: result.catalog || null,
        ready: result.ready === true,
        error: result.error || "",
      });
    }).catch(function (error) {
      if (sameActor(ws, who.userId)) send(ws, { type: "default_ai_catalog", requestId: requestId, vendor: vendor, ready: false, accountAvailable: true, accountId: who.userId, canonicalRevision: canonicalRevision(who.userId), error: error.message || String(error) });
    });
  }

  async function saveSelection(ws, who, msg, requestId) {
    var draft = {
      vendor: msg.vendor,
      model: msg.model === undefined ? "" : msg.model,
      effort: msg.effort === undefined ? "" : msg.effort,
    };
    var result = await resolve(ws, who, draft);
    if (!sameActor(ws, who.userId)) { accountError(ws, requestId); return; }
    if (!result.ready) {
      send(ws, { type: "default_ai_state", requestId: requestId, ready: false, accountAvailable: result.accountAvailable !== false, accountId: who.userId, canonicalRevision: canonicalRevision(who.userId), installedVendors: result.installedVendors || [], error: result.error || "That Default AI selection is unavailable." });
      return;
    }
    var canonical = { vendor: result.vendor, model: result.model, effort: result.effort };
    var saveResult = await Promise.resolve(users.setDefaultAiPreference(who.userId, canonical));
    if (!sameActor(ws, who.userId)) { accountError(ws, requestId); return; }
    if (!saveResult || !saveResult.ok) {
      send(ws, { type: "default_ai_state", requestId: requestId, ready: false, accountAvailable: true, accountId: who.userId, canonicalRevision: canonicalRevision(who.userId), installedVendors: result.installedVendors || [], error: saveResult && saveResult.error || "Default AI preference could not be saved." });
      return;
    }
    var revision = advanceCanonicalRevision(who.userId);
    var message = {
      type: "default_ai_state",
      requestId: null,
      preference: canonical,
      source: "explicit",
      selection: canonical,
      installedVendors: result.installedVendors || [],
      accountAvailable: true,
      accountId: who.userId,
      canonicalRevision: revision,
      ready: true,
      error: "",
      catalog: result.catalog || null,
    };
    broadcast(who.userId, message, ws);
    send(ws, Object.assign({}, message, { requestId: requestId }));
  }

  function handleMessage(ws, msg) {
    if (!msg || ["default_ai_get", "default_ai_catalog_get", "default_ai_set"].indexOf(msg.type) === -1) return false;
    var requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 200) : null;
    var who = actor(ws);
    if (!who.user) { accountError(ws, requestId, msg.type === "default_ai_catalog_get" ? "default_ai_catalog" : "default_ai_state", msg.vendor); return true; }
    if (msg.type === "default_ai_get") handleGet(ws, who, requestId);
    else if (msg.type === "default_ai_catalog_get") handleCatalogGet(ws, who, msg, requestId);
    else saveSelection(ws, who, msg, requestId).catch(function (error) {
      if (sameActor(ws, who.userId)) send(ws, { type: "default_ai_state", requestId: requestId, ready: false, accountAvailable: true, accountId: who.userId, canonicalRevision: canonicalRevision(who.userId), error: error.message || String(error) });
    });
    return true;
  }

  function resolveForWs(ws, context) {
    var who = actor(ws);
    if (!who.user) return Promise.resolve({ ready: false, accountAvailable: false, error: "Your account is no longer available." });
    if (context && context.preference) return resolve(ws, who, context.preference);
    return resolveCanonical(ws, who);
  }

  function resolveForUser(ws, userId, context) {
    var who = actor(ws);
    if (!who.user || who.userId !== userId) return Promise.resolve({ ready: false, accountAvailable: false, error: "Authenticated user identity is required." });
    if (context && context.preference) return resolve(ws, who, context.preference);
    return resolveCanonical(ws, who);
  }

  return { handleMessage: handleMessage, resolveForWs: resolveForWs, resolveForUser: resolveForUser };
}

module.exports = { attachDefaultAiService: attachDefaultAiService };
