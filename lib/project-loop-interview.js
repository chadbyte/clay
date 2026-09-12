var crypto = require("crypto");
var driverEligibility = require("./session-driver-eligibility");
var loopGuidance = require("./loop-guidance");

var MAX_OBJECTIVE = 20000;
var MAX_CRITERIA = 10;
var MAX_CRITERION = 1000;

function text(value, max) { return typeof value === "string" ? value.trim().substring(0, max) : ""; }
function criteria(value) { return (Array.isArray(value) ? value : []).slice(0, MAX_CRITERIA).map(function (item) { return text(item, MAX_CRITERION); }).filter(Boolean); }
function brief(value) {
  if (!value || typeof value !== "object") return null;
  var objective = text(value.objective, MAX_OBJECTIVE);
  var successCriteria = criteria(value.successCriteria);
  if (!objective || successCriteria.length === 0) return null;
  return { version: 1, id: text(value.id, 200) || crypto.randomUUID(), objective: objective,
    successCriteria: successCriteria, maxContinuations: Math.max(1, Math.min(100, Math.floor(Number(value.maxContinuations) || 10))),
    maxMinutes: Math.max(1, Math.min(1440, Math.floor(Number(value.maxMinutes) || 60))), createdAt: Number(value.createdAt) || Date.now() };
}

function attachLoopInterview(ctx) {
  var sm = ctx.sm;
  var sendTo = ctx.sendTo;
  var autonomousRun = ctx.autonomousRun;
  function eligible(session) { return !!(session && !ctx.isMate && (session.runtimeMode || session.mode) === "gui" && driverEligibility.isEligibleDriverSession(session) && !ctx.isDriverOperatedSession(session)); }
  function runActive(session) { return !!(session && session.autonomousRun && ["armed", "running", "reviewing", "waiting-worker", "waiting-user", "paused"].indexOf(session.autonomousRun.state) !== -1); }
  function hasInterview(session, requestId) {
    var history = Array.isArray(session && session.history) ? session.history : [];
    for (var i = history.length - 1; i >= 0; i--) if (history[i] && history[i].source === "loop_interview" && history[i].requestId === requestId) return true;
    return false;
  }
  function currentInterview(session) {
    var history = Array.isArray(session && session.history) ? session.history : [];
    var current = null;
    for (var i = 0; i < history.length; i++) {
      if (history[i] && history[i].source === "loop_interview") current = history[i].interviewId || null;
      if (history[i] && (history[i].source === "loop_interview_cancel" || history[i].source === "loop_interview_close") && history[i].interviewId === current) current = null;
    }
    return current;
  }
  function interviewActive(session) {
    return !!currentInterview(session);
  }
  function startInterview(ws, msg) {
    var session = ctx.getSessionForWs(ws);
    var requestId = text(msg.requestId, 200);
    var result = { type: "loop_interview_start_result", sessionId: session && session.localId || msg.sessionId || null, requestId: requestId, ok: false };
    if (!session || !requestId || Number(msg.sessionId) !== Number(session.localId) || (ctx.canAccess && !ctx.canAccess(ws, session))) result.error = "This session is no longer available.";
    else if (hasInterview(session, requestId)) { result.ok = true; result.duplicate = true; }
    else if (!eligible(session)) result.error = "Loop interviews are available only in a Driver project chat.";
    else if (runActive(session)) result.error = "Finish the active Loop run before starting another interview.";
    else if (session.isProcessing || session._queryStarting) result.error = "Wait for the current task to finish before starting a Loop interview.";
    else {
      session.loopInterviewBrief = null;
      var prompt = loopGuidance.interviewPrompt();
      var interviewId = crypto.randomUUID();
      var entry = { type: "user_message", text: "[Loop interview started]", source: "loop_interview", interviewId: interviewId, requestId: requestId, _ts: Date.now() };
      session.history.push(entry);
      sm.appendToSessionFile(session, entry);
      sm.saveSessionFile(session);
      publish(session);
      ctx.sendToSession(session.localId, entry);
      session.isProcessing = true;
      ctx.onProcessingChanged();
      ctx.sendToSession(session.localId, { type: "status", status: "processing" });
      try {
        var started = ctx.sdk.startQuery(session, prompt, null, ctx.ensureProjectAccessForSession(session));
        ctx.sendTo(ws, Object.assign({}, result, { ok: true }));
        Promise.resolve(started).catch(function (error) {
          var stillCurrent = ctx.getSessionForWs(ws) === session && currentInterview(session) === interviewId && hasInterview(session, requestId);
          if (!stillCurrent) return;
          session.isProcessing = false;
          ctx.onProcessingChanged();
          ctx.sendToSession(session.localId, { type: "status", status: "idle" });
          sm.saveSessionFile(session);
          ctx.sendTo(ws, Object.assign({}, result, { ok: false, error: "Loop interview could not start: " + (error.message || error) }));
        });
        return true;
      } catch (error) {
        session.isProcessing = false;
        ctx.onProcessingChanged();
        ctx.sendToSession(session.localId, { type: "status", status: "idle" });
        sm.saveSessionFile(session);
        result.error = "Loop interview could not start: " + (error.message || error);
      }
    }
    ctx.sendTo(ws, result);
    return true;
  }
  function publish(session) { sm.sendToSession(session, { type: "loop_interview_brief", sessionId: session.localId, brief: session.loopInterviewBrief || null }); }
  function propose(session, interviewId, args) {
    if (!eligible(session) || runActive(session) || !interviewId || currentInterview(session) !== interviewId) return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "rejected", reason: "propose_loop is stale or unavailable outside the current Driver Loop interview." }) }] });
    var next = brief(args);
    if (!next) return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "rejected", reason: "Provide an objective and at least one success criterion." }) }] });
    next.interviewId = interviewId;
    session.loopInterviewBrief = next;
    sm.saveSessionFile(session);
    publish(session);
    return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ status: "proposed", brief: next }) }] });
  }
  function getToolDefs(session) {
    if (!eligible(session) || runActive(session) || !interviewActive(session) || session.loopInterviewBrief) return [];
    var interviewId = currentInterview(session);
    return [{ name: "propose_loop", description: "Draft a bounded Loop execution brief for human review. This never starts execution or changes permissions.", inputSchema: { type: "object", properties: {
      objective: { type: "string" }, successCriteria: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
      maxContinuations: { type: "integer", minimum: 1, maximum: 100 }, maxMinutes: { type: "integer", minimum: 1, maximum: 1440 }
    }, required: ["objective", "successCriteria"], additionalProperties: false }, handler: function (args) { return propose(session, interviewId, args || {}); } }];
  }
  function handleMessage(ws, msg) {
    if (msg.type === "loop_interview_state") {
      var stateSession = ctx.getSessionForWs(ws);
      if (stateSession && Number(msg.sessionId) === Number(stateSession.localId) && (!ctx.canAccess || ctx.canAccess(ws, stateSession))) publish(stateSession);
      return true;
    }
    if (msg.type === "loop_interview_start") return startInterview(ws, msg);
    if (["loop_interview_start_run", "loop_interview_edit", "loop_interview_cancel"].indexOf(msg.type) === -1) return false;
    var session = ctx.getSessionForWs(ws);
    if (!session || Number(msg.sessionId) !== Number(session.localId) || (ctx.canAccess && !ctx.canAccess(ws, session)) || !eligible(session)) {
      if (msg.type === "loop_interview_start_run") sendTo(ws, { type: "loop_interview_start_run_result", ok: false, sessionId: session && session.localId || msg.sessionId || null, requestId: text(msg.requestId, 200), error: "This session is no longer available." });
      return true;
    }
    if (msg.type === "loop_interview_cancel") {
      if (session.loopInterviewBrief && (text(msg.proposalId, 200) !== session.loopInterviewBrief.id || Number(msg.version) !== Number(session.loopInterviewBrief.version))) return true;
      var cancelEntry = { type: "loop_interview_cancel", source: "loop_interview_cancel", interviewId: currentInterview(session), _ts: Date.now() };
      session.history.push(cancelEntry); sm.appendToSessionFile(session, cancelEntry);
      session.loopInterviewBrief = null; sm.saveSessionFile(session); publish(session); return true;
    }
    if (msg.type === "loop_interview_edit") {
      if (session.loopInterviewBrief && text(msg.proposalId, 200) === session.loopInterviewBrief.id && Number(msg.version) === Number(session.loopInterviewBrief.version) && session.loopInterviewBrief.interviewId === currentInterview(session)) {
        var edited = brief(Object.assign({}, session.loopInterviewBrief, msg.brief || {}));
        if (edited) { edited.interviewId = session.loopInterviewBrief.interviewId; edited.version = session.loopInterviewBrief.version + 1; session.loopInterviewBrief = edited; sm.saveSessionFile(session); publish(session); }
      }
      return true;
    }
    var proposal = session.loopInterviewBrief;
    if (!proposal || proposal.interviewId !== currentInterview(session) || text(msg.proposalId, 200) !== proposal.id || Number(msg.version) !== Number(proposal.version)) {
      sendTo(ws, { type: "loop_interview_start_run_result", ok: false, sessionId: session.localId, requestId: text(msg.requestId, 200), error: "This Loop brief is stale or no longer pending." });
      return true;
    }
    autonomousRun.startApprovedBrief(ws, session, proposal, text(msg.requestId, 200), function () {
      return !!(session.loopInterviewBrief && session.loopInterviewBrief.id === proposal.id && Number(session.loopInterviewBrief.version) === Number(proposal.version) && session.loopInterviewBrief.interviewId === currentInterview(session));
    }).then(function (ok) {
      if (ok && session.loopInterviewBrief && session.loopInterviewBrief.id === proposal.id) {
        var closeEntry = { type: "loop_interview_close", source: "loop_interview_close", interviewId: proposal.interviewId, proposalId: proposal.id, proposalVersion: proposal.version, _ts: Date.now() };
        session.history.push(closeEntry);
        sm.appendToSessionFile(session, closeEntry);
        session.loopInterviewBrief = null;
        sm.saveSessionFile(session);
        publish(session);
      }
    }).catch(function (error) {
      sendTo(ws, { type: "loop_interview_start_run_result", ok: false, sessionId: session.localId, requestId: text(msg.requestId, 200), error: error.message || String(error) });
    });
    return true;
  }
  return { getToolDefs: getToolDefs, handleMessage: handleMessage };
}

module.exports = { attachLoopInterview: attachLoopInterview, brief: brief };
