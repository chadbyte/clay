// Safe native Home transcript presentation for a session-bound debate brief.

import { store } from './store.js';
import { refreshIcons } from './icons.js';
import { appendDebateModelSelectors, collectDebateModelOverrides } from './home-debate-models.js';
import { createHomeDebateActivityRow, resetHomeDebateActivityAnnouncement } from './home-debate-activity.js';
var pendingComposerOpener = null;
var planningPending = false;

export function clearHomeDebatePlanningPending() { planningPending = false; resetHomeDebateActivityAnnouncement("home-debate-activity-next"); }
export function isHomeDebatePlanningPending() { return planningPending; }
export function syncHomeDebatePlanningPending(msg) {
  var wasPending = planningPending;
  planningPending = false;
  if (!msg || (msg.debatePhase !== "planning" && msg.mateCreation !== true)) return;
  var history = Array.isArray(msg.messages) ? msg.messages : [];
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i].role === "question") {
      planningPending = history[i].status === "answered" && (wasPending || msg.isProcessing === true);
      if (planningPending && !wasPending) resetHomeDebateActivityAnnouncement("home-debate-activity-next");
      return;
    }
  }
}

export function createHomeDebatePlanningPendingRow() {
  return createHomeDebateActivityRow("Preparing the next question", "Clay is preparing the next question", "home-debate-activity-next");
}

export function requestHomeDebateComposerFocus() {
  pendingComposerOpener = document.activeElement || document.body;
}

export function restoreHomeDebateComposerFocus(input) {
  if (!pendingComposerOpener) return;
  var opener = pendingComposerOpener;
  if (!document.body || !document.body.classList.contains("home-active")) { pendingComposerOpener = null; return; }
  if (!input || input.disabled) return;
  pendingComposerOpener = null;
  var active = document.activeElement;
  if (active && active !== document.body && active !== opener && active.id !== "home-sidebar-expand") return;
  input.focus({ preventScroll: true });
}

function mateName(mateId) {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (!mates[i] || mates[i].id !== mateId) continue;
    var profile = mates[i].profile || {};
    return profile.displayName || mates[i].displayName || mates[i].name || "Mate";
  }
  return "Mate";
}

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

export function createHomeDebateProposalCard(message, respond) {
  var proposal = message.proposal || {};
  var card = document.createElement("section");
  card.className = "debate-brief-card home-debate-proposal";
  card.dataset.proposalId = proposal.proposalId || "";
  card.setAttribute("aria-label", "Debate proposal: " + (proposal.topic || "Untitled debate"));
  var header = textElement("div", "debate-brief-card-header", "Debate proposal");
  card.appendChild(header);
  var body = document.createElement("div");
  body.className = "debate-brief-card-body";
  body.appendChild(textElement("h3", "debate-brief-topic", proposal.topic || "Untitled debate"));
  if (proposal.context) body.appendChild(textElement("p", "debate-brief-context", proposal.context));
  var panelists = Array.isArray(proposal.panelists) ? proposal.panelists : [];
  if (panelists.length) {
    body.appendChild(textElement("div", "debate-brief-panelists-label", "Panel"));
    var list = document.createElement("div");
    list.className = "debate-brief-panelists";
    for (var i = 0; i < panelists.length; i++) {
      var name = mateName(panelists[i].mateId);
      var detail = panelists[i].role ? name + " — " + panelists[i].role : name;
      list.appendChild(textElement("div", "debate-brief-panelist", detail));
    }
    body.appendChild(list);
  }
  appendDebateModelSelectors(body, proposal, message.status === "submitting" || message.status === "started" || message.status === "cancelled");
  card.appendChild(body);
  if (message.error) {
    var error = textElement("p", "home-debate-proposal-error", message.error);
    error.setAttribute("role", "alert");
    card.appendChild(error);
  }
  var actions = document.createElement("div");
  actions.className = "debate-brief-actions";
  if (message.status === "started" || message.status === "cancelled") {
    var label = message.status === "started" ? "Debate started" : "Proposal cancelled";
    var resolved = textElement("span", "debate-brief-resolved-label", label);
    resolved.setAttribute("role", "status");
    actions.appendChild(resolved);
  } else {
    var start = textElement("button", "debate-brief-start-btn", message.status === "submitting" ? "Starting…" : "Start debate");
    start.type = "button";
    start.disabled = message.status === "submitting";
    start.setAttribute("aria-label", "Approve and start this debate");
    start.addEventListener("click", function () {
      var overrides = collectDebateModelOverrides(card);
      if (overrides.length) respond(message, "start", start, null, overrides);
      else respond(message, "start", start);
    });
    var cancel = textElement("button", "debate-brief-cancel-btn", "Cancel");
    cancel.type = "button";
    cancel.disabled = message.status === "submitting";
    cancel.setAttribute("aria-label", "Cancel this debate proposal");
    cancel.addEventListener("click", function () { respond(message, "cancel", cancel); });
    actions.appendChild(start);
    actions.appendChild(cancel);
  }
  card.appendChild(actions);
  refreshIcons();
  return card;
}

export function createHomeDebateQuestionCard(message, respond) {
  var question = Array.isArray(message.questions) && message.questions.length ? message.questions[0] : {};
  var card = document.createElement("section");
  card.className = "home-debate-question" + (message.flow === "mcp_import" ? " mcp-import-consent" : "");
  card.dataset.toolId = message.toolId || "";
  card.setAttribute("aria-busy", message.status === "submitting" ? "true" : "false");
  var isMateCreation = message.flow === "mate_creation", isMcpImport = message.flow === "mcp_import";
  card.setAttribute("aria-label", (isMcpImport ? "MCP import consent: " : isMateCreation ? "Mate creation interview question: " : "Debate planning question: ") + (question.question || "Question"));
  if (question.header) card.appendChild(textElement("div", "home-debate-question-header", question.header));
  card.appendChild(textElement("h3", "home-debate-question-text", question.question || "Clay has a question."));
  var form = document.createElement("div");
  form.className = "home-debate-question-form";
  var options = Array.isArray(question.options) ? question.options.slice(0, 6) : [];
  var freeform = options.length === 0;
  var selected = "";
  var buttons = [];
  for (var i = 0; i < options.length; i++) {
    (function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "home-debate-question-option";
      button.setAttribute("aria-pressed", "false");
      button.appendChild(textElement("span", "home-debate-question-option-label", option.label || "Option"));
      if (option.description) button.appendChild(textElement("span", "home-debate-question-option-description", option.description));
      button.addEventListener("click", function () {
        if (message.status !== "pending") return;
        selected = option.label || "";
        answerControl.value = "";
        for (var j = 0; j < buttons.length; j++) buttons[j].setAttribute("aria-pressed", buttons[j] === button ? "true" : "false");
        submit.disabled = !selected;
      });
      buttons.push(button);
      form.appendChild(button);
    })(options[i]);
  }
  var answerLabel = textElement("label", freeform ? "home-debate-question-freeform-label" : "home-debate-question-other-label", freeform ? "Your answer" : "Other");
  var answerControl = document.createElement(freeform ? "textarea" : "input");
  if (!freeform) answerControl.type = "text";
  if (freeform) answerControl.rows = 3;
  answerControl.className = freeform ? "home-debate-question-freeform" : "home-debate-question-other";
  answerControl.placeholder = freeform ? (isMateCreation ? "Describe what you want in your own words" : "Describe the topic in your own words") : "Type another answer";
  answerLabel.appendChild(answerControl);
  if (freeform || question.allowOther !== false) form.appendChild(answerLabel);
  var submit = textElement("button", "home-debate-question-submit", message.status === "submitting" ? "Submitting…" : isMcpImport ? "Confirm choice" : "Submit answer");
  submit.type = "button";
  submit.disabled = message.status !== "pending" || !selected;
  function submitAnswer() {
    var answer = answerControl.value.trim() || selected;
    if (!answer || message.status !== "pending") return;
    respond(message, "answer", submit, { 0: answer });
  }
  answerControl.addEventListener("input", function () {
    selected = answerControl.value.trim();
    for (var j = 0; j < buttons.length; j++) buttons[j].setAttribute("aria-pressed", "false");
    submit.disabled = !selected;
  });
  answerControl.addEventListener("keydown", function (event) {
    var submitKey = freeform ? (event.key === "Enter" && (event.ctrlKey || event.metaKey)) : (event.key === "Enter" && !event.shiftKey);
    if (submitKey) { event.preventDefault(); submitAnswer(); }
  });
  submit.addEventListener("click", submitAnswer);
  form.appendChild(submit);
  if (message.error && message.status !== "expired") {
    var retryError = textElement("p", "home-debate-question-error", message.error);
    retryError.setAttribute("role", "alert");
    retryError.tabIndex = -1;
    form.appendChild(retryError);
  }
  if (message.status === "answered") {
    form.textContent = "";
    var answer = message.answers && message.answers[0] ? String(message.answers[0]) : "Answered";
    var status = textElement("p", "home-debate-question-status", "Answered: " + answer);
    status.setAttribute("role", "status");
    status.tabIndex = -1;
    form.appendChild(status);
  } else if (message.status === "expired") {
    form.textContent = "";
    var expired = textElement("p", "home-debate-question-error", message.error || "This question expired. Ask Clay to repeat it.");
    expired.setAttribute("role", "alert");
    expired.tabIndex = -1;
    form.appendChild(expired);
  }
  card.appendChild(form);
  return card;
}

export function createHomeDebateTranscriptCard(message, respond) {
  return message.role === "question" ? createHomeDebateQuestionCard(message, respond) : createHomeDebateProposalCard(message, respond);
}

export function markHomeDebateProposalSubmitting(message, opener) {
  message.status = "submitting";
  var card = opener;
  while (card && (" " + card.className + " ").indexOf(" home-debate-proposal ") === -1) card = card.parentNode;
  function disableControls(node) {
    if (!node) return;
    if (node.tagName === "BUTTON" || node.tagName === "SELECT") node.disabled = true;
    var children = node.children || [];
    for (var i = 0; i < children.length; i++) disableControls(children[i]);
  }
  disableControls(card);
  if (opener && opener.textContent === "Start debate") opener.textContent = "Starting…";
}

export function restoreHomeDebateProposalFocus(proposalId) {
  if (!proposalId || !document.querySelectorAll) return;
  var cards = document.querySelectorAll(".home-debate-proposal");
  for (var i = 0; i < cards.length; i++) {
    if (!cards[i].dataset || cards[i].dataset.proposalId !== proposalId) continue;
    var target = cards[i].querySelector('[role="status"]') || cards[i].querySelector(".debate-brief-start-btn");
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    return;
  }
}

export function normalizeHomeTranscript(raw) {
  return (raw || []).filter(function (message) {
    return message && ((message.role === "assignment" && message.assignment) || ((message.role === "proposal" || message.role === "mate_proposal") && message.proposal) || (message.role === "question" && message.toolId) || ["debate_header", "debate_turn", "debate_user", "debate_tool_decision"].indexOf(message.role) !== -1 || ((message.role === "user" || message.role === "assistant") && typeof message.text === "string"));
  }).map(function (message) {
    if (message.role === "assignment") return { role: "assignment", assignment: message.assignment, requestId: message.requestId || null };
    if (message.role === "proposal") return { role: "proposal", proposal: message.proposal, status: message.status || "pending", error: message.error || "" };
    if (message.role === "mate_proposal") return { role: "mate_proposal", proposal: message.proposal, status: message.status || "pending", mateId: message.mateId || null, error: message.error || "" };
    if (message.role === "question") return { role: "question", flow: message.flow || "debate", toolId: message.toolId, questions: message.questions || [], status: message.status || "pending", answers: message.answers || null, error: message.error || "" };
    if (["debate_header", "debate_turn", "debate_user", "debate_tool_decision"].indexOf(message.role) !== -1) return Object.assign({}, message);
    return { role: message.role, text: message.text, ts: message.ts || 0 };
  });
}

export function applyHomeDebateQuestion(messages, msg) {
  if (!msg || !msg.toolId) return messages;
  for (var i = 0; i < messages.length; i++) if (messages[i].role === "question" && messages[i].toolId === msg.toolId) return messages;
  return messages.concat([{ role: "question", flow: msg.type === "home_mcp_import_question" ? "mcp_import" : msg.type === "home_mate_creation_question" ? "mate_creation" : "debate", toolId: msg.toolId, questions: msg.questions || [], status: "pending", error: "" }]);
}

export function resolveHomeDebateQuestion(messages, msg) {
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role !== "question" || messages[i].toolId !== msg.toolId) continue;
    messages[i] = Object.assign({}, messages[i], { status: msg.status === "answered" ? "answered" : "expired", answers: msg.answers || null, error: msg.error || "" });
  }
  return messages;
}

export function failHomeDebateQuestion(messages, msg) {
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "question" || (messages[i].status !== "pending" && messages[i].status !== "submitting")) continue;
    messages[i] = Object.assign({}, messages[i], { status: "pending", error: msg.text || "The answer could not be submitted. Try again." });
    break;
  }
  return messages;
}

export function hasPendingHomeDebateQuestion(messages) {
  for (var i = 0; i < messages.length; i++) if (messages[i].role === "question" && (messages[i].status === "pending" || messages[i].status === "submitting")) return true;
  return false;
}

export function markHomeDebateQuestionSubmitting(message, opener) {
  message.status = "submitting";
  if (!planningPending) resetHomeDebateActivityAnnouncement("home-debate-activity-next");
  planningPending = true;
  var form = opener && opener.parentNode;
  function disableControls(node) {
    if (!node) return;
    if (node.tagName === "BUTTON" || node.tagName === "INPUT" || node.tagName === "TEXTAREA") node.disabled = true;
    var children = node.children || [];
    for (var i = 0; i < children.length; i++) disableControls(children[i]);
  }
  disableControls(form);
  if (opener) opener.textContent = "Submitting…";
}

export function createHomeDebateResponder(sendMessage, getContext, onChange) {
  return function respond(message, action, opener, answers, modelOverrides) {
    if (!message || message.status === "submitting") return;
    var payload = message.role === "question" ? { type: message.flow === "mcp_import" ? "home_mcp_import_response" : message.flow === "mate_creation" ? "home_mate_creation_question_response" : "home_debate_question_response", toolId: message.toolId, answers: answers || {} } : { type: "home_debate_proposal_response", proposalId: message.proposal.proposalId, action: action, modelOverrides: Array.isArray(modelOverrides) ? modelOverrides : [] };
    Object.assign(payload, getContext());
    if (!sendMessage(payload)) return;
    if (message.role === "question") markHomeDebateQuestionSubmitting(message, opener);
    else markHomeDebateProposalSubmitting(message, opener);
    if (typeof onChange === "function") onChange(message);
  };
}

export function restoreHomeDebateQuestionFocus(toolId) {
  if (!toolId || !document.querySelectorAll) return;
  var cards = document.querySelectorAll(".home-debate-question");
  for (var i = 0; i < cards.length; i++) {
    if (!cards[i].dataset || cards[i].dataset.toolId !== toolId) continue;
    var target = cards[i].querySelector('[role="status"]') || cards[i].querySelector('[role="alert"]') || cards[i];
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    return;
  }
}

export function applyHomeDebateProposal(messages, msg) {
  var id = msg && msg.proposal && msg.proposal.proposalId;
  if (!id) return messages;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role === "proposal" && messages[i].proposal.proposalId === id) return messages;
  }
  return messages.concat([{ role: "proposal", proposal: msg.proposal, status: "pending" }]);
}

export function resolveHomeDebateProposal(messages, msg) {
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role !== "proposal" || messages[i].proposal.proposalId !== msg.proposalId) continue;
    messages[i] = Object.assign({}, messages[i], { status: msg.action === "start" ? "started" : (msg.action === "cancel" ? "cancelled" : "pending"), error: msg.action === "error" ? (msg.error || "The debate could not be started.") : "" });
  }
  return messages;
}
