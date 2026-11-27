// Qwen Code 0.28.4 carries questions and exact edits in permission metadata.
var userInput = require("./user-input");
function isQuestion(call) {
  return !!(call._meta && call._meta.qwenInteractionKind === "user_question");
}
function reviewQuestion(call, handler, signal, requestId) {
  var questions = call._meta.qwenQuestions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) return Promise.resolve(false);
  for (var i = 0; i < questions.length; i++) {
    var question = questions[i];
    if (!question || typeof question.question !== "string" || !question.question.trim() || question.question.length > 2000 ||
        typeof question.header !== "string" || question.header.length > 40 ||
        (question.multiSelect !== undefined && typeof question.multiSelect !== "boolean") ||
        !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 4) return Promise.resolve(false);
    for (var j = 0; j < question.options.length; j++) {
      var option = question.options[j];
      if (!option || typeof option.label !== "string" || !option.label.trim() || option.label.length > 60 ||
          typeof option.description !== "string" || option.description.length > 160) return Promise.resolve(false);
    }
  }
  var input = { questions: questions.map(function(question, index) {
    return Object.assign({}, question, { id: String(index) });
  }) };
  return userInput.dispatchUserInput(handler, input, { signal: signal, requestId: String(requestId),
    provider: "qwen", source: "qwen_permission_question", native: true }).then(function(result) {
    if (result.status !== "submitted") return false;
    var answers = {};
    for (var i = 0; i < questions.length; i++) answers[String(i)] = result.answers[String(i)].join(", ");
    return { behavior: "allow", answers: answers };
  });
}
function editInput(call) {
  var diffs = (Array.isArray(call.content) ? call.content : []).filter(function(item) { return item && item.type === "diff"; });
  // A single Edit review can describe exactly one complete replacement.
  if (diffs.length !== 1) return null;
  var diff = diffs[0];
  if (typeof diff.path !== "string" || !diff.path.trim() || typeof diff.oldText !== "string" || typeof diff.newText !== "string") return null;
  return { file_path: diff.path, old_string: diff.oldText, new_string: diff.newText };
}
module.exports = { isQuestion: isQuestion, reviewQuestion: reviewQuestion, editInput: editInput };
