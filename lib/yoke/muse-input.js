var userInput = require("./user-input");
function createRouter(runtime, queryOpts, signal) {
  var pending = new Map();
  function route(request) {
    if (pending.has(request.userInputId)) return pending.get(request.userInputId).operation;
    if (pending.size >= 1000) return Promise.reject(new Error("Muse input request capacity exceeded"));
    var controller = new AbortController();
    var entry = { controller: controller, retired: false };
    function abort() { controller.abort(); }
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    var operation = Promise.resolve().then(async function() {
      runtime.check();
      var input = { id: request.userInputId, questions: (request.questions || []).map(function(question) {
        return { id: question.id, header: question.header, question: question.question,
          options: question.options, multiSelect: question.selection && question.selection.mode === "multiple", allowOther: true };
      }) };
      if (typeof queryOpts.validateUserInputRequest === "function") {
        var reason = queryOpts.validateUserInputRequest(input);
        if (reason) throw new Error(reason);
      }
      var result = await runtime.wait(userInput.dispatchUserInput(queryOpts.onUserInputRequest, input,
        { source: "muse", native: true, provider: "muse", signal: controller.signal }));
      runtime.check();
      if (entry.retired) return;
      if (result.status !== "submitted") return runtime.waitRequest(runtime.connection.command("userInput/cancel", {
        sessionId: request.sessionId, userInputId: request.userInputId,
      }));
      var answers = request.questions.map(function(question) {
        var values = result.answers[question.id] || [];
        var selection = question.selection || {};
        if (values.length < (selection.minSelections || 1) || selection.maxSelections != null && values.length > selection.maxSelections) throw new Error("Muse answer violates selection bounds");
        var known = values.every(function(value) { return (question.options || []).some(function(option) { return option.label === value; }); });
        var answer = { questionId: question.id };
        if (!known || !question.options.length) {
          var text = values.join(", ");
          if (text.length > 500) throw new Error("Muse free-text answer exceeds 500 characters");
          answer.freeText = text;
        } else if (selection.mode === "multiple") answer.selectedLabels = values;
        else answer.selectedLabel = values[0];
        return answer;
      });
      return runtime.waitRequest(runtime.connection.command("userInput/answer", {
        sessionId: request.sessionId, userInputId: request.userInputId, answers: answers,
      }));
    });
    entry.operation = operation.finally(function() { signal.removeEventListener("abort", abort); });
    pending.set(request.userInputId, entry);
    return entry.operation;
  }
  route.settle = function(id) {
    var entry = pending.get(id);
    if (entry) { entry.retired = true; entry.controller.abort(); }
  };
  return route;
}
function inputParts(text, images) {
  var parts = [{ type: "text", text: text }];
  (images || []).forEach(function(image) {
    if (!image || typeof image.data !== "string" || !image.data || !/^image\/[a-z0-9.+-]+$/i.test(image.mediaType || "") || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error("Invalid Muse image attachment");
    parts.push({ type: "image", mediaType: image.mediaType, base64Data: image.data });
  });
  return parts;
}
module.exports = { createRouter: createRouter, inputParts: inputParts };
