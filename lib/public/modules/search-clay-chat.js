// Compact Clay conversation hosted inside the global search drawer.
import { getWs } from './ws-ref.js';
import { showHomeHub } from './app-home-hub.js';
import { openHomeConversation } from './home-mate-chat.js';
import { refreshIcons } from './icons.js';
import { store } from './store.js';
import { mateAvatarUrl } from './avatar.js';
import { createAssistantBubble, createUserBubble, finalizeAssistantBubble, renderAssistantBubbleText } from './chat-bubble-renderer.js';
import { isExactSearchControlMessage, replaceSearchPermissions, applySearchPermissionMessage, createSearchPermissionCard } from './search-clay-controls.js';

var state = store.get('searchClayChatState') || null;
var hostEl = null;
var backHandler = null;
var closeHandler = null;
var sequence = 0;
var progressTimer = null;

function send(payload) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function requestId() {
  sequence++;
  return "search-clay-" + Date.now() + "-" + sequence;
}

function stopProgressTimer() {
  if (!progressTimer) return;
  clearInterval(progressTimer);
  progressTimer = null;
}

function startProgressTimer() {
  if (progressTimer) return;
  progressTimer = setInterval(function () { if (state && state.processing) updateProgressDom(); else stopProgressTimer(); }, 1000);
}

function progressCopy() {
  var elapsed = state && state.startedAt ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0;
  var label = state && state.step ? "Considering what was found" : "Understanding what to look for";
  if (state.activity === "searching") label = state.step > 1 ? "Checking another lead" : "Searching your conversations";
  else if (state.activity === "reviewing") label = "Reviewing what Clay found";
  else if (state.activity === "reconsidering") label = "Trying another search route";
  else if (elapsed >= 12) label = "Following related context";
  else if (elapsed >= 4) label = "Searching your conversations";
  var detail = (state.step ? "Search pass " + state.step + " · " : "") + elapsed + "s";
  return { label: label, detail: detail };
}

function updateProgressDom() {
  if (!hostEl) return;
  var progress = progressCopy();
  var label = hostEl.querySelector(".search-clay-pending-copy strong");
  var detail = hostEl.querySelector(".search-clay-pending-copy small");
  if (label) label.textContent = progress.label;
  if (detail) detail.textContent = progress.detail;
  var activeDetails = hostEl.querySelectorAll(".search-clay-activity-item.is-active small");
  var activeIndex = 0;
  for (var i = 0; state && i < state.activities.length; i++) {
    if (state.activities[i].status !== "active") continue;
    var elapsed = Math.max(0, Math.floor((Date.now() - state.activities[i].startedAt) / 1000));
    state.activities[i].detail = elapsed + "s elapsed";
    if (activeDetails[activeIndex]) activeDetails[activeIndex].textContent = state.activities[i].detail;
    activeIndex++;
  }
}

function button(icon, label, title, handler) {
  var el = document.createElement("button");
  el.type = "button";
  el.className = "search-clay-icon-button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.innerHTML = '<i data-lucide="' + icon + '" aria-hidden="true"></i><span>' + label + '</span>';
  el.addEventListener("click", handler);
  return el;
}

function clayMate() {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && (mates[i].id === state.mateId || mates[i].builtinKey === "clay")) return mates[i];
  }
  return { name: "Clay", profile: { displayName: "Clay", avatarCustom: "/clay-studio-symbol.png" } };
}

function appendActivityList(content, items, expanded, onToggle) {
  var panel = document.createElement("div");
  panel.className = "search-clay-activity-panel " + (expanded ? "is-expanded" : "is-collapsed");
  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "search-clay-activity-toggle";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.setAttribute("aria-label", (expanded ? "Collapse" : "Expand") + " Clay activity, " + items.length + (items.length === 1 ? " step" : " steps"));
  toggle.innerHTML = '<i data-lucide="activity" aria-hidden="true"></i><span><strong>Activity</strong><small></small></span><i class="search-clay-activity-chevron" data-lucide="chevron-down" aria-hidden="true"></i>';
  toggle.querySelector("small").textContent = items.length + (items.length === 1 ? " step" : " steps");
  if (items.length <= 2) {
    toggle.disabled = true;
    toggle.setAttribute("aria-label", "Clay activity, " + items.length + (items.length === 1 ? " step" : " steps"));
  } else {
    toggle.addEventListener("click", function () {
      expanded = !expanded;
      panel.classList.toggle("is-expanded", expanded);
      panel.classList.toggle("is-collapsed", !expanded);
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.setAttribute("aria-label", (expanded ? "Collapse" : "Expand") + " Clay activity, " + items.length + " steps");
      onToggle(expanded);
    });
  }
  panel.appendChild(toggle);
  var list = document.createElement("div");
  list.className = "search-clay-activity-list";
  for (var i = 0; i < items.length; i++) {
    var item = document.createElement("div");
    item.className = "search-clay-activity-item is-" + items[i].status;
    item.innerHTML = '<i data-lucide="' + activityIcon(items[i].status) + '" aria-hidden="true"></i>';
    var copy = document.createElement("span");
    var label = document.createElement("strong");
    label.textContent = items[i].label;
    copy.appendChild(label);
    var detail = document.createElement("small");
    detail.textContent = items[i].detail || "";
    copy.appendChild(detail);
    item.appendChild(copy);
    list.appendChild(item);
  }
  panel.appendChild(list);
  content.appendChild(panel);
}

function renderMessage(message, streaming) {
  var row;
  if (message.role === "user") {
    row = createUserBubble({ text: message.text || "" });
    row.classList.add("search-clay-message", "search-clay-message-user");
  } else {
    row = createAssistantBubble({ name: "Clay", avatarUrl: mateAvatarUrl(clayMate(), 28) });
    row.classList.add("search-clay-message", "search-clay-message-assistant");
    if (streaming) renderAssistantBubbleText(row, message.text || "", false);
    else finalizeAssistantBubble(row, message.text || "", false);
    if (message.activities && message.activities.length) {
      appendActivityList(row.querySelector(".dm-bubble-content"), message.activities, message.activitiesExpanded === true, message.toggleActivities || function (expanded) { message.activitiesExpanded = expanded; });
      row.classList.add("search-clay-activity-message");
    }
  }
  row.setAttribute("role", "article");
  row.setAttribute("aria-label", message.role === "user" ? "Your message" : "Message from Clay");
  return row;
}

function activityIcon(status) {
  if (status === "done") return "circle-check";
  if (status === "error") return "circle-alert";
  return "loader-circle";
}

function updateActivity(message) {
  var id = message.activityId || message.phase + ":" + (message.step || 0);
  var activity = null;
  for (var i = 0; i < state.activities.length; i++) if (state.activities[i].id === id) activity = state.activities[i];
  if (!activity) {
    activity = { id: id, label: message.label || "Working", detail: "0s elapsed", status: message.status || "active", startedAt: Date.now() };
    state.activities.push(activity);
  } else if (message.status === "active") {
    activity.label = message.label || activity.label;
    activity.status = "active";
  } else {
    var elapsed = Math.max(0, Math.floor((Date.now() - activity.startedAt) / 1000));
    activity.detail = (message.label || "Complete") + (elapsed ? " \u00b7 " + elapsed + "s" : "");
    activity.status = message.status || "done";
  }
  if (state.activities.length > 12) state.activities = state.activities.slice(state.activities.length - 12);
}

function takeActivities(finalLabel, finalStatus) {
  var now = Date.now();
  for (var i = 0; i < state.activities.length; i++) {
    if (state.activities[i].status !== "active") continue;
    var elapsed = Math.max(0, Math.floor((now - state.activities[i].startedAt) / 1000));
    state.activities[i].status = finalStatus || "done";
    state.activities[i].detail = finalLabel + (elapsed ? " \u00b7 " + elapsed + "s" : "");
  }
  var items = state.activities.slice();
  state.activities = [];
  return items;
}

function submit(input, sendButton) {
  var text = input.value.trim();
  if (!state || !text || !state.sessionId) return;
  if (!send({ type: "home_mate_send", mateId: state.mateId, sessionId: state.sessionId, requestId: state.requestId, text: text })) return;
  if (state.processing) {
    state.queuedUsers.push({ role: "user", text: text });
  } else {
    state.messages.push({ role: "user", text: text });
    state.processing = true;
    state.awaitingCompletion = true;
    state.stream = "";
    state.activity = "thinking";
    state.step = 0;
    state.activities = [];
    state.activityExpanded = false;
    state.startedAt = Date.now();
  }
  state.pendingTurns++;
  state.updatedAt = Date.now();
  startProgressTimer();
  state.draft = "";
  input.value = "";
  sendButton.disabled = true;
  render();
}

function stopSearchClayChat() {
  if (!state || !state.processing || state.stopping || !state.mateId || !state.sessionId) return false;
  if (!send({ type: "home_mate_stop", mateId: state.mateId, sessionId: state.sessionId, requestId: state.requestId })) return false;
  state.stopping = true;
  render();
  return true;
}

function respondToPermission(permission, decision) {
  if (!state || permission.status !== "pending") return false;
  if (!send({ type: "home_mate_permission_response", mateId: state.mateId, sessionId: state.sessionId, requestId: state.requestId, permissionRequestId: permission.permissionRequestId, decision: decision })) return false;
  permission.status = "answering";
  render();
  return true;
}

function expand() {
  if (!state || !state.mateId || !state.sessionId) return;
  var mateId = state.mateId;
  var sessionId = state.sessionId;
  if (closeHandler) closeHandler();
  showHomeHub();
  openHomeConversation(mateId, sessionId);
}

function render() {
  if (!hostEl || !state) return;
  var shell = hostEl.querySelector(".search-clay-chat");
  var transcript = shell ? shell.querySelector(".search-clay-transcript") : null;
  var previousTop = transcript ? transcript.scrollTop : 0;
  var follow = !transcript || transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40;
  if (!shell) {
    hostEl.innerHTML = "";
    shell = document.createElement("section");
    shell.className = "search-clay-chat";
    shell.setAttribute("aria-label", "Chat with Clay");
    var header = document.createElement("header");
    header.className = "search-clay-header";
    var identity = document.createElement("div");
    identity.className = "search-clay-identity";
    identity.innerHTML = '<span><strong>Clay</strong><small>Workspace search</small></span>';
    header.appendChild(identity);
    var actions = document.createElement("div");
    actions.className = "search-clay-header-actions";
    actions.appendChild(button("search", "Search", "Back to search", function () { detachSearchClayChat(); if (backHandler) backHandler(); }));
    actions.appendChild(button("maximize-2", "Expand", "Open this conversation in Home", expand));
    header.appendChild(actions);
    shell.appendChild(header);
    transcript = document.createElement("div");
    transcript.className = "search-clay-transcript";
    transcript.setAttribute("aria-live", "polite");
    shell.appendChild(transcript);
    var composer = document.createElement("div");
    composer.className = "search-clay-composer";
    var freshInput = document.createElement("textarea");
    freshInput.rows = 1;
    freshInput.value = state.draft || "";
    freshInput.setAttribute("aria-label", "Message Clay");
    var freshSendButton = document.createElement("button");
    freshSendButton.type = "button";
    freshSendButton.className = "search-clay-send";
    freshSendButton.setAttribute("aria-label", "Send to Clay");
    freshSendButton.innerHTML = '<i data-lucide="arrow-up" aria-hidden="true"></i>';
    freshInput.addEventListener("input", function () { state.draft = freshInput.value; freshSendButton.disabled = state.processing ? (!state.sessionId || state.stopping) : (!state.sessionId || !freshInput.value.trim()); });
    freshInput.addEventListener("keydown", function (event) { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(freshInput, freshSendButton); } });
    freshSendButton.addEventListener("click", function () { if (state.processing) stopSearchClayChat(); else submit(freshInput, freshSendButton); });
    composer.appendChild(freshInput);
    composer.appendChild(freshSendButton);
    shell.appendChild(composer);
    hostEl.appendChild(shell);
  }
  transcript.innerHTML = "";
  for (var i = 0; i < state.messages.length; i++) transcript.appendChild(renderMessage(state.messages[i], false));
  if (state.activities.length || state.stream) transcript.appendChild(renderMessage({ role: "assistant", text: state.stream, activities: state.activities, activitiesExpanded: state.activityExpanded, toggleActivities: function (expanded) { state.activityExpanded = expanded; } }, true));
  for (var p = 0; p < state.permissions.length; p++) transcript.appendChild(createSearchPermissionCard(state.permissions[p], respondToPermission));
  if (state.processing && !state.stream && !state.activities.length) {
    var progress = progressCopy();
    var pending = document.createElement("div");
    pending.className = "search-clay-pending";
    pending.setAttribute("role", "status");
    var pendingCopy = document.createElement("span");
    pendingCopy.className = "search-clay-pending-copy";
    var pendingLabel = document.createElement("strong");
    pendingLabel.textContent = progress.label;
    var pendingDetail = document.createElement("small");
    pendingDetail.textContent = progress.detail;
    pendingCopy.appendChild(pendingLabel);
    pendingCopy.appendChild(pendingDetail);
    pending.appendChild(pendingCopy);
    var dots = document.createElement("span");
    dots.className = "search-clay-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.innerHTML = "<i></i><i></i><i></i>";
    pending.appendChild(dots);
    transcript.appendChild(pending);
  }
  for (var q = 0; q < state.queuedUsers.length; q++) transcript.appendChild(renderMessage(state.queuedUsers[q], false));
  var input = shell.querySelector(".search-clay-composer textarea");
  var sendButton = shell.querySelector(".search-clay-send");
  input.placeholder = state.sessionId ? "Message Clay…" : "Starting Clay…";
  input.disabled = !state.sessionId;
  sendButton.disabled = state.processing ? (!state.sessionId || state.stopping) : (!state.sessionId || !input.value.trim());
  sendButton.setAttribute("aria-label", state.processing ? (state.stopping ? "Stopping Clay" : "Stop Clay") : "Send to Clay");
  sendButton.innerHTML = state.processing ? '<i data-lucide="square" aria-hidden="true"></i>' : '<i data-lucide="arrow-up" aria-hidden="true"></i>';
  var expandButton = shell.querySelector('.search-clay-icon-button[aria-label="Open this conversation in Home"]');
  if (expandButton) expandButton.disabled = !state.sessionId;
  refreshIcons();
  transcript.scrollTop = follow ? transcript.scrollHeight : previousTop;
}

export function startSearchClayChat(query, host, onBack, onClose) {
  var clean = typeof query === "string" ? query.trim().slice(0, 12000) : "";
  if (!clean) return false;
  hostEl = host;
  backHandler = onBack;
  closeHandler = onClose;
  var startedAt = Date.now();
  state = { requestId: requestId(), mateId: null, sessionId: null, messages: [{ role: "user", text: clean }], queuedUsers: [], pendingTurns: 1, activities: [], permissions: [], activityExpanded: false, stream: "", draft: "", processing: true, stopping: false, awaitingCompletion: true, activity: "thinking", step: 0, startedAt: startedAt, updatedAt: startedAt, query: clean };
  store.set({ searchClayChatState: state });
  startProgressTimer();
  render();
  if (!send({ type: "home_clay_ask", requestId: state.requestId, text: clean })) {
    state.processing = false;
    state.awaitingCompletion = false;
    state.pendingTurns = 0;
    stopProgressTimer();
    state.messages.push({ role: "assistant", text: "Clay is offline. Reconnect and try again." });
    render();
  }
  return true;
}

export function attachSearchClayChat(host, onBack, onClose) {
  if (!state) return false;
  hostEl = host;
  backHandler = onBack;
  closeHandler = onClose;
  if (state.processing) send({ type: "home_clay_ask", requestId: state.requestId, text: state.query });
  render();
  return true;
}

export function getSearchClayChatSummary() {
  if (!state) return null;
  var preview = "";
  var candidates = state.queuedUsers.length ? state.queuedUsers : state.messages;
  for (var i = candidates.length - 1; i >= 0; i--) {
    if (!candidates[i] || typeof candidates[i].text !== "string" || !candidates[i].text.trim()) continue;
    preview = candidates[i].text.replace(/\s+/g, " ").trim().slice(0, 120);
    break;
  }
  return { sessionId: state.sessionId, processing: state.processing === true, preview: preview, updatedAt: state.updatedAt || state.startedAt || null };
}

export function detachSearchClayChat() { hostEl = null; }

export function handleSearchClayMessage(msg) {
  if (!isExactSearchControlMessage(state, msg)) return false;
  state.updatedAt = Date.now();
  if (msg.mateId) state.mateId = msg.mateId;
  if (msg.type === "home_mate_session_identity" && msg.sessionId) state.sessionId = msg.sessionId;
  if (msg.type === "home_clay_activity") {
    if (!state.awaitingCompletion) return true;
    state.activity = msg.phase || state.activity;
    state.step = typeof msg.step === "number" ? msg.step : state.step;
    updateActivity(msg);
  } else if (msg.type === "home_mate_history") {
    state.sessionId = msg.sessionId || state.sessionId;
    state.messages = Array.isArray(msg.messages) ? msg.messages.filter(function (item) { return item && (item.role === "user" || item.role === "assistant"); }).map(function (item) { return { role: item.role, text: item.text || "" }; }) : state.messages;
    state.processing = msg.isProcessing === true;
    state.awaitingCompletion = state.processing;
    state.pendingTurns = state.processing ? Math.max(1, state.pendingTurns) : 0;
    if (state.processing) startProgressTimer();
    state.stream = "";
    state.stopping = false;
    replaceSearchPermissions(state, msg.pendingPermissions);
  } else if (msg.type === "home_mate_permission_request" || msg.type === "home_mate_permission_resolved" || msg.type === "home_mate_permission_cancelled") {
    applySearchPermissionMessage(state, msg);
  } else if (msg.type === "home_mate_stopping") {
    state.stopping = true;
  } else if (msg.type === "home_mate_delta") {
    if (!state.awaitingCompletion) return true;
    state.sessionId = msg.sessionId || state.sessionId;
    state.processing = true;
    state.pendingTurns = Math.max(1, state.pendingTurns);
    state.stream += msg.text || "";
  } else if (msg.type === "home_mate_done") {
    if (!state.awaitingCompletion) return true;
    var completedActivities = takeActivities("Response complete", "done");
    if (state.stream || msg.text || completedActivities.length) state.messages.push({ role: "assistant", text: state.stream || msg.text || "", activities: completedActivities, activitiesExpanded: state.activityExpanded });
    if (state.queuedUsers.length) state.messages.push(state.queuedUsers.shift());
    state.stream = "";
    state.activityExpanded = false;
    state.pendingTurns = Math.max(0, state.pendingTurns - 1);
    state.processing = state.pendingTurns > 0;
    state.stopping = false;
    state.awaitingCompletion = state.processing;
    state.startedAt = Date.now();
    if (!state.processing) stopProgressTimer();
  } else if (msg.type === "home_mate_error") {
    if (!state.awaitingCompletion) return true;
    var failedActivities = takeActivities("Stopped", "error");
    state.stream = "";
    state.messages.push({ role: "assistant", text: msg.text || "Clay could not complete that search.", activities: failedActivities, activitiesExpanded: state.activityExpanded });
    if (state.queuedUsers.length) state.messages.push(state.queuedUsers.shift());
    state.pendingTurns = Math.max(0, state.pendingTurns - 1);
    state.activityExpanded = false;
    state.processing = state.pendingTurns > 0;
    state.stopping = false;
    state.awaitingCompletion = state.processing;
    state.startedAt = Date.now();
    if (!state.processing) stopProgressTimer();
  }
  render();
  return true;
}

store.subscribe(function (appState, previous) {
  if (!state || appState.connected === previous.connected) return;
  if (!appState.connected) {
    replaceSearchPermissions(state, []);
    state.stopping = false;
    render();
    return;
  }
  if (state.processing) send({ type: "home_clay_ask", requestId: state.requestId, text: state.query });
});
