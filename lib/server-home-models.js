// Concrete Mate model resolution and Home model-selection protocol.

var modelEntryMatches = require("./project-models").modelEntryMatches;
var modelEntryValue = require("./project-models").modelEntryValue;

function attachHomeModels(deps) {
  var users = deps.users;
  var mates = deps.mates;
  var projects = deps.projects;
  var sendMessage = deps.sendMessage;
  var resolveDefaultAi = deps.resolveDefaultAi;

  function modelError(text) {
    var error = new Error(text);
    error.code = "model_unavailable";
    return error;
  }

  function broadcastMateUpdated(userId, mate) {
    projects.forEach(function (project) {
      project.forEachClient(function (client) {
        if (client.readyState !== 1) return;
        if (users.isMultiUser()) {
          var clientUserId = client._clayUser ? client._clayUser.id : null;
          if (!userId || clientUserId !== userId) return;
        }
        sendMessage(client, { type: "mate_updated", mate: mate });
      });
    });
  }

  function catalogModel(models, candidate) {
    if (!candidate) return "";
    for (var i = 0; i < models.length; i++) {
      if (modelEntryMatches(models[i], candidate)) return modelEntryValue(models[i]);
    }
    return "";
  }

  function vendorChoices(ws, found) {
    var currentVendor = found.mate.vendor || "claude";
    if (typeof found.ctx.getVendorModelAvailability !== "function") {
      return [{ id: currentVendor, displayName: currentVendor, installed: false }];
    }
    return found.ctx.getVendorModelAvailability(ws);
  }

  function vendorIsAvailable(choices, vendor) {
    for (var i = 0; i < choices.length; i++) {
      if (choices[i] && choices[i].id === vendor) return true;
    }
    return false;
  }

  function sessionReference(session) {
    if (!session) return null;
    return session.cliSessionId || (session.localId != null ? "local:" + session.localId : null);
  }

  function ownsSession(session, userId) {
    if (!session) return false;
    if (!users.isMultiUser()) return true;
    return !!userId && session.ownerId === userId;
  }

  function resolveRequestedSession(found, userId, reference) {
    if (!reference || !found.ctx || typeof found.ctx.getSessionManager !== "function") return null;
    var manager = found.ctx.getSessionManager();
    if (!manager || !manager.sessions) return null;
    var localMatch = /^local:(\d+)$/.exec(reference);
    if (localMatch) {
      var localSession = manager.sessions.get(parseInt(localMatch[1], 10));
      return ownsSession(localSession, userId) ? localSession : null;
    }
    var foundSession = null;
    manager.sessions.forEach(function (session) {
      if (!foundSession && session && session.cliSessionId === reference && ownsSession(session, userId)) foundSession = session;
    });
    return foundSession;
  }

  function isPristineSession(session) {
    if (!session || session.isProcessing || session._queryStarting || session.queryInstance || session.worker) return false;
    if (session.pendingPush && session.pendingPush.length) return false;
    return Array.isArray(session.history) && session.history.length === 0;
  }

  function applyModelToPristineSession(found, userId, reference, vendor, model) {
    if (!reference) return {};
    var result = { requestedSessionId: reference, sessionId: null, sessionApplied: false };
    var session = resolveRequestedSession(found, userId, reference);
    if (!session) {
      result.sessionReason = "The selected conversation is no longer available.";
      return result;
    }
    result.sessionId = sessionReference(session);
    if (!isPristineSession(session)) {
      result.sessionReason = "This conversation already has activity and keeps its committed model.";
      return result;
    }
    var manager = found.ctx.getSessionManager();
    if (!manager || typeof manager.saveSessionFile !== "function") {
      result.sessionReason = "The conversation model could not be persisted.";
      return result;
    }
    var previousVendor = session.vendor;
    var previousModel = session.model;
    session.vendor = vendor;
    session.model = model;
    try {
      manager.saveSessionFile(session);
    } catch (error) {
      session.vendor = previousVendor;
      session.model = previousModel;
      result.sessionReason = "The conversation model could not be persisted.";
      return result;
    }
    result.sessionApplied = true;
    result.sessionVendor = vendor;
    result.sessionModel = model;
    return result;
  }

  async function loadCatalog(ws, found, vendor) {
    if (typeof found.ctx.getVendorModelCatalog !== "function") {
      throw modelError("Model catalog is unavailable. Reconnect and choose a model before starting a conversation.");
    }
    var catalog = await found.ctx.getVendorModelCatalog(ws, vendor);
    var models = catalog.models || [];
    if (!models.length) {
      throw modelError(catalog.error || "No models are available for this Mate. Check the vendor connection and try again.");
    }
    return catalog;
  }

  async function resolveMateModel(ws, found, userId, options) {
    options = options || {};
    var mateCtx = mates.buildMateCtx(userId);
    var latestMate = mates.getMate(mateCtx, found.mate.id);
    if (!latestMate) throw modelError("Mate not available.");
    if (latestMate.builtinKey === "clay" && options.useDefault !== false && typeof resolveDefaultAi === "function") {
      var defaultResult = await resolveDefaultAi(ws, userId);
      if (!defaultResult || !defaultResult.ready) throw modelError(defaultResult && defaultResult.error || "Default AI is unavailable.");
      found.mate = latestMate;
      return { vendor: defaultResult.vendor, model: defaultResult.model, effort: defaultResult.effort || "", catalog: defaultResult.catalog || null };
    }
    var vendor = latestMate.vendor || "claude";
    var catalog = await loadCatalog(ws, found, vendor);
    var models = catalog.models || [];
    var selected = catalogModel(models, latestMate.model);
    if (!selected) selected = catalogModel(models, catalog.defaultModel);
    for (var i = 0; i < models.length && !selected; i++) selected = modelEntryValue(models[i]);
    if (!selected) throw modelError("The Mate model catalog did not return a usable model. Choose a model and try again.");
    if (latestMate.model !== selected) {
      latestMate = mates.updateMate(mateCtx, latestMate.id, { model: selected });
      if (!latestMate) throw modelError("Could not save the resolved Mate model.");
      broadcastMateUpdated(userId, latestMate);
    }
    found.mate = latestMate;
    return { vendor: vendor, model: selected, effort: "", catalog: catalog };
  }

  async function sendMateModels(ws, found, requestId, requestedVendor) {
    var choices = vendorChoices(ws, found);
    var vendor = requestedVendor || found.mate.vendor || "claude";
    if (!vendorIsAvailable(choices, vendor)) {
      sendMessage(ws, { type: "home_mate_models_state", mateId: found.mate.id, requestId: requestId, vendor: vendor, mateVendor: found.mate.vendor || "claude", mateModel: found.mate.model || "", model: "", models: [], vendors: choices, status: "error", error: "That vendor is not configured for this Clay project." });
      return;
    }
    try {
      var catalog = await found.ctx.getVendorModelCatalog(ws, vendor);
      sendMessage(ws, {
        type: "home_mate_models_state",
        mateId: found.mate.id,
        requestId: requestId,
        vendor: vendor,
        mateVendor: found.mate.vendor || "claude",
        mateModel: found.mate.model || "",
        model: (found.mate.vendor || "claude") === vendor ? (found.mate.model || "") : "",
        models: catalog.models || [],
        vendors: choices,
        status: catalog.status || ((catalog.models || []).length ? "ready" : "empty"),
        error: catalog.error || "",
      });
    } catch (error) {
      sendMessage(ws, { type: "home_mate_models_state", mateId: found.mate.id, requestId: requestId, vendor: vendor, mateVendor: found.mate.vendor || "claude", mateModel: found.mate.model || "", model: "", models: [], vendors: choices, status: "error", error: error.message || String(error) });
    }
  }

  async function setMateModel(ws, found, userId, msg) {
    var requestId = msg.requestId || null;
    var vendor = msg.vendor || "";
    var choices = vendorChoices(ws, found);
    if (!vendor || !vendorIsAvailable(choices, vendor)) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "That vendor is not configured for this Clay project." });
      return;
    }
    if (!msg.model) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "That model is not available for this Mate." });
      return;
    }
    var catalog;
    try {
      catalog = await loadCatalog(ws, found, vendor);
    } catch (error) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: error.message || String(error) });
      return;
    }
    var mateCtx = mates.buildMateCtx(userId);
    var latestMate = mates.getMate(mateCtx, found.mate.id);
    if (!latestMate) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "Mate not available." });
      return;
    }
    var selected = catalogModel(catalog.models || [], msg.model);
    if (!selected) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "That model is not available for the Mate vendor." });
      return;
    }
    var updated = mates.updateMate(mateCtx, found.mate.id, { vendor: vendor, model: selected });
    if (!updated) {
      sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: requestId, ok: false, error: "Mate not available." });
      return;
    }
    found.mate = updated;
    broadcastMateUpdated(userId, updated);
    var sessionResult = applyModelToPristineSession(found, userId, msg.sessionId || null, vendor, selected);
    var result = Object.assign({ type: "home_mate_model_result", mateId: updated.id, requestId: requestId, ok: true, vendor: vendor, model: selected }, sessionResult);
    sendMessage(ws, result);
    return result;
  }

  function sendAccessError(ws, msg, text) {
    if (msg.type === "home_mate_models_get") {
      sendMessage(ws, { type: "home_mate_models_state", mateId: msg.mateId || null, requestId: msg.requestId || null, vendor: msg.vendor || "", mateVendor: "", mateModel: "", model: "", models: [], vendors: [], status: "error", error: text });
      return;
    }
    sendMessage(ws, { type: "home_mate_model_result", mateId: msg.mateId || null, requestId: msg.requestId || null, ok: false, error: text });
  }

  return {
    resolveMateModel: resolveMateModel,
    sendMateModels: sendMateModels,
    setMateModel: setMateModel,
    sendAccessError: sendAccessError,
  };
}

module.exports = { attachHomeModels: attachHomeModels };
