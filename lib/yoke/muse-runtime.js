var queryAbort = require("./query-abort");

var initializeTimeoutMs = require("./interface").INITIALIZE_TIMEOUT_MS;

function isAuthError(error) {
  var kind = error && (error.kind || error.data && error.data.kind);
  return kind === "authRequired" || /authentication|not authenticated|sign[ -]?in|log[ -]?in|credential|unauthorized|forbidden|api.?key|401/i.test(String(error && error.message || error || ""));
}

function closeResource(resource) {
  if (!resource || typeof resource.close !== "function") return Promise.resolve();
  return Promise.resolve().then(function() {
    return resource.close();
  });
}
// Own the process before initialize starts, including callers still opening a session.

function createRuntime(adapter, sdk, options) {
  var scope = queryAbort.createAbortScope();
  var handshake = sdk.spawnMspConnection(Object.assign({}, options, {
    shutdownTimeoutMs: adapter.shutdownTimeoutMs
  }));
  var closing = null;
  var runtime = {
    handshake: handshake,
    spawned: null,
    connection: null,
    session: null,
    held: [],
    opening: true,
    dead: false,
    wait: scope.wait,
    check: scope.check,
    waitRequest: async function(promise, timeoutMs) {
      var timer;
      try {
        return await scope.wait(Promise.race([ promise, new Promise(function(resolve, reject) {
          timer = setTimeout(function() {
            reject(new Error("Muse Code request timed out"));
          }, timeoutMs || adapter.requestTimeoutMs);
        }) ]));
      } finally {
        clearTimeout(timer);
      }
    },
    fail: function(error) {},
    onFrame: function(frame) {},
    apply: function(frame) {
      if (!runtime.session || scope.stopped()) return;
      var named = frame.params && frame.params.sessionId;
      if (named !== runtime.session.sessionId) return;
      if (frame.method === "view/gap") {
        runtime.fail(new Error("Muse view stream has a gap; Stop retired this attempt. Resume explicitly to reconcile the session."));
        return;
      }
      try {
        var applied = runtime.session.apply(frame);
        if (applied.fold.kind !== "item" || applied.fold.outcome.kind !== "ignoredStaleRevision") runtime.onFrame(frame);
      } catch (error) {
        runtime.fail(error);
      }
    },
    close: function() {
      if (closing) return closing;
      scope.stop();
      if (runtime.session) runtime.session.hostExited({
        kind: "transportEof"
      });
      closing = closeResource(handshake).finally(function() {
        adapter.clients.delete(runtime);
      });
      return closing;
    },
    initialize: async function() {
      try {
        runtime.spawned = await runtime.waitRequest(handshake.initialize({
          clientInfo: {
            name: "clay",
            title: "Clay",
            version: "1.0.0"
          },
          capabilities: {
            requestedCapabilities: [ "sessionMcp" ],
            userInputDialogs: options.userInputDialogs === true
          }
        }), initializeTimeoutMs);
        runtime.connection = runtime.spawned.connection;
        runtime.connection.onProtocolError(function(error) {
          runtime.fail(error);
        });
        runtime.connection.closed.then(function() {
          if (scope.stopped()) return;
          runtime.dead = true;
          if (runtime.session) runtime.session.hostExited({
            kind: "transportEof"
          });
          runtime.fail(new Error("Muse Code transport closed unexpectedly"));
        });
        return runtime.spawned;
      } catch (error) {
        await runtime.close();
        throw error;
      }
    }
  };
  function route(frame) {
    if (scope.stopped()) return;
    if (frame.method === "usage/changed") { runtime.onFrame(frame); return; }
    if (runtime.opening) runtime.held.push(frame); else runtime.apply(frame);
  }
  handshake.onServerRequest(async function(request) {
    if (request.method === "approval/request") {
      route({
        method: "approval/requested",
        params: request.params
      });
      return {};
    }
    if (request.method === "userInput/request" && typeof runtime.onUserInput === "function") {
      route({ method: "userInput/requested", params: request.params });
      return {};
    }
    var error = new Error("Muse host requested an unsupported client dialog: " + request.method);
    runtime.fail(error);
    throw error;
  });
  adapter.clients.add(runtime);
  handshake.onNotification(route);
  if (typeof handshake.onProtocolError === "function") handshake.onProtocolError(function(error) {
    runtime.fail(error);
  });
  if (handshake.child && handshake.child.exit) handshake.child.exit.then(function(exit) {
    runtime.dead = true;
    if (runtime.session) runtime.session.hostExited(exit);
    if (!scope.stopped()) runtime.fail(new Error("Muse Code host exited: " + exit.kind));
  }, function(error) {
    if (!scope.stopped()) runtime.fail(error);
  });
  return runtime;
}

function normalizeCatalog(result) {
  return (result.models || []).map(function(model) {
    return {
      value: model.modelId,
      displayName: model.displayLabel || model.modelId,
      description: model.description || "",
      supportedEffortLevels: Array.isArray(model.variants) ? model.variants.filter(function(tier) {
        return ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(tier);
      }) : [],
      providerId: model.providerId || result.providerId,
      profileId: model.profileId == null ? result.profileId : model.profileId,
      defaultReasoningEffort: model.defaultReasoningEffort,
      isDefault: model.isDefault === true,
      effortUnknown: !Array.isArray(model.variants),
      catalogSource: result.source
    };
  });
}

function modelSelection(catalog, model) {
  for (var i = 0; i < catalog.length; i++) {
    if (catalog[i].value !== model) continue;
    var selection = {
      modelId: model,
      displayLabel: catalog[i].displayName
    };
    if (catalog[i].providerId) selection.providerId = catalog[i].providerId;
    if (catalog[i].profileId != null) selection.profileId = catalog[i].profileId;
    return selection;
  }
  throw new Error("Muse model is not in the live model catalog: " + model);
}
// SDK 1.4.7 retains opening metadata but does not ingest its history. Seed once,
// before the buffered live suffix; pending pointers await the host's full reissue.

function seedHistory(session, opening, onFrame) {
  if (opening.verb !== "session/resume") return;
  var history = opening.result.history || {};
  var snapshot = history.snapshot;
  if (snapshot && snapshot.schemaVersion !== 1) throw new Error("Unsupported Muse snapshot schema version");
  var items = history.items || snapshot && snapshot.state.items || [];
  for (var i = 0; i < items.length; i++) {
    var frame = {
      method: "item/updated",
      params: {
        sessionId: session.sessionId,
        item: items[i],
        viewCursor: opening.result.viewCursor
      }
    };
    session.apply(frame);
    if (onFrame) onFrame(frame);
  }
  var active = snapshot && snapshot.state.activeTurn;
  if (active) session.apply({
    method: "turn/started",
    params: Object.assign({}, active, {
      sessionId: session.sessionId,
      viewCursor: snapshot.viewCursor
    })
  });
}

module.exports = {
  isAuthError: isAuthError,
  createRuntime: createRuntime,
  normalizeCatalog: normalizeCatalog,
  modelSelection: modelSelection,
  seedHistory: seedHistory
};
