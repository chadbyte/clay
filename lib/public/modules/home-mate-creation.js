// Native proposal card for a Clay-led Mate creation interview.

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

export function createHomeMateProposalCard(message, respond, openMate) {
  var proposal = message.proposal || {};
  var card = document.createElement("section");
  card.className = "home-mate-proposal";
  card.dataset.proposalId = proposal.proposalId || "";
  card.setAttribute("aria-label", "New Mate proposal: " + (proposal.name || "Unnamed Mate"));
  card.appendChild(textElement("div", "home-mate-proposal-eyebrow", "New Mate"));
  card.appendChild(textElement("h3", "home-mate-proposal-name", proposal.name || "Unnamed Mate"));
  if (proposal.bio) card.appendChild(textElement("p", "home-mate-proposal-bio", proposal.bio));
  var facts = document.createElement("dl");
  facts.className = "home-mate-proposal-facts";
  function fact(label, value) {
    if (!value) return;
    facts.appendChild(textElement("dt", "", label));
    facts.appendChild(textElement("dd", "", value));
  }
  fact("Relationship", proposal.relationship);
  fact("Activities", Array.isArray(proposal.activities) ? proposal.activities.join(", ") : "");
  fact("Communication", Array.isArray(proposal.communicationStyle) ? proposal.communicationStyle.join(", ") : "");
  fact("Autonomy", proposal.autonomy);
  card.appendChild(facts);
  if (proposal.identityMarkdown) {
    var details = document.createElement("details");
    details.className = "home-mate-proposal-identity";
    details.appendChild(textElement("summary", "", "Review full identity"));
    details.appendChild(textElement("pre", "", proposal.identityMarkdown));
    card.appendChild(details);
  }
  if (message.error) {
    var error = textElement("p", "home-mate-proposal-error", message.error);
    error.setAttribute("role", "alert");
    card.appendChild(error);
  }
  var actions = document.createElement("div");
  actions.className = "home-mate-proposal-actions";
  if (message.status === "created" || message.status === "cancelled") {
    var resolved = textElement("span", "home-mate-proposal-status", message.status === "created" ? "Mate created" : "Proposal cancelled");
    resolved.setAttribute("role", "status");
    resolved.tabIndex = -1;
    actions.appendChild(resolved);
    if (message.status === "created" && message.mateId && typeof openMate === "function") {
      var mateName = message.mateName || proposal.name || "Mate";
      var open = textElement("button", "home-mate-proposal-open", "Open " + mateName);
      open.type = "button";
      open.setAttribute("aria-label", "Open conversation with " + mateName);
      open.addEventListener("click", function () { openMate(message, open); });
      actions.appendChild(open);
    }
  } else {
    var create = textElement("button", "home-mate-proposal-create", message.status === "submitting" ? "Creating…" : "Create Mate");
    create.type = "button";
    create.disabled = message.status === "submitting";
    create.addEventListener("click", function () { respond(message, "create", create); });
    var cancel = textElement("button", "home-mate-proposal-cancel", "Cancel");
    cancel.type = "button";
    cancel.disabled = message.status === "submitting";
    cancel.addEventListener("click", function () { respond(message, "cancel", cancel); });
    actions.appendChild(create);
    actions.appendChild(cancel);
  }
  card.appendChild(actions);
  return card;
}

export function applyHomeMateProposal(messages, msg) {
  var id = msg && msg.proposal && msg.proposal.proposalId;
  if (!id) return messages;
  for (var i = 0; i < messages.length; i++) if (messages[i].role === "mate_proposal" && messages[i].proposal && messages[i].proposal.proposalId === id) return messages;
  return messages.concat([{ role: "mate_proposal", proposal: msg.proposal, status: "pending", error: "" }]);
}

export function resolveHomeMateProposal(messages, msg) {
  for (var i = 0; i < messages.length; i++) {
    if (messages[i].role !== "mate_proposal" || !messages[i].proposal || messages[i].proposal.proposalId !== msg.proposalId) continue;
    messages[i] = Object.assign({}, messages[i], { status: msg.action === "create" ? "created" : (msg.action === "cancel" ? "cancelled" : "pending"), mateId: msg.createdMateId || null, mateName: msg.mateName || "", error: msg.error || "" });
  }
  return messages;
}

export function createHomeMateProposalResponder(sendMessage, getContext, onChange) {
  return function (message, action, opener) {
    if (!message || message.status === "submitting") return;
    var payload = { type: "home_mate_creation_proposal_response", proposalId: message.proposal.proposalId, action: action === "create" ? "create" : "cancel" };
    Object.assign(payload, getContext());
    if (!sendMessage(payload)) return;
    message.status = "submitting";
    if (opener) opener.textContent = action === "create" ? "Creating…" : "Cancelling…";
    if (typeof onChange === "function") onChange(message);
  };
}

export function restoreHomeMateProposalFocus(proposalId) {
  var cards = document.querySelectorAll(".home-mate-proposal");
  for (var i = 0; i < cards.length; i++) {
    if (!cards[i].dataset || cards[i].dataset.proposalId !== proposalId) continue;
    var target = cards[i].querySelector('[role="status"]') || cards[i].querySelector('[role="alert"]') || cards[i].querySelector("button");
    if (target) target.focus({ preventScroll: true });
    return;
  }
}
