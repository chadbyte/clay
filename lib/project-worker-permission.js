// Split Worker permission routing.
//
// A visible Split Worker runs work the human delegated to its Driver, not to
// itself. So an ordinary provider permission prompt raised inside the Worker is
// answered by its exact paired Driver through the same MCP tool coordination
// the pair already uses, instead of being presented in the Worker pane as if
// the human had asked for that tool call directly.
//
// Boundaries this module does NOT cross:
//
//   - It sits BELOW every existing auto-decision in handleCanUseTool. Skip
//     permissions (bypassPermissions), the read-only/safe-bash whitelist,
//     session allowedTools, Ralph loop denials and the debate tool policy all
//     resolve before routing is even considered, so enabling skip permissions
//     on the Worker passes questions through the established bypass and never
//     waits on the Driver. There is no second toggle.
//   - USER_INPUT_TOOLS still go to the human, because they are not permission
//     approvals at all. AskUserQuestion is a question addressed to the person;
//     answering it is content, not authorization. Note that Clay already
//     exempts it from bypassPermissions for the same reason.
//   - Everything else, including the plan-mode tools, is a permission approval
//     and goes to the Driver. A Driver owns the Worker's execution mode within
//     the scope the user delegated, so deciding EnterPlanMode/ExitPlanMode for
//     it is in scope. See the note on plan-mode decision metadata below.
//   - An approval answers exactly one request. It never writes
//     session.allowedTools and never changes a permission mode, so it cannot
//     pre-authorize the Worker's next call.
//
// Plan-mode decision metadata: the human plan card can answer ExitPlanMode
// with "allow_accept_edits" or "allow_clear_context", which flip
// sm.currentPermissionMode / start a fresh session. Those are *decision
// strings* carried on the permission_response WebSocket message and are
// interpreted only in project-sessions.js — they are not tool input, and they
// are structurally unreachable from here because the router resolves the
// provider callback directly and never travels that path. A Driver's approval
// is therefore exactly the plain "allow" the card's own "Manually approve"
// button sends: the plan is accepted, the provider leaves plan mode, and no
// session-global state changes.
//
// Identity is always re-derived from the live pair record, never from the
// caller's arguments: a response must come from the exact Driver of the exact
// group that still pairs the exact Worker the request came from, owned by the
// same user. Anything else is refused and the request stays pending.

var crypto = require("crypto");
var splitRoles = require("./session-split-group-roles");

// Tools that collect input from the person rather than authorize an action.
// These are not permission approvals, so they are never routed to a Driver;
// a Worker asking the user a question still asks the user.
var USER_INPUT_TOOLS = ["AskUserQuestion"];

var DECISION_TIMEOUT_MS = 5 * 60 * 1000;
var LIVENESS_INTERVAL_MS = 2000;
var MAX_INPUT_PREVIEW_CHARS = 2000;

function isUserInputTool(toolName) {
  return USER_INPUT_TOOLS.indexOf(toolName) !== -1;
}

function previewInput(input) {
  var text;
  try {
    text = JSON.stringify(input === undefined ? null : input);
  } catch (e) {
    return "(tool input could not be serialized)";
  }
  if (typeof text !== "string") return "(no tool input)";
  if (text.length > MAX_INPUT_PREVIEW_CHARS) text = text.slice(0, MAX_INPUT_PREVIEW_CHARS) + "…(truncated)";
  return text;
}

function attachWorkerPermission(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;
  var resumeDriver = ctx.resumeDriverWithMessage;
  var requestDetach = ctx.requestDetach || function () { return false; };

  // requestId -> record. The only place a routed request lives.
  var pending = Object.create(null);

  function toolResult(value) {
    return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
  }

  function toolError(message) {
    return Promise.resolve({
      content: [{ type: "text", text: "Error: " + message }],
      isError: true,
    });
  }

  // The live pair as the store sees it right now. Returns null unless this
  // session is the configured Worker of a pair whose Driver still exists and
  // belongs to the same owner.
  function resolveWorkerPair(session) {
    if (!session || !store) return null;
    // Exact live object identity, before the group is consulted. A localId is
    // reusable and a session object can be replaced by a rehydrated or forged
    // one carrying the same id, so identity by id alone would let a stale
    // object inherit the Driver's permission mode, count as Driver-operated,
    // or open a routed request against the wrong object. Every caller of this
    // function — routing, isDriverOperated, inheritedPermissionMode, and so the
    // human-send refusal — is protected by this one check.
    if (sm.sessions.get(session.localId) !== session) return null;
    var group = store.groupForMember(session.localId);
    if (!group || !group.pair) return null;
    var roles = splitRoles.resolveLiveRoles(sm, group);
    if (!roles || roles.workers.indexOf(session) === -1) return null;
    return { group: group, driver: roles.driver };
  }

  // Is the record's pair still exactly the pair it was created for?
  function pairStillExact(record) {
    var group = store ? store.groupForMember(record.workerId) : null;
    if (!group || group.id !== record.groupId || !group.pair) return false;
    var roles = splitRoles.resolveLiveRoles(sm, group);
    if (!roles || roles.driver.localId !== record.driverId) return false;
    if (roles.workers.indexOf(record.workerRef) === -1 || record.workerRef.localId !== record.workerId) return false;
    var driver = sm.sessions.get(record.driverId);
    var worker = sm.sessions.get(record.workerId);
    if (!driver || !worker || driver.destroying || worker.destroying) return false;
    // The exact objects the request was opened against. If either side has
    // been replaced in the manager — a restart, a rehydration, an impostor
    // reusing the id — this is no longer the same pair, so the request fails
    // closed rather than resolving against a different session.
    if (driver !== record.driverRef || worker !== record.workerRef) return false;
    if ((driver.ownerId || null) !== record.ownerId) return false;
    if ((worker.ownerId || null) !== record.ownerId) return false;
    return true;
  }

  function clearRecord(record) {
    if (record.timer) {
      clearInterval(record.timer);
      record.timer = null;
    }
    delete pending[record.requestId];
  }

  // Every exit path funnels through here, so a request is answered exactly
  // once and its timer never outlives it.
  function settle(record, outcome) {
    if (record.settled) return false;
    record.settled = true;
    clearRecord(record);
    if (outcome.behavior === "allow") {
      record.resolve({ behavior: "allow", updatedInput: record.toolInput });
    } else {
      record.resolve({ behavior: "deny", message: outcome.message || "Denied by the paired Driver" });
    }
    if (typeof ctx.onProcessingChanged === "function") ctx.onProcessingChanged();
    return true;
  }

  // Fail closed. Used for timeout, pair loss, Driver loss and Worker stop:
  // a request never leaks to another session and never hangs forever.
  //
  // No frame is emitted to either pane. Model coordination is complete without
  // one: the Worker learns the outcome because its own tool call resolves, and
  // a Driver that answers a request that has since died gets "already_resolved"
  // from the tool. Adding a frame would mean adding client rendering, which
  // this change deliberately does not do.
  function failClosed(record, reason) {
    settle(record, { behavior: "deny", message: reason });
  }

  function startLiveness(record) {
    record.timer = setInterval(function () {
      if (record.settled) {
        clearRecord(record);
        return;
      }
      if (!pairStillExact(record)) {
        failClosed(record, "The Driver/Split Worker pair changed before the request was answered.");
        return;
      }
      if (Date.now() >= record.deadline) {
        failClosed(record, "The paired Driver did not answer this permission request in time.");
      }
    }, LIVENESS_INTERVAL_MS);
    if (record.timer && typeof record.timer.unref === "function") record.timer.unref();
  }

  function driverRequestText(record) {
    return "[Split Worker permission request]\n" +
      "The Split Worker you delegated to needs approval for one tool call before it can continue. " +
      "You are deciding on behalf of the task the user already authorized: approve it only if it is " +
      "within that scope, and deny it otherwise.\n\n" +
      "Request id: " + record.requestId + "\n" +
      "Tool: " + record.toolName + "\n" +
      "Tool input: " + previewInput(record.toolInput) + "\n" +
      (record.decisionReason ? "Provider note: " + record.decisionReason + "\n" : "") +
      "\nAnswer with respond_to_worker_permission using exactly this request id. " +
      "This decision covers only this one call; the Split Worker will ask again for the next one.";
  }

  // Called from handleCanUseTool after every existing auto-decision. Returns a
  // Promise when the request was routed to a Driver, or null to let the normal
  // human-facing flow run.
  function routeIfWorker(session, req) {
    if (!req) return null;
    if (isUserInputTool(req.toolName)) return null;
    var resolved = resolveWorkerPair(session);
    if (!resolved) return null;

    var record = {
      requestId: "wperm_" + crypto.randomUUID(),
      groupId: resolved.group.id,
      driverId: resolved.driver.localId,
      workerId: session.localId,
      driverRef: resolved.driver,
      workerRef: session,
      ownerId: session.ownerId || null,
      toolName: req.toolName,
      toolInput: req.input,
      toolUseId: req.toolUseId || null,
      decisionReason: req.decisionReason || "",
      resolve: null,
      settled: false,
      createdAt: Date.now(),
      deadline: Date.now() + DECISION_TIMEOUT_MS,
      timer: null,
    };
    // The executor runs synchronously, so `resolve` is in place before the
    // record is registered and before anything can settle it.
    var decided = new Promise(function (resolve) { record.resolve = resolve; });
    pending[record.requestId] = record;

    // The Worker being stopped, or its query aborting, cancels the request
    // rather than leaving the Driver holding a decision nobody needs.
    if (req.signal && typeof req.signal.addEventListener === "function") {
      req.signal.addEventListener("abort", function () {
        var live = pending[record.requestId];
        if (live) failClosed(live, "The Split Worker stopped before the request was answered.");
      });
    }

    // A Driver blocked inside a waiting send_to_partner cannot call a tool, so
    // its wait is detached first. The delegation then completes through the
    // existing detached push-back path.
    requestDetach(session);

    startLiveness(record);

    var delivered = false;
    try {
      delivered = resumeDriver(resolved.driver, driverRequestText(record), {
        workerPermissionRequest: true,
        workerSessionId: record.workerId,
        requestId: record.requestId,
      });
    } catch (e) {
      delivered = false;
    }
    if (!delivered) {
      failClosed(record, "The paired Driver could not be reached to decide this request.");
    }

    return decided;
  }

  // The Driver-side MCP tool. Every field is re-validated against the live
  // pair; nothing about identity is taken from `args`.
  function handleDriverResponse(args, caller) {
    if (!caller) return toolError("respond_to_worker_permission requires a session-bound tool server");
    var requestId = args && typeof args.requestId === "string" ? args.requestId.trim() : "";
    if (!requestId) return toolError("requestId is required");

    var record = pending[requestId];
    if (!record || record.settled) {
      // Idempotent: a duplicate or late answer is reported, never re-applied.
      return toolResult({
        status: "already_resolved",
        requestId: requestId,
        detail: "This permission request is no longer pending. It was answered, cancelled, or it expired.",
      });
    }

    // Exact Driver only. A different session in the same group, another
    // group's Driver, or the Worker itself cannot answer.
    if (record.driverId !== caller.localId) {
      return toolError("only the paired Driver of that Split Worker can answer this request");
    }
    // And the exact live object. A tool handler captured by a query outlives
    // the session it bound to, so a stale Driver object — or an impostor with
    // the same localId — cannot answer through it. This refusal leaves the
    // request pending on purpose: a genuinely live Driver may still answer it.
    // The separate case where the live entry is no longer the object the
    // request was opened against is a pair change, and pairStillExact below
    // both detects it (via driverRef) and fails the request closed.
    if (sm.sessions.get(caller.localId) !== caller) {
      return toolError("this Driver session is no longer live; the request is bound to an exact session");
    }
    if ((caller.ownerId || null) !== record.ownerId) {
      return toolError("permission request access denied");
    }
    if (!pairStillExact(record)) {
      failClosed(record, "The Driver/Split Worker pair changed before the request was answered.");
      return toolError("the Driver/Split Worker pair changed; this request is no longer valid");
    }

    var decision = args && typeof args.decision === "string" ? args.decision.trim().toLowerCase() : "";
    if (decision !== "allow" && decision !== "deny") {
      return toolError('decision must be exactly "allow" or "deny"');
    }
    var reason = args && typeof args.reason === "string" ? args.reason.trim().slice(0, 500) : "";

    if (decision === "allow") {
      settle(record, { behavior: "allow" });
    } else {
      settle(record, {
        behavior: "deny",
        message: reason
          ? "Denied by the paired Driver: " + reason
          : "Denied by the paired Driver.",
      });
    }

    return toolResult({
      status: "resolved",
      requestId: record.requestId,
      decision: decision,
      workerSessionId: record.workerId,
      detail: "This decision covered only that one tool call.",
    });
  }

  // Exposed to the Driver only, and only while it really is a pair Driver.
  function getToolDefs(boundSession, options) {
    if (!boundSession || !store) return [];
    var group = store.groupForMember(boundSession.localId);
    var dormantDriver = !!(options && options.dormantDriver);
    if (!dormantDriver && (!group || !group.pair || group.pair.driverId !== boundSession.localId)) return [];
    return [{
      name: "respond_to_worker_permission",
      description: "Approve or deny one tool-permission request raised by your paired Split Worker. " +
        "Clay delivers each request to you with its request id. Decide within the task the user already " +
        "authorized: approve only calls that belong to that scope, and deny anything outside it. " +
        "A decision covers exactly one tool call and grants the Split Worker nothing further.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: { type: "string", description: "The exact request id Clay delivered." },
          decision: { type: "string", description: 'Either "allow" or "deny".' },
          reason: { type: "string", description: "Optional short explanation, shown to the Split Worker on a denial." },
        },
        required: ["requestId", "decision"],
        additionalProperties: false,
      },
      handler: function (toolArgs) { return handleDriverResponse(toolArgs || {}, boundSession); },
    }];
  }

  // Cancel everything tied to a session, in either role. Used when a session
  // is torn down or a pair is dissolved.
  function cancelForSession(session, reason) {
    if (!session) return 0;
    var ids = Object.keys(pending);
    var cancelled = 0;
    for (var i = 0; i < ids.length; i++) {
      var record = pending[ids[i]];
      if (!record) continue;
      if (record.workerId !== session.localId && record.driverId !== session.localId) continue;
      failClosed(record, reason || "The Driver/Split Worker pair is no longer available.");
      cancelled++;
    }
    return cancelled;
  }

  // --- Driver-operated Worker surface -------------------------------------

  // Is this session the configured Split Worker of a live pair? The single
  // server-side answer for "is this session Driver-operated", used by the
  // permission-mode inheritance below and by the human-send refusal. An
  // ad-hoc side-by-side split has no pair roles and is never Driver-operated.
  function driverOperatedPair(session) {
    var resolved = resolveWorkerPair(session);
    if (!resolved) return null;
    return { group: resolved.group, driver: resolved.driver };
  }

  function isDriverOperated(session) {
    return !!driverOperatedPair(session);
  }

  // The permission mode a configured Worker runs under: its Driver's, resolved
  // fresh on every call. Never a copy taken at creation, and never written back
  // onto the Worker, so flipping skip permissions on the Driver takes effect on
  // the Worker's very next permission decision — including mid-turn — and
  // flipping it back restores routing just as immediately.
  //
  // Returns null when the session is not a configured Worker, so the caller
  // keeps its own ordinary resolution.
  function inheritedPermissionMode(session) {
    var resolved = driverOperatedPair(session);
    if (!resolved) return null;
    var driver = resolved.driver;
    return driver.permissionMode || sm.currentPermissionMode || "default";
  }

  function pendingCountFor(session) {
    if (!session) return 0;
    var ids = Object.keys(pending);
    var count = 0;
    for (var i = 0; i < ids.length; i++) {
      var record = pending[ids[i]];
      if (record && !record.settled && record.workerId === session.localId) count++;
    }
    return count;
  }

  return {
    USER_INPUT_TOOLS: USER_INPUT_TOOLS,
    cancelForSession: cancelForSession,
    getToolDefs: getToolDefs,
    inheritedPermissionMode: inheritedPermissionMode,
    isDriverOperated: isDriverOperated,
    handleDriverResponse: handleDriverResponse,
    pendingCountFor: pendingCountFor,
    routeIfWorker: routeIfWorker,
  };
}

module.exports = {
  attachWorkerPermission: attachWorkerPermission,
  USER_INPUT_TOOLS: USER_INPUT_TOOLS,
  isUserInputTool: isUserInputTool,
};
