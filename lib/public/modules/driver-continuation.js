import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { addToMessages, scrollToBottom } from './app-rendering.js';
import { iconHtml, refreshIcons } from './icons.js';
import { continuationKey, authoritativeState, beginRequest, applyResponse, failRequest, sendContinuationPayload, continuationCanAct } from './driver-continuation-state.js';

var REQUEST_TIMEOUT_MS = 12000;

function states() {
  return store.get("driverContinuations") || {};
}

function stateFor(key) {
  return states()[key] || null;
}

function setState(key, value) {
  var next = Object.assign({}, states());
  next[key] = value;
  store.set({ driverContinuations: next });
}

function currentProjectAllows(message) {
  var current = store.get("currentSlug");
  return !current || !message.projectSlug || current === message.projectSlug;
}

function hydrate(message) {
  if (!currentProjectAllows(message)) return null;
  var normalized = message;
  var activeSessionId = store.get("activeSessionId");
  if (message.type === "driver_continuation_proposal" && activeSessionId !== undefined && activeSessionId !== null) {
    normalized = Object.assign({}, message, { sourceSessionId: activeSessionId });
  }
  var state = authoritativeState(normalized);
  if (!state.key) return null;
  setState(state.key, state);
  return state;
}

function cardsFor(key) {
  var cards = document.querySelectorAll("[data-driver-continuation-key]");
  var found = [];
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset.driverContinuationKey === key) found.push(cards[i]);
  }
  return found;
}

function statusLabel(status) {
  if (status === "starting") return "Starting new session";
  if (status === "accepted") return "Continued in new session";
  if (status === "declined") return "Staying here";
  if (status === "superseded") return "Work changed";
  return "Your choice";
}

function syncCard(card) {
  var state = stateFor(card.dataset.driverContinuationKey);
  if (!state) return;
  card.dataset.status = state.status;
  card.dataset.inflight = state.inflight ? "true" : "false";
  var badge = card.querySelector(".driver-continuation-status");
  var error = card.querySelector(".driver-continuation-error");
  if (badge) badge.textContent = statusLabel(state.status);
  if (error) {
    error.textContent = state.error;
    error.hidden = !state.error;
  }
  var enabled = continuationCanAct(state, store.get("connected"));
  var buttons = card.querySelectorAll(".driver-continuation-action");
  for (var i = 0; i < buttons.length; i++) buttons[i].disabled = !enabled;
  var sourceButton = card.querySelector(".driver-continuation-source");
  if (sourceButton) sourceButton.disabled = state.inflight || store.get("connected") !== true;
}

function syncKey(key) {
  var cards = cardsFor(key);
  for (var i = 0; i < cards.length; i++) syncCard(cards[i]);
}

function requestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "continuation_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function fail(key, exactRequestId, message) {
  var next = failRequest(stateFor(key), exactRequestId, message);
  if (!next) return false;
  setState(key, next);
  return true;
}

function sendRequest(key, kind, payload) {
  var ws = getWs();
  var id = requestId();
  var next = beginRequest(stateFor(key), kind, id, store.get("connected"));
  if (!next || !ws || ws.readyState !== 1) return false;
  setState(key, next);
  payload.requestId = id;
  payload.projectSlug = next.projectSlug;
  payload.sourceOriginId = next.sourceOriginId;
  payload.proposalId = next.proposalId;
  var sent = sendContinuationPayload(ws, payload);
  if (!sent.ok) {
    fail(key, id, sent.error);
    return false;
  }
  setTimeout(function () {
    fail(key, id, "Clay did not confirm the request. Check the connection and try again.");
  }, REQUEST_TIMEOUT_MS);
  return true;
}

function sendChoice(card, accepted) {
  sendRequest(card.dataset.driverContinuationKey, "decision", {
    type: "driver_continuation_response",
    accepted: accepted === true,
  });
}

function addDetail(details, label, value) {
  if (!value) return;
  var term = document.createElement("dt");
  term.textContent = label;
  var description = document.createElement("dd");
  description.textContent = value;
  details.appendChild(term);
  details.appendChild(description);
}

function evidenceText(evidence) {
  if (!evidence) return "";
  if (evidence.kind === "current_context_pressure" && typeof evidence.usedRatio === "number") {
    var percent = Math.round(evidence.usedRatio * 100);
    var threshold = Math.round(Number(evidence.thresholdRatio || 0) * 100);
    return percent + "% of the current context is in use (proposal threshold: " + threshold + "%).";
  }
  if (evidence.kind === "recorded_compaction") {
    var count = Number(evidence.observedCount || 0);
    return "Clay recorded " + count + " completed context compaction" + (count === 1 ? "" : "s") + " in this session.";
  }
  return "";
}

export function renderDriverContinuation(msg) {
  var state = hydrate(msg);
  if (!state) return;
  var existing = cardsFor(state.key);
  if (existing.length) { syncKey(state.key); return; }
  var handoff = msg.handoff || {};
  var card = document.createElement("section");
  card.className = "driver-continuation-card";
  card.dataset.driverContinuationKey = state.key;
  card.innerHTML = '<header><span class="driver-continuation-mark">' + iconHtml("arrow-up-right") + '</span><div><span class="driver-continuation-kicker">DRIVER CONTINUATION</span><strong>Carry this work into a fresh session?</strong></div><span class="driver-continuation-status"></span></header>';
  var reason = document.createElement("p");
  reason.className = "driver-continuation-reason";
  reason.textContent = msg.reason || "The Driver identified a safe boundary for a compact handoff.";
  card.appendChild(reason);
  var summary = document.createElement("div");
  summary.className = "driver-continuation-summary";
  addDetail(summary, "Observed evidence", evidenceText(msg.triggerEvidence));
  addDetail(summary, "Completed milestone", msg.milestone);
  addDetail(summary, "Why a fresh session helps", msg.benefit);
  addDetail(summary, "Goal", handoff.goal);
  addDetail(summary, "Next action", handoff.nextAction);
  card.appendChild(summary);
  var disclosure = document.createElement("details");
  disclosure.className = "driver-continuation-details";
  disclosure.innerHTML = "<summary>Review inherited context</summary>";
  var details = document.createElement("dl");
  addDetail(details, "Constraints", handoff.constraints);
  addDetail(details, "Decisions and why", handoff.decisions);
  addDetail(details, "Rejected approaches", handoff.rejectedApproaches);
  addDetail(details, "Unresolved", handoff.unresolved);
  addDetail(details, "Repository state", handoff.repositoryState);
  addDetail(details, "Verification", handoff.verification);
  disclosure.appendChild(details);
  card.appendChild(disclosure);
  var error = document.createElement("p");
  error.className = "driver-continuation-error";
  error.hidden = true;
  card.appendChild(error);
  var actions = document.createElement("div");
  actions.className = "driver-continuation-actions";
  var stay = document.createElement("button");
  stay.type = "button";
  stay.className = "driver-continuation-action secondary";
  stay.textContent = "Stay here";
  stay.addEventListener("click", function () { sendChoice(card, false); });
  var proceed = document.createElement("button");
  proceed.type = "button";
  proceed.className = "driver-continuation-action primary";
  proceed.innerHTML = iconHtml("arrow-right") + "<span>Continue in new session</span>";
  proceed.addEventListener("click", function () { sendChoice(card, true); });
  actions.appendChild(stay);
  actions.appendChild(proceed);
  card.appendChild(actions);
  addToMessages(card);
  syncCard(card);
  refreshIcons();
  scrollToBottom();
}

export function updateDriverContinuation(msg) {
  if (!currentProjectAllows(msg)) return false;
  var key = continuationKey(msg);
  var current = stateFor(key);
  if (!current) return false;
  var next = applyResponse(current, msg);
  if (!next) return false;
  setState(key, next);
  return true;
}

export function renderDriverContinuationContext(msg) {
  var seed = Object.assign({ status: "accepted" }, msg);
  var key = continuationKey(seed);
  if (!stateFor(key)) hydrate(seed);
  var card = document.createElement("section");
  card.className = "driver-continuation-context";
  card.dataset.driverContinuationKey = key;
  card.innerHTML = '<span class="driver-continuation-mark">' + iconHtml("history") + '</span><div class="driver-continuation-context-copy"><span class="driver-continuation-kicker">INHERITED CONTEXT</span></div>';
  var copy = card.querySelector(".driver-continuation-context-copy");
  var title = document.createElement("strong");
  title.textContent = msg.goal || "Continued Driver work";
  var next = document.createElement("p");
  next.textContent = "Next: " + (msg.nextAction || "Revalidate the current state and continue.");
  var error = document.createElement("p");
  error.className = "driver-continuation-error";
  error.hidden = true;
  var source = document.createElement("button");
  source.type = "button";
  source.className = "driver-continuation-source";
  source.textContent = "Open original session";
  source.addEventListener("click", function () {
    sendRequest(key, "open_source", { type: "driver_continuation_open_source" });
  });
  copy.appendChild(title);
  copy.appendChild(next);
  copy.appendChild(error);
  copy.appendChild(source);
  addToMessages(card);
  syncCard(card);
  refreshIcons();
}

store.subscribe(function (state, previous) {
  if (state.connected === previous.connected &&
      state.driverContinuations === previous.driverContinuations) return;
  if (state.connected === false && previous.connected === true) {
    var current = states();
    var keys = Object.keys(current);
    for (var i = 0; i < keys.length; i++) {
      if (current[keys[i]].inflight) fail(keys[i], current[keys[i]].requestId, "Connection lost before Clay confirmed the request. Try again after reconnecting.");
    }
  }
  var cards = document.querySelectorAll("[data-driver-continuation-key]");
  for (var j = 0; j < cards.length; j++) syncCard(cards[j]);
});
