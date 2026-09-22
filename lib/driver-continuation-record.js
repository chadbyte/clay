var crypto = require("crypto");

function toolResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function text(value, max) {
  if (typeof value !== "string") return "";
  var result = value.replace(/\u0000/g, "").trim();
  return result.length > max ? result.substring(0, max) : result;
}

function hasEntries(value) {
  return !!(value && Object.keys(value).length > 0);
}

function contextKey(session) {
  var history = session && session.history || [];
  var lastUser = "";
  var compactions = 0;
  for (var i = 0; i < history.length; i++) {
    var entry = history[i];
    if (!entry) continue;
    if (entry.type === "user_message" && !entry._internal) lastUser = String(entry._ts || "") + "\n" + String(entry.text || "");
    if (entry.type === "compacting" && entry.active) compactions++;
  }
  return crypto.createHash("sha256").update(lastUser + "\n" + compactions).digest("hex").substring(0, 20);
}

function findProposal(session, proposalId) {
  var history = session && session.history || [];
  for (var i = history.length - 1; i >= 0; i--) {
    var entry = history[i];
    if (entry && entry.type === "driver_continuation_proposal" && entry.proposalId === proposalId) return entry;
  }
  return null;
}

module.exports = { contextKey: contextKey, findProposal: findProposal, hasEntries: hasEntries,
  text: text, toolResult: toolResult };
