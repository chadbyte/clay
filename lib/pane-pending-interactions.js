// Pending requests can precede the initial history window. Restate their exact
// display payloads before snapshot completion, without resolving or replaying
// any human decision. Client renderers deduplicate by their original IDs.
function send(session, emit) {
  Object.keys(session.pendingAskUser || {}).forEach(function (id) {
    var pending = session.pendingAskUser[id];
    var input = pending.input || { questions: pending.request && pending.request.questions || [] };
    emit({ type: 'ask_user_pending', toolId: id, input: input });
  });
  Object.keys(session.pendingElicitations || {}).forEach(function (id) {
    var request = session.pendingElicitations[id].request || {};
    emit({ type: 'elicitation_request', requestId: id, serverName: request.serverName, message: request.message,
      mode: request.mode || 'form', url: request.url || null, elicitationId: request.elicitationId || null, requestedSchema: request.requestedSchema || null });
  });
  Object.keys(session.pendingUserDialogs || {}).forEach(function (id) {
    var request = session.pendingUserDialogs[id].request || {};
    emit({ type: 'user_dialog_request', requestId: id, dialogKind: request.dialogKind, payload: request.payload || {}, toolUseId: request.toolUseID || null });
  });
}
module.exports = { send: send };
