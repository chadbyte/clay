function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  var keys = Object.keys(value).sort();
  var result = {};
  for (var i = 0; i < keys.length; i++) result[keys[i]] = canonicalize(value[keys[i]]);
  return result;
}

function sameAskUserRequest(event, id, input) {
  return !!(event && event.type === "tool_executing" && event.name === "AskUserQuestion"
    && event.id === id && JSON.stringify(canonicalize(event.input || {})) === JSON.stringify(canonicalize(input || {})));
}

function hasRecordedAskUserRequest(history, id, input) {
  if (!Array.isArray(history) || !id) return false;
  for (var i = history.length - 1; i >= 0; i--) {
    if (sameAskUserRequest(history[i], id, input)) return true;
  }
  return false;
}

module.exports = { canonicalize: canonicalize, sameAskUserRequest: sameAskUserRequest, hasRecordedAskUserRequest: hasRecordedAskUserRequest };
