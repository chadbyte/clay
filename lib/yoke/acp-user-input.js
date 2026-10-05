// ACP elicitation/create mapping (form mode only; Clay advertises
// clientCapabilities.elicitation.form and never url).
var userInput = require("./user-input");
var elicitationSchema = require("./elicitation-schema");

var INVALID_PARAMS = -32602;

// Maps a host elicitation result to an ACP response. Legacy "reject" is an
// explicit refusal; anything that is not accept or decline is a dismissal.
function protocolResponse(response, schema) {
  var action = response && response.action;
  if (action === "accept") return { action: "accept", content: elicitationSchema.validateContent(response.content || {}, schema) };
  if (action === "decline" || action === "reject") return { action: "decline" };
  return { action: "cancel" };
}

function handleElicitation(acp, msg, handler, elicitationHandler, signal, provider, displayName) {
  var params = msg.params || {};
  var mode = params.mode || "form";
  if (mode !== "form") {
    acp.respondError(msg.id, INVALID_PARAMS, "Unsupported elicitation mode: " + mode + ". Clay advertises form mode only.");
    return;
  }
  if (typeof handler !== "function" && typeof elicitationHandler !== "function") {
    acp.respond(msg.id, { action: "cancel" });
    return;
  }
  var request = {
    serverName: params.serverName || displayName || "Agent",
    message: params.message || "",
    mode: "form",
    requestedSchema: params.requestedSchema || null,
  };
  var settled = false;
  var abortHandler = null;
  function finish(response, error) {
    if (settled) return;
    settled = true;
    if (signal && abortHandler && typeof signal.removeEventListener === "function") signal.removeEventListener("abort", abortHandler);
    if (error) acp.respondError(msg.id, INVALID_PARAMS, error.message);
    else acp.respond(msg.id, response);
  }
  if (typeof handler !== "function") {
    abortHandler = function () { finish({ action: "cancel" }); };
    if (signal && signal.aborted) return abortHandler();
    if (signal && typeof signal.addEventListener === "function") signal.addEventListener("abort", abortHandler, { once: true });
    Promise.resolve().then(function () {
      return elicitationHandler(request, { signal: signal });
    }).then(function (response) {
      finish(protocolResponse(response, request.requestedSchema));
    }).catch(function (error) {
      finish(null, error);
    });
    return;
  }
  userInput.dispatchElicitation(handler, request, {
    requestId: String(msg.id),
    signal: signal,
    source: "acp_elicitation",
    native: true,
    provider: provider,
    diagnostics: { elicitation: Object.assign({}, params, { serverName: request.serverName, mode: "form" }) },
  }).then(function (result) {
    finish(userInput.elicitationResponse(result, request.requestedSchema));
  }).catch(function (error) {
    finish(null, error);
  });
}

module.exports = { handleElicitation: handleElicitation, protocolResponse: protocolResponse };
