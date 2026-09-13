// Claude SDK mappings for YOKE structured user input.
var userInput = require("./user-input");

function ask(handler, input, opts) {
  opts = opts || {};
  return userInput.dispatchUserInput(handler, input, {
    requestId: opts.toolUseID || opts.requestId,
    signal: opts.signal,
    source: "claude_ask_user_question",
    native: true,
    provider: "claude",
  }).then(function (result) { return userInput.claudePermissionResult(input, result); });
}

function elicitation(handler, request, opts) {
  opts = opts || {};
  return userInput.dispatchUserInput(handler, userInput.questionsFromElicitation(request), {
    requestId: opts.requestId || request.elicitationId,
    signal: opts.signal,
    source: "claude_elicitation",
    native: true,
    provider: "claude",
    presentation: "elicitation",
    diagnostics: { elicitation: request },
  }).then(userInput.elicitationResponse);
}

function canUseTool(queryOpts) {
  var original = queryOpts.canUseTool;
  return function (toolName, input, opts) {
    var validationError = toolName === "AskUserQuestion" && typeof queryOpts.validateUserInputRequest === "function" ? queryOpts.validateUserInputRequest(input) : null;
    if (validationError) return Promise.resolve({ behavior: "deny", message: validationError });
    if (toolName === "AskUserQuestion" && typeof queryOpts.onUserInputRequest === "function") return ask(queryOpts.onUserInputRequest, input, opts);
    if (toolName === "AskUserQuestion") return Promise.resolve({ behavior: "deny", message: "Use the query's structured input fallback tool." });
    if (original) return original(toolName, input, opts);
    return Promise.resolve({ behavior: "deny", message: "No tool permission handler is available." });
  };
}

module.exports = { ask: ask, elicitation: elicitation, canUseTool: canUseTool };
