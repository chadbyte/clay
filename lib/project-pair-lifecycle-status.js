var pairUsage = require("./project-pair-usage");

var MAX_TASK_PREVIEW_CHARS = 200;

function clampText(value, max) {
  var text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text.length > max) text = text.slice(0, max - 1) + "…";
  return text;
}

function continuityStatus(session) {
  var history = session.history || [];
  var userTurns = 0;
  var errors = 0;
  for (var i = 0; i < history.length; i++) {
    if (!history[i]) continue;
    if (history[i].type === "user_message") userTurns++;
    else if (history[i].type === "error") errors++;
  }
  var lastActivity = typeof session.lastActivity === "number" ? session.lastActivity : null;
  return { historyEntries: history.length, userTurns: userTurns, errorEntries: errors,
    idleSeconds: lastActivity ? Math.max(0, Math.round((Date.now() - lastActivity) / 1000)) : null };
}

function activityStatus(session) {
  var token = session._pairDelegation || null;
  return { isProcessing: !!(session.isProcessing || session._queryStarting), delegated: !!token,
    currentTask: token ? clampText(token.message, MAX_TASK_PREVIEW_CHARS) : "",
    currentTaskId: token && token.taskId || null, interruption: session._pairInterruption || null,
    lastTurnInterrupted: !!session._lastTurnInterrupted };
}

module.exports = { activityStatus: activityStatus, clampText: clampText, continuityStatus: continuityStatus,
  contextStatus: pairUsage.contextStatus, firstNumber: pairUsage.firstNumber };
