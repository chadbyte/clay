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
 * Optional query orchestration contract (.queryContract):
 *   toolTransport: "sdk-mcp" | "dynamic" | "stdio-mcp" (absent: unsupported)
 *   catalogLifetime: "query" | "conversation"
 *   externalToolTransport?: "dynamic" for remotely discovered definitions
 *   defaultUserInputMode?: "fallback" | "native" (auto otherwise)
 *   questionGuidance?(): string; provider-specific protocol guidance
 *   permissionModes?: string[]; implemented native modes, e.g. "auto"
 *   mcpPermissionOverrides?: true only for a working handle override setter
 *   interruptionMessage?: string; truthful feedback after Stop
 *   catalogVersion?(session, family): number
 *   recordCatalog?(session, versions): void
 *   staleCatalogReason?: string
 *
 * Conversation catalogs are immutable on resume. The host uses semantic tool
 * families (schedules, questions, browser, issues, knowledge, linear) and their
 * required revisions to request an exact-query recovery bridge. Adapter-owned
 * mapping reads/writes persisted provider fields, including legacy names. A
 * missing reader means unknown catalog; a missing writer never records success.
 * Writers run only after a matching session_started event on the same live
 * session/query generation. Creating a handle alone is not catalog confirmation.
 * SDK transports must actually mount createToolServer output; dynamic transports
 * must dispatch dynamicTools/callDynamicTool and deliver sessionMcpServer on
 * resume or reject startup truthfully. These declarations never authorize tools:
 * owner/foreign checks, target/review authority and live generation checks remain
 * in common services. Stop cancels pending input/effects immediately; uncertain
 * effects must not replay automatically. Provider protocols stay adapter-side.
 * Init-free contracts live beside adapters and are also exposed by the registry
 * for product controls before adapter initialization. Other providers retain
 * their existing declared stdio transport or default to unsupported.
 *
 * Init-free provider services (adapter.providerContract or registry entry):
 *   mapQueryOptions(intent): object. Translates validated common intent to SDK
 *     namespaces; host never builds CLAUDE/CODEX/ACP/KIRO envelopes. Intent
 *     includes settings, thinking, nativePermissionMode/nativeBypass, readOnly,
 *     isolation, resumeAt, instructionSources, betas and start time. readOnly
 *     must dominate bypass, sandbox and search options. Unknown providers have
 *     no extra options; declared invalid/missing implementations must not imply
 *     success. Legacy persisted names remain accepted through provider codecs.
 *   configuration: serializable permission/thinking/approval/sandbox/search
 *     descriptions. These describe supported controls, never authorization.
 *   settings: defaults(), messages(settings), change(message, settings) returns
 *     a validated patch and response; host owns persistence and socket access.
 *   normalizeContext(value): { usedTokens, windowTokens, measurement, source }.
 *     measurement is observed, estimated or unavailable. Zero is a measurement;
 *     unknown is null. Billing totals are not context occupancy. YOKE usage
 *     projects result/account-quota history to the same client contract.
 *   authenticationReply(text), classifyError(text): protocol interpretation.
 *     Host handles authenticationRequired and classified errors, preserving
 *     identity, user-visible failure and explicit resumption requirements.
 *   resolveExecutable(options): path|null; discovery never runs the provider.
 *     Explicit supported overrides win; mapped users cannot inherit daemon
 *     credentials/installations. Errors or missing resolvers mean unavailable.
 *   login command/host metadata: only known validated token-only operations;
 *     OAuth URLs require exact hosts, PKCE, state and a loopback callback.
 *     Host still authorizes the exact owner/terminal and async flow revision.
 *   prepareIsolation, processControl: provider filesystem/PID protocol. Host
 *     authorizes identity and the exact process target before effects; absent
 *     verification refuses termination. No arbitrary shell/API dispatch.
 *   recoveryFactory(ctx): actual begin/enqueue/event/progress/cancel/current/
 *     valid/stopping/dispose implementation. Only the implemented confirmed
 *     termination protocol may retry; never replay uncertain delivery. Bindings
 *     retain the original service for immediate Stop and reject replacement
 *     providers. Unsupported providers receive no synthesized watchdog/retry.
 *   readSessionHistory(home, cwd, sessionId): actual provider fork-history
 *     reader. Local-history forks bypass file reading. Missing/nonfunction
 *     readers refuse; the host must not assume another provider's format.
 *   supportsLegacyGuiResume(session): implements the actual terminal format;
 *     the host retains idle/Stop/identity admission and persistence authority.
 *   notificationHooks, maintenance, provisionUser, credentialDirectories:
 *     bounded provider services; host owns provisioning and cleanup policy.
 *
 * publicInfo() sends only an explicit serializable field allowlist. Executable
 * callbacks/services, OAuth internals and factories are never client metadata.
 * Unknown/unsupported transports normalize to none. Declared SDK MCP transport
 * with requested definitions must have a callable factory and non-null result;
 * errors fail startup before admission. Capability data never grants canonical
 * registry/query-generation authority, owner permissions or human review.
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
