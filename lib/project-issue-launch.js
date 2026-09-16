// Creates one visible Driver session for an exact Issue revision.

var yoke = require("./yoke");
var provenance = require("./session-provenance");
var sessionVisibility = require("./session-visibility");

function attachIssueLaunch(ctx) {
  var requests = new Map();
  var operations = new Map();

  function osUsersEnabled() {
    return typeof ctx.osUsers === "function" ? ctx.osUsers() === true : ctx.osUsers === true;
  }

  function requestFingerprint(args) {
    return JSON.stringify({ ref: args.ref, expectedRevision: args.expectedRevision });
  }

  function trimRequests() {
    if (requests.size <= 200) return;
    for (var pair of requests) {
      if (pair[1].settled) { requests.delete(pair[0]); return; }
    }
  }

  function record(session, event) {
    if (ctx.sm && typeof ctx.sm.sendAndRecord === "function") ctx.sm.sendAndRecord(session, event);
    else {
      session.history = session.history || [];
      session.history.push(event);
      if (ctx.sm && typeof ctx.sm.appendToSessionFile === "function") ctx.sm.appendToSessionFile(session, event);
    }
  }

  function sendStatus(session, status) {
    if (ctx.sm && typeof ctx.sm.sendToSession === "function") ctx.sm.sendToSession(session, { type: "status", status: status });
  }

  function lastLaunchError(session, fromIndex) {
    var history = session.history || [];
    for (var i = history.length - 1; i >= fromIndex; i--) {
      if (history[i] && history[i].type === "error" && history[i].text) return String(history[i].text);
    }
    return "The Driver session could not start its agent runtime.";
  }

  function failLaunch(session, fromIndex, error) {
    var message = error && error.message ? error.message : lastLaunchError(session, fromIndex);
    if (lastLaunchError(session, fromIndex) === "The Driver session could not start its agent runtime.") {
      record(session, { type: "error", text: "Could not start issue work: " + message, issueRef: session.issueOrigin && session.issueOrigin.ref });
    }
    session.isProcessing = false;
    if (typeof ctx.onProcessingChanged === "function") ctx.onProcessingChanged();
    sendStatus(session, "idle");
    var launchError = new Error(message || "The Driver session could not start its agent runtime.");
    launchError.sessionId = session.localId;
    return launchError;
  }

  async function run(ws, actor, actorId, args, bound) {
    var entry = bound.readIssue({ ref: args.ref });
    if (entry.revision !== args.expectedRevision) throw new Error("Issue revision conflict. Reload before starting work.");
    if (entry.status === "resolved" || entry.status === "closed") throw new Error("Reopen this issue before starting work.");
    if ((entry.linkedWorkSessions || []).length >= 40) throw new Error("This issue has reached its work-session limit.");

    var expectedLinuxUser = typeof ctx.getLinuxUserForSession === "function" ? ctx.getLinuxUserForSession({ ownerId: actorId }) : null;
    if (osUsersEnabled() && !expectedLinuxUser) throw new Error("An OS identity is required to start work.");
    var runtime = await ctx.resolveDefaultAi(ws);
    if (ws.readyState !== 1 || ws._clayUser !== actor || actorId !== (ws._clayUser && ws._clayUser.id || null)) {
      throw new Error("The requesting connection changed.");
    }
    if (typeof ctx.canStartWork === "function" && ctx.canStartWork(ws, actor) !== true) throw new Error("Issue work is no longer allowed from this connection.");
    entry = bound.readIssue({ ref: args.ref });
    if (entry.revision !== args.expectedRevision) throw new Error("Issue revision conflict. Reload before starting work.");
    if (entry.status === "resolved" || entry.status === "closed") throw new Error("Reopen this issue before starting work.");
    if (!runtime || !runtime.ready || !ctx.sm || (ctx.sm.installedVendors || []).indexOf(runtime.vendor) < 0) {
      throw new Error(runtime && runtime.error || "Default AI is unavailable.");
    }
    if (yoke.sessionTools.capability(runtime.vendor).kind === "none") throw new Error("The selected provider does not support Issues tools.");
    var liveLinuxUser = typeof ctx.getLinuxUserForSession === "function" ? ctx.getLinuxUserForSession({ ownerId: actorId }) : null;
    if (osUsersEnabled() && liveLinuxUser !== expectedLinuxUser) throw new Error("The OS identity changed while issue work was being prepared.");

    var projectAccess = typeof ctx.getProjectAccess === "function" ? ctx.getProjectAccess() : null;
    var session = ctx.sm.createSessionRaw({ vendor: runtime.vendor, model: runtime.model, effort: runtime.effort || null,
      mode: "gui", ownerId: actor && actor.id || null, sessionVisibility: sessionVisibility.defaultForProject(projectAccess) });
    provenance.ensureOrigin(session);
    if (session.hidden === true || session.delegated === true || provenance.isWorker(session)) {
      ctx.sm.deleteSession(session.localId);
      throw new Error("A visible Driver session is required to start issue work.");
    }
    var linuxUser = typeof ctx.ensureProjectAccessForSession === "function"
      ? ctx.ensureProjectAccessForSession(session) : expectedLinuxUser;
    if (osUsersEnabled() && (!linuxUser || linuxUser !== expectedLinuxUser)) {
      ctx.sm.deleteSession(session.localId);
      throw new Error("The OS identity changed before issue work could start.");
    }
    session.issueOrigin = { ref: entry.ref, revision: args.expectedRevision, requestId: args.requestId, sessionOriginId: session.sessionOriginId };
    try { bound.linkWorkSession(args, session); }
    catch (error) { ctx.sm.deleteSession(session.localId); throw error; }

    session.title = "Issue · " + entry.title;
    session.titleManuallySet = true;
    ctx.sm.saveSessionFile(session);
    var prompt = "Work on project issue " + entry.ref + ". Read it with read_issue, inspect the repository, implement the requested outcome and verify it. Update this same issue as work progresses. Do not commit, publish, or create a PR unless explicitly authorized. If implementation is verified but no commit is authorized, keep it in_progress and record that state. Resolve only with verified commit evidence. Session completion never resolves the issue automatically.\n\nRequested issue:\n" + JSON.stringify({ title: entry.title, summary: entry.summary, body: entry.body });
    ctx.sm.switchSession(session.localId, ws);
    ws._clayActiveSession = session.localId;
    record(session, { type: "user_message", text: prompt, issueRef: entry.ref, issueRevision: args.expectedRevision });
    session.isProcessing = true;
    sendStatus(session, "processing");
    if (typeof ctx.onProcessingChanged === "function") ctx.onProcessingChanged();
    ctx.sm.broadcastSessionList();
    var historyStart = (session.history || []).length;
    var sdk = ctx.getSdk && ctx.getSdk();
    if (!sdk || typeof sdk.startQuery !== "function") throw failLaunch(session, historyStart, new Error("The SDK bridge is not ready."));
    try { await sdk.startQuery(session, prompt, undefined, linuxUser); }
    catch (error) { throw failLaunch(session, historyStart, error); }
    if (ctx.sm.sessions.get(session.localId) !== session || !session.queryInstance) {
      throw failLaunch(session, historyStart, null);
    }
    return { sessionId: session.localId, sessionOriginId: session.sessionOriginId, ref: entry.ref };
  }

  return function startWork(ws, msg, bound) {
    var args = Object.assign({}, msg && msg.args || {}, { requestId: msg && msg.requestId });
    var actor = ws && ws._clayUser || null;
    var actorId = actor && actor.id || null;
    if (!msg || typeof msg.requestId !== "string" || !msg.requestId || msg.requestId.length > 200) {
      return Promise.reject(new Error("A work request identifier is required."));
    }
    if (!bound || typeof args.ref !== "string" || !Number.isInteger(args.expectedRevision)) {
      return Promise.reject(new Error("An exact issue reference and expectedRevision are required."));
    }
    var fingerprint = requestFingerprint(args);
    var requestKey = JSON.stringify([bound.scopeId, actorId, msg.requestId]);
    var prior = requests.get(requestKey);
    if (prior) {
      if (prior.ws !== ws || prior.fingerprint !== fingerprint) return Promise.reject(new Error("Work request identifier was already used with different arguments."));
      return prior.task;
    }
    var operationKey = JSON.stringify([bound.scopeId, actorId, args.ref, args.expectedRevision]);
    var operation = operations.get(operationKey);
    var task = operation ? operation.task : run(ws, actor, actorId, args, bound);
    if (!operation) {
      operations.set(operationKey, { task: task });
      task.then(function () { if (operations.get(operationKey).task === task) operations.delete(operationKey); },
        function () { if (operations.get(operationKey).task === task) operations.delete(operationKey); });
    }
    var request = { ws: ws, fingerprint: fingerprint, task: task, settled: false };
    requests.set(requestKey, request);
    task.then(function () { request.settled = true; trimRequests(); }, function () { request.settled = true; trimRequests(); });
    trimRequests();
    return task;
  };
}

module.exports = { attachIssueLaunch: attachIssueLaunch };
