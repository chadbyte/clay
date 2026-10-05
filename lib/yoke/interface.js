// YOKE Interface Definition
// -------------------------
// This file defines the contract that every adapter must implement.
// It does NOT contain runtime logic; it is the authoritative reference
// for Phase 3 and beyond.
//
// Adapter objects must satisfy two shapes:
//   1. Adapter (returned by createAdapter)
//   2. QueryHandle (returned by adapter.createQuery)

var TOOL_POLICIES = ["ask", "allow-all"];
var BACKGROUND_TASK_TYPES = ["shell", "agent", "monitor", "other"];

// Shared budget for the initialize handshake every vendor process manager
// performs. Agents do their cold start before answering it: kiro-cli boots the
// KAS server, MCP subsystem and SQLite first, which measures ~20s, and Codex
// launches its configured MCP servers. The cost is asymmetric, since too short
// a window makes a working agent unusable while too long a one only delays the
// error for an agent that is already broken, so keep it generous.
var INITIALIZE_TIMEOUT_MS = 90000;

/*
 * Optional adapter event contract:
 *   { yokeType: "background_tasks_changed", tasks: [{ task_id, task_type, description }] }
 *
 * Each event replaces the complete live set. An adapter that emits this event
 * must reset it to an empty set when its CLI process restarts. task_type uses
 * BACKGROUND_TASK_TYPES; adapters without a level signal may synthesize one,
 * and adapters that emit nothing simply have no background-task indicator.
 */

/**
 * Validate that an adapter object implements all required methods.
 * Throws if any are missing. Development-time safety net only.
 *
 * Adapter shape:
 *   .vendor           : string          - e.g. "claude", "opencode", "codex"
 *   .init(opts)       : Promise<InitResult>
 *   .supportedModels(): Promise<string[]>
 *   .createToolServer(def): ToolServer (opaque)
 *   .createQuery(opts): QueryHandle
 *
 * Optional one-shot capability:
 *   .createOneShotQuery(opts): Promise<{ handle, backendPersistence }>
 *     backendPersistence is "ephemeral" only when the adapter can verify the
 *     provider does not materialize the backend conversation. Adapters without
 *     this method may only use completeOnce's explicit unknown-persistence path.
 *
 * Optional structured user-input capability:
 *   .userInputCapability: { mode: "native"|"fallback", native: boolean,
 *                           nativeElicitation?: boolean, transport: string }
 *   createQuery({ userInputMode: "auto"|"native"|"fallback",
 *                 onUserInputRequest(request, respond) })
 *     request.presentation is "questions" or "elicitation";
 *     question requests contain 1-3 { id, header, question, multiSelect,
 *     allowOther, secret, options }; options contain zero or 2-6 safe
 *     { label, description } entries. Elicitation requests carry the raw
 *     form in request.diagnostics.elicitation and have no question limit.
 *     respond(answerMap), respond.submitContent(typedMap),
 *     respond.decline(reason) and respond.cancel(reason) settle exactly once.
 *     submitContent preserves typed MCP elicitation forms.
 *     mode governs structured questions only: "native" adapters translate
 *     their provider question protocol, others use createFallbackServer() /
 *     fallbackToolDefs() from yoke/user-input. nativeElicitation marks
 *     adapters that also forward agent-initiated forms on fallback mode.
 *
 * Lightweight utilities:
 *   .generateTitle(messages, opts) : Promise<string> - generate a short session title
 *     messages: string[] - user messages to derive the title from
 *     opts: { cwd }
 *     Returns a short (3-8 word) title string.
 *
 * Additional session management (Claude SDK specific, may vary per adapter):
 *   .getSessionInfo(sessionId, opts): Promise<object|null>
 *   .listSessions(opts)             : Promise<Array>
 *   .renameSession(sessionId, title, opts): Promise
 *   .forkSession(sessionId, opts)   : Promise<object>
 *
 * QueryHandle shape:
 *   [Symbol.asyncIterator]()  - yields SDK events (raw in Phase 3, normalized later)
 *   .pushMessage(text, images) - boolean; false when the handle cannot accept input
 *   .setModel(model)
 *   .setEffort(effort)
 *   .setToolPolicy(policy)    - "ask" | "allow-all"
 *   .stopTask(taskId)
 *   .getContextUsage()        - Promise<object|null>
 *   .endInput()               - stop accepting turns after queued input drains
 *   .abort()
 *   .close()
 */

var ADAPTER_METHODS = [
  "init",
  "supportedModels",
  "createToolServer",
  "createQuery",
];

var QUERY_HANDLE_METHODS = [
  "pushMessage",
  "setModel",
  "setEffort",
  "setToolPolicy",
  "stopTask",
  "getContextUsage",
  "endInput",
  "abort",
  "close",
];

function validateAdapter(adapter) {
  if (!adapter) throw new Error("[YOKE] Adapter is null or undefined");
  if (typeof adapter.vendor !== "string" || !adapter.vendor) {
    throw new Error("[YOKE] Adapter must have a non-empty 'vendor' string property");
  }
  for (var i = 0; i < ADAPTER_METHODS.length; i++) {
    var m = ADAPTER_METHODS[i];
    if (typeof adapter[m] !== "function") {
      throw new Error("[YOKE] Adapter '" + adapter.vendor + "' missing required method: " + m);
    }
  }
}

function validateQueryHandle(handle) {
  if (!handle) throw new Error("[YOKE] QueryHandle is null or undefined");
  if (typeof handle[Symbol.asyncIterator] !== "function") {
    throw new Error("[YOKE] QueryHandle must implement Symbol.asyncIterator");
  }
  for (var i = 0; i < QUERY_HANDLE_METHODS.length; i++) {
    var m = QUERY_HANDLE_METHODS[i];
    if (typeof handle[m] !== "function") {
      throw new Error("[YOKE] QueryHandle missing required method: " + m);
    }
  }
}

module.exports = {
  TOOL_POLICIES: TOOL_POLICIES,
  INITIALIZE_TIMEOUT_MS: INITIALIZE_TIMEOUT_MS,
  BACKGROUND_TASK_TYPES: BACKGROUND_TASK_TYPES,
  ADAPTER_METHODS: ADAPTER_METHODS,
  QUERY_HANDLE_METHODS: QUERY_HANDLE_METHODS,
  validateAdapter: validateAdapter,
  validateQueryHandle: validateQueryHandle,
};
