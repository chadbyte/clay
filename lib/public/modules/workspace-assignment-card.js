import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';

var pendingFocus = {};

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

function statusLabel(status) {
  if (status === "queued") return "Queued for Driver";
  if (status === "starting") return "Starting";
  if (status === "running") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "interrupted") return "Interrupted";
  return "Approval required";
}

function sendDecision(assignment, action, surface, context, card, opener) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1 || !assignment || (assignment.status !== "proposed" && !(assignment.status === "queued" && action === "cancel"))) return false;
  pendingFocus[assignment.assignmentId] = opener || null;
  card.setAttribute("aria-busy", "true");
  var buttons = card.querySelectorAll("button");
  for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
  ws.send(JSON.stringify({
    type: "project_assignment_response",
    assignmentId: assignment.assignmentId,
    action: action,
    surface: surface,
    sourceProjectSlug: assignment.sourceProjectSlug,
    sourceSessionRef: assignment.sourceSessionRef,
    mateId: context && context.mateId || null,
    sessionId: context && context.sessionId || null,
    requestId: context && context.requestId || null,
  }));
  return true;
}

export function restoreWorkspaceAssignmentFocus(assignmentId, card) {
  if (!assignmentId || !pendingFocus[assignmentId] || !card) return false;
  delete pendingFocus[assignmentId];
  var focusTarget = card.querySelector(".workspace-assignment-error") || card.querySelector('[role="status"]');
  if (!focusTarget) return false;
  focusTarget.tabIndex = -1;
  requestAnimationFrame(function () { focusTarget.focus({ preventScroll: true }); });
  return true;
}

export function createWorkspaceAssignmentCard(assignment, options) {
  var config = options || {};
  var followUp = assignment.delivery === "follow_up";
  var card = document.createElement("section");
  card.className = "workspace-assignment-card" + (config.home ? " home-workspace-assignment" : "");
  card.dataset.assignmentId = assignment.assignmentId || "";
  card.dataset.status = assignment.status || "proposed";
  card.dataset.delivery = followUp ? "follow_up" : "new_session";
  card.setAttribute("aria-label", (followUp ? "Project follow-up: " : "Project assignment: ") + (assignment.title || "Untitled assignment"));

  var header = document.createElement("div");
  header.className = "workspace-assignment-header";
  var mark = document.createElement("span");
  mark.className = "workspace-assignment-mark";
  mark.innerHTML = iconHtml(followUp ? "message-square-plus" : "send");
  mark.setAttribute("aria-hidden", "true");
  header.appendChild(mark);
  var heading = document.createElement("div");
  heading.className = "workspace-assignment-heading";
  heading.appendChild(textElement("span", "workspace-assignment-kicker", followUp ? "PROJECT FOLLOW-UP" : "PROJECT ASSIGNMENT"));
  heading.appendChild(textElement("h3", "workspace-assignment-title", assignment.title || "Untitled assignment"));
  header.appendChild(heading);
  var status = textElement("span", "workspace-assignment-status", statusLabel(assignment.status));
  status.setAttribute("role", "status");
  header.appendChild(status);
  card.appendChild(header);

  var targetText = followUp
    ? "Send instructions to “" + (assignment.targetSessionTitle || "Existing session") + "” in " + (assignment.projectTitle || assignment.projectSlug || "project")
    : "New private session in " + (assignment.projectTitle || assignment.projectSlug || "project");
  var target = textElement("p", "workspace-assignment-target", targetText);
  card.appendChild(target);
  if (assignment.status === 'queued' && assignment.deliveryState === 'queued') card.appendChild(textElement('p', 'workspace-assignment-result', 'Approved. Waiting for the Driver to finish its current turn.'));
  else if (assignment.deliveryState === 'accepted' && assignment.status === 'running') card.appendChild(textElement('p', 'workspace-assignment-result', 'Accepted by the Driver runtime. Completion is still pending.'));
  card.appendChild(textElement("p", "workspace-assignment-task", assignment.task || ""));

  if (assignment.error) {
    var error = textElement("p", "workspace-assignment-error", assignment.error);
    error.setAttribute("role", "alert");
    card.appendChild(error);
  }
  if (assignment.resultSummary) card.appendChild(textElement("p", "workspace-assignment-result", assignment.resultSummary));

  var actions = document.createElement("div");
  actions.className = "workspace-assignment-actions";
  if (assignment.status === "proposed" || assignment.status === "queued") {
    var cancel = textElement("button", "workspace-assignment-action secondary", assignment.status === "queued" ? "Cancel queued update" : "Cancel");
    cancel.type = "button";
    cancel.setAttribute("aria-label", assignment.status === "queued" ? "Cancel queued update" : "Cancel project assignment");
    cancel.addEventListener("click", function () { sendDecision(assignment, "cancel", config.home ? "home" : "project", config.context, card, cancel); });
    var approve = textElement("button", "workspace-assignment-action primary", "Approve");
    approve.type = "button";
    approve.setAttribute("aria-label", followUp ? "Approve follow-up in " + (assignment.targetSessionTitle || "the target session") : "Approve new session in " + (assignment.projectTitle || assignment.projectSlug || "the target project"));
    approve.addEventListener("click", function () { sendDecision(assignment, "approve", config.home ? "home" : "project", config.context, card, approve); });
    actions.appendChild(cancel);
    if (assignment.status === "proposed") actions.appendChild(approve);
  } else {
    var resolved = textElement("span", "workspace-assignment-resolved", statusLabel(assignment.status));
    resolved.setAttribute("role", "status");
    resolved.tabIndex = -1;
    actions.appendChild(resolved);
  }
  card.appendChild(actions);
  restoreWorkspaceAssignmentFocus(assignment.assignmentId, card);
  refreshIcons();
  return card;
}

export function showWorkspaceAssignmentError(card, msg) {
  if (!card) return false;
  card.removeAttribute("aria-busy");
  var buttons = card.querySelectorAll("button");
  for (var i = 0; i < buttons.length; i++) buttons[i].disabled = false;
  var error = card.querySelector(".workspace-assignment-error");
  if (!error) {
    error = textElement("p", "workspace-assignment-error", "");
    error.setAttribute("role", "alert");
    card.insertBefore(error, card.querySelector(".workspace-assignment-actions"));
  }
  error.textContent = msg.error || "The assignment could not be updated.";
  error.tabIndex = -1;
  error.focus({ preventScroll: true });
  return true;
}

export function applyHomeWorkspaceAssignment(messages, msg) {
  var assignment = msg && msg.assignment;
  if (!assignment || !assignment.assignmentId) return messages;
  var next = (messages || []).slice();
  for (var i = 0; i < next.length; i++) {
    if (next[i].role === "assignment" && next[i].assignment && next[i].assignment.assignmentId === assignment.assignmentId) {
      next[i] = { role: "assignment", assignment: assignment };
      return next;
    }
  }
  next.push({ role: "assignment", assignment: assignment });
  return next;
}
