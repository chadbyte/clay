var normalizer = require("./acp-event-normalizer");
var driverRuntime = require("./acp-driver-runtime");
var queryAbort = require("./query-abort");
var acpUserInput = require("./acp-user-input");
var uuidCounter = 0;
function generateUuid(vendor) {
  uuidCounter++;
  return (vendor || "acp") + "-" + Date.now().toString(36) + "-" + uuidCounter.toString(36);
}
function isAuthError(value) {
  return /not logged in|sign in|log ?in|authenticate|authentication|credentials|unauthorized|forbidden|\b401\b/i.test(String(value || ""));
}
function isApproved(decision) {
  return decision === true || (decision && decision.behavior === "allow");
}
function createAcpQueryHandle(acp, queryOpts) {
  queryOpts = queryOpts || {};
  var vendor = queryOpts.vendor || "acp";
  var driver = queryOpts.driver || null;
  var abortController = queryOpts.abortController;
  var cancellation = queryAbort.createAbortScope();
  var removeAbort = function () {};
  var pendingPermissions = new Set();
  var stopDelivery = Promise.resolve();
  function send(method, params, timeout) {
    cancellation.check();
    return cancellation.wait(acp.send(method, params, timeout, cancellation.signal));
  }
  var canUseTool = queryOpts.canUseTool || null;
  var state = normalizer.createEventState({ vendor: vendor, contextWindow: queryOpts.contextWindow });
  state.sessionId = queryOpts.resumeSessionId || null;
  state.model = queryOpts.model || "auto"; state.effort = queryOpts.effort || null;
  state.done = false;
  state.aborted = false;
  state.loadingSession = false;
  state.toolPolicy = "ask";
  var eventBuffer = [];
  var eventWaiting = null;
  var iteratorDone = false;
  var messageQueue = [];
  var messageWaiting = null;
  var messageQueueEnded = false;
  var loopStarted = false;
  var finishedNotified = false;
  function driverContext(extra) {
    return Object.assign({
      vendor: vendor,
      driver: driver,
      acp: acp,
      state: state,
      queryOpts: queryOpts,
    }, extra || {});
  }
  function notifyFinished() {
    if (finishedNotified) return;
    finishedNotified = true;
    if (typeof queryOpts.onFinished === "function") {
      try { queryOpts.onFinished(); } catch (e) {
        console.error("[yoke/" + vendor + "] onFinished error:", e.message || e);
      }
    }
  }

  function pushEvent(event) {
    if (iteratorDone) return;
    if (eventWaiting) {
      var resolve = eventWaiting;
      eventWaiting = null;
      resolve({ value: event, done: false });
    } else {
      eventBuffer.push(event);
    }
  }

  function endIterator() {
    if (iteratorDone) return;
    iteratorDone = true;
    removeAbort();
    if (eventWaiting) {
      var resolve = eventWaiting;
      eventWaiting = null;
      resolve({ value: undefined, done: true });
    }
    notifyFinished();
  }

  function isCancelled() {
    return state.aborted || !!(abortController && abortController.signal && abortController.signal.aborted);
  }

  function queueMessage(message) {
    if (messageQueueEnded) return false;
    if (messageWaiting) {
      var resolve = messageWaiting;
      messageWaiting = null;
      resolve(message);
    } else {
      messageQueue.push(message);
    }
    return true;
  }

  function waitForMessage() {
    if (messageQueue.length) return Promise.resolve(messageQueue.shift());
    if (messageQueueEnded) return Promise.resolve(null);
    return new Promise(function(resolve) { messageWaiting = resolve; });
  }

  function findPermissionOption(options, kinds) {
    for (var i = 0; i < kinds.length; i++) {
      for (var j = 0; j < options.length; j++) {
        if (options[j].kind === kinds[i]) return options[j].optionId;
      }
    }
    return null;
  }

  function handlePermission(msg) {
    var params = msg.params || {};
    var toolCall = params.toolCall || {};
    var options = params.options || [];
    var allowId = findPermissionOption(options, ["allow_once", "allow_always"]);
    var rejectId = findPermissionOption(options, ["reject_once", "reject_always"]);
    var meta = (toolCall.toolCallId && state.toolMeta[toolCall.toolCallId]) || {};

    if (isCancelled()) {
      acp.respond(msg.id, { outcome: { outcome: "cancelled" } });
      return;
    }

    var answered = false;
    function cancelPermission() {
      if (answered) return;
      answered = true;
      pendingPermissions.delete(cancelPermission);
      acp.respond(msg.id, { outcome: { outcome: "cancelled" } });
    }
    pendingPermissions.add(cancelPermission);
    function respond(allowed) {
      if (answered) return;
      if (isCancelled()) { cancelPermission(); return; }
      answered = true;
      pendingPermissions.delete(cancelPermission);
      var optionId = allowed ? allowId : rejectId;
      if (!optionId) {
        acp.respond(msg.id, { outcome: { outcome: "cancelled" } });
        return;
      }
      var defaultResult = { outcome: { outcome: "selected", optionId: optionId } };
      var result = driverRuntime.call(driver, "buildPermissionResponse", driverContext({
        message: msg,
        allowed: allowed,
        optionId: optionId,
      }), function() { return defaultResult; });
      acp.respond(msg.id, result || defaultResult);
    }

    if (state.toolPolicy === "allow-all") {
      respond(true);
      return;
    }
    if (!canUseTool) {
      respond(false);
      return;
    }

    var toolName = toolCall.name || meta.name || normalizer.toolNameForKind(toolCall.kind || meta.kind, toolCall.title || meta.title);
    var input = toolCall.rawInput || meta.rawInput || { title: toolCall.title || meta.title };
    var permission = driverRuntime.call(driver, "mapPermissionRequest", driverContext({
      message: msg,
      toolName: toolName,
      input: input,
      options: options,
    }), function() { return { toolName: toolName, input: input }; }) || { toolName: toolName, input: input };
    Promise.resolve(canUseTool(permission.toolName || toolName, permission.input || input, { signal: cancellation.signal })).then(function(decision) {
      respond(isApproved(decision));
    }).catch(function(err) {
      console.error("[yoke/" + vendor + "] canUseTool error:", err.message || err);
      respond(false);
    });
  }

  function handleServerEvent(msg) {
    if (msg.method === "elicitation/create") {
      acpUserInput.handleElicitation(acp, msg, queryOpts.onUserInputRequest, queryOpts.onElicitation, cancellation.signal, vendor, driver && driver.displayName);
      return;
    }
    if (msg.method === "session/request_permission") {
      handlePermission(msg);
      return;
    }
    if (msg.method !== "session/update" || isCancelled() || state.loadingSession) return;
    var update = msg.params && msg.params.update;
    var events = driverRuntime.normalizeEvents(driver, driverContext({ message: msg, update: update }), function() {
      return normalizer.normalizeAcpUpdate(update, state);
    });
    for (var i = 0; i < events.length; i++) pushEvent(events[i]);
  }

  function configOptionFor(category, fallbackId) {
    for (var i = 0; i < state.configOptions.length; i++) {
      var option = state.configOptions[i];
      if (option.category === category || option.id === fallbackId) return option;
    }
    return null;
  }

  function setConfig(category, fallbackId, value) {
    if (!state.sessionId || !acp.started || value === undefined || value === null) return Promise.resolve();
    var option = configOptionFor(category, fallbackId);
    if (option) {
      return send("session/set_config_option", {
        sessionId: state.sessionId,
        configId: option.id,
        value: value,
      }, 15000).then(function(result) {
        if (result && Array.isArray(result.configOptions)) state.configOptions = result.configOptions;
      });
    }
    if (category === "mode") {
      return send("session/set_mode", { sessionId: state.sessionId, modeId: value }, 15000);
    }
    return Promise.reject(new Error("ACP session does not expose configuration option: " + fallbackId));
  }

  function safeModeValue(values) {
    var preferred = /^(ask|default|manual|supervised|plan|read.?only)$/i;
    for (var i = 0; i < values.length; i++) {
      var value = typeof values[i] === "string" ? values[i] : values[i] && (values[i].value || values[i].id);
      if (value && preferred.test(value)) return value;
    }
    return null;
  }

  function ensureDefaultSafePermissionMode() {
    var option = configOptionFor("mode", "mode");
    if (option) {
      if (safeModeValue([option.currentValue])) return Promise.resolve();
      var safeValue = safeModeValue(option.options || []);
      if (!safeValue) return Promise.reject(new Error("ACP agent started in an unsafe permission mode and exposed no supervised mode"));
      return setConfig("mode", option.id, safeValue);
    }

    var modes = state.modes;
    if (modes) {
      if (safeModeValue([modes.currentModeId])) return Promise.resolve();
      var safeMode = safeModeValue(modes.availableModes || []);
      if (!safeMode) return Promise.reject(new Error("ACP agent started in an unsafe permission mode and exposed no supervised mode"));
      return send("session/set_mode", { sessionId: state.sessionId, modeId: safeMode }, 15000);
    }
    if (driver && driver.permissionModeGuaranteed === true) return Promise.resolve();
    return Promise.reject(new Error("ACP agent did not expose a verifiable supervised permission mode"));
  }

  function ensureSafePermissionMode() {
    return driverRuntime.callAsync(driver, "ensureSafePermissionMode", driverContext(), ensureDefaultSafePermissionMode);
  }

  function prependSystemPrompt(message) {
    var parts = [queryOpts.systemPrompt, queryOpts.appendSystemPrompt].filter(function(part) { return !!part; });
    var systemPrompt = parts.join("\n\n");
    if (!systemPrompt) return message;
    if (typeof message === "string") return systemPrompt + "\n\n" + message;
    if (!Array.isArray(message)) return message;
    var cloned = message.slice();
    for (var i = 0; i < cloned.length; i++) {
      if (cloned[i] && cloned[i].type === "text") {
        cloned[i] = Object.assign({}, cloned[i], { text: systemPrompt + "\n\n" + (cloned[i].text || "") });
        return cloned;
      }
    }
    cloned.unshift({ type: "text", text: systemPrompt });
    return cloned;
  }

  function asPrompt(message) {
    if (typeof message === "string") return [{ type: "text", text: message }];
    return Array.isArray(message) ? message : [];
  }

  function emitResult() {
    var modelUsage = {};
    modelUsage[state.model] = { contextWindow: state.contextWindow || null };
    var resultEvent = {
      yokeType: "result",
      uuid: generateUuid(vendor),
      messageType: "assistant",
      cost: null,
      duration: null,
      usage: state.lastInputTokens == null ? null : {
        input_tokens: state.lastInputTokens,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      modelUsage: modelUsage,
      sessionId: state.sessionId,
      lastStreamInputTokens: state.lastInputTokens,
    };
    resultEvent = driverRuntime.call(driver, "buildResult", driverContext({ event: resultEvent }), function() { return resultEvent; }) || resultEvent;
    pushEvent(resultEvent);
  }

  function buildSessionParams(operation, base) {
    return driverRuntime.buildParams(driver, "buildSessionParams", driverContext({ operation: operation }), base);
  }

  function setModel(model) {
    return driverRuntime.callAsync(driver, "setModel", driverContext({ model: model }), function() {
      return setConfig("model", "model", model);
    });
  }

  function setEffort(effort) {
    return driverRuntime.callAsync(driver, "setEffort", driverContext({ effort: effort }), function() {
      return setConfig("thought_level", "thought_level", effort);
    });
  }

  function applySessionResult(result) {
    cancellation.check();
    result = result || {};
    if (result.sessionId) state.sessionId = result.sessionId;
    if (Array.isArray(result.configOptions)) state.configOptions = result.configOptions;
    if (result.modes) state.modes = result.modes;
    if (typeof queryOpts.onSessionReady === "function") queryOpts.onSessionReady(result);
    return result;
  }

  async function openDefaultSession(handlerEntry) {
    if (state.sessionId && queryOpts.canResumeSession) {
      handlerEntry.sessionId = state.sessionId;
      var resumed = await send("session/resume", buildSessionParams("resume", {
        sessionId: state.sessionId,
        cwd: queryOpts.cwd,
        mcpServers: queryOpts.mcpServers || [],
      }), 60000);
      return resumed;
    }
    if (state.sessionId && queryOpts.canLoadSession) {
      handlerEntry.sessionId = state.sessionId;
      state.loadingSession = true;
      try {
        var loaded = await send("session/load", buildSessionParams("load", {
          sessionId: state.sessionId,
          cwd: queryOpts.cwd,
          mcpServers: queryOpts.mcpServers || [],
        }), 60000);
        return loaded;
      } finally {
        state.loadingSession = false;
      }
    }

    state.sessionId = null;
    var result = await send("session/new", buildSessionParams("new", {
      cwd: queryOpts.cwd,
      mcpServers: queryOpts.mcpServers || [],
    }), 60000);
    return result;
  }

  function openSession(handlerEntry) {
    return driverRuntime.callAsync(driver, "openSession", driverContext({ handlerEntry: handlerEntry }), function() {
      return openDefaultSession(handlerEntry);
    }).then(applySessionResult);
  }

  function prompt(message) {
    return driverRuntime.callAsync(driver, "prompt", driverContext({ message: message }), function() {
      var params = driverRuntime.buildParams(driver, "buildPromptParams", driverContext({ message: message }), {
        sessionId: state.sessionId,
        prompt: asPrompt(message),
      });
      return send("session/prompt", params, 30 * 60 * 1000);
    });
  }

  async function runQueryLoop(initialMessage) {
    var currentMessage = prependSystemPrompt(initialMessage);
    var handlerEntry = acp.addHandler(handleServerEvent);
    try {
      var sessionResult = await cancellation.wait(openSession(handlerEntry));
      handlerEntry.sessionId = state.sessionId;
      await cancellation.wait(driverRuntime.callAsync(driver, "afterSessionOpen", driverContext({ sessionResult: sessionResult }), function() {}));
      await cancellation.wait(ensureSafePermissionMode());
      if (state.model && state.model !== "auto") await setModel(state.model);
      if (state.effort) await setEffort(state.effort);
      if (queryOpts.mode) await setConfig("mode", "mode", queryOpts.mode);

      while (!isCancelled()) {
        normalizer.resetTurnState(state);
        pushEvent({ yokeType: "turn_start", uuid: generateUuid(vendor), messageType: "user" });
        var result = await cancellation.wait(prompt(currentMessage));
        var closing = normalizer.closeOpenBlocks(state);
        for (var i = 0; i < closing.length; i++) pushEvent(closing[i]);
        if (isCancelled() || (result && result.stopReason === "cancelled")) {
          pushEvent({ yokeType: "interrupted" });
          emitResult();
          break;
        }
        emitResult();
        var next = await waitForMessage();
        if (next === null) break;
        currentMessage = next;
      }
    } catch (e) {
      if (!isCancelled() && e.name !== "AbortError") {
        var message = e.message || String(e);
        var authError = driverRuntime.call(driver, "isAuthError", driverContext({ error: e, message: message }), function() { return isAuthError(message); });
        pushEvent(authError
          ? { yokeType: "auth_required", vendor: vendor }
          : { yokeType: "error", text: message });
      }
    } finally {
      await stopDelivery;
      acp.removeHandler(handlerEntry);
      state.done = true;
      endIterator();
    }
  }

  var handle = {
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (eventBuffer.length) return Promise.resolve({ value: eventBuffer.shift(), done: false });
          if (iteratorDone) return Promise.resolve({ value: undefined, done: true });
          return new Promise(function(resolve) { eventWaiting = resolve; });
        },
      };
    },
    pushMessage: function(text, images) {
      if (iteratorDone || state.done || messageQueueEnded) return false;
      var content = [];
      for (var i = 0; images && i < images.length; i++) {
        if (images[i] && images[i].base64 && images[i].mimeType) {
          content.push({ type: "image", data: images[i].base64, mimeType: images[i].mimeType });
        }
      }
      content.push({ type: "text", text: text || "" });
      var message = content.length === 1 ? content[0].text : content;
      if (!loopStarted) {
        loopStarted = true;
        runQueryLoop(message);
        return true;
      }
      return queueMessage(message);
    },
    setModel: function(model) {
      return setModel(model).then(function() { state.model = model; });
    },
    setEffort: function(effort) {
      return setEffort(effort).then(function() { state.effort = effort; });
    },
    setToolPolicy: function(policy) {
      state.toolPolicy = policy === "allow-all" ? "allow-all" : "ask";
      return Promise.resolve();
    },
    stopTask: function(taskId) {
      return driverRuntime.callAsync(driver, "stopTask", driverContext({ taskId: taskId }), function() {});
    },
    getContextUsage: function() {
      return driverRuntime.callAsync(driver, "getContextUsage", driverContext(), function() { return state.lastInputTokens == null ? null : {
        input_tokens: state.lastInputTokens,
        contextWindow: state.contextWindow,
      }; });
    },
    abort: function() {
      if (state.aborted || iteratorDone) return;
      state.aborted = true;
      cancellation.stop();
      handle.endInput();
      messageQueue = [];
      pendingPermissions.forEach(function (cancel) { try { cancel(); } catch (e) {} });
      stopDelivery = driverRuntime.callAsync(driver, "cancel", driverContext(), function() {
        if (state.sessionId && (!acp.started || acp.notify("session/cancel", { sessionId: state.sessionId }) === false)) {
          throw new Error("ACP transport is disconnected");
        }
      }).catch(function (error) {
        pushEvent({ yokeType: "error", text: "Cancellation could not be delivered: " + error.message });
      }).finally(endIterator);
      return stopDelivery;
    },
    close: function() { handle.endInput(); endIterator(); },
    endInput: function() {
      messageQueueEnded = true;
      if (messageWaiting) { var resolve = messageWaiting; messageWaiting = null; resolve(null); }
    },
  };

  removeAbort = queryAbort.bindAbort(abortController, function () { handle.abort(); });
  return handle;
}

module.exports = {
  createAcpQueryHandle: createAcpQueryHandle,
  isAuthError: isAuthError,
};
