var queryAbort = require("./query-abort");

var runtimeTools = require("./muse-runtime");

var policy = require("./muse-policy");

function createMuseQueryHandle(adapter, queryOpts) {
  var state = {
    client: null,
    connection: null,
    session: null,
    sessionId: queryOpts.resumeSessionId || null,
    model: queryOpts.model || null,
    effort: queryOpts.effort || null,
    toolPolicy: "ask",
    messages: [],
    messageSequence: 0,
    active: false,
    ended: false,
    inputEnded: false,
    stopped: false,
    events: [],
    waiter: null,
    textBlocks: {},
    thinkingBlocks: {},
    toolBlocks: {},
    activeTurn: null,
    liveTurnIds: new Set(),
    abortController: queryOpts.abortController || new AbortController(),
    started: false
  };
  var removeAbort = function() {};
  var handle;
  var failure = null;
  var cleanup = null;
  var runtime = null;
  var itemFrames = [];
  var skillDelivery = require("./muse-skills").create(Object.assign({}, queryOpts, { cwd: queryOpts.cwd || adapter.cwd }), function() { return runtime; }, push, assertLive);
  var emitArtifact = require("./muse-artifacts").create(function() { return runtime; }, push);
  var renderer = require("./muse-items").createRenderer(state, push);
  var turns = require("./muse-turns").create({ state: state, renderer: renderer, emitArtifact: emitArtifact,
    runtime: function() { return runtime; }, push: push, outcomeEvent: outcomeEvent, fail: fail, close: function() { return handle.close(); } });
  function push(event) {
    if (state.stopped || state.ended) return;
    if (state.waiter) {
      var resolve = state.waiter;
      state.waiter = null;
      resolve({
        value: event,
        done: false
      });
    } else state.events.push(event);
  }
  function finish() {
    if (state.waiter) {
      var resolve = state.waiter;
      state.waiter = null;
      resolve({
        value: undefined,
        done: true
      });
    }
  }
  function assertLive() {
    if (state.stopped || state.ended || adapter.shuttingDown) throw new Error("Muse Code query was stopped");
  }
  function activateTurn(turn) {
    state.activeTurn = turn;
    push({
      yokeType: "turn_start",
      uuid: turn.turnId, messageType: "user",
      turnId: turn.turnId
    });
    var frames = itemFrames.splice(0);
    for (var i = 0; i < frames.length; i++) renderer.renderFrame(frames[i]);
  }
  function chooseApproval(request) {
    if (state.stopped || state.abortController.signal.aborted) return Promise.reject(new Error("Muse approval cancelled"));
    return runtime.wait(policy.chooseApprovalDecision(request, queryOpts.canUseTool, state.abortController.signal));
  }
  function fail(error) {
    if (state.stopped || failure) return;
    failure = error;
    state.messages = [];
    push(runtimeTools.isAuthError(error) ? {
      yokeType: "auth_required",
      vendor: "muse"
    } : {
      yokeType: "error",
      text: error.message || String(error)
    });
    handle.close().catch(function(closeError) {
      adapter.lastCloseError = closeError;
    });
  }
  async function selectModel(model) {
    if (!model) return null;
    if (!adapter.catalog.some(function(row) {
      return row.value === model;
    })) {
      var result = await runtime.waitRequest(state.connection.request("model/list", {}));
      adapter.catalog = runtimeTools.normalizeCatalog(result);
    }
    assertLive();
    return runtimeTools.modelSelection(adapter.catalog, model);
  }
  function validateEffort(effort) {
    var vocabulary = [ "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra" ];
    if (!vocabulary.includes(effort)) throw new Error("Unsupported Muse reasoning effort: " + effort);
    var row = adapter.catalog.find(function(model) {
      return model.value === state.model;
    });
    if (row && !row.effortUnknown && !row.supportedEffortLevels.includes(effort)) {
      throw new Error("Muse model does not support reasoning effort: " + effort);
    }
  }
  async function ensureSession() {
    assertLive();
    if (state.session) return state.session;
    var sdk = await adapter.loadSdk();
    assertLive();
    runtime = runtimeTools.createRuntime(adapter, sdk, {
      command: adapter.binaryPath,
      args: [ "serve" ],
      cwd: queryOpts.cwd || adapter.cwd,
      userInputDialogs: queryOpts.userInputMode !== "fallback" && typeof queryOpts.onUserInputRequest === "function",
      env: Object.assign({}, process.env, queryOpts.env || {})
    });
    runtime.fail = fail;
    runtime.onUserInput = require("./muse-input").createRouter(runtime, queryOpts, state.abortController.signal);
    runtime.onFrame = function(frame) {
      turns.onFrame(frame);
      if (frame.method.indexOf("item/") === 0) {
        if (!renderer.renderFrame(frame)) itemFrames.push(frame);
      }
      if (frame.method === "session/modelChanged") {
        var previousModel = state.model;
        state.model = frame.params.modelId;
        if (typeof queryOpts.onModelSwitch === "function" && previousModel && previousModel !== state.model) queryOpts.onModelSwitch({ fromModel: previousModel, toModel: state.model, source: frame.params.source });
      }
      if (frame.method === "userInput/settled") runtime.onUserInput.settle(frame.params.userInputId);
      if (frame.method === "userInput/requested") runtime.onUserInput(frame.params).catch(fail);
      if (frame.method === "usage/changed") {
        var quota = require("./muse-services").quotaEvent(frame.params);
        if (quota) push(quota);
      }
      if (frame.method === "session/contextUsage") state.contextUsage = frame.params;
      if (frame.method === "approval/requested" && queryOpts.resumeSessionId && !state.started) {
        state.resumedTurnId = state.resumedTurnId || frame.params.turnId;
      }
    };
    var spawned = await runtime.initialize();
    assertLive();
    state.connection = spawned.connection;
    var museOpts = queryOpts.adapterOptions && queryOpts.adapterOptions.MUSE || {};
    var mcpServers = policy.normalizeMcpServers(museOpts.mcpServers);
    var hasMcp = Object.keys(mcpServers).length > 0;
    var config = hasMcp ? {
      mcpServers: mcpServers
    } : undefined;
    if (hasMcp && !(spawned.initializeResult.grantedCapabilities || []).includes("sessionMcp")) {
      throw new Error("Muse host does not support the required sessionMcp capability");
    }
    var selection = await selectModel(state.model);
    if (state.effort) validateEffort(state.effort);
    var verb = state.sessionId ? "session/resume" : "session/start";
    var params = state.sessionId ? {
      sessionId: state.sessionId,
      config: config,
      history: "inline"
    } : {
      workspaceRoot: queryOpts.cwd || adapter.cwd,
      config: config,
      approvalMode: museOpts.readOnly ? "denyUnmatched" : "onRequest"
    };
    if (selection && verb === "session/start") {
      params.modelId = selection.modelId;
      if (selection.providerId) params.providerId = selection.providerId;
    }
    var result = await runtime.waitRequest(state.connection.command(verb, params));
    assertLive();
    state.sessionId = result.session.sessionId;
    var opening = {
      verb: verb,
      result: result
    };
    state.session = new sdk.Session({
      connection: state.connection,
      durability: sdk.readSessionDurability(spawned.initializeResult),
      opening: opening,
      sessionId: state.sessionId
    });
    runtime.session = state.session;
    state.session.onApproval(chooseApproval);
    state.session.onApprovalError(function(problem) {
      fail(problem.error || new Error("Muse approval failed: " + problem.kind));
    });
    state.session.onGapError(function(problem) {
      fail(problem.error || new Error("Muse view gap could not be filled"));
    });
    runtimeTools.seedHistory(state.session, opening, runtime.onFrame);
    state.resumedTurnId = state.session.fold.activeTurnId;
    state.contextUsage = result.history && result.history.snapshot && result.history.snapshot.state.contextUsage || null;
    runtime.opening = false;
    var held = runtime.held.splice(0);
    for (var i = 0; i < held.length; i++) runtime.apply(held[i]);
    assertLive();
    if (runtime.dead) throw new Error("Muse host exited while opening the session");
    if (verb === "session/resume") {
      await runtime.waitRequest(state.connection.command("session/setApprovalMode", {
        sessionId: state.sessionId,
        mode: museOpts.readOnly ? "denyUnmatched" : "onRequest"
      }));
      if (selection) await runtime.waitRequest(state.connection.command("session/setModel", {
        sessionId: state.sessionId,
        model: selection
      }));
    }
    assertLive();
    if (verb === "session/resume") {
      state.resumedTurnId = state.resumedTurnId || result.session.activeTurnId || state.session.fold.activeTurnId;
      if ((result.pendingRequests || []).length) {
        var pending = await runtime.waitRequest(state.connection.request("approval/listPending", {
          sessionId: state.sessionId
        }));
        for (var promptIndex = 0; promptIndex < (pending.userInputs || []).length; promptIndex++) {
          var promptRequest = pending.userInputs[promptIndex];
          state.resumedTurnId = state.resumedTurnId || promptRequest.turnId;
          runtime.onUserInput(promptRequest).catch(fail);
        }
        for (var pendingIndex = 0; pendingIndex < (pending.approvals || []).length; pendingIndex++) {
          var approval = pending.approvals[pendingIndex];
          state.resumedTurnId = state.resumedTurnId || approval.turnId;
          runtime.apply({
            method: "approval/requested",
            params: approval
          });
        }
      }
    }
    assertLive();
    push({
      yokeType: "session_started",
      sessionId: state.sessionId
    });
    return state.session;
  }
  function outcomeEvent(outcome) {
    if (!outcome || outcome.kind === "unqueued" || outcome.kind === "completed" && outcome.params && (outcome.params.terminal === "cancelled" || outcome.params.terminal === "cancelledByUser")) return {
      yokeType: "interrupted"
    };
    if (outcome.kind === "terminalUnknown") return {
      yokeType: "error",
      text: "Muse host exited before the turn outcome was known"
    };
    var params = outcome.params || {};
    if (params.terminal === "failed") return params.error && params.error.kind === "authRequired" ? {
      yokeType: "auth_required",
      vendor: "muse"
    } : {
      yokeType: "error",
      text: params.error && params.error.message || params.reason || "Muse Code turn failed."
    };
    if (params.terminal !== "completed") return {
      yokeType: "error",
      text: "Unknown Muse turn outcome: " + params.terminal
    };
    return {
      yokeType: "result",
      messageType: "assistant",
      sessionId: state.sessionId,
      usage: params.usage ? {
        input_tokens: params.usage.inputTokens,
        output_tokens: params.usage.outputTokens,
        cache_read_input_tokens: params.usage.cacheReadTokens == null ? params.usage.cachedTokens : params.usage.cacheReadTokens,
        cache_creation_input_tokens: params.usage.cacheWriteTokens || 0
      } : null,
      cost: null,
      duration: params.durationMs || null
    };
  }
  async function runMessage(text, images, skill, sequence) {
    state.active = true;
    try {
      var session = await ensureSession();
      assertLive();
      if (state.resumedTurnId) {
        var resumed = session.turn(state.resumedTurnId);
        state.resumedTurnId = null;
        activateTurn(resumed);
        var resumedBoundary = await turns.follow(resumed, false);
        assertLive();
        if (resumedBoundary.kind === "failed" || resumedBoundary.event && resumedBoundary.event.yokeType !== "result") return;
        push({ yokeType: "runtime_specific", vendor: "muse",
          eventType: resumedBoundary.kind === "foreground" ? "resumed_foreground_completed" : "resumed_turn_completed", raw: resumedBoundary.outcome });
      }
      var prepared = await skillDelivery.prepare(text || "", skill);
      assertLive();
      skill = prepared.skill;
      var prompt = prepared.text;
      if (!state.started) {
        state.started = true;
        prompt = [ queryOpts.systemPrompt, queryOpts.appendSystemPrompt, prompt ].filter(function(part) {
          return !!part;
        }).join("\n\n");
      }
      state.activeTurn = null;
      if (prepared.scoped) skillDelivery.check();
      var turn = await runtime.wait(session.sendUserTurn({
        input: require("./muse-input").inputParts(prompt, images).concat(skill ? [{ type: "skill", selector: skill.selector, arguments: skill.arguments }] : []),
        reasoningEffort: state.effort || undefined
      }));
      assertLive();
      activateTurn(turn);
      await turns.follow(turn, true, sequence);
    } catch (e) {
      fail(e);
    } finally {
      state.active = false;
      state.activeTurn = null;
      if (state.messages.length && !state.stopped) {
        var next = state.messages.shift();
        runMessage(next.text, next.images, next.skill, next.sequence).catch(function(error) {
          adapter.lastCloseError = error;
        });
      } else if (state.inputEnded && !turns.pending()) await handle.close();
      else if (!state.stopped && turns.background()) push({ yokeType: "foreground_available" });
    }
  }
  handle = {
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (state.events.length) return Promise.resolve({
            value: state.events.shift(),
            done: false
          });
          if (state.ended) return Promise.resolve({
            value: undefined,
            done: true
          });
          return new Promise(function(resolve) {
            state.waiter = resolve;
          });
        }
      };
    },
    pushMessage: function(text, images, skill) {
      if (state.stopped || state.ended || state.inputEnded) return false;
      state.messages.push({
        text: text, sequence: ++state.messageSequence,
        images: images, skill: skill
      });
      if (!state.active) {
        var next = state.messages.shift();
        runMessage(next.text, next.images, next.skill, next.sequence).catch(function(error) {
          adapter.lastCloseError = error;
        });
      }
      return true;
    },
    // Clay's callback remains the authority even when its UI permits all tools.
    setToolPolicy: async function(value) {
      assertLive();
      if (["ask", "allow-all"].indexOf(value) < 0) throw new Error("Unsupported Muse tool policy: " + value);
      state.toolPolicy = value;
      return { policy: value, nativeApprovalMode: "onRequest", authority: "canUseTool" };
    },
    stopTask: async function(taskId) {
      assertLive();
      if (!taskId) return handle.abort();
      if (!state.connection || !state.session) throw new Error("Muse task stop requires an opened session");
      await runtime.waitRequest(state.connection.command("task/stop", {
        sessionId: state.sessionId,
        taskId: taskId
      }));
    },
    getContextUsage: function() {
      var context = state.contextUsage;
      return Promise.resolve(context ? {
        input_tokens: context.usedTokens,
        contextWindow: context.windowTokens
      } : null);
    },
    endInput: function() {
      state.inputEnded = true;
      if (!state.active && !state.messages.length && !turns.pending()) handle.close().catch(function(error) {
        adapter.lastCloseError = error;
      });
    },
    abort: function() {
      if (state.ended || state.stopped) return cleanup;
      state.events = [];
      var liveTurns = new Set(state.liveTurnIds);
      if (state.activeTurn) liveTurns.add(state.activeTurn.turnId);
      if (state.connection) liveTurns.forEach(function(turnId) {
        state.connection.command("turn/cancel", { sessionId: state.sessionId, turnId: turnId }).catch(function(error) {
          adapter.lastCancelError = error;
        });
      });
      push({
        yokeType: "interrupted"
      });
      return handle.close();
    },
    close: function() {
      if (cleanup) return cleanup;
      state.stopped = true;
      state.inputEnded = true;
      state.messages = [];
      state.ended = true;
      removeAbort();
      state.abortController.abort();
      finish();
      adapter.handles.delete(handle);
      cleanup = runtime ? runtime.close() : Promise.resolve();
      return cleanup;
    }
  };
  Object.assign(handle, require("./muse-controls").create({ state: state, assertLive: assertLive, selectModel: selectModel, validateEffort: validateEffort, skills: skillDelivery, runtime: function() { return runtime; }, handle: handle }));
  adapter.handles.add(handle);
  removeAbort = queryAbort.bindAbort(state.abortController, function() {
    handle.abort();
  });
  return handle;
}

module.exports = {
  createMuseQueryHandle: createMuseQueryHandle
};
