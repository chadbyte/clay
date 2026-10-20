var normalizeQuestions = require('./yoke/user-input').normalizeQuestions;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  var keys = Object.keys(value).sort();
  var result = {};
  for (var i = 0; i < keys.length; i++) result[keys[i]] = canonicalize(value[keys[i]]);
  return result;
}

// Compare SDK input with the canonical display payload without dropping custom
// review fields or merging independently identified requests.
function displayInput(input) {
  input = input || {};
  try {
    var questions = normalizeQuestions(input);
    return Object.assign({}, input, { questions: questions.map(function (question, index) {
      var original = input.questions[index];
      return Object.assign({}, original, question, { options: question.options.map(function (option, optionIndex) {
        return Object.assign({}, original.options && original.options[optionIndex], option);
      }) });
    }) });
  } catch (_error) { return input; }
}

function sameAskUserRequest(event, id, input) {
  return !!(event && event.type === "tool_executing" && event.name === "AskUserQuestion"
    && event.id === id && JSON.stringify(canonicalize(displayInput(event.input))) === JSON.stringify(canonicalize(displayInput(input))));
}

function hasRecordedAskUserRequest(history, id, input) {
  if (!Array.isArray(history) || !id) return false;
  for (var i = history.length - 1; i >= 0; i--) {
    if (sameAskUserRequest(history[i], id, input)) return true;
  }
  return false;
}

module.exports = { canonicalize: canonicalize, sameAskUserRequest: sameAskUserRequest, hasRecordedAskUserRequest: hasRecordedAskUserRequest };
