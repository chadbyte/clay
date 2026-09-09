// YOKE Codex Adapter
// -------------------
// Implements the YOKE interface using codex app-server protocol.
// Bidirectional JSON-RPC over stdin/stdout enables interactive approval flows.

var path = require("path");
var fs = require("fs");
var { CodexAppServer } = require("../codex-app-server");
var INITIALIZE_TIMEOUT_MS = require("../interface").INITIALIZE_TIMEOUT_MS;
var skillDiscovery = require("../skill-discovery");
var { resolveOsUserInfo } = require("../../os-users");
var backgroundTasks = require("../codex-background-tasks");
var codexUserInput = require("../codex-user-input");

// --- Reasoning defaults ---
// Reasoning summaries are the only readable thinking channel Codex offers:
// raw reasoning content is encrypted for ChatGPT-authenticated models, so the
// item/reasoning/* events this adapter already maps to thinking only carry
// text when the app-server is asked for summaries. The CLI default
// (`model_reasoning_summary = "auto"`) frequently produces none at all, and the
// app-server otherwise inherits whatever is in the user's ~/.codex/config.toml,
// so Clay asks for detailed summaries explicitly.
//
// `show_raw_agent_reasoning` is deliberately absent: it is encrypted on
// ChatGPT-auth models and noisy elsewhere, so it stays a user opt-in.
// Everything here is overridable via adapterOptions.CODEX.config.
var CODEX_REASONING_DEFAULTS = {
  model_reasoning_summary: "detailed",
  model_supports_reasoning_summaries: true,
};
var DEFAULT_CODEX_MODEL = "gpt-6-astra";
var CODEX_NOTE_TOOLS = {
  list_notes: true,
  write_note: true,
  close_note: true,
  reopen_note: true,
  remove_note: true,
};

function canonicalDynamicPermissionToolName(toolName) {
  if (CODEX_NOTE_TOOLS[toolName]) return "mcp__clay-notes__" + toolName;
  if (toolName === "send_to_partner" || toolName === "read_partner") return "mcp__clay-sessions__" + toolName;
  if (toolName === "present_markdown_edit") return "mcp__clay-documents__" + toolName;
  return toolName;
}

// --- Event flattening ---
// Converts app-server JSON-RPC notifications into flat objects with a yokeType field.
//
// App-server events use slash notation (item/started) and camelCase item types.
// We normalize to the same YOKE event format used by the rest of the system.
//
// Server -> Client notifications:
//   thread/started     -> { params: { thread } }
//   turn/started       -> { params: {} }
//   turn/completed     -> { params: { usage } }
//   turn/failed        -> { params: { error } }
//   item/started       -> { params: { item } }
//   item/updated       -> { params: { item } }
//   item/completed     -> { params: { item } }
//   item/agentMessage/delta -> { params: { itemId, delta } }
//
// Item types (camelCase in app-server):
//   agentMessage       -> text response
//   reasoning          -> thinking
//   commandExecution   -> bash/shell
//   imageGeneration    -> ImageGen with a persisted inline image
//   fileChange         -> file edits
//   mcpToolCall        -> MCP tool
//   webSearch          -> web search
//   error              -> error

var _uuidCounter = 0;
function generateUuid() {
  var ts = Date.now().toString(36);
  var cnt = (++_uuidCounter).toString(36);
  var rnd = Math.random().toString(36).substring(2, 8);
  return "codex-" + ts + "-" + cnt + "-" + rnd;
}

function waitMs(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

function waitForProcessExit(proc, timeoutMs) {
  return new Promise(function(resolve) {
    if (!proc) {
      resolve(true);
      return;
    }

    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }

    var done = false;
    var timer = null;

    function cleanup() {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      proc.removeListener("exit", onDone);
      proc.removeListener("close", onDone);
    }

    function onDone() {
      cleanup();
      resolve(true);
    }

    proc.once("exit", onDone);
    proc.once("close", onDone);

    timer = setTimeout(function() {
      cleanup();
      resolve(false);
    }, timeoutMs || 5000);
  });
}

function createShutdownError() {
  var err = new Error("Codex adapter is shutting down, retry shortly");
  err.code = "CODEX_ADAPTER_SHUTTING_DOWN";
  return err;
}

function normalizePlanStatus(status) {
  if (status === "inProgress") return "in_progress";
  if (status === "completed") return "completed";
  return "pending";
}

function dynamicInputSchema(inputSchema) {
  if (inputSchema && typeof inputSchema.type === "string") return inputSchema;
  try {
    var zod = require("zod");
    if (zod.toJSONSchema && inputSchema) {
      var schema = inputSchema.safeParse ? inputSchema : zod.object(inputSchema);
      return zod.toJSONSchema(schema);
    }
  } catch (e) {}
  return { type: "object", properties: {} };
}

// Detect Codex "not logged in" errors. Codex surfaces auth failures several
// ways depending on transport: a clean error event with
// codexErrorInfo:"unauthorized", or a turn/failed / item error whose message
// carries a 401 / token-revoked / missing-bearer / "sign in again" string.
// Callers map a match to the neutral auth_required yokeType.
function isCodexAuthError(text, errObj) {
  if (errObj && errObj.codexErrorInfo === "unauthorized") return true;
  return /sign in again|token[_ ]?revoked|invalidated oauth|missing bearer|unauthorized|\b401\b/i.test(String(text || ""));
}

function extractPromptSuggestion(params) {
  if (!params) return "";
  if (typeof params.suggestion === "string") return params.suggestion;
  if (typeof params.promptSuggestion === "string") return params.promptSuggestion;
  if (typeof params.suggestedPrompt === "string") return params.suggestedPrompt;
  if (Array.isArray(params.suggestions) && typeof params.suggestions[0] === "string") return params.suggestions[0];
  if (Array.isArray(params.promptSuggestions) && typeof params.promptSuggestions[0] === "string") return params.promptSuggestions[0];
  if (Array.isArray(params.followUpSuggestions) && typeof params.followUpSuggestions[0] === "string") return params.followUpSuggestions[0];
  return "";
}

function flattenEvent(notification, state) {
  var events = [];
  var method = notification.method;
  var params = notification.params || {};


  if (method === "thread/started") {
    state.threadId = params.thread ? params.thread.id : (params.threadId || null);
    return events;
  }

  if (method === "turn/started") {
    state.turnStarted = true;
    var userUuid = generateUuid();
    events.push({ yokeType: "turn_start", uuid: userUuid, messageType: "user" });
    return events;
  }

  if (method === "turn/completed") {
    var usage = params.usage || null;
    var turnStatus = params.status || (params.turn && params.turn.status) || null;
    state.lastUsage = usage;
    // Emit interrupted status so UI shows "stopped" message
    if (turnStatus === "interrupted" || state.aborted) {
      events.push({ yokeType: "interrupted" });
    }
    var inputTokens = state.lastInputTokens || (usage ? (usage.input_tokens || 0) + (usage.cached_input_tokens || 0) : 0);
    var outputTokens = (usage ? (usage.output_tokens || 0) : 0) || state.lastOutputTokens || 0;
    var cachedTokens = (usage ? (usage.cached_input_tokens || 0) : 0) || state.lastCachedTokens || 0;
    var hasTokenData = inputTokens > 0 || outputTokens > 0;
    var resultModelUsage = {};
    // Codex reports the real window in thread/tokenUsage/updated. Dropping it
    // made the client fall back to its model-name table, which has no entry
    // for codex model ids and defaulted to Claude's 200k denominator.
    resultModelUsage[state.model] = { contextWindow: state.modelContextWindow || null };
    var assistantUuid = generateUuid();
    events.push({
      yokeType: "result",
      uuid: assistantUuid,
      messageType: "assistant",
      cost: null,
      duration: null,
      usage: hasTokenData ? {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cachedTokens,
        cache_creation_input_tokens: 0,
      } : null,
      modelUsage: resultModelUsage,
      sessionId: state.threadId || null,
      lastStreamInputTokens: state.lastInputTokens || null,
    });
    state.lastInputTokens = null;
    state.lastCachedTokens = null;
    state.lastOutputTokens = null;
    return events;
  }

  if (method === "turn/plan/updated") {
    events.push({
      yokeType: "plan_updated",
      turnId: params.turnId || null,
      explanation: params.explanation || "",
      title: "Plan",
      plan: Array.isArray(params.plan) ? params.plan.map(function(step) {
        return {
          step: step && step.step ? step.step : "",
          status: normalizePlanStatus(step && step.status),
        };
      }) : [],
    });
    return events;
  }

  if (method === "turn/failed") {
    var tfMsg = params.error ? params.error.message : "Turn failed";
    if (isCodexAuthError(tfMsg, params.error)) {
      events.push({ yokeType: "auth_required", vendor: "codex" });
      return events;
    }
    events.push({
      yokeType: "error",
      text: tfMsg,
    });
    return events;
  }

  // Rate limits from Codex account
  if (method === "account/rateLimits/updated") {
    var rl = params.rateLimits;
    if (rl) {
      var windows = [
        { key: "primary", type: "five_hour" },
        { key: "secondary", type: "seven_day" },
      ];
      for (var wi = 0; wi < windows.length; wi++) {
        var w = rl[windows[wi].key];
        if (!w) continue;
        var utilization = (w.usedPercent || 0) / 100;
        var status = "allowed";
        if (w.usedPercent >= 100) status = "rejected";
        else if (w.usedPercent >= 80) status = "allowed_warning";
        events.push({
          yokeType: "rate_limit",
          rateLimitInfo: {
            status: status,
            resetsAt: w.resetsAt || null,
            rateLimitType: windows[wi].type,
            utilization: utilization,
            isUsingOverage: false,
          },
        });
      }
    }
    return events;
  }

  // Streaming text delta (app-server specific, not present in exec mode)
  if (method === "item/agentMessage/delta") {
    var deltaItemId = params.itemId || params.id;
    if (deltaItemId && !state.textBlocks[deltaItemId]) {
      state.textBlocks[deltaItemId] = true;
      state.blockCounter++;
      events.push({ yokeType: "text_start", blockId: "blk_" + state.blockCounter });
    }
    if (params.delta) {
      events.push({
        yokeType: "text_delta",
        blockId: "blk_" + state.blockCounter,
        text: params.delta,
      });
      // Track cumulative streamed length so item/completed doesn't re-send the full text
      if (deltaItemId) {
        state.textLengths[deltaItemId] = (state.textLengths[deltaItemId] || 0) + params.delta.length;
      }
    }
    return events;
  }

  // Reasoning deltas: streamed summarized thinking. The reasoning ITEM often
  // carries only encrypted content with no readable text; the human-readable
  // summary arrives through these delta notifications. Without handling them
  // Codex sessions show no thinking at all.
  if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
    var rDeltaItemId = params.itemId || params.id;
    if (rDeltaItemId && !state.thinkingBlocks[rDeltaItemId]) {
      state.blockCounter++;
      state.thinkingBlocks[rDeltaItemId] = "blk_" + state.blockCounter;
      events.push({ yokeType: "thinking_start", blockId: state.thinkingBlocks[rDeltaItemId] });
    }
    if (params.delta) {
      events.push({
        yokeType: "thinking_delta",
        blockId: rDeltaItemId ? state.thinkingBlocks[rDeltaItemId] : ("blk_" + state.blockCounter),
        text: params.delta,
      });
      // Track streamed length so item/completed doesn't re-send the full text
      if (rDeltaItemId) {
        state.thinkingLengths[rDeltaItemId] = (state.thinkingLengths[rDeltaItemId] || 0) + params.delta.length;
      }
    }
    return events;
  }

  // Separator between reasoning summary sections
  if (method === "item/reasoning/summaryPartAdded") {
    var rPartItemId = params.itemId || params.id;
    if (rPartItemId && state.thinkingBlocks[rPartItemId]) {
      events.push({ yokeType: "thinking_delta", blockId: state.thinkingBlocks[rPartItemId], text: "\n\n" });
      state.thinkingLengths[rPartItemId] = (state.thinkingLengths[rPartItemId] || 0) + 2;
    }
    return events;
  }

  if (method === "item/plan/delta") {
    var planDeltaItemId = params.itemId || params.id;
    var nextPlanText = (state.planTexts[planDeltaItemId] || "") + (params.delta || "");
    if (planDeltaItemId) state.planTexts[planDeltaItemId] = nextPlanText;
    if (nextPlanText) {
      events.push({
        yokeType: "plan_content",
        content: nextPlanText,
        itemId: planDeltaItemId || null,
      });
    }
    return events;
  }

  // serverRequest/resolved - confirmation that an approval was processed
  if (method === "serverRequest/resolved") {
    return events; // no-op, approval already handled
  }

  // Item events
  if (method === "item/started" || method === "item/updated" || method === "item/completed") {
    var item = params.item;
    if (!item) return events;

    var evtPhase = method.split("/")[1]; // "started", "updated", "completed"

    if (item.type === "plan") {
      if (typeof item.text === "string") {
        state.planTexts[item.id] = item.text;
        events.push({
          yokeType: "plan_content",
          content: item.text,
          itemId: item.id,
          final: evtPhase === "completed",
        });
      }
      return events;
    }

    if (item.type === "contextCompaction" || item.type === "context_compaction") {
      events.push({
        yokeType: "status",
        status: evtPhase === "completed" ? "processing" : "compacting",
      });
      return events;
    }

    // Agent message (text response)
    if (item.type === "agentMessage" || item.type === "agent_message") {
      if (!state.textBlocks[item.id]) {
        state.textBlocks[item.id] = true;
        state.blockCounter++;
        events.push({ yokeType: "text_start", blockId: "blk_" + state.blockCounter });
      }
      if (item.text) {
        var prevLen = state.textLengths[item.id] || 0;
        if (item.text.length > prevLen) {
          events.push({
            yokeType: "text_delta",
            blockId: "blk_" + state.blockCounter,
            text: item.text.substring(prevLen),
          });
          state.textLengths[item.id] = item.text.length;
        }
      }
      return events;
    }

    // Reasoning (thinking)
    if (item.type === "reasoning") {
      if (!state.thinkingBlocks[item.id]) {
        state.blockCounter++;
        state.thinkingBlocks[item.id] = "blk_" + state.blockCounter;
        events.push({ yokeType: "thinking_start", blockId: "blk_" + state.blockCounter });
      }
      // Codex reasoning items may expose plain text via `text`, a short
      // `summary`, or nested `content` parts. Prefer whichever is present;
      // many turns arrive with only encrypted reasoning and no readable
      // text at all, in which case the UI will hide the expand affordance.
      var reasoningText = "";
      if (typeof item.text === "string" && item.text.length > 0) {
        reasoningText = item.text;
      } else if (typeof item.summary === "string" && item.summary.length > 0) {
        reasoningText = item.summary;
      } else if (Array.isArray(item.content)) {
        var parts = [];
        for (var rpi = 0; rpi < item.content.length; rpi++) {
          var rp = item.content[rpi];
          if (rp && typeof rp.text === "string") parts.push(rp.text);
        }
        reasoningText = parts.join("\n");
      }
      if (reasoningText) {
        var thinkBlockId = state.thinkingBlocks[item.id];
        var prevThinkLen = state.thinkingLengths[item.id] || 0;
        if (reasoningText.length > prevThinkLen) {
          events.push({
            yokeType: "thinking_delta",
            blockId: thinkBlockId,
            text: reasoningText.substring(prevThinkLen),
          });
          state.thinkingLengths[item.id] = reasoningText.length;
        }
      }
      if (evtPhase === "completed") {
        events.push({ yokeType: "thinking_stop", blockId: state.thinkingBlocks[item.id] });
      }
      return events;
    }

    // Image generation. Codex emits the generated PNG as base64 in `result`;
    // the message processor persists it before anything reaches the browser.
    if (item.type === "imageGeneration" || item.type === "image_generation") {
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        var imageBlockId = state.toolBlocks[item.id];
        events.push({
          yokeType: "tool_start",
          blockId: imageBlockId,
          toolId: item.id,
          toolName: "ImageGen",
        });
        events.push({
          yokeType: "tool_executing",
          blockId: imageBlockId,
          toolId: item.id,
          toolName: "ImageGen",
          input: { prompt: item.revisedPrompt || "" },
        });
      }
      if (evtPhase === "completed") {
        events.push({
          yokeType: "generated_image",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          data: item.result || "",
          mediaType: item.mediaType || "image/png",
          prompt: item.revisedPrompt || "",
          savedPath: item.savedPath || null,
          transparentBackground: item.transparentBackground == null ? null : !!item.transparentBackground,
          isError: item.status === "failed",
          status: item.status || "completed",
        });
      }
      return events;
    }

    // Command execution (bash/shell)
    if (item.type === "commandExecution" || item.type === "command_execution") {
      var commandText = item.command || state.commandInputs[item.id] || "";
      if (commandText) state.commandInputs[item.id] = commandText;
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        var toolBlockId = state.toolBlocks[item.id];
        events.push({
          yokeType: "tool_start",
          blockId: toolBlockId,
          toolId: item.id,
          toolName: "Bash",
        });
        events.push({
          yokeType: "tool_executing",
          blockId: toolBlockId,
          toolId: item.id,
          toolName: "Bash",
          input: { command: commandText },
        });
      }
      if (evtPhase === "completed") {
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: item.aggregated_output || item.output || "",
          isError: item.status === "failed",
        });
      }
      return events;
    }

    // File change
    if (item.type === "fileChange" || item.type === "file_change") {
      var changes = item.changes || [];
      var changeDesc = changes.map(function(c) { return c.kind + " " + c.path; }).join(", ");
      var primaryPath = changes.length === 1 ? (changes[0].path || "") : "";
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        var fcBlockId = state.toolBlocks[item.id];
        events.push({
          yokeType: "tool_start",
          blockId: fcBlockId,
          toolId: item.id,
          toolName: "Edit",
        });
        events.push({
          yokeType: "tool_executing",
          blockId: fcBlockId,
          toolId: item.id,
          toolName: "Edit",
          input: {
            changes: changeDesc,
            file_paths: changes.map(function(c) { return c.path; }).filter(Boolean),
            file_path: primaryPath || undefined,
          },
        });
      }
      if (evtPhase === "completed") {
        var diffText = changes.map(function(c) {
          return c && c.diff ? c.diff : "";
        }).filter(Boolean).join("\n\n");
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: diffText || (item.status === "completed" ? "Changes applied" : "Changes failed"),
          isError: item.status === "failed",
        });
      }
      return events;
    }

    // MCP tool call
    if (item.type === "mcpToolCall" || item.type === "mcp_tool_call") {
      console.log("[yoke/codex] MCP event:", method, "tool=" + (item.tool || "?"), "status=" + (item.status || "?"), "error=" + (item.error ? JSON.stringify(item.error) : "none"));
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        var mcpBlockId = state.toolBlocks[item.id];
        events.push({
          yokeType: "tool_start",
          blockId: mcpBlockId,
          toolId: item.id,
          toolName: item.tool || "mcp_tool",
        });
        events.push({
          yokeType: "tool_executing",
          blockId: mcpBlockId,
          toolId: item.id,
          toolName: item.tool || "mcp_tool",
          input: item.arguments || {},
        });
      }
      if (evtPhase === "completed") {
        var resultText = "";
        if (item.result && item.result.content) {
          resultText = item.result.content.map(function(c) { return c.text || ""; }).join("\n");
        }
        if (item.error) resultText = item.error.message;
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: resultText,
          isError: !!item.error,
        });
      }
      return events;
    }

    // Dynamic tools are supplied by Clay for a specific thread, such as the
    // Driver's pair-session controls.
    if (item.type === "dynamicToolCall" || item.type === "dynamic_tool_call") {
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        var dynamicBlockId = state.toolBlocks[item.id];
        events.push({
          yokeType: "tool_start",
          blockId: dynamicBlockId,
          toolId: item.id,
          toolName: item.tool || "session_tool",
        });
        events.push({
          yokeType: "tool_executing",
          blockId: dynamicBlockId,
          toolId: item.id,
          toolName: item.tool || "session_tool",
          input: item.arguments || {},
        });
      }
      if (evtPhase === "completed") {
        var dynamicText = Array.isArray(item.contentItems) ? item.contentItems.map(function (contentItem) {
          return contentItem && contentItem.text ? contentItem.text : "";
        }).join("\n") : "";
        events.push({
          yokeType: "tool_result",
          toolId: item.id,
          blockId: state.toolBlocks[item.id],
          content: dynamicText,
          isError: item.success === false || item.status === "failed",
        });
      }
      return events;
    }

    // Web search
    if (item.type === "webSearch" || item.type === "web_search") {
      if (!state.toolBlocks[item.id]) {
        state.blockCounter++;
        state.toolBlocks[item.id] = "blk_" + state.blockCounter;
        events.push({
          yokeType: "tool_start",
          blockId: state.toolBlocks[item.id],
          toolId: item.id,
          toolName: "WebSearch",
        });
      }
      return events;
    }

    // Error item
    if (item.type === "error") {
      var ieMsg = item.message || "Unknown error";
      if (isCodexAuthError(ieMsg, item)) {
        events.push({ yokeType: "auth_required", vendor: "codex" });
        return events;
      }
      events.push({
        yokeType: "error",
        text: ieMsg,
      });
      return events;
    }
  }

  // Token usage update - track input tokens for context bar.
  //
  // ThreadTokenUsage carries { lastTurn, total, modelContextWindow }. The
  // context gauge must use the LAST turn, not the running total: each turn's
  // input already contains the whole conversation, so summing turns
  // overstates occupancy (a 5k + 8k thread reads as 13k of an 8k context).
  // `total` is only a fallback for servers that omit lastTurn.
  if (method === "thread/tokenUsage/updated") {
    var tu = params.tokenUsage;
    if (tu) {
      var turnUsage = tu.lastTurn || tu.total;
      if (turnUsage) {
        state.lastInputTokens = (turnUsage.inputTokens || 0) + (turnUsage.cachedInputTokens || 0);
        state.lastCachedTokens = turnUsage.cachedInputTokens || 0;
        state.lastOutputTokens = turnUsage.outputTokens || 0;
      }
      if (tu.modelContextWindow) state.modelContextWindow = tu.modelContextWindow;
    }
    return events;
  }

  var promptSuggestion = extractPromptSuggestion(params);
  if (promptSuggestion) {
    events.push({
      yokeType: "prompt_suggestion",
      suggestion: promptSuggestion,
    });
    return events;
  }

  // Top-level error event. Codex signals "not logged in" via an unauthorized /
  // token-revoked error (not a login-prompt message like Claude), so map it to
  // the neutral auth_required yokeType to drive the login flow.
  if (method === "error" && params && params.error) {
    var cErr = params.error;
    var cErrMsg = cErr.message || "Codex error";
    if (isCodexAuthError(cErrMsg, cErr)) {
      events.push({ yokeType: "auth_required", vendor: "codex" });
      return events;
    }
    events.push({ yokeType: "error", text: cErrMsg });
    return events;
  }

  // Unknown event type - pass through
  console.log("[yoke/codex] UNHANDLED event:", method, JSON.stringify(params).substring(0, 200));
  events.push({
    yokeType: "runtime_specific",
    vendor: "codex",
    eventType: method,
    raw: params,
  });

  return events;
}

function createEventState(model) {
  return {
    blockCounter: 0,
    threadId: null,
    turnStarted: false,
    lastUsage: null,
    lastInputTokens: null,
    lastCachedTokens: null,
    lastOutputTokens: null,
    modelContextWindow: null,
    done: false,
    aborted: false,
    loopStarted: false,
    model: model || DEFAULT_CODEX_MODEL,
    textBlocks: {},
    textLengths: {},
    thinkingBlocks: {},
    thinkingLengths: {},
    toolBlocks: {},
    commandInputs: {},
    planTexts: {},
    backgroundTasks: backgroundTasks.createState(),
  };
}

// --- QueryHandle ---

function createCodexQueryHandle(appServer, queryOpts) {
  var abortController = queryOpts.abortController;
  var promptParts = [queryOpts.systemPrompt, queryOpts.appendSystemPrompt].filter(function (part) { return !!part; });
  var systemPrompt = promptParts.join("\n\n");
  var canUseTool = queryOpts.canUseTool || null;
  var callDynamicTool = queryOpts.callDynamicTool || null;
  var onElicitation = queryOpts.onElicitation || null;
  var onUserInputRequest = queryOpts.onUserInputRequest || null;
  var onFinished = queryOpts.onFinished || null;

  // Check if the query was cancelled (either via handle.abort() or direct signal abort)
  function isCancelled() {
    return state.aborted || (abortController && abortController.signal && abortController.signal.aborted);
  }

  var state = createEventState(queryOpts.model);

  // Internal event buffer for async iterator
  var eventBuffer = [];
  var eventWaiting = null;
  var iteratorDone = false;
  var finishedNotified = false;
  var removeBackgroundTaskReset = null;

  function notifyFinished() {
    if (finishedNotified) return;
    finishedNotified = true;
    if (typeof onFinished === "function") {
      try {
        onFinished();
      } catch (e) {
        console.error("[yoke/codex] onFinished error:", e.message || e);
      }
    }
  }

  function pushEvent(evt) {
    if (iteratorDone) return;
    if (eventWaiting) {
      var resolve = eventWaiting;
      eventWaiting = null;
      resolve({ value: evt, done: false });
    } else {
      eventBuffer.push(evt);
    }
  }

  if (typeof queryOpts.registerBackgroundTaskReset === "function") {
    removeBackgroundTaskReset = queryOpts.registerBackgroundTaskReset(function() {
      backgroundTasks.emitReset(state.backgroundTasks, pushEvent);
    });
  }

  function endIterator() {
    iteratorDone = true;
    if (eventWaiting) {
      var resolve = eventWaiting;
      eventWaiting = null;
      resolve({ value: undefined, done: true });
    }
    if (removeBackgroundTaskReset) {
      removeBackgroundTaskReset();
      removeBackgroundTaskReset = null;
    }
    notifyFinished();
  }

  // Message queue for multi-turn
  var messageQueue = [];
  var messageWaiting = null;
  var messageQueueEnded = false;
  var handlerEntry = null;

  function pushMessageToQueue(msg) {
    if (messageQueueEnded) return false;
    if (messageWaiting) {
      var resolve = messageWaiting;
      messageWaiting = null;
      resolve(msg);
    } else {
      messageQueue.push(msg);
    }
    return true;
  }

  function waitForMessage() {
    if (messageQueue.length > 0) return Promise.resolve(messageQueue.shift());
    if (messageQueueEnded) return Promise.resolve(null);
    return new Promise(function(resolve) { messageWaiting = resolve; });
  }

  // Track whether this turn is still active (waiting for turn/completed or turn/failed)
  var turnResolve = null;

  // --- App-server event handler ---
  function handleServerEvent(msg) {
    var method = msg.method;
    var params = msg.params || {};

    // Ignore events from other threads (app-server is shared across sessions)
    if (params.threadId && state.threadId && params.threadId !== state.threadId) return;

    // After abort, only let turn-ending events through
    if (isCancelled() && method !== "turn/completed" && method !== "turn/failed" && method !== "serverRequest/resolved" && method !== "thread/status/changed") return;

    // --- Approval helper ---
    // canUseTool returns { behavior: "allow"|"deny", updatedInput } or truthy/falsy
    function isApproved(decision) {
      if (!decision) return false;
      if (decision === true) return true;
      if (decision.behavior === "allow") return true;
      return false;
    }

    // Command approval request
    if (method === "item/commandExecution/requestApproval") {
      var cmdParams = msg.params || {};
      if (cmdParams.itemId && cmdParams.command) {
        state.commandInputs[cmdParams.itemId] = cmdParams.command;
      }
      if (canUseTool) {
        canUseTool("Bash", { command: cmdParams.command }, {}).then(function(decision) {
          var approved = isApproved(decision);
          // Response must be wrapped in { decision: ... } object per app-server protocol
          appServer.respond(msg.id, { decision: approved ? "accept" : "decline" });
        }).catch(function(err) {
          console.error("[yoke/codex] canUseTool error:", err.message);
          appServer.respond(msg.id, { decision: "decline" });
        });
      } else {
        appServer.respond(msg.id, { decision: "accept" });
      }
      return;
    }

    // File change approval request
    if (method === "item/fileChange/requestApproval") {
      var fcParams = msg.params || {};
      if (canUseTool) {
        var changeInfo = (fcParams.changes || []).map(function(c) { return c.kind + " " + c.path; }).join(", ");
        canUseTool("Edit", { changes: changeInfo, path: fcParams.path }, {}).then(function(decision) {
          appServer.respond(msg.id, { decision: isApproved(decision) ? "accept" : "decline" });
        }).catch(function(err) {
          console.error("[yoke/codex] canUseTool error:", err.message);
          appServer.respond(msg.id, { decision: "decline" });
        });
      } else {
        appServer.respond(msg.id, { decision: "accept" });
      }
      return;
    }

    // Session-bound tools supplied at thread creation. Codex sends these as a
    // server request and waits for the client to execute and answer it.
    if (method === "item/tool/call") {
      var dynamicParams = msg.params || {};
      if (!callDynamicTool) {
        appServer.respond(msg.id, {
          contentItems: [{ type: "inputText", text: "Session tool handler is unavailable" }],
          success: false,
        });
        return;
      }
      function executeDynamicTool() {
        return Promise.resolve(callDynamicTool(dynamicParams.tool, dynamicParams.arguments || {})).then(function (result) {
          var content = result && Array.isArray(result.content) ? result.content : [];
          var contentItems = content.map(function (item) {
            return { type: "inputText", text: item && item.text ? item.text : JSON.stringify(item) };
          });
          if (contentItems.length === 0) {
            contentItems.push({ type: "inputText", text: typeof result === "string" ? result : JSON.stringify(result) });
          }
          appServer.respond(msg.id, { contentItems: contentItems, success: !(result && result.isError) });
        });
      }
      var permissionToolName = canonicalDynamicPermissionToolName(dynamicParams.tool);
      var permission = canUseTool
        ? Promise.resolve(canUseTool(permissionToolName, dynamicParams.arguments || {}, {
          toolUseID: dynamicParams.callId || String(msg.id),
          signal: abortController ? abortController.signal : null,
        }))
        : Promise.resolve({ behavior: "allow" });
      permission.then(function (decision) {
        if (!isApproved(decision)) {
          appServer.respond(msg.id, {
            contentItems: [{ type: "inputText", text: "Tool use was not approved" }],
            success: false,
          });
          return;
        }
        return executeDynamicTool();
      }).catch(function (err) {
        appServer.respond(msg.id, {
          contentItems: [{ type: "inputText", text: "Error: " + (err.message || String(err)) }],
          success: false,
        });
      });
      return;
    }

    if (method === "item/tool/requestUserInput") {
      if (!onUserInputRequest) {
        appServer.respondError(msg.id, -32002, "This query cannot request structured user input.");
        return;
      }
      codexUserInput.handleNative(appServer, msg, onUserInputRequest, state.threadId, abortController && abortController.signal);
      return;
    }

    // MCP elicitation shares the YOKE user-input lifecycle when available.
    if (method === "mcpServer/elicitation/request") {
      var mcpParams = msg.params || {};
      var mcpMeta = mcpParams._meta || {};
      console.log("[yoke/codex] MCP approval request:", (mcpMeta.tool || "?"), "server=" + (mcpParams.serverName || "?"));
      if (onUserInputRequest) {
        codexUserInput.handleElicitation(appServer, msg, onUserInputRequest, abortController && abortController.signal);
      } else if (onElicitation) {
        var request = {
          serverName: mcpParams.serverName || (mcpMeta.tool || "Tool"),
          message: mcpParams.message || mcpParams.prompt || "",
          mode: mcpParams.url ? "url" : "form",
          url: mcpParams.url || null,
          elicitationId: mcpParams.elicitationId || null,
          requestedSchema: mcpParams.requestedSchema || null,
        };
        if (!request.requestedSchema && Array.isArray(mcpParams.questions) && mcpParams.questions.length > 0) {
          var schema = { type: "object", properties: {}, required: [] };
          for (var qi = 0; qi < mcpParams.questions.length; qi++) {
            var q = mcpParams.questions[qi];
            var qid = q.id || ("question_" + (qi + 1));
            schema.required.push(qid);
            if (Array.isArray(q.options) && q.options.length > 0) {
              schema.properties[qid] = {
                type: "string",
                description: q.question || q.prompt || qid,
                enum: q.options.map(function(opt) { return opt && (opt.value || opt.label) ? (opt.value || opt.label) : ""; }).filter(Boolean),
              };
            } else {
              schema.properties[qid] = {
                type: "string",
                description: q.question || q.prompt || qid,
              };
            }
          }
          request.requestedSchema = schema;
        }
        onElicitation(request, {
          signal: { addEventListener: function() {} },
        }).then(function(result) {
          appServer.respond(msg.id, result || { action: "reject" });
        }).catch(function(err) {
          console.error("[yoke/codex] elicitation_response send failed:", err.message || err);
          appServer.respond(msg.id, { action: "reject" });
        });
      } else if (canUseTool) {
        canUseTool("mcp__" + (mcpParams.serverName || "unknown") + "__" + (mcpMeta.tool || "call"), mcpParams, {}).then(function(decision) {
          appServer.respond(msg.id, { action: isApproved(decision) ? "accept" : "decline" });
        }).catch(function(err) {
          console.error("[yoke/codex] MCP canUseTool error:", err.message);
          appServer.respond(msg.id, { action: "decline" });
        });
      } else {
        appServer.respond(msg.id, { action: "accept" });
      }
      return;
    }

    // Regular events: flatten and push to iterator
    var yokeEvents = flattenEvent(msg, state);
    for (var i = 0; i < yokeEvents.length; i++) {
      pushEvent(yokeEvents[i]);
    }

    if (method === "turn/completed" || method === "turn/failed") {
      backgroundTasks.poll(appServer, state.threadId, state.backgroundTasks, pushEvent).catch(function() {});
    }

    // Resolve turn promise when turn ends
    if (method === "turn/completed" || method === "turn/failed") {
      if (turnResolve) {
        var resolve = turnResolve;
        turnResolve = null;
        resolve();
      }
    }
  }

  // --- Main query loop ---
  async function runQueryLoop(initialMessage) {
    // Prepend system prompt (project instructions from YOKE layer) to first message.
    // initialMessage may be a string (text-only) or an array of content items
    // (e.g. [{ type: "text", text: "..." }, ...] when images/attachments are present).
    // Naive string concatenation on an array coerces it via toString(), producing
    // "[object Object]" inside the prompt, so we must branch on the shape.
    var currentMessage;
    if (!systemPrompt) {
      currentMessage = initialMessage;
    } else if (typeof initialMessage === "string") {
      currentMessage = systemPrompt + "\n\n" + initialMessage;
    } else if (Array.isArray(initialMessage)) {
      // Prepend systemPrompt to the first text item; if none exists, insert one.
      var cloned = initialMessage.slice();
      var injected = false;
      for (var i = 0; i < cloned.length; i++) {
        if (cloned[i] && cloned[i].type === "text") {
          cloned[i] = {
            type: "text",
            text: systemPrompt + "\n\n" + (cloned[i].text || ""),
          };
          injected = true;
          break;
        }
      }
      if (!injected) {
        cloned.unshift({ type: "text", text: systemPrompt });
      }
      currentMessage = cloned;
    } else {
      currentMessage = initialMessage;
    }

    try {
      handlerEntry = appServer.addHandler(handleServerEvent);
      if (queryOpts.resumeSessionId) {
        handlerEntry.threadId = queryOpts.resumeSessionId;
      }

      // Start or resume thread
      var threadParams = {
        model: queryOpts.model || DEFAULT_CODEX_MODEL,
        sandbox: queryOpts.sandboxMode || "workspace-write",
        approvalPolicy: queryOpts.approvalPolicy || "on-request",
        cwd: queryOpts.cwd,
        skipGitRepoCheck: true,
      };
      if (queryOpts.ephemeral === true) threadParams.ephemeral = true;
      if (queryOpts.modelReasoningEffort) {
        threadParams.modelReasoningEffort = queryOpts.modelReasoningEffort;
      }
      if (queryOpts.webSearchMode) {
        threadParams.webSearchMode = queryOpts.webSearchMode;
      }
      if (Array.isArray(queryOpts.dynamicTools) && queryOpts.dynamicTools.length > 0) {
        threadParams.dynamicTools = queryOpts.dynamicTools.map(function (tool) {
          return {
            type: "function",
            name: tool.name,
            description: tool.description || tool.name,
            inputSchema: dynamicInputSchema(tool.inputSchema),
          };
        });
      }

      var threadResult;
      if (queryOpts.resumeSessionId) {
        threadResult = await appServer.send("thread/resume", {
          threadId: queryOpts.resumeSessionId,
          model: threadParams.model,
          sandbox: threadParams.sandbox,
          approvalPolicy: threadParams.approvalPolicy,
          cwd: threadParams.cwd,
        }, 60000);
      } else {
        threadResult = await appServer.send("thread/start", threadParams, 60000);
      }

      if (queryOpts.ephemeral === true
          && (!threadResult || !threadResult.thread || threadResult.thread.ephemeral !== true)) {
        throw new Error("Codex did not confirm an ephemeral one-shot thread.");
      }

      if (threadResult && threadResult.thread) {
        state.threadId = threadResult.thread.id;
        handlerEntry.threadId = state.threadId;
      }
      if (state.threadId) {
        pushEvent({ yokeType: "session_started", sessionId: state.threadId });
      }

      while (!isCancelled()) {
        // Reset per-turn state
        state.turnStarted = false;
        state.textBlocks = {};
        state.textLengths = {};
        state.thinkingBlocks = {};
        state.thinkingLengths = {};
        state.toolBlocks = {};
        state.commandInputs = {};
        state.planTexts = {};

        // Start turn
        var turnPromise = new Promise(function(resolve) { turnResolve = resolve; });

        var input;
        if (typeof currentMessage === "string") {
          input = [{ type: "text", text: currentMessage }];
        } else {
          input = currentMessage;
        }

        // Explicit references use Codex's native skill input item regardless of
        // which vendor owns the SKILL.md file.
        var availableSkills = queryOpts.skipSkills ? [] : skillDiscovery.discoverSkills(queryOpts.cwd);
        var skillItemsToInject = [];
        var injected = {};
        for (var ii = 0; ii < input.length; ii++) {
          if (input[ii].type === "text" && input[ii].text) {
            var referencedSkills = skillDiscovery.findSkillReferences(input[ii].text, availableSkills);
            for (var si = 0; si < referencedSkills.length; si++) {
              if (!injected[referencedSkills[si].name]) {
                injected[referencedSkills[si].name] = true;
                skillItemsToInject.push({ type: "skill", name: referencedSkills[si].name, path: referencedSkills[si].path });
              }
            }
          }
        }
        if (skillItemsToInject.length > 0) {
          console.log("[yoke/codex] injecting shared skills:", skillItemsToInject.map(function(s) { return s.name; }).join(", "));
          input = input.concat(skillItemsToInject);
        }

        await appServer.send("turn/start", {
          threadId: state.threadId,
          input: input,
          model: state.model,
        }, 60000);

        // Wait for turn to complete
        await turnPromise;

        if (isCancelled()) break;

        // Wait for next message (multi-turn)
        var nextMsg = await waitForMessage();
        if (nextMsg === null) break;
        currentMessage = nextMsg;
      }
    } catch (e) {
      // Suppress AbortError when the user stopped the query.
      if (!isCancelled() && e.name !== "AbortError") {
        console.error("[yoke/codex] runQueryLoop error:", e.message || e);
        console.error("[yoke/codex] stack:", e.stack || "(no stack)");
        var loopErrMsg = e.message || String(e);
        pushEvent(isCodexAuthError(loopErrMsg)
          ? { yokeType: "auth_required", vendor: "codex" }
          : { yokeType: "error", text: loopErrMsg });
      }
    } finally {
      if (handlerEntry) {
        appServer.removeHandler(handlerEntry);
        handlerEntry = null;
      }
    }

    state.done = true;
    endIterator();
  }

  var handle = {
    [Symbol.asyncIterator]: function() {
      return {
        next: function() {
          if (eventBuffer.length > 0) {
            return Promise.resolve({ value: eventBuffer.shift(), done: false });
          }
          if (iteratorDone) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(function(resolve) { eventWaiting = resolve; });
        },
      };
    },

    pushMessage: function(text, images) {
      if (iteratorDone || state.done || messageQueueEnded) return false;
      var input;
      if (images && images.length > 0) {
        input = [];
        for (var i = 0; i < images.length; i++) {
          // Codex supports local_image with path, not base64
          // For now, text-only
        }
        input.push({ type: "text", text: text || "" });
      } else {
        input = text || "";
      }

      if (!state.loopStarted) {
        state.loopStarted = true;
        runQueryLoop(input);
        return true;
      } else {
        return pushMessageToQueue(input);
      }
    },

    setModel: function(model) {
      state.model = model || DEFAULT_CODEX_MODEL;
      return Promise.resolve();
    },

    setEffort: function(effort) {
      // Stored for next thread
      return Promise.resolve();
    },

    setToolPolicy: function(policy) {
      // Codex uses approvalPolicy at thread creation
      return Promise.resolve();
    },

    stopTask: function(taskId) {
      // Codex doesn't expose sub-task stopping
      return Promise.resolve();
    },

    getContextUsage: function() {
      if (state.lastInputTokens == null && state.modelContextWindow == null) return Promise.resolve(null);
      return Promise.resolve({
        input_tokens: state.lastInputTokens == null ? null : state.lastInputTokens,
        contextWindow: state.modelContextWindow || null,
      });
    },

    abort: function() {
      console.log("[yoke/codex] handle.abort() called, threadId=" + state.threadId + " already aborted=" + state.aborted);
      state.aborted = true;
      // Send turn/interrupt to stop the server-side turn
      if (state.threadId && appServer.started) {
        appServer.send("turn/interrupt", { threadId: state.threadId }, 5000).catch(function() {});
      }
      // End iterator immediately. sdk-bridge's post-loop code checks
      // session.taskStopRequested and sends the interrupted message + done.
      // This matches Claude's abort pattern.
      if (turnResolve) {
        var resolve = turnResolve;
        turnResolve = null;
        resolve();
      }
      endIterator();
    },

    close: function() {
      messageQueueEnded = true;
      if (messageWaiting) {
        var resolve = messageWaiting;
        messageWaiting = null;
        resolve(null);
      }
      endIterator();
    },

    endInput: function() {
      messageQueueEnded = true;
      if (messageWaiting) {
        var resolve = messageWaiting;
        messageWaiting = null;
        resolve(null);
      }
    },
  };

  // Listen for external abort (sdk-bridge's stopTask calls session.abortController.abort())
  if (abortController && abortController.signal) {
    abortController.signal.addEventListener("abort", function() {
      if (!state.aborted) handle.abort();
    }, { once: true });
  }

  return handle;
}

// --- Adapter factory ---

function createCodexAdapter(opts) {
  var _cwd = (opts && opts.cwd) || process.cwd();
  var _slug = (opts && opts.slug) || "";
  var _defaultInitOpts = Object.assign({}, opts || {});
  var _runtimeLinuxUser = (opts && opts.runtimeLinuxUser) || null;
  var _requiresLinuxUser = !!(opts && opts.osUsers) && !_runtimeLinuxUser;
  var _userRuntimes = Object.create(null);
  var _resolveOsUserInfo = (opts && opts.resolveOsUserInfo) || resolveOsUserInfo;
  var _createAppServer = (opts && opts.createAppServer) || function(serverOpts) {
    return new CodexAppServer(null, serverOpts);
  };
  // Codex models are a fixed list (the app-server doesn't enumerate them), so
  // model listing must not depend on a successful app-server init — otherwise a
  // slow/failed `initialize` leaves the picker empty and the chip shows the
  // previous vendor's model.
  // Kept in sync with what `model/list` reports for the bundled codex build
  // (0.153.4). Models the CLI no longer offers are rejected at turn/start, so
  // listing them would only surface a runtime failure in the model picker.
  var CODEX_MODELS = [
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.2",
  ];
  var _cachedModels = CODEX_MODELS.slice();
  var _appServer = null;
  var _backgroundTaskResetListeners = [];

  function registerBackgroundTaskReset(listener) {
    _backgroundTaskResetListeners.push(listener);
    return function() {
      var index = _backgroundTaskResetListeners.indexOf(listener);
      if (index !== -1) _backgroundTaskResetListeners.splice(index, 1);
    };
  }

  function emitBackgroundTaskReset() {
    var listeners = _backgroundTaskResetListeners.slice();
    for (var i = 0; i < listeners.length; i++) listeners[i]();
  }
  var _initPromise = null;
  var _shutdownPromise = null;
  var _refCount = 0;
  var _lastActiveAt = Date.now();
  var _shuttingDown = false;
  var _activeQueries = [];

  function withoutLinuxUser(callOpts) {
    var cleaned = Object.assign({}, callOpts || {});
    delete cleaned.linuxUser;
    return cleaned;
  }

  function getUserRuntime(linuxUser) {
    if (!linuxUser) return null;
    if (_runtimeLinuxUser) {
      if (_runtimeLinuxUser !== linuxUser) {
        throw new Error("Codex runtime user mismatch: expected " + _runtimeLinuxUser + ", received " + linuxUser);
      }
      return adapter;
    }
    if (!_userRuntimes[linuxUser]) {
      var runtimeOpts = Object.assign({}, _defaultInitOpts, {
        runtimeLinuxUser: linuxUser,
      });
      delete runtimeOpts.linuxUser;
      _userRuntimes[linuxUser] = createCodexAdapter(runtimeOpts);
    }
    return _userRuntimes[linuxUser];
  }

  function shutdownUserRuntimes(method, idleMs) {
    var users = Object.keys(_userRuntimes);
    if (!users.length) return Promise.resolve([]);
    return Promise.all(users.map(function(linuxUser) {
      var runtime = _userRuntimes[linuxUser];
      var result = method === "shutdownIfIdle"
        ? runtime.shutdownIfIdle(idleMs)
        : runtime.shutdown();
      return Promise.resolve(result).then(function(stopped) {
        if (method === "shutdown" || stopped) delete _userRuntimes[linuxUser];
        return stopped;
      });
    }));
  }

  function updateLastActiveAt() {
    _lastActiveAt = Date.now();
  }

  function registerActiveQuery(entry) {
    _activeQueries.push(entry);
  }

  function removeActiveQuery(entry) {
    var next = [];
    for (var i = 0; i < _activeQueries.length; i++) {
      if (_activeQueries[i] !== entry) next.push(_activeQueries[i]);
    }
    _activeQueries = next;
  }

  function decrementRefCount() {
    if (_refCount > 0) {
      _refCount--;
    } else {
      console.error("[yoke/codex] refCount negative, bug!");
      _refCount = 0;
    }
    updateLastActiveAt();
  }

  function buildReadyResponse(skillNames) {
    return {
      models: _cachedModels,
      defaultModel: DEFAULT_CODEX_MODEL,
      skills: skillNames || [],
      slashCommands: skillNames || [],
      fastModeState: null,
      capabilities: {
        effort: true,
        midSessionModelSwitch: true,
        fork: true,
        rollback: true,
        sessionListing: false,
        sessionRename: false,
        thinking: true,
        betas: false,
        rewind: false,
        sessionResume: true,
        promptSuggestions: true,
        elicitation: true,
        fileCheckpointing: false,
        contextCompacting: false,
        skillSharing: true,
        toolPolicy: ["ask", "allow-all"],
      },
    };
  }

  function clearRuntimeState() {
    _appServer = null;
    _initPromise = null;
    _cachedModels = [];
    _refCount = 0;
    _activeQueries = [];
    updateLastActiveAt();
  }

  function waitForRefCount(targetCount, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 5000);
    return new Promise(function(resolve) {
      function tick() {
        if (_refCount <= targetCount) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(tick, 50);
      }
      tick();
    });
  }

  function stopAppServer(deadlineMs) {
    var proc = _appServer && _appServer.proc ? _appServer.proc : null;
    if (!_appServer) return Promise.resolve(true);
    try {
      _appServer.stop();
    } catch (e) {
      console.error("[yoke/codex] App-server stop error:", e.message || e);
    }
    if (!proc) return Promise.resolve(true);
    var remaining = (typeof deadlineMs === "number") ? Math.max(0, deadlineMs - Date.now()) : 5000;
    return waitForProcessExit(proc, remaining).then(function(exited) {
      if (!exited) {
        try {
          proc.kill("SIGKILL");
        } catch (e) {}
      }
      return exited;
    });
  }

  function beginShutdown(force, idleMs) {
    if (_shutdownPromise) return _shutdownPromise;
    if (_shuttingDown) return null;

    _shuttingDown = true;

    _shutdownPromise = (async function() {
      var deadline = Date.now() + 5000;
      var shouldAbort = !!force;

      if (_initPromise) {
        try {
          await Promise.race([
            _initPromise.catch(function() { return null; }),
            waitMs(Math.max(0, deadline - Date.now())),
          ]);
        } catch (e) {}
      }

      if (shouldAbort && _activeQueries.length > 0) {
        var active = _activeQueries.slice();
        for (var i = 0; i < active.length; i++) {
          try {
            if (active[i] && active[i].abort) active[i].abort();
          } catch (e) {}
        }
        await waitForRefCount(0, Math.max(0, deadline - Date.now()));
      }

      if (_appServer) {
        await stopAppServer(deadline);
      }

      clearRuntimeState();
      _shuttingDown = false;
      _shutdownPromise = null;
      return true;
    })().catch(function(err) {
      clearRuntimeState();
      _shuttingDown = false;
      _shutdownPromise = null;
      throw err;
    });

    return _shutdownPromise;
  }

  var adapter = {
    vendor: "codex",
    userInputCapability: { mode: "native", native: true, transport: "item/tool/requestUserInput" },

    init: function(initOpts) {
      var requestedLinuxUser = initOpts && initOpts.linuxUser;
      if (!_runtimeLinuxUser && requestedLinuxUser) {
        return getUserRuntime(requestedLinuxUser).init(withoutLinuxUser(initOpts));
      }
      if (_requiresLinuxUser) {
        return Promise.reject(new Error("Codex requires a mapped Linux user while OS-user isolation is enabled"));
      }
      if (_runtimeLinuxUser && requestedLinuxUser && requestedLinuxUser !== _runtimeLinuxUser) {
        return Promise.reject(new Error("Codex runtime user mismatch"));
      }
      if (_shuttingDown) {
        return Promise.reject(createShutdownError());
      }

      var effectiveInitOpts = Object.assign({}, _defaultInitOpts, initOpts || {});

      // Already initialized - return cached result
      if (_appServer && _appServer.started && _cachedModels.length > 0) {
        return Promise.resolve(buildReadyResponse([]));
      }

      // Deduplicate concurrent init calls
      if (_initPromise) return _initPromise;

      _initPromise = (async function() {
        var serverOpts = { cwd: _cwd, env: effectiveInitOpts.env || null };
        if (_runtimeLinuxUser) {
          serverOpts.osUserInfo = _resolveOsUserInfo(_runtimeLinuxUser);
        }

        // Clay's config defaults go in first so any user-supplied
        // adapterOptions.CODEX.config key of the same name overrides them.
        serverOpts.config = Object.assign({}, CODEX_REASONING_DEFAULTS);

        // Extract adapter options
        if (effectiveInitOpts && effectiveInitOpts.adapterOptions && effectiveInitOpts.adapterOptions.CODEX) {
          var co = effectiveInitOpts.adapterOptions.CODEX;
          if (co.apiKey) serverOpts.env = Object.assign({}, serverOpts.env || {}, { OPENAI_API_KEY: co.apiKey });
          if (co.baseUrl) serverOpts.env = Object.assign({}, serverOpts.env || {}, { OPENAI_BASE_URL: co.baseUrl });
          if (co.config) serverOpts.config = Object.assign(serverOpts.config, co.config);
        }

        // Track 1: Read local MCP server definitions from ~/.clay/mcp.json
        // and inject into Codex config so Codex manages them natively.
        var mcpServerConfig = {};
        try {
          var mcpLocal = require("../../mcp-local");
          var localMcpServers = mcpLocal.readMergedServers();
          var mcpNames = Object.keys(localMcpServers);
          for (var mi = 0; mi < mcpNames.length; mi++) {
            var ms = localMcpServers[mcpNames[mi]];
            if (ms.command) {
              mcpServerConfig[mcpNames[mi]] = { command: ms.command, args: ms.args || [] };
              if (ms.env && Object.keys(ms.env).length > 0) {
                mcpServerConfig[mcpNames[mi]].env = ms.env;
              }
            }
          }
        } catch (e) {
          console.error("[codex] Failed to read local MCP config:", e.message);
        }

        // Track 2: Add clay-tools bridge server for in-app + remote MCP tools.
        var bridgePath = require("path").join(__dirname, "..", "mcp-bridge-server.js");
        var clayPort = effectiveInitOpts.clayPort || process.env.CLAY_PORT || 2633;
        var clayTls = effectiveInitOpts.clayTls || false;
        var clayAuthToken = effectiveInitOpts.clayAuthToken || "";
        var claySlug = effectiveInitOpts.slug || _slug || "";
        try {
          if (require("fs").existsSync(bridgePath)) {
            var bridgeArgs = [bridgePath, "--port", String(clayPort), "--slug", claySlug];
            if (clayTls) bridgeArgs.push("--tls");
            var bridgeEnv = {};
            if (clayAuthToken) bridgeEnv.CLAY_AUTH_TOKEN = clayAuthToken;
            mcpServerConfig["clay-tools"] = {
              command: process.execPath,
              args: bridgeArgs,
              env: Object.keys(bridgeEnv).length > 0 ? bridgeEnv : undefined,
            };
          }
        } catch (e) {
          console.error("[codex] Failed to configure clay-tools bridge:", e.message);
        }

        if (Object.keys(mcpServerConfig).length > 0) {
          serverOpts.config = Object.assign({}, serverOpts.config || {}, {
            mcp_servers: mcpServerConfig,
          });
          console.log("[codex] MCP servers configured:", Object.keys(mcpServerConfig).join(", "));
          try {
            var names = Object.keys(mcpServerConfig);
            for (var di = 0; di < names.length; di++) {
              var sc = mcpServerConfig[names[di]];
              console.log("[codex] MCP server '" + names[di] + "': command=" + sc.command + " args=" + JSON.stringify(sc.args));
            }
          } catch (e) {}
        }

        // Spawn and initialize app-server
        _appServer = _createAppServer(serverOpts);
        await _appServer.start();
        emitBackgroundTaskReset();

        await _appServer.send("initialize", {
          clientInfo: { name: "clay", title: "Clay", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        }, INITIALIZE_TIMEOUT_MS);
        _appServer.notify("initialized", {});

        if (_shuttingDown) {
          await stopAppServer(Date.now() + 1000);
          throw createShutdownError();
        }

        console.log("[codex] App-server initialized, models: " + CODEX_MODELS.join(", "));

        _cachedModels = CODEX_MODELS.slice();

        // Register foreign vendor roots with Codex so automatic skill
        // triggering and skills/list use the same merged inventory.
        var skillNames = [];
        try {
          var roots = skillDiscovery.getSkillRoots(_cwd);
          var extraRootPaths = [];
          for (var ri = 0; ri < roots.length; ri++) {
            if (roots[ri].source !== "codex-user" && path.isAbsolute(roots[ri].path)) extraRootPaths.push(roots[ri].path);
          }
          await _appServer.send("skills/extraRoots/set", { extraRoots: extraRootPaths }, 10000).catch(function(e) {
            console.error("[codex] skills/extraRoots/set failed:", e.message);
          });
          var skillsResult = await _appServer.send("skills/list", {
            cwds: _cwd ? [_cwd] : [],
            forceReload: true,
          }, 10000).catch(function(e) {
            console.error("[codex] skills/list failed:", e.message);
            return null;
          });
          // Response shape: { data: [{ cwd, skills: [{ name, ... }] }] }
          if (skillsResult && skillsResult.data) {
            for (var di = 0; di < skillsResult.data.length; di++) {
              var entry = skillsResult.data[di];
              if (!entry.skills) continue;
              for (var sk = 0; sk < entry.skills.length; sk++) {
                if (entry.skills[sk].name && skillNames.indexOf(entry.skills[sk].name) === -1) {
                  skillNames.push(entry.skills[sk].name);
                }
              }
            }
          }
          // Direct discovery remains the fallback for older Codex app-server
          // versions and keeps the GUI inventory vendor-neutral.
          var sharedSkills = skillDiscovery.discoverSkills(_cwd);
          for (var csn = 0; csn < sharedSkills.length; csn++) {
            if (skillNames.indexOf(sharedSkills[csn].name) === -1) skillNames.push(sharedSkills[csn].name);
          }
          console.log("[codex] Discovered skills:", skillNames.length, "(" + skillNames.slice(0, 5).join(", ") + (skillNames.length > 5 ? "..." : "") + ")");
        } catch (e) {
          console.error("[codex] Failed to discover skills:", e.message);
        }

        if (_shuttingDown) {
          await stopAppServer(Date.now() + 1000);
          throw createShutdownError();
        }

        _initPromise = null;
        updateLastActiveAt();

        return buildReadyResponse(skillNames);
      })();

      return _initPromise;
    },

    supportedModels: function() {
      // Fixed list; return it without requiring a live app-server init.
      return Promise.resolve(CODEX_MODELS.slice());
    },

    createToolServer: function(def) {
      // Codex handles tools internally (file ops, bash, etc.)
      // MCP tools are configured via Codex config, not SDK.
      console.log("[yoke/codex] createToolServer skipped: Codex handles tools internally");
      return null;
    },

    createQuery: async function(queryOpts) {
      var requestedLinuxUser = queryOpts && queryOpts.linuxUser;
      if (!_runtimeLinuxUser && requestedLinuxUser) {
        return getUserRuntime(requestedLinuxUser).createQuery(withoutLinuxUser(queryOpts));
      }
      if (_requiresLinuxUser) {
        throw new Error("Codex requires a mapped Linux user while OS-user isolation is enabled");
      }
      if (_runtimeLinuxUser && requestedLinuxUser && requestedLinuxUser !== _runtimeLinuxUser) {
        throw new Error("Codex runtime user mismatch");
      }
      if (_shuttingDown) {
        throw createShutdownError();
      }

      if (!_appServer || !_appServer.started) {
        await adapter.init(queryOpts || {});
      }

      if (_shuttingDown) {
        throw createShutdownError();
      }

      if (!_appServer || !_appServer.started) {
        throw new Error("[yoke/codex] Adapter not initialized. Call init() first.");
      }

      var model = queryOpts.model || DEFAULT_CODEX_MODEL;
      var ac = queryOpts.abortController || new AbortController();
      var activeEntry = {
        abort: function() {
          try {
            ac.abort();
          } catch (e) {}
        },
      };

      // Map YOKE options to Codex thread options
      var codexOpts = (queryOpts.adapterOptions && queryOpts.adapterOptions.CODEX) || {};

      var handleOpts = {
        model: model,
        cwd: queryOpts.cwd || _cwd,
        systemPrompt: queryOpts.systemPrompt || "",
        appendSystemPrompt: queryOpts.appendSystemPrompt || "",
        dynamicTools: queryOpts.dynamicTools || [],
        callDynamicTool: queryOpts.callDynamicTool || null,
        abortController: ac,
        canUseTool: queryOpts.canUseTool || null,
        onElicitation: queryOpts.userInputMode === "fallback" ? null : (queryOpts.onElicitation || null),
        onUserInputRequest: queryOpts.userInputMode === "fallback" ? null : (queryOpts.onUserInputRequest || null),
        resumeSessionId: queryOpts.resumeSessionId || null,
        registerBackgroundTaskReset: registerBackgroundTaskReset,
        ephemeral: queryOpts.ephemeral === true,
      };

      // Reasoning effort
      if (queryOpts.effort || codexOpts.modelReasoningEffort) {
        handleOpts.modelReasoningEffort = codexOpts.modelReasoningEffort || queryOpts.effort || "medium";
      }

      // Tool policy -> approval mode
      if (queryOpts.toolPolicy === "allow-all") {
        handleOpts.approvalPolicy = "never";
      } else {
        handleOpts.approvalPolicy = codexOpts.approvalPolicy || "on-request";
      }

      // Sandbox mode
      handleOpts.sandboxMode = codexOpts.sandboxMode || "workspace-write";

      // Web search
      if (codexOpts.webSearchMode && codexOpts.webSearchMode !== "disabled") {
        handleOpts.webSearchMode = codexOpts.webSearchMode;
      }

      console.log("[yoke/codex] createQuery: model=" + model + " approval=" + handleOpts.approvalPolicy + " sandbox=" + handleOpts.sandboxMode);

      _refCount++;
      registerActiveQuery(activeEntry);

      var handle;
      try {
        handleOpts.onFinished = function() {
          removeActiveQuery(activeEntry);
          decrementRefCount();
        };
        handle = createCodexQueryHandle(_appServer, handleOpts);
      } catch (e) {
        removeActiveQuery(activeEntry);
        decrementRefCount();
        throw e;
      }

      activeEntry.handle = handle;
      activeEntry.abort = function() {
        try {
          if (handle && typeof handle.abort === "function") {
            handle.abort();
          } else {
            ac.abort();
          }
        } catch (e) {}
      };

      return handle;
    },

    createOneShotQuery: async function(queryOpts) {
      var handle = await adapter.createQuery(Object.assign({}, queryOpts || {}, {
        ephemeral: true,
        resumeSessionId: null,
      }));
      return { handle: handle, backendPersistence: "ephemeral" };
    },

    // --- Title generation ---
    generateTitle: async function(messages, opts) {
      var requestedLinuxUser = opts && opts.linuxUser;
      if (!_runtimeLinuxUser && requestedLinuxUser) {
        return getUserRuntime(requestedLinuxUser).generateTitle(messages, withoutLinuxUser(opts));
      }
      if (_requiresLinuxUser) {
        throw new Error("Codex requires a mapped Linux user while OS-user isolation is enabled");
      }
      var systemPrompt = "You are a title generator. Output only a short title (3-8 words). No quotes, no punctuation at the end, no explanation.";
      var prompt = "Below is a conversation between a user and an AI assistant. Generate a short, descriptive title (3-8 words) that captures the main topic. Reply with ONLY the title, nothing else.\n\n";
      for (var i = 0; i < messages.length; i++) {
        prompt += "User message " + (i + 1) + ": " + messages[i] + "\n";
      }
      var ac = new AbortController();
      var handle = await adapter.createQuery({
        cwd: (opts && opts.cwd) || _cwd,
        env: opts && opts.env,
        systemPrompt: systemPrompt,
        model: "gpt-5.4-mini",
        abortController: ac,
        canUseTool: function() { return Promise.resolve({ behavior: "deny", message: "No tools." }); },
      });
      handle.pushMessage(prompt);
      var title = "";
      var streamed = false;
      try {
        for await (var msg of handle) {
          if (msg.yokeType === "text_delta" && msg.text) {
            streamed = true;
            title += msg.text;
          } else if (msg.yokeType === "message" && msg.messageRole === "assistant" && !streamed && msg.content) {
            var content = msg.content;
            if (Array.isArray(content)) {
              for (var ci = 0; ci < content.length; ci++) {
                if (content[ci].type === "text" && content[ci].text) {
                  title += content[ci].text;
                }
              }
            }
          } else if (msg.yokeType === "result") {
            break;
          }
        }
      } finally {
        handle.close();
      }
      return title.replace(/[\r\n]+/g, " ").replace(/^["'\s]+|["'\s.]+$/g, "").trim();
    },

    // Codex has session persistence via thread IDs
    getSessionInfo: function(sessionId) {
      return Promise.resolve(null);
    },
    listSessions: function() { return Promise.resolve([]); },
    renameSession: function() { return Promise.resolve(); },
    forkSession: function(threadId, opts) {
      var requestedLinuxUser = opts && opts.linuxUser;
      if (!_runtimeLinuxUser && requestedLinuxUser) {
        return getUserRuntime(requestedLinuxUser).forkSession(threadId, withoutLinuxUser(opts));
      }
      if (_requiresLinuxUser) return Promise.reject(new Error("Codex requires a mapped Linux user while OS-user isolation is enabled"));
      if (!_appServer || !_appServer.started) return Promise.resolve(null);
      return _appServer.send("thread/fork", { threadId: threadId }, 30000).then(function(result) {
        var newThreadId = (result && result.thread) ? result.thread.id : null;
        if (!newThreadId) throw new Error("thread/fork did not return a new thread id");
        return { sessionId: newThreadId };
      });
    },
    rollbackThread: function(threadId, numTurns, opts) {
      var requestedLinuxUser = opts && opts.linuxUser;
      if (!_runtimeLinuxUser && requestedLinuxUser) {
        return getUserRuntime(requestedLinuxUser).rollbackThread(threadId, numTurns, withoutLinuxUser(opts));
      }
      if (_requiresLinuxUser) return Promise.reject(new Error("Codex requires a mapped Linux user while OS-user isolation is enabled"));
      if (!_appServer || !_appServer.started) return Promise.resolve(null);
      return _appServer.send("thread/rollback", { threadId: threadId, numTurns: numTurns }, 30000);
    },

    // Shutdown the app-server process
    shutdown: function() {
      return Promise.all([
        beginShutdown(true),
        shutdownUserRuntimes("shutdown"),
      ]).then(function() { return true; });
    },

    // A device login writes credentials for one OS identity. Refresh only
    // that identity in OS-isolated deployments; single-user projects restart
    // their sole app-server.
    refreshAuthIdentity: function(linuxUser) {
      if (!_runtimeLinuxUser && linuxUser) {
        var userRuntime = _userRuntimes[linuxUser];
        if (!userRuntime) return Promise.resolve(false);
        return userRuntime.shutdown().then(function() {
          delete _userRuntimes[linuxUser];
          return true;
        });
      }
      if (_runtimeLinuxUser && linuxUser !== _runtimeLinuxUser) return Promise.resolve(false);
      if (_requiresLinuxUser) return Promise.resolve(false);
      return adapter.shutdown();
    },

    shutdownIfIdle: function(idleMs) {
      if (!_runtimeLinuxUser && Object.keys(_userRuntimes).length > 0) {
        return shutdownUserRuntimes("shutdownIfIdle", idleMs).then(function(results) {
          return results.some(function(stopped) { return !!stopped; });
        });
      }
      if (_shuttingDown || _shutdownPromise) return Promise.resolve(false);
      if (_initPromise) return Promise.resolve(false);
      if (!_appServer) return Promise.resolve(false);
      if (_refCount > 0) return Promise.resolve(false);
      if (Date.now() - _lastActiveAt < (idleMs || 0)) return Promise.resolve(false);
      return beginShutdown(false).then(function() {
        console.log("[yoke/codex] Reclaimed idle adapter for project " + (_slug || _cwd));
        return true;
      });
    },
  };

  return adapter;
}

module.exports = {
  createCodexAdapter: createCodexAdapter,
  contractTestKit: {
    canonicalDynamicPermissionToolName: canonicalDynamicPermissionToolName,
    createEventState: createEventState,
    createQueryHandle: createCodexQueryHandle,
    normalizeEvent: flattenEvent,
  },
};
