// Project-bound access to the same participation actions used by Home debates.
function handleProjectDebateControl(ws, msg, session, engine, sendTo) {
  if (msg.type !== "project_debate_control" && msg.type !== "project_debate_state") return false;
  var userId = ws && ws._clayUser && ws._clayUser.id;
  var valid = session && msg.sessionId != null && String(session.localId) === String(msg.sessionId)
    && (!session.ownerId || session.ownerId === userId);
  if (msg.type === "project_debate_state") {
    sendTo(ws, { type: "project_debate_state", sessionId: msg.sessionId, header: valid ? debateHeader(session) : null });
    return true;
  }
  var ok = false;
  if (valid) {
    if (session.homeDebatePlanning) ok = engine.handleHomeControl(ws, msg, session);
    else if (msg.action === "hand_raise") { engine.handleDebateHandRaise(ws, session); ok = true; }
    else if (msg.action === "stop") ok = engine.handleDebateStop(ws, session);
    else if (msg.action === "cancel_stop") ok = engine.handleDebateCancelStop(ws, session);
    else if (msg.action === "user_floor") { engine.handleDebateUserFloorResponse(ws, msg, session); ok = true; }
    else if (msg.action === "conclude" || msg.action === "resume") {
      engine.handleDebateConcludeResponse(ws, { action: msg.action === "resume" ? "continue" : msg.response, text: msg.text || "" }, session);
      ok = true;
    }
  }
  sendTo(ws, { type: "project_debate_control_result", sessionId: msg.sessionId, ok: !!ok, error: ok ? null : "This debate action is no longer available. Reopen the debate and try again." });
  return true;
}
function debateHeader(session) {
  var header = null;
  (session.history || []).forEach(function (event) {
    if (event.type === "debate_started") header = Object.assign({}, event, { role: "debate_header", phase: "live", round: 1, interaction: null, handRaised: false });
    if (!header) return;
    if (event.round) header.round = event.round;
    if (event.type === "debate_conclude_confirm") header.interaction = "conclude";
    if (event.type === "debate_user_floor") header.interaction = "user_floor";
    if (event.type === "debate_user_floor_done") { header.interaction = null; header.handRaised = false; }
    if (event.type === "debate_hand_raised") header.handRaised = true;
    if (event.type === "debate_stop_requested") header.stopping = true;
    if (event.type === "debate_stop_cancelled") header.stopping = false;
    if (event.type === "debate_turn" || event.type === "debate_resumed") { header.interaction = null; header.phase = "live"; }
    if (event.type === "debate_ended") { header.phase = event.reason === "interrupted" ? "interrupted" : "ended"; header.reason = event.reason; header.interaction = null; header.stopping = false; }
  });
  return header;
}
module.exports = { handleProjectDebateControl: handleProjectDebateControl, debateHeader: debateHeader };
