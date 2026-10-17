var CLAUDE_INTERRUPTED_TEXT = "[Request interrupted by user]";
function extractClaudeUserText(event) {
  var content = event && event.message && event.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  var parts = [];
  for (var i = 0; i < content.length; i++) {
    if (content[i] && content[i].type === "text" && typeof content[i].text === "string") {
      parts.push(content[i].text);
    }
  }
  return parts.join("");
}

// SDK capability probes create a real Claude transcript with a single "hi"
// prompt. Newer Claude Code versions append an interruption record when Clay
// aborts the probe, so that bookkeeping record must not make the transcript
// look like a real two-turn conversation.
function isClaudeWarmupTranscript(events) {
  var promptCount = 0;
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (!event || typeof event !== "object") continue;
    if (event.type === "assistant") return false;
    if (event.type !== "user" || !event.message || event.message.role !== "user") continue;
    var text = extractClaudeUserText(event);
    if (text === CLAUDE_INTERRUPTED_TEXT) continue;
    if (text !== "hi") return false;
    promptCount++;
  }
  return promptCount === 1;
}

module.exports = { extractClaudeUserText: extractClaudeUserText, isClaudeWarmupTranscript: isClaudeWarmupTranscript };
