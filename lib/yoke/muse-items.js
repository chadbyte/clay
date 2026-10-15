function itemInput(item) {
  if (!item || typeof item.args !== "string") return {};
  try {
    return JSON.parse(item.args);
  } catch (e) {
    return {
      rawArgs: item.args
    };
  }
}

function toolName(item) {
  var name = String(item && (item.tool || item.toolName) || "Tool").toLowerCase();
  if (name.indexOf("shell") !== -1 || name.indexOf("command") !== -1) return "Bash";
  if (name.indexOf("read") !== -1) return "Read";
  if (name.indexOf("write") !== -1 || name.indexOf("create") !== -1) return "Write";
  if (name.indexOf("edit") !== -1 || name.indexOf("delete") !== -1) return "Edit";
  if (name.indexOf("search") !== -1 || name.indexOf("grep") !== -1) return "Grep";
  return item && (item.tool || item.toolName) || "Tool";
}

function createRenderer(state, push) {
  var streamedItems = {};
  var openBlocks = {};
  var notices = {};
  function closeBlocks(turnId) {
    Object.keys(openBlocks).forEach(function(id) {
      if (turnId && openBlocks[id] !== turnId) return;
      push({
        yokeType: "block_stop",
        blockId: id
      });
      delete openBlocks[id];
    });
    if (!turnId) { state.thinkingBlocks = {}; state.textBlocks = {}; state.toolBlocks = {}; }
  }
  function emitNotice(item, id) {
    if (item.status === "inProgress" || item.kind === "userMessage") return;
    var failed = ["failed", "rejected", "timedOut"].includes(item.status)
      || (item.kind === "compaction" && item.outcome === "failed")
      || (item.kind === "hookRun" && ["failed", "blocked", "timedOut"].includes(item.runStatus))
      || (item.kind === "subagent" && item.result && item.result.errorKind);
    var text = "";
    if (failed) {
      var labels = { reminderChild: "A background task", hookRun: "A hook", compaction: "Context maintenance", sideChat: "A side conversation", subagent: "A task", workflow: "A workflow", userShell: "A command", webSearch: "A search" };
      var label = labels[item.kind] || "A Muse operation";
      // Unknown kinds have no established human-facing fields. Do not dump them.
      var detail = labels[item.kind] ? (item.failureReason || item.reason || item.message || "") : "";
      if (item.kind === "subagent" && !detail && item.result) detail = item.result.summary || "";
      text = label + " failed" + (detail ? ": " + detail : ".");
    } else if (item.status === "completed") {
      // Only documented action results belong in chat. Reminder/hook/compaction/
      // side-chat bookkeeping and unknown protocol fallback text stay silent.
      if (item.kind === "subagent" && item.result) text = item.result.text || item.result.summary || "";
      else if (item.kind === "workflow") text = item.finalSummary || item.message || "";
      else if (item.kind === "userShell") text = item.visibleOutput || "";
      else if (item.kind === "webSearch") text = item.fallbackText || "";
    }
    var key = id + (failed ? ":failure" : ":summary");
    if (typeof text !== "string" || !text.trim() || notices[key]) return;
    notices[key] = true;
    push({ yokeType: "informational", level: failed ? "warning" : "info", content: text });
  }
  function emitItem(item) {
    if (!item || state.stopped) return;
    var id = item.itemId || "muse-item";
    if (item.kind === "agentMessage" || item.kind === "reasoning") {
      var previous = state.textBlocks[id] || "";
      var value = item.kind === "reasoning" && Array.isArray(item.summary) ? item.summary.join("\n") : item.text || "";
      var blockId = state.thinkingBlocks[id] || id;
      if (item.kind === "reasoning") state.thinkingBlocks[id] = blockId;
      if (!previous && value) {
        openBlocks[blockId] = item.turnId;
        push({
          yokeType: item.kind === "reasoning" ? "thinking_start" : "text_start",
          blockId: blockId
        });
      }
      if (value.length > previous.length) push({
        yokeType: item.kind === "reasoning" ? "thinking_delta" : "text_delta",
        blockId: blockId,
        text: value.substring(previous.length)
      });
      if (value.length >= previous.length) state.textBlocks[id] = value;
      if (item.status !== "inProgress" && openBlocks[blockId]) {
        push({
          yokeType: "block_stop",
          blockId: blockId
        });
        delete openBlocks[blockId];
      }
      return;
    }
    if (item.kind === "toolCall") {
      if (!state.toolBlocks[id]) {
        state.toolBlocks[id] = true;
        push({
          yokeType: "tool_start",
          blockId: id,
          toolId: id,
          toolName: toolName(item)
        });
        push({
          yokeType: "tool_executing",
          blockId: id,
          toolId: id,
          toolName: toolName(item),
          input: itemInput(item)
        });
      }
      if (item.status && item.status !== "inProgress" && state.toolBlocks[id] !== "completed") {
        state.toolBlocks[id] = "completed";
        push({
          yokeType: "tool_result",
          blockId: id,
          toolId: id,
          content: item.visibleOutput || item.message || item.failureReason || "",
          isError: item.status !== "completed"
        });
      }
      return;
    }
    emitNotice(item, id);
  }
  function renderFrame(frame) {
    var params = frame.params || {};
    var item = params.item;
    var owner = item && item.turnId || streamedItems[params.itemId] && streamedItems[params.itemId].turnId;
    if (!(state.liveTurnIds && state.liveTurnIds.has(owner) || state.activeTurn && owner === state.activeTurn.turnId)) return false;
    if (item) streamedItems[item.itemId] = Object.assign({}, item); else if (frame.method === "item/delta") {
      item = streamedItems[params.itemId];
      if (item) {
        var field = params.field || "text";
        if (field.indexOf("summary.") === 0) {
          var index = Number(field.split(".")[1]);
          item.summary = (item.summary || []).slice();
          item.summary[index] = (item.summary[index] || "") + params.delta;
        } else if (field === "text") item.text = (item.text || "") + params.delta; else if (field === "output") item.visibleOutput = (item.visibleOutput || "") + params.delta;
      }
    }
    if (item) emitItem(item);
    return true;
  }
  return {
    emitItem: emitItem,
    renderFrame: renderFrame,
    closeBlocks: closeBlocks,
    hasItem: function(id) {
      return !!streamedItems[id];
    }
  };
}

module.exports = {
  createRenderer: createRenderer,
  itemInput: itemInput
};
