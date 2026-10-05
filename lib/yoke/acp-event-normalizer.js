// ACP Event Normalizer
// --------------------
// Converts standard session/update payloads to stable YOKE events.

function toolNameForKind(kind, title) {
  switch (kind) {
    case "execute": return "Bash";
    case "read": return "Read";
    case "edit": return "Edit";
    case "delete": return "Edit";
    case "move": return "Edit";
    case "search": return "Grep";
    case "fetch": return "WebFetch";
    case "think": return "Think";
    default: return title || "Tool";
  }
}

function createEventState(opts) {
  opts = opts || {};
  return {
    vendor: opts.vendor || "acp",
    blockCounter: 0,
    textBlockOpen: false,
    textBlockId: null,
    thinkBlockOpen: false,
    thinkBlockId: null,
    toolBlocks: {},
    toolMeta: {},
    toolContent: {},
    lastInputTokens: null,
    contextWindow: opts.contextWindow || null,
    configOptions: [],
  };
}

function extractContent(content) {
  if (!Array.isArray(content)) return "";
  var parts = [];
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (!item) continue;
    if (item.type === "content" && item.content && typeof item.content.text === "string") {
      parts.push(item.content.text);
    } else if (item.type === "diff") {
      parts.push((item.path ? "--- " + item.path + "\n" : "") + (item.newText || ""));
    } else if (typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("\n");
}

function finalToolContent(state, callId, update) {
  if (callId && state.toolContent[callId]) return state.toolContent[callId];
  var direct = extractContent(update.content);
  if (direct) return direct;
  if (typeof update.rawOutput === "string") return update.rawOutput;
  if (update.rawOutput && typeof update.rawOutput.output === "string") return update.rawOutput.output;
  return "";
}

function normalizeStatus(status) {
  if (status === "in_progress" || status === "inProgress") return "in_progress";
  if (status === "completed") return "completed";
  return "pending";
}

function normalizeAcpUpdate(update, state) {
  var events = [];
  if (!update) return events;
  var type = update.sessionUpdate;

  if (type === "agent_message_chunk") {
    var text = update.content && typeof update.content.text === "string" ? update.content.text : "";
    if (!state.textBlockOpen) {
      state.textBlockOpen = true;
      state.textBlockId = "blk_" + (++state.blockCounter);
      events.push({ yokeType: "text_start", blockId: state.textBlockId });
    }
    if (text) events.push({ yokeType: "text_delta", blockId: state.textBlockId, text: text });
    return events;
  }

  if (type === "agent_thought_chunk") {
    var thought = update.content && typeof update.content.text === "string" ? update.content.text : "";
    if (!state.thinkBlockOpen) {
      state.thinkBlockOpen = true;
      state.thinkBlockId = "blk_" + (++state.blockCounter);
      events.push({ yokeType: "thinking_start", blockId: state.thinkBlockId });
    }
    if (thought) events.push({ yokeType: "thinking_delta", blockId: state.thinkBlockId, text: thought });
    return events;
  }

  if (type === "tool_call" || type === "tool_call_update") {
    var callId = update.toolCallId;
    var name = update.name || toolNameForKind(update.kind, update.title);
    if (callId) {
      state.toolMeta[callId] = Object.assign({}, state.toolMeta[callId] || {}, {
        kind: update.kind || (state.toolMeta[callId] && state.toolMeta[callId].kind),
        name: update.name || (state.toolMeta[callId] && state.toolMeta[callId].name),
        title: update.title || (state.toolMeta[callId] && state.toolMeta[callId].title),
        rawInput: update.rawInput || (state.toolMeta[callId] && state.toolMeta[callId].rawInput) || {},
      });
    }
    if (callId && !state.toolBlocks[callId]) {
      state.toolBlocks[callId] = "blk_" + (++state.blockCounter);
      events.push({ yokeType: "tool_start", blockId: state.toolBlocks[callId], toolId: callId, toolName: name });
      events.push({ yokeType: "tool_executing", blockId: state.toolBlocks[callId], toolId: callId, toolName: name, input: update.rawInput || {} });
    }
    var chunk = extractContent(update.content);
    if (callId && chunk) state.toolContent[callId] = (state.toolContent[callId] || "") + chunk;
    if (update.status === "completed" || update.status === "failed") {
      events.push({
        yokeType: "tool_result",
        blockId: state.toolBlocks[callId],
        toolId: callId,
        content: finalToolContent(state, callId, update),
        isError: update.status === "failed",
      });
    }
    return events;
  }

  if (type === "plan") {
    var entries = Array.isArray(update.entries) ? update.entries : [];
    events.push({
      yokeType: "plan_updated",
      title: "Plan",
      explanation: "",
      plan: entries.map(function(entry) {
        return { step: entry.content || "", status: normalizeStatus(entry.status) };
      }),
    });
    return events;
  }

  if (type === "usage_update") {
    if (typeof update.used === "number") state.lastInputTokens = update.used;
    if (typeof update.size === "number") state.contextWindow = update.size;
    return events;
  }

  if (type === "config_option_update") {
    state.configOptions = Array.isArray(update.configOptions) ? update.configOptions : [];
    return events;
  }

  if (type === "available_commands_update") {
    var commands = Array.isArray(update.availableCommands) ? update.availableCommands : [];
    events.push({
      yokeType: "commands_changed",
      commandNames: commands.map(function(command) { return command && command.name; }).filter(Boolean),
    });
    return events;
  }

  events.push({
    yokeType: "runtime_specific",
    vendor: state.vendor,
    eventType: "session/update:" + type,
    raw: update,
  });
  return events;
}

function closeOpenBlocks(state) {
  var events = [];
  if (state.thinkBlockOpen) {
    events.push({ yokeType: "thinking_stop", blockId: state.thinkBlockId });
    state.thinkBlockOpen = false;
  }
  return events;
}

function resetTurnState(state) {
  state.textBlockOpen = false;
  state.textBlockId = null;
  state.thinkBlockOpen = false;
  state.thinkBlockId = null;
  state.toolBlocks = {};
  state.toolMeta = {};
  state.toolContent = {};
}

module.exports = {
  createEventState: createEventState,
  normalizeAcpUpdate: normalizeAcpUpdate,
  closeOpenBlocks: closeOpenBlocks,
  resetTurnState: resetTurnState,
  toolNameForKind: toolNameForKind,
};
