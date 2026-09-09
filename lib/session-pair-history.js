var MAX_RESPONSE_CHARS = 30000;

function responseText(history, fromIndex) {
  var text = "";
  for (var i = Math.max(0, fromIndex || 0); i < history.length; i++) {
    if (history[i] && history[i].type === "delta" && history[i].text) text += history[i].text;
  }
  return text.length > MAX_RESPONSE_CHARS ? text.slice(-MAX_RESPONSE_CHARS) : text;
}

function errorSince(history, fromIndex) {
  for (var i = history.length - 1; i >= Math.max(0, fromIndex || 0); i--) {
    if (history[i] && history[i].type === "error") return history[i].text || "partner turn failed";
  }
  return null;
}

function recentTurns(session, count) {
  var history = session.history || [];
  var starts = [];
  for (var i = 0; i < history.length; i++) if (history[i] && history[i].type === "user_message") starts.push(i);
  var from = starts.length > 0 ? starts[Math.max(0, starts.length - count)] : 0;
  var turns = [];
  var current = null;
  for (var j = from; j < history.length; j++) {
    var item = history[j];
    if (!item) continue;
    if (item.type === "user_message") {
      current = { user: item.text || "", delegated: !!item.delegated, response: "" };
      turns.push(current);
    } else if (item.type === "delta" && item.text) {
      if (!current) { current = { user: "", delegated: false, response: "" }; turns.push(current); }
      current.response += item.text;
      if (current.response.length > MAX_RESPONSE_CHARS) current.response = current.response.slice(-MAX_RESPONSE_CHARS);
    }
  }
  return turns;
}

module.exports = { errorSince: errorSince, recentTurns: recentTurns, responseText: responseText };
