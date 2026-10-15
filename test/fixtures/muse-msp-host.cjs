#!/usr/bin/env node
var readline = require("node:readline");
var fs = require("node:fs");
var mode = process.env.MUSE_FIXTURE_MODE || "complete";
var logFile = process.env.MUSE_FIXTURE_LOG;
var cursor = 0;
var sessionId = "fixture-session";
var activeTurn = null;
var initialized = false;
var pendingApproval = null;
var fixturePrompt = "";
var fixtureAnswer = "hello";
var completedTurns = [];
var skillRequests = 0;
var foregroundTurn = null;
var foregroundStarts = 0;
var queuedAcks = new Map();
function log(value) { if (logFile) fs.appendFileSync(logFile, JSON.stringify(value) + "\n"); }
function send(frame) {
  var wire = Object.assign({ jsonrpc: "2.0" }, frame);
  if (mode.indexOf("foreground-") === 0 || mode === "fork-history" && frame.result && frame.result.session && frame.result.session.sessionId === "forked-session") log(wire);
  process.stdout.write(JSON.stringify(wire) + "\n");
}
function reply(frame, result) { send({ id: frame.id, result: result }); }
function notify(method, params) {
  var defaults = { sessionId: sessionId, viewCursor: String(++cursor) };
  if (method !== "item/delta") defaults.sourceRange = { first: { id: "record-" + cursor, sequence: cursor }, last: { id: "record-" + cursor, sequence: cursor } };
  send({ method: method, params: Object.assign(defaults, params) });
}
function item(id, kind, status, revision, text) {
  return { itemId: id + "-" + activeTurn, turnId: activeTurn, kind: kind, status: status, revision: revision, text: text };
}
function complete(terminal) {
  if (mode === "fork-history" && (!terminal || terminal === "completed")) {
    completedTurns.push({ turnId: activeTurn, prompt: fixturePrompt, answer: "early " + fixtureAnswer });
    fs.writeFileSync(logFile + ".turns.json", JSON.stringify(completedTurns));
  }
  notify("turn/completed", { turnId: activeTurn, terminal: terminal || "completed", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 2, reasoningTokens: 1 }, durationMs: 20, error: mode === "auth" ? { kind: "authRequired", message: "Sign in required" } : mode === "failed" ? { kind: "modelError", message: "Fixture failure" } : null });
}
function approval() {
  pendingApproval = { approvalId: "approval-1", currentRequirementId: { approvalId: "approval-1", sourceIndex: 0 }, itemId: "tool-1", toolCallId: "tool-1", taskId: "tool-1", turnId: activeTurn, toolName: "Bash", rawArgs: '{"command":"pwd"}', judgeEscalated: false, protectedWrite: false,
    sourceRange: { first: { id: "1", sequence: 1 }, last: { id: "1", sequence: 1 } }, subject: { kind: "tool" },
    availableChoices: [{ choiceId: "allow-session", decision: "approvedForSession", scope: "session", label: "Allow session" }, { choiceId: "allow-once", decision: "approved", scope: "once", label: "Allow once" }, { choiceId: "deny-once", decision: "denied", scope: "once", label: "Deny" }],
  };
  if (mode === "foreground-approval") pendingApproval.rawArgs = '{"command":"fixture-mutation"}';
  if (mode === "server-approval" || (mode === "resume-approval" || mode === "resume-inline-approval")) {
    send({ id: 1, method: "approval/request", params: Object.assign({ sessionId: sessionId, viewCursor: String(++cursor) }, pendingApproval) });
  } else notify("approval/requested", pendingApproval);
}
function internalItems(terminal) {
  var kinds = ["reminderChild", "hookRun", "compaction", "sideChat", "futureInternal"];
  kinds.forEach(function(kind) {
    var fields = { fallbackText: kind === "reminderChild" ? "Reminder child session" : "Internal protocol detail", blocking: true };
    var status = terminal ? "completed" : "inProgress";
    var record = Object.assign(item("internal-" + kind, kind, status, terminal ? 2 : 1), fields);
    notify(terminal ? "item/completed" : "item/started", { item: record });
    if (terminal) notify("item/updated", { item: Object.assign({}, record, { revision: 3 }) });
  });
  notify("session/debug", { message: "Raw protocol debug chatter" });
}
function output() {
  if (mode === "usage-context") {
    notify("usage/changed", { observedAtMs: 123456, tier: "fixture", window: { resetsAtMs: 200000, usedPercent: 105, windowDurationMins: 300 }, weekly: { resetsAtMs: 400000, usedPercent: 0 } });
    notify("session/contextUsage", { usedTokens: 15, windowTokens: 100, pressure: "normal" });
  }
  if (mode.indexOf("internal-") === 0) internalItems(false);
  if (mode === "action-output") {
    var actions = [
      { kind: "subagent", objective: "Internal task objective", result: { artifactRefs: [], evidenceRefs: [], summary: "Task finished", text: "Task findings" } },
      { kind: "workflow", message: "Workflow terminal message", finalSummary: "Workflow finished" },
      { kind: "webSearch", fallbackText: "Search found three useful pages" },
    ];
    actions.forEach(function(fields) {
      notify("item/started", { item: Object.assign(item(fields.kind, fields.kind, "inProgress", 1), fields) });
      var record = Object.assign(item(fields.kind, fields.kind, "completed", 2), fields);
      notify("item/completed", { item: record });
      notify("item/updated", { item: Object.assign({}, record, { revision: 3 }) });
    });
  }
  if (mode === "reasoning") {
    notify("item/started", { item: Object.assign(item("reasoning", "reasoning", "inProgress", 1), { summary: [] }) });
    notify("item/delta", { itemId: "reasoning-" + activeTurn, field: "summary.0", delta: "think" });
    notify("item/delta", { itemId: "reasoning-" + activeTurn, field: "summary.1", delta: "more" });
    notify("item/completed", { item: Object.assign(item("reasoning", "reasoning", "completed", 2), { summary: ["think", "more"], text: "private raw reasoning" }) });
  }
  if (mode === "unknown-item") notify("item/completed", { item: Object.assign(item("future", "futureKind", "completed", 1), { fallbackText: "Future item detail" }) });
  notify("item/started", { item: item("answer", "agentMessage", "inProgress", 1, "") });
  notify("item/delta", { itemId: "answer-" + activeTurn, delta: fixtureAnswer.slice(0, 3) });
  setTimeout(function() {
    notify("item/delta", { itemId: "answer-" + activeTurn, delta: fixtureAnswer.slice(3) });
    notify("item/completed", { item: item("answer", "agentMessage", "completed", 2, fixtureAnswer) });
    var tool = Object.assign(item("tool-1", "toolCall", "completed", 2), { tool: "shell", args: '{"command":"pwd"}', visibleOutput: "/workspace" });
    if (["image-artifact", "bad-image-artifact", "pending-image-artifact"].includes(mode)) tool.outputRef = {
      id: "image-output", availability: "available", byteLen: 3, mediaType: "image/png", kind: "tool_output", uri: "untrusted://not-a-file", path: "/never-open-this-path",
    };
    notify("item/completed", { item: tool });
    notify("item/updated", { item: Object.assign({}, tool, { revision: 3 }) });
    if (mode.indexOf("internal-") === 0) internalItems(true);
    if (mode === "internal-failure") {
      [
        { kind: "reminderChild", status: "failed" },
        { kind: "hookRun", status: "rejected", runStatus: "blocked", reason: "A required hook was blocked" },
        { kind: "compaction", status: "completed", outcome: "failed", reason: "Context maintenance failed" },
        { kind: "futureInternal", status: "failed", fallbackText: "Raw unknown error dump" },
      ].forEach(function(fields) {
        var record = Object.assign(item("failure-" + fields.kind, fields.kind, fields.status, 1), fields);
        notify("item/completed", { item: record });
        notify("item/updated", { item: Object.assign({}, record, { revision: 2 }) });
      });
      notify("item/completed", { item: Object.assign(item("failed-tool", "toolCall", "failed", 1), { tool: "shell", failureReason: "Command failed" }) });
      notify("turn/completed", { turnId: activeTurn, terminal: "failed", error: { kind: "modelError", message: "Fixture turn failure" } });
      return;
    }
    complete(mode === "failed" || mode === "auth" ? "failed" : mode === "cancelled" ? "cancelled" : mode === "unknown-terminal" ? "futureTerminal" : "completed");
  }, 30);
}
log({ pid: process.pid, mode: mode });
var reader = readline.createInterface({ input: process.stdin });
reader.on("line", function(line) {
  var frame = JSON.parse(line); log(frame);
  if (!frame.method) return;
  if (frame.method === "initialize") {
    if (mode === "handshake-hang") return;
    if (mode === "bad-handshake") { reply(frame, {}); return; }
    reply(frame, { experimentalApi: false, museHome: "/fixture-home", platformFamily: "unix", platformOs: "macos", serverInfo: { name: "fixture", version: "1" }, schema: { version: 1, fingerprint: "sha256:6de32db08bbbe0deb478d2bfcaba001e9fb490986bc80db3aceb4d996abf7df9" }, sessionDurability: "durable", grantedCapabilities: mode === "no-mcp" ? [] : ["sessionMcp"] });
  } else if (frame.method === "initialized") initialized = true;
  else if (!initialized) throw new Error("traffic before initialized");
  else if (frame.method === "model/list") {
    if (mode === "model-hang") return;
    reply(frame, { models: mode === "empty-models" ? [] : [{ modelId: "wonder-1", displayLabel: "Wonder", providerId: "meta", profileId: null, variants: ["low", "high"], defaultReasoningEffort: "low", isDefault: true }], providerId: "meta", profileId: null, source: "fakeCatalog" });
  } else if (frame.method === "session/start" || frame.method === "session/resume") {
    if (mode === "open-hang") return;
    var result = { session: { sessionId: sessionId, activeTurnId: null, createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", forkedFrom: null, modelId: "wonder-1", providerId: "meta", path: "/fixture-session", status: "idle", turnCount: 0, workspaceRoot: process.cwd() }, viewCursor: String(cursor), pendingRequests: [] };
    if (frame.method === "session/resume") {
      var old = { itemId: "old", kind: "agentMessage", revision: 2, status: "completed", turnId: "old-turn", text: "old answer" };
      result.history = { mode: "inline", items: [old], snapshot: null };
      if ((mode === "resume-approval" || mode === "resume-inline-approval")) {
        activeTurn = "resumed-turn";
        result.history = { mode: "snapshot", items: null, snapshot: { schemaVersion: 1, viewCursor: "1", state: { items: [item("resumed-answer", "agentMessage", "inProgress", 1, "before ")], activeTurn: { turnId: activeTurn, commandId: "resumed-command" }, pendingApprovals: [{ approvalId: "approval-1", viewCursor: "1" }] } } };
        if (mode === "resume-inline-approval") result.history = { mode: "inline", items: [item("resumed-answer", "agentMessage", "inProgress", 1, "before ")], snapshot: null };
        result.pendingRequests = [{ kind: "approval", approvalId: "approval-1", viewCursor: "1" }];
        // Resume frames can precede the response in the same stdout chunk.
        approval();
      }
    }
    if (mode === "early-open") {
      activeTurn = "opening-turn";
      notify("turn/started", { turnId: activeTurn, commandId: activeTurn });
      notify("item/completed", { item: item("opening-item", "agentMessage", "completed", 1, "opening") });
      complete();
    }
    reply(frame, result);
  } else if (frame.method === "turn/start") {
    if (queuedAcks.has(frame.params.commandId)) { reply(frame, queuedAcks.get(frame.params.commandId)); return; }
    activeTurn = frame.params.commandId;
    fixturePrompt = frame.params.input.filter(function(part) { return part.type === "text"; }).map(function(part) { return part.text; }).join("\n");
    fixtureAnswer = mode === "fork-history" ? "Answer " + (completedTurns.length + 1) : "hello";
    if (mode === "foreground-queued" && foregroundStarts > 0) {
      var ack = { commandId: activeTurn, disposition: "queued", turnId: activeTurn, startedNewTurn: false, status: "accepted" };
      queuedAcks.set(activeTurn, ack);
      reply(frame, ack);
      setTimeout(function() {
        notify("turn/started", { turnId: activeTurn, commandId: activeTurn });
        notify("item/completed", { item: Object.assign(item("queued-user", "userMessage", "completed", 1, fixturePrompt), { commandId: activeTurn }) });
        notify("item/completed", { item: item("queued-answer", "agentMessage", "completed", 1, "queued reply") });
        complete();
      }, 20);
      return;
    }
    notify("turn/started", { turnId: activeTurn, commandId: frame.params.commandId });
    notify("item/completed", { item: Object.assign(item("user-" + activeTurn, "userMessage", "completed", 1, "run"), { commandId: frame.params.commandId }) });
    // Text before ack verifies the low-level consumer's early frame buffering.
    notify("item/started", { item: item("early-" + activeTurn, "agentMessage", "inProgress", 1, "") });
    notify("item/delta", { itemId: "early-" + activeTurn + "-" + activeTurn, delta: "early " });
    notify("item/completed", { item: item("early-" + activeTurn, "agentMessage", "completed", 2, "early ") });
    if (mode.indexOf("foreground-") === 0 && foregroundStarts++ === 0) {
      foregroundTurn = activeTurn;
      if (mode === "foreground-early") notify("turn/foregroundCompleted", { turnId: foregroundTurn, blockingAgents: ["reminder-1"] });
      reply(frame, { commandId: activeTurn, disposition: "started", turnId: activeTurn });
      if (mode !== "foreground-early") setTimeout(function() {
        notify("turn/foregroundCompleted", { turnId: foregroundTurn, blockingAgents: ["reminder-1"] });
      }, 20);
      return;
    }
    reply(frame, { commandId: activeTurn, disposition: "started", turnId: activeTurn });
    if (mode === "crash") setTimeout(function() { process.exit(7); }, 10);
    else if (mode === "protocol") setTimeout(function() { process.stdout.write("invalid-json\n"); }, 10);
    else if (mode === "approval" || mode === "server-approval" || mode === "approval-reject" || mode === "pending-approval" || mode === "foreground-approval") approval();
    else if (mode === "user-input" || mode === "pending-input" || mode === "settled-input") {
      notify("userInput/requested", { userInputId: "input-1", itemId: "input-item", toolCallId: "input-tool", toolName: "AskUserQuestion", turnId: activeTurn,
        questions: [{ id: "choice", header: "Choice", question: "Choose a target", options: [{ label: "Alpha" }, { label: "Beta" }], selection: { mode: "single" } }] });
      if (mode === "settled-input") setTimeout(function() {
        notify("userInput/settled", { userInputId: "input-1", outcome: "timedOut", answers: [], clarification: null, decidedAt: null, decidedByCommandId: null, reason: "Timed out" });
        output();
      }, 30);
    }
    else if (mode === "view-gap") notify("view/gap", { after: "1", next: "4" });
    else if (mode !== "turn-hang") output();
  } else if (frame.method === "item/readOutput") {
    if (mode === "pending-image-artifact") return;
    reply(frame, { content: "cG5n", encoding: "base64", mediaType: "image/png", offsetBytes: 0, byteLen: 3, eof: mode !== "bad-image-artifact" });
  } else if (frame.method === "task/list") {
    reply(frame, { tasks: [] });
  } else if (frame.method === "task/stop") {
    reply(frame, { commandId: frame.params.commandId, status: "accepted" });
  } else if (frame.method === "session/read") {
    reply(frame, { session: { sessionId: sessionId }, history: { mode: "inline", items: [], snapshot: null }, pendingRequests: [], viewCursor: String(cursor) });
  } else if (frame.method === "session/list") {
    reply(frame, { sessions: [{ sessionId: sessionId, name: "Fixture", workspaceRoot: process.cwd() }], nextCursor: "page-2" });
  } else if (frame.method === "session/rename") {
    reply(frame, { commandId: frame.params.commandId, status: "accepted" });
  } else if (frame.method === "session/fork") {
    if (mode === "fork-history") {
      var turns = JSON.parse(fs.readFileSync(logFile + ".turns.json", "utf8"));
      var selected = turns.findIndex(function(turn) { return frame.params.cutPoint && turn.turnId === frame.params.cutPoint.lastTurnId; });
      if (selected < 0) { send({ id: frame.id, error: { code: -32030, message: "Unknown completed turn" } }); return; }
      var copiedItems = [];
      turns.slice(0, selected + 1).forEach(function(turn) {
        copiedItems.push({ itemId: "user-" + turn.turnId, kind: "userMessage", status: "completed", revision: 1, turnId: turn.turnId, commandId: turn.turnId, text: turn.prompt });
        copiedItems.push({ itemId: "answer-" + turn.turnId, kind: "agentMessage", status: "completed", revision: 1, turnId: turn.turnId, text: turn.answer });
      });
      reply(frame, { session: { sessionId: "forked-session" }, history: { mode: "inline", items: copiedItems, snapshot: null }, pendingRequests: [], viewCursor: String(cursor) });
      return;
    }
    reply(frame, { session: { sessionId: "forked-session" }, history: { mode: "none" }, pendingRequests: [], viewCursor: String(cursor) });
  } else if (frame.method === "usage/read") {
    reply(frame, mode === "no-usage" ? {} : { usage: { observedAtMs: 123456, tier: "fixture", window: { resetsAtMs: 200000, usedPercent: 105, windowDurationMins: 300 }, weekly: { resetsAtMs: 400000, usedPercent: 0 } } });
  } else if (frame.method === "session/compact") {
    reply(frame, { commandId: frame.params.commandId, status: "accepted" });
  } else if (frame.method === "skill/list") {
    skillRequests++;
    if (mode === "skills-hang") return;
    if (mode === "skills" || mode === "skills-change") {
      var nativeSkills = [{ selector: "plugin:deploy", displayName: "Deploy", description: "Native deploy", source: "plugin" }, { selector: "clay-hidden", displayName: "Hidden", description: "Reserved namespace", source: "project" }];
      if (mode !== "skills-change" || skillRequests === 1) nativeSkills.push({ selector: "review", displayName: "Review", description: "Native review", source: "project" });
      reply(frame, { skills: nativeSkills }); return;
    }
    reply(frame, { skills: [{ selector: "review", displayName: "Review", description: "Review code", source: "project" }] });
  } else if (frame.method === "userInput/answer" || frame.method === "userInput/cancel") {
    reply(frame, { commandId: frame.params.commandId, status: "accepted", userInputId: frame.params.userInputId });
    output();
  } else if (frame.method === "approval/listPending") {
    reply(frame, { approvals: pendingApproval ? [Object.assign({ sessionId: sessionId, viewCursor: "1" }, pendingApproval)] : [], userInputs: [] });
  } else if (frame.method === "approval/decide") {
    pendingApproval = null;
    if (mode === "approval-reject") {
      send({ id: frame.id, error: { code: -32030, message: "Fixture approval refused", data: { kind: "commandRejected" } } }); return;
    }
    reply(frame, { commandId: frame.params.commandId, terminal: true });
    if ((mode === "resume-approval" || mode === "resume-inline-approval")) {
      notify("item/completed", { item: item("resumed-answer", "agentMessage", "completed", 2, "before after") });
      complete();
    } else output();
  } else if (frame.method === "session/setName" && mode.indexOf("foreground-") === 0) {
    reply(frame, { commandId: frame.params.commandId, status: "accepted" });
    if (frame.params.name === "duplicate-foreground") notify("turn/foregroundCompleted", { turnId: foregroundTurn, blockingAgents: ["reminder-1"] });
    else {
      var terminal = frame.params.name === "fail-background" ? "failed" : "completed";
      notify("turn/completed", { turnId: foregroundTurn, terminal: terminal, error: terminal === "failed" ? { kind: "modelError", message: "Background fixture failed" } : null });
      notify("turn/completed", { turnId: foregroundTurn, terminal: terminal });
      notify("turn/foregroundCompleted", { turnId: foregroundTurn, blockingAgents: ["reminder-1"] });
    }
  } else if (frame.method === "turn/cancel") { reply(frame, { commandId: frame.params.commandId, status: "accepted" }); complete("cancelled"); }
  else if (frame.method === "session/setModel" || frame.method === "session/setApprovalMode" || frame.method === "session/setReasoningEffort") reply(frame, { commandId: frame.params.commandId, status: "accepted" });
  else send({ id: frame.id, error: { code: -32601, message: "unsupported fixture method " + frame.method } });
});
reader.on("close", function() { if (mode !== "handshake-hang" && mode !== "open-hang" && mode !== "model-hang") process.exit(0); });
if (/hang$/.test(mode)) setInterval(function() {}, 1000);
