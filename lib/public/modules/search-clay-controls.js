function cleanText(value, fallback) {
  if (typeof value !== "string") return fallback || "";
  var clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean || fallback || "";
}

export function isExactSearchControlMessage(state, message) {
  if (!state || !message || message.requestId !== state.requestId) return false;
  if (state.mateId && message.mateId && message.mateId !== state.mateId) return false;
  if (state.sessionId) {
    if (message.type === "home_mate_session_identity") return message.previousSessionId === state.sessionId;
    if (message.sessionId !== state.sessionId) return false;
  }
  return true;
}

export function replaceSearchPermissions(state, permissions) {
  state.permissions = Array.isArray(permissions) ? permissions.filter(function (item) {
    return item && typeof item.permissionRequestId === "string" && item.permissionRequestId;
  }).map(function (item) {
    return { permissionRequestId: item.permissionRequestId, toolName: cleanText(item.toolName, "Tool"), toolInput: item.toolInput || {}, decisionReason: cleanText(item.decisionReason, ""), status: "pending" };
  }) : [];
}

export function applySearchPermissionMessage(state, message) {
  if (!isExactSearchControlMessage(state, message)) return false;
  if (!Array.isArray(state.permissions)) state.permissions = [];
  var permissionRequestId = message.permissionRequestId;
  var index = -1;
  for (var i = 0; i < state.permissions.length; i++) {
    if (state.permissions[i].permissionRequestId === permissionRequestId) index = i;
  }
  if (message.type === "home_mate_permission_request") {
    var permission = { permissionRequestId: permissionRequestId, toolName: cleanText(message.toolName, "Tool"), toolInput: message.toolInput || {}, decisionReason: cleanText(message.decisionReason, ""), status: "pending" };
    if (index === -1) state.permissions.push(permission);
    else state.permissions[index] = permission;
    return true;
  }
  if (index === -1) return true;
  if (message.type === "home_mate_permission_resolved") {
    state.permissions[index].status = message.decision === "allow" ? "allowed" : "denied";
  } else if (message.type === "home_mate_permission_cancelled") {
    state.permissions[index].status = "cancelled";
  }
  return true;
}

function permissionTarget(permission) {
  var input = permission.toolInput && typeof permission.toolInput === "object" ? permission.toolInput : {};
  return cleanText(input.file_path || input.command || input.url || input.query || input.pattern || permission.decisionReason, "Clay needs your approval to continue.");
}

export function createSearchPermissionCard(permission, onDecision) {
  var card = document.createElement("section");
  card.className = "search-clay-permission is-" + permission.status;
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", "Permission request for " + permission.toolName);
  var title = document.createElement("strong");
  title.textContent = "Allow " + permission.toolName + "?";
  card.appendChild(title);
  var target = document.createElement("p");
  target.textContent = permissionTarget(permission);
  card.appendChild(target);
  if (permission.status === "pending" || permission.status === "answering") {
    var actions = document.createElement("div");
    var deny = document.createElement("button");
    deny.type = "button";
    deny.textContent = "Deny";
    deny.disabled = permission.status === "answering";
    deny.addEventListener("click", function () { onDecision(permission, "deny"); });
    var allow = document.createElement("button");
    allow.type = "button";
    allow.className = "is-primary";
    allow.textContent = "Approve";
    allow.disabled = permission.status === "answering";
    allow.addEventListener("click", function () { onDecision(permission, "allow"); });
    actions.appendChild(deny);
    actions.appendChild(allow);
    card.appendChild(actions);
  } else {
    var result = document.createElement("small");
    result.textContent = permission.status === "allowed" ? "Approved" : (permission.status === "denied" ? "Denied" : "Cancelled");
    card.appendChild(result);
  }
  return card;
}
