var yoke = require("./yoke");
var defaultAiRuntime = require("./default-ai-runtime");

function modelEntryValue(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return entry.value || entry.id || "";
}

function modelEntryMatches(entry, value) {
  if (!entry || !value) return false;
  if (typeof entry === "string") return entry === value;
  return entry.value === value || entry.id === value || entry.resolvedModel === value;
}

function modelsWithEffortMetadata(models, vendorInfo) {
  var fallback = vendorInfo && Array.isArray(vendorInfo.effortLevels) ? vendorInfo.effortLevels : [];
  return (models || []).map(function (model) {
    if (typeof model === "string") {
      return { value: model, displayName: model, supportedEffortLevels: fallback.slice() };
    }
    if (!model || Array.isArray(model.supportedEffortLevels)) return model;
    return Object.assign({}, model, { supportedEffortLevels: fallback.slice() });
  });
}

function normalizeCatalogModels(models) {
  var normalized = [];
  models = models || [];
  for (var i = 0; i < models.length; i++) {
    var value = modelEntryValue(models[i]);
    if (!value) continue;
    var displayName = typeof models[i] === "string" ? models[i] : (models[i].displayName || models[i].name || value);
    var searchParts = [value, displayName];
    if (typeof models[i] === "object") {
      searchParts.push(models[i].id || "");
      searchParts.push(models[i].resolvedModel || "");
    }
    normalized.push({ value: value, displayName: displayName, search: searchParts.join(" ").toLowerCase(), source: models[i] });
  }
  return normalized;
}

function selectCatalogModel(models, defaultModel, alias) {
  var entries = normalizeCatalogModels(models);
  if (entries.length === 0) return null;
  var configured = null;
  for (var i = 0; i < entries.length; i++) {
    if (modelEntryMatches(entries[i].source, defaultModel)) {
      configured = entries[i];
      break;
    }
  }
  alias = alias === "fast" || alias === "deep" ? alias : "standard";
  if (alias === "standard" && configured) return configured;
  var matcher = alias === "fast"
    ? /haiku|mini|flash|fast|lite|small|luna/
    : alias === "deep"
      ? /opus|\bpro\b|max|deep|large|\bsol\b|reason/
      : /sonnet|standard|balanced|terra/;
  for (var mi = 0; mi < entries.length; mi++) {
    if (matcher.test(entries[mi].search)) return entries[mi];
  }
  return configured || entries[0];
}

function attachModels(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var sm = ctx.sm;
  var sdk = ctx.sdk;
  var adapters = ctx.adapters;
  var sendTo = ctx.sendTo;
  var getSessionForWs = ctx.getSessionForWs;
  var getLinuxUserForWs = ctx.getLinuxUserForWs;
  var serverPort = ctx.serverPort;
  var serverTls = ctx.serverTls;
  var serverAuthToken = ctx.serverAuthToken;
  var resolveDefaultAi = ctx.resolveDefaultAi;

  function getVendorAvailability() {
    var available = (sm.availableVendors || []).slice();
    var installed = (sm.installedVendors || []).slice();
    var ids = available.slice();
    for (var i = 0; i < installed.length; i++) {
      if (ids.indexOf(installed[i]) === -1) ids.push(installed[i]);
    }
    return ids.map(function (vendor) {
      var info = yoke.getVendorInfo(vendor);
      return {
        id: vendor,
        displayName: info && info.displayName ? info.displayName : vendor,
        installed: installed.indexOf(vendor) !== -1,
      };
    });
  }

  function modelDisplayName(models, value) {
    for (var i = 0; i < models.length; i++) {
      if (!modelEntryMatches(models[i], value)) continue;
      return typeof models[i] === "string" ? models[i] : (models[i].displayName || modelEntryValue(models[i]));
    }
    return value;
  }

  async function getVendorCatalog(ws, vendor) {
    var loadError = null;
    var loadedDefaultModel = "";
    var vendorAdapter = null;
    if (!vendor) return { vendor: "", models: [], capabilities: {}, status: "error", error: "No vendor was selected." };

    try {
      var modelLinuxUser = getLinuxUserForWs(ws);
      vendorAdapter = adapters[vendor] || null;
      if (!vendorAdapter) {
        vendorAdapter = await yoke.lazyCreateAdapter(adapters, vendor, {
          cwd: cwd,
          linuxUser: modelLinuxUser || undefined,
          clayPort: serverPort,
          clayTls: serverTls,
          clayAuthToken: serverAuthToken,
          slug: slug,
        });
      }

      var cachedModels = (sm.modelsByVendor && sm.modelsByVendor[vendor]) || [];
      var cachedCapabilities = sm.capabilitiesByVendor && sm.capabilitiesByVendor[vendor];
      var needsReadyMetadata = !cachedCapabilities || cachedModels.length === 0;
      if (vendorAdapter && needsReadyMetadata && typeof vendorAdapter.init === "function") {
        try {
          var readyResult = await vendorAdapter.init({
            cwd: cwd,
            linuxUser: modelLinuxUser || undefined,
            clayPort: serverPort,
            clayTls: serverTls,
            clayAuthToken: serverAuthToken,
            slug: slug,
          });
          sm.capabilitiesByVendor = sm.capabilitiesByVendor || {};
          sm.capabilitiesByVendor[vendor] = readyResult.capabilities || {};
          loadedDefaultModel = readyResult.defaultModel || "";
          sm.modelsByVendor = sm.modelsByVendor || {};
          if (Array.isArray(readyResult.models) && readyResult.models.length > 0) {
            sm.modelsByVendor[vendor] = readyResult.models;
          }
        } catch (e) {
          loadError = e;
          console.error("[project-models] " + vendor + " init failed:", e.message || e);
        }
      }

      if (vendorAdapter) {
        sm.availableVendors = Object.keys(adapters);
        sm.modelsByVendor = sm.modelsByVendor || {};
        var currentModels = sm.modelsByVendor[vendor] || [];
        if (currentModels.length === 0 && typeof vendorAdapter.supportedModels === "function") {
          try {
            var supported = await vendorAdapter.supportedModels();
            if (Array.isArray(supported) && supported.length > 0) {
              sm.modelsByVendor[vendor] = supported;
              loadError = null;
            }
          } catch (e) {
            if (!loadError) loadError = e;
            console.error("[project-models] " + vendor + " model listing failed:", e.message || e);
          }
        }
      } else {
        loadError = new Error("The vendor adapter is unavailable.");
      }
    } catch (e) {
      loadError = e;
      console.error("[project-models] model loading failed for " + vendor + ":", e.message || e);
    }

    var vendorInfo = yoke.getVendorInfo(vendor);
    var vendorModels = modelsWithEffortMetadata((sm.modelsByVendor && sm.modelsByVendor[vendor]) || [], vendorInfo);
    var displayName = vendorInfo ? vendorInfo.displayName : vendor;
    var status = vendorModels.length > 0 ? "ready" : (loadError ? "error" : "empty");
    var defaultModel = "";
    var preferredModels = [
      (sm.defaultModelByVendor && sm.defaultModelByVendor[vendor]) || "",
      loadedDefaultModel,
    ];
    for (var preferredIndex = 0; preferredIndex < preferredModels.length && !defaultModel; preferredIndex++) {
      for (var modelIndex = 0; modelIndex < vendorModels.length; modelIndex++) {
        if (!modelEntryMatches(vendorModels[modelIndex], preferredModels[preferredIndex])) continue;
        defaultModel = modelEntryValue(vendorModels[modelIndex]);
        break;
      }
    }
    var errorText = "";
    if (status === "error") {
      errorText = "Could not load " + displayName + " models: " + (loadError.message || loadError);
    } else if (status === "empty") {
      errorText = displayName + " returned no models. Check CLI authentication and retry.";
    }
    return {
      vendor: vendor,
      models: vendorModels,
      defaultModel: defaultModel,
      capabilities: (sm.capabilitiesByVendor && sm.capabilitiesByVendor[vendor]) || {},
      availableVendors: sm.availableVendors || [],
      installedVendors: sm.installedVendors || [],
      status: status,
      error: errorText,
      effortLevels: vendorInfo && Array.isArray(vendorInfo.effortLevels) ? vendorInfo.effortLevels.slice() : [],
    };
  }

  async function resolveConfiguredModel(ws, alias) {
    if (typeof resolveDefaultAi === "function") {
      var defaultSelection = await resolveDefaultAi(ws);
      var normalizedAlias = alias === "fast" || alias === "deep" ? alias : "standard";
      if (!defaultSelection || !defaultSelection.ready) {
        return {
          status: "error",
          vendor: defaultSelection && defaultSelection.vendor || "",
          vendorName: defaultSelection && defaultSelection.vendor || "",
          model: "",
          modelName: "",
          alias: normalizedAlias,
          effort: "",
          error: defaultSelection && defaultSelection.error || "Default AI is unavailable.",
        };
      }
      var selectedModel = defaultSelection.model;
      var selectedName = defaultSelection.model;
      if (normalizedAlias !== "standard") {
        var selectedCatalog = await getVendorCatalog(ws, defaultSelection.vendor);
        var aliasEntry = selectCatalogModel(selectedCatalog.models || [], defaultSelection.model, normalizedAlias);
        if (!aliasEntry || selectedCatalog.status !== "ready") {
          return {
            status: "error",
            vendor: defaultSelection.vendor,
            vendorName: defaultSelection.vendor,
            model: "",
            modelName: "",
            alias: normalizedAlias,
            effort: defaultSelection.effort || "",
            error: selectedCatalog.error || "The selected Default AI provider has no available model.",
          };
        }
        selectedModel = aliasEntry.value;
        selectedName = aliasEntry.displayName || selectedModel;
        var aliasEffort = defaultAiRuntime.resolveEffort({ effort: defaultSelection.effort || "" }, aliasEntry.source, selectedCatalog);
        if (!aliasEffort.ok) aliasEffort = defaultAiRuntime.resolveEffort(null, aliasEntry.source, selectedCatalog);
        defaultSelection = Object.assign({}, defaultSelection, { effort: aliasEffort.effort || "" });
      }
      var selectedInfo = yoke.getVendorInfo(defaultSelection.vendor);
      return {
        status: "ready",
        vendor: defaultSelection.vendor,
        vendorName: selectedInfo && selectedInfo.displayName ? selectedInfo.displayName : defaultSelection.vendor,
        alias: normalizedAlias,
        model: selectedModel,
        modelName: selectedName,
        effort: defaultSelection.effort || "",
        error: "",
      };
    }
    var availability = getVendorAvailability();
    var candidates = [];
    var preferredVendor = sm.defaultVendor || "";
    if (preferredVendor) candidates.push(preferredVendor);
    for (var i = 0; i < availability.length; i++) {
      if (candidates.indexOf(availability[i].id) === -1) candidates.push(availability[i].id);
    }
    var errors = [];
    for (var ci = 0; ci < candidates.length; ci++) {
      var catalog = await getVendorCatalog(ws, candidates[ci]);
      var models = catalog.models || [];
      var selected = selectCatalogModel(models, catalog.defaultModel, alias);
      if (catalog.status !== "ready" || !selected) {
        if (catalog.error) errors.push(catalog.error);
        continue;
      }
      var info = yoke.getVendorInfo(catalog.vendor);
      return {
        status: "ready",
        vendor: catalog.vendor,
        vendorName: info && info.displayName ? info.displayName : catalog.vendor,
        alias: alias === "fast" || alias === "deep" ? alias : "standard",
        model: selected.value,
        modelName: selected.displayName || modelDisplayName(models, selected.value),
        error: "",
      };
    }
    return {
      status: "error",
      vendor: preferredVendor,
      vendorName: preferredVendor ? ((yoke.getVendorInfo(preferredVendor) || {}).displayName || preferredVendor) : "",
      model: "",
      modelName: "",
      alias: alias === "fast" || alias === "deep" ? alias : "standard",
      error: errors[0] || "No configured model is available. Sign in to an installed model provider CLI, then retry.",
    };
  }

  async function loadVendorModels(ws, msg) {
    var vendor = msg.vendor || "";
    var requestId = msg.requestId || null;
    var session = getSessionForWs(ws);
    var catalog = await getVendorCatalog(ws, vendor);
    var vendorModels = catalog.models;
    var modelToSend = modelEntryValue(vendorModels[0]);
    var preferredModel = (session && session.vendor === vendor && session.model) || (sm.defaultModelByVendor && sm.defaultModelByVendor[vendor]) || "";
    if (preferredModel) {
      for (var i = 0; i < vendorModels.length; i++) {
        if (modelEntryMatches(vendorModels[i], preferredModel)) {
          modelToSend = modelEntryValue(vendorModels[i]);
          break;
        }
      }
    }
    sendTo(ws, {
      type: "model_info",
      model: modelToSend,
      models: vendorModels,
      vendor: vendor,
      sessionId: session ? session.localId : null,
      capabilities: catalog.capabilities,
      availableVendors: catalog.availableVendors,
      installedVendors: catalog.installedVendors,
      requestId: requestId,
      modelStatus: catalog.status,
      error: catalog.error,
    });
  }

  async function selectModel(ws, msg) {
    var session = getSessionForWs(ws);
    if (!session) {
      sendTo(ws, { type: "model_selection_result", requestId: msg.requestId || null, ok: false, error: "No active session." });
      return;
    }
    var sessionVendor = session.vendor || sm.defaultVendor || "claude";
    if (msg.vendor && msg.vendor !== sessionVendor) {
      sendTo(ws, {
        type: "model_selection_result",
        requestId: msg.requestId || null,
        ok: false,
        error: "The session vendor changed before the model selection completed.",
      });
      return;
    }
    var knownModels = (sm.modelsByVendor && sm.modelsByVendor[sessionVendor]) || [];
    if (knownModels.length > 0) {
      var known = false;
      for (var i = 0; i < knownModels.length; i++) {
        if (modelEntryMatches(knownModels[i], msg.model)) {
          known = true;
          break;
        }
      }
      if (!known) {
        sendTo(ws, {
          type: "model_selection_result",
          requestId: msg.requestId || null,
          ok: false,
          error: "That model is not available for the selected vendor.",
        });
        return;
      }
    }
    var result = await sdk.setModel(session, msg.model);
    sendTo(ws, {
      type: "model_selection_result",
      requestId: msg.requestId || null,
      ok: !!(result && result.ok),
      model: result && result.model ? result.model : msg.model,
      vendor: sessionVendor,
      error: result && result.error ? result.error : "",
    });
  }

  function handleMessage(ws, msg) {
    if (msg.type === "get_vendor_models") {
      loadVendorModels(ws, msg).catch(function(e) {
        console.error("[project-models] Unexpected model loading failure:", e.message || e);
      });
      return true;
    }
    if (msg.type === "set_model" && msg.model) {
      selectModel(ws, msg).catch(function(e) {
        sendTo(ws, { type: "model_selection_result", requestId: msg.requestId || null, ok: false, error: e.message || String(e) });
      });
      return true;
    }
    return false;
  }

  return {
    handleMessage: handleMessage,
    getVendorCatalog: getVendorCatalog,
    getVendorAvailability: getVendorAvailability,
    resolveConfiguredModel: resolveConfiguredModel,
    loadVendorModels: loadVendorModels,
    selectModel: selectModel,
  };
}

module.exports = {
  attachModels: attachModels,
  modelEntryMatches: modelEntryMatches,
  modelEntryValue: modelEntryValue,
  normalizeCatalogModels: normalizeCatalogModels,
  modelsWithEffortMetadata: modelsWithEffortMetadata,
  selectCatalogModel: selectCatalogModel,
};
