// Native proposal card for a Clay-led Mate creation interview.

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

function scheduleDate(value) {
  var parts = String(value || "").split("-").map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : value;
}

function exactScheduleFact(proposal) {
  var intent = proposal.scheduleIntent;
  var schedule = intent.scheduleRule;
  var recurrence = schedule.recurrence;
  var timing = "On " + scheduleDate(schedule.anchorDate);
  if (recurrence) {
    var days = (recurrence.weekdays || []).map(function (day) { return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]; });
    if (recurrence.unit === "week" && recurrence.every === 1 && (recurrence.weekdays || []).join(",") === "1,2,3,4,5") timing = "Every weekday";
    else if (recurrence.unit === "week" && recurrence.every === 1 && days.length) timing = "Every " + days.join(", ");
    else timing = "Every " + (recurrence.every === 1 ? recurrence.unit : recurrence.every + " " + recurrence.unit + "s") + (days.length ? " on " + days.join(", ") : "");
  }
  timing += " at " + schedule.time + " (" + (proposal.scheduleTimezone || "server local") + ")";
  if (recurrence) timing += ", starting " + scheduleDate(schedule.anchorDate);
  if (schedule.recurrenceEnd) timing += schedule.recurrenceEnd.type === "after" ? "; for " + schedule.recurrenceEnd.count + " deliveries" : "; through " + scheduleDate(schedule.recurrenceEnd.date);
  if (schedule.interval) {
    var interval = schedule.interval;
    timing += "; every " + interval.every + " " + interval.unit + (interval.every === 1 ? "" : "s");
    timing += !interval.end ? " until end of day" : interval.end.type === "after" ? ", " + interval.end.count + " deliveries per day" : " until " + interval.end.time;
  }
  return timing + ": " + intent.message;
}

function friendlyTime(value) {
  var parts = value.split(":");
  var hour = Number(parts[0]);
  if (parts[1] === "00" && (hour === 0 || hour === 12)) return hour === 0 ? "midnight" : "noon";
  return (hour % 12 || 12) + (parts[1] === "00" ? "" : ":" + parts[1]) + (hour < 12 ? " AM" : " PM");
}

function scheduleSummary(proposal) {
  var intent = proposal.scheduleIntent;
  var schedule = intent.scheduleRule;
  var recurrence = schedule.recurrence;
  var timing = scheduleDate(schedule.anchorDate);
  if (recurrence) {
    var days = (recurrence.weekdays || []).map(function (day) { return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]; });
    if (recurrence.unit === "week" && recurrence.every === 1 && (recurrence.weekdays || []).join(",") === "1,2,3,4,5") timing = "Every weekday";
    else if (recurrence.unit === "week" && recurrence.every === 1 && days.length) timing = "Every " + days.join(", ");
    else timing = "Every " + (recurrence.every === 1 ? recurrence.unit : recurrence.every + " " + recurrence.unit + "s") + (days.length ? " on " + days.join(", ") : "");
  }
  var hour = Number(schedule.time.split(":")[0]);
  var time = friendlyTime(schedule.time);
  var period = hour >= 5 && hour < 12 ? "morning" : hour >= 13 && hour < 17 ? "afternoon" : hour >= 17 && hour < 21 ? "evening" : "";
  if (recurrence && period && recurrence.unit === "day" && recurrence.every === 1) timing = "Every " + period + " at " + time.replace(/ (AM|PM)$/, "");
  else if (recurrence && period && timing === "Every weekday") timing += " " + period + " at " + time.replace(/ (AM|PM)$/, "");
  else timing += " at " + time;
  if (schedule.recurrenceEnd) timing += schedule.recurrenceEnd.type === "after" ? ", for " + schedule.recurrenceEnd.count + (schedule.recurrenceEnd.count === 1 ? " delivery" : " deliveries") : ", through " + scheduleDate(schedule.recurrenceEnd.date);
  if (schedule.interval) {
    var interval = schedule.interval;
    timing += ", then every " + interval.every + " " + interval.unit + (interval.every === 1 ? "" : "s");
    timing += !interval.end ? " until the end of the day" : interval.end.type === "after" ? ", " + interval.end.count + " deliveries a day" : " until " + friendlyTime(interval.end.time);
  }
  return timing + ": " + intent.message;
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
    var description = textElement("dd", "", typeof value === "string" ? value : "");
    if (typeof value !== "string") description.appendChild(value);
    facts.appendChild(description);
    return description;
  }
  fact("Relationship", proposal.relationship);
  fact("Activities", Array.isArray(proposal.activities) ? proposal.activities.join(", ") : "");
  fact("Communication", Array.isArray(proposal.communicationStyle) ? proposal.communicationStyle.join(", ") : "");
  fact("Autonomy", proposal.autonomy);
  if (proposal.scheduleIntent && proposal.scheduleIntent.message && proposal.scheduleIntent.scheduleRule) {
    var scheduleItem = fact("Schedule", textElement("span", "home-mate-proposal-schedule-summary", scheduleSummary(proposal)));
    var exactTiming = document.createElement("details");
    exactTiming.className = "home-mate-proposal-schedule-details";
    exactTiming.appendChild(textElement("summary", "", "Exact timing"));
    exactTiming.appendChild(textElement("div", "", exactScheduleFact(proposal)));
    scheduleItem.appendChild(exactTiming);
  }
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
