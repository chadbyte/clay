// Required decisions use Clay's blocking question lifecycle in every Codex mode.
function codexQuestionGuidance() {
  return [
    "When clarification materially changes task scope, targets, or intended behavior, use Clay's ask_user_questions tool (or its available MCP-qualified equivalent).",
    "Present the question as a structured input card, not a question followed by bullet choices in ordinary chat. Await the tool result before work that depends on the answer.",
    "Call the blocking question tool by itself; do not batch dependent actions alongside it or detach it into background work. request_user_input may be unavailable outside Plan mode, so use ask_user_questions in that case.",
    "A cancelled, skipped, empty, or failed question is not an answer or approval. Do not infer a choice; leave dependent work pending and explain what answer is needed.",
    "Do not ask again when the user has already answered or authorized the work. This question tool does not replace tool-permission enforcement."
  ].join(" ");
}
module.exports = { codexQuestionGuidance: codexQuestionGuidance };
