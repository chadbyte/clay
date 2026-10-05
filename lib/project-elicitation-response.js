// Browser elicitation_response handling: action mapping and server-side form
// validation before the provider callback settles.

var elicitationSchema = require("./yoke/elicitation-schema");

// "reject" is the legacy browser spelling of an explicit refusal.
function normalizeAction(action) {
  if (action === "accept") return "accept";
  if (action === "decline" || action === "reject") return "decline";
  return "cancel";
}

// Returns true when handled. Invalid accepted forms stay pending so the user
// can correct them; only the submitting socket receives the error.
function handleElicitationResponse(session, ws, msg, deps) {
  var pending = session.pendingElicitations && session.pendingElicitations[msg.requestId];
  if (!pending) {
    deps.sendTo(ws, { type: "elicitation_error", requestId: msg.requestId, error: "This request is no longer active.", expired: true });
    return true;
  }
  var action = normalizeAction(msg.action);
  var result = { action: action };
  if (action === "accept") {
    var request = pending.request || {};
    var content = msg.content && typeof msg.content === "object" && !Array.isArray(msg.content) ? msg.content : {};
    if (request.mode !== "url") {
      try {
        content = elicitationSchema.validateContent(content, request.requestedSchema);
      } catch (error) {
        deps.sendTo(ws, { type: "elicitation_error", requestId: msg.requestId, error: error.message });
        return true;
      }
    }
    result.content = content;
  }
  delete session.pendingElicitations[msg.requestId];
  pending.resolve(result);
  deps.sendAndRecord(session, { type: "elicitation_resolved", requestId: msg.requestId, action: action });
  return true;
}

module.exports = { handleElicitationResponse: handleElicitationResponse, normalizeAction: normalizeAction };
