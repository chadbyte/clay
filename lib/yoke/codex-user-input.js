// Codex app-server 0.147 structured user-input protocol mapping.
var userInput = require("./user-input");

function nativeInput(params) {
  return {
    questions: (params.questions || []).map(function (question) {
      return {
        id: question.id,
        header: question.header || "",
        question: question.question,
        allowOther: question.isOther !== false,
        secret: question.isSecret === true,
        options: Array.isArray(question.options) ? question.options : [],
      };
    }),
  };
}

function handleNative(appServer, msg, handler, expectedThreadId, signal) {
  var params = msg.params || {};
  if (!params.threadId || (expectedThreadId && params.threadId !== expectedThreadId)) {
    appServer.respondError(msg.id, -32001, "Structured input request does not belong to this query thread.");
    return;
  }
  userInput.dispatchUserInput(handler, nativeInput(params), {
    requestId: params.itemId || String(msg.id),
    signal: signal,
    source: "codex_request_user_input",
    native: true,
    provider: "codex",
    diagnostics: { threadId: params.threadId, turnId: params.turnId || null, itemId: params.itemId || null },
  }).then(function (result) {
    appServer.respond(msg.id, userInput.codexResponse(result));
  }).catch(function (error) {
    appServer.respondError(msg.id, -32602, error.message);
  });
}

function handleElicitation(appServer, msg, handler, signal) {
  var params = msg.params || {};
  var request = {
    serverName: params.serverName || (params._meta && params._meta.tool) || "Tool",
    message: params.message || params.prompt || "",
    url: params.url || null,
    elicitationId: params.elicitationId || null,
    requestedSchema: params.requestedSchema || null,
  };
  var dispatchOpts = {
    requestId: request.elicitationId || String(msg.id),
    signal: signal,
    source: "codex_mcp_elicitation",
    native: true,
    provider: "codex",
    presentation: "elicitation",
    diagnostics: { threadId: params.threadId || null, elicitation: request },
  };
  var pending = Array.isArray(params.questions)
    ? userInput.dispatchUserInput(handler, nativeInput(params), dispatchOpts)
    : userInput.dispatchElicitation(handler, request, dispatchOpts);
  pending.then(function (result) {
    appServer.respond(msg.id, userInput.elicitationResponse(result, request.requestedSchema));
  }).catch(function (error) {
    appServer.respondError(msg.id, -32602, error.message);
  });
}

module.exports = { nativeInput: nativeInput, handleNative: handleNative, handleElicitation: handleElicitation };
