import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { isDriverOperatedView } from './worker-pane-lock.js';

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function eligible() {
  var state = store.snap();
  var home = document.getElementById("home-hub");
  var onHome = home && !home.classList.contains("hidden");
  return !state.dmMode && !onHome && state.activeSessionMode === "gui" && !isDriverOperatedView(state);
}

function active(run) {
  return !!(run && ["armed", "running", "reviewing", "waiting-worker", "waiting-user", "paused"].indexOf(run.state) !== -1);
}

function formatState(state) {
  var labels = {
    armed: "Ready to send",
    running: "Working",
    reviewing: "Reviewing",
    "waiting-worker": "Waiting for Worker",
    "waiting-user": "Waiting for you",
    paused: "Paused",
    completed: "Completed",
    stopped: "Stopped",
    limit: "Limit reached",
    error: "Error",
  };
  return labels[state] || "Loop";
}

function remainingTime(run) {
  if (!run || !run.deadlineAt) return run && run.maxMinutes ? run.maxMinutes + " min" : "60 min";
  return Math.max(0, Math.ceil((run.deadlineAt - Date.now()) / 60000)) + " min";
}

function requestId(prefix) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return prefix + "-" + globalThis.crypto.randomUUID();
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

function closePopover(returnFocus) {
  var popover = document.getElementById("execution-mode-popover");
  if (popover) popover.classList.add("hidden");
  var button = document.getElementById("execution-mode-btn");
  if (button) button.setAttribute("aria-expanded", "false");
  if (returnFocus && button) button.focus();
}

function setCriteriaInput(value) {
  var input = document.getElementById("execution-success-criteria");
  if (input) input.value = value || "";
}

function renderSelector() {
  var wrap = document.getElementById("execution-mode-wrap");
  var button = document.getElementById("execution-mode-btn");
  var label = document.getElementById("execution-mode-label");
  if (!wrap || !button || !label) return;
  var visible = eligible();
  wrap.classList.toggle("hidden", !visible);
  if (!visible) return;
  var state = store.snap();
  var busyOrdinary = !!state.processing && !active(state.autonomousRun);
  button.disabled = state.autonomousArming || busyOrdinary;
  button.classList.toggle("active", state.autonomousSelectedMode === "until-complete" || active(state.autonomousRun));
  button.classList.toggle("arming", state.autonomousArming);
  var modeLabel = state.autonomousArming ? "Enabling Loop" : (state.autonomousSelectedMode === "until-complete" ? "Loop" : "Normal");
  label.textContent = state.autonomousArming ? "Enabling…" : modeLabel;
  button.setAttribute("aria-pressed", state.autonomousSelectedMode === "until-complete" ? "true" : "false");
  button.setAttribute("aria-label", "Execution mode: " + modeLabel);
  button.title = busyOrdinary ? "Wait for the current task to finish" : "Choose how this task runs";
}

function renderStatus() {
  var bar = document.getElementById("autonomous-run-status");
  if (!bar) return;
  var currentRun = store.get("autonomousRun");
  if (!currentRun || (!active(currentRun) && !currentRun.terminalReason)) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  bar.classList.toggle("terminal", !active(currentRun));
  bar.classList.toggle("expanded", store.get("autonomousExpanded"));
  var stateEl = document.getElementById("autonomous-run-state");
  var progressEl = document.getElementById("autonomous-run-progress");
  var detailEl = document.getElementById("autonomous-run-detail");
  var stop = document.getElementById("autonomous-run-stop");
  var resume = document.getElementById("autonomous-run-resume");
  if (stateEl) stateEl.textContent = formatState(currentRun.state);
  if (progressEl) progressEl.textContent = currentRun.continuationCount + "/" + currentRun.maxContinuations + " continuations · " + remainingTime(currentRun) + " left";
  if (stop) stop.classList.toggle("hidden", !active(currentRun) || currentRun.state === "armed");
  if (resume) resume.classList.toggle("hidden", currentRun.state !== "paused");
  if (detailEl) {
    detailEl.innerHTML = "";
    var fields = [
      ["Goal", currentRun.objective || "Waiting for the task"],
      ["Success criteria", (currentRun.successCriteria || []).join("\n") || "Meaningfully verify the requested outcome"],
      ["Status", currentRun.waitingReason || currentRun.terminalReason || (currentRun.outcome && currentRun.outcome.summary) || formatState(currentRun.state)],
    ];
    for (var i = 0; i < fields.length; i++) {
      var row = document.createElement("div");
      var title = document.createElement("span");
      var value = document.createElement("span");
      row.className = "autonomous-run-detail-row";
      title.textContent = fields[i][0];
      value.textContent = fields[i][1];
      row.appendChild(title);
      row.appendChild(value);
      detailEl.appendChild(row);
    }
    if (currentRun.outcome && currentRun.outcome.evidence && currentRun.outcome.evidence.length) {
      var evidence = document.createElement("div");
      evidence.className = "autonomous-run-detail-row";
      var evidenceTitle = document.createElement("span");
      var evidenceValue = document.createElement("span");
      evidenceTitle.textContent = "Driver evidence";
      evidenceValue.textContent = currentRun.outcome.evidence.join("\n");
      evidence.appendChild(evidenceTitle);
      evidence.appendChild(evidenceValue);
      detailEl.appendChild(evidence);
    }
  }
}

function render() {
  renderSelector();
  renderStatus();
  refreshIcons();
}

function arm() {
  if (store.get("autonomousArming") || !eligible()) return;
  var criteria = document.getElementById("execution-success-criteria").value.trim();
  var maxContinuations = parseInt(document.getElementById("execution-max-continuations").value, 10) || 10;
  var maxMinutes = parseInt(document.getElementById("execution-max-minutes").value, 10) || 60;
  var sessionId = store.get("activeSessionId");
  var armRequestId = requestId("arm");
  var successCriteria = criteria.split("\n").map(function (item) { return item.trim(); }).filter(Boolean);
  store.set({ autonomousArming: true, autonomousSelectedMode: "until-complete", autonomousCriteria: criteria,
    autonomousMaxContinuations: maxContinuations, autonomousMaxMinutes: maxMinutes,
    autonomousArmRequestId: armRequestId, autonomousArmSessionId: sessionId });
  closePopover();
  render();
  if (!send({ type: "autonomous_run_arm", sessionId: sessionId, requestId: armRequestId, successCriteria: successCriteria,
    maxContinuations: maxContinuations, maxMinutes: maxMinutes })) {
    store.set({ autonomousArming: false, autonomousSelectedMode: "normal", autonomousArmRequestId: null, autonomousArmSessionId: null });
    render();
  }
}

function sendAction(type) {
  var state = store.snap();
  var actionRequestId = requestId("action");
  var runId = state.autonomousRun && state.autonomousRun.id || null;
  store.set({ autonomousActionRequestId: actionRequestId, autonomousActionSessionId: state.activeSessionId });
  if (!send({ type: type, sessionId: state.activeSessionId, requestId: actionRequestId, runId: runId })) {
    store.set({ autonomousActionRequestId: null, autonomousActionSessionId: null });
    return false;
  }
  return true;
}

function selectNormal() {
  closePopover();
  var currentRun = store.get("autonomousRun");
  if (currentRun && currentRun.state === "armed") {
    sendAction("autonomous_run_disarm");
  }
  store.set({ autonomousSelectedMode: "normal", autonomousArming: false, autonomousArmToken: null,
    autonomousArmRequestId: null, autonomousArmSessionId: null, autonomousCriteria: "" });
  setCriteriaInput("");
  render();
}

export function prepareAutonomousPayload(payload) {
  var state = store.snap();
  if (state.autonomousArming || (state.autonomousSelectedMode === "until-complete" && (!state.autonomousArmToken || !state.autonomousRun || state.autonomousRun.state !== "armed"))) {
    showToast("Wait for Skip Permissions to be enabled before sending.", "error");
    return false;
  }
  if (state.autonomousSelectedMode !== "until-complete") return true;
  payload.autonomousRunToken = state.autonomousArmToken;
  payload.autonomousSuccessCriteria = (state.autonomousRun.successCriteria || []).slice();
  store.set({ autonomousSelectedMode: "normal", autonomousArmToken: null });
  render();
  return true;
}

export function handleAutonomousRunMessage(msg) {
  if (msg.type === "autonomous_run_arm_result") {
    var state = store.snap();
    if (Number(msg.sessionId) !== Number(state.activeSessionId) || Number(msg.sessionId) !== Number(state.autonomousArmSessionId) || msg.requestId !== state.autonomousArmRequestId) return true;
    store.set({ autonomousArming: false, autonomousArmRequestId: null, autonomousArmSessionId: null });
    if (!msg.ok) {
      store.set({ autonomousSelectedMode: "normal", autonomousArmToken: null, autonomousCriteria: "" });
      showToast(msg.error || "Loop could not be enabled.", "error");
    } else {
      var persistedCriteria = (msg.run.successCriteria || []).join("\n");
      store.set({ autonomousRun: msg.run, autonomousArmToken: msg.armToken, autonomousSelectedMode: "until-complete",
        autonomousCriteria: persistedCriteria });
      setCriteriaInput(persistedCriteria);
    }
    render();
    return true;
  }
  if (msg.type === "autonomous_run_action_result") {
    var actionState = store.snap();
    if (Number(msg.sessionId) !== Number(actionState.activeSessionId) || Number(msg.sessionId) !== Number(actionState.autonomousActionSessionId) || msg.requestId !== actionState.autonomousActionRequestId) return true;
    if (msg.runId && actionState.autonomousRun && msg.runId !== actionState.autonomousRun.id) return true;
    store.set({ autonomousActionRequestId: null, autonomousActionSessionId: null });
    if (!msg.ok) showToast(msg.error || "The Loop action failed.", "error");
    return true;
  }
  if (msg.type === "autonomous_run_state") {
    if (Number(msg.sessionId) !== Number(store.get("activeSessionId"))) return true;
    var currentRun = msg.run || null;
    var armToken = store.get("autonomousArmToken");
    if (currentRun && currentRun.state === "armed") {
      armToken = currentRun.armToken || armToken;
    }
    store.set({ autonomousRun: currentRun, autonomousArmToken: currentRun && currentRun.state === "armed" ? armToken : null,
      autonomousSelectedMode: currentRun && currentRun.state === "armed" ? "until-complete" : "normal",
      autonomousCriteria: currentRun ? (currentRun.successCriteria || []).join("\n") : "" });
    setCriteriaInput(currentRun ? (currentRun.successCriteria || []).join("\n") : "");
    render();
    return true;
  }
  return false;
}

export function syncAutonomousRunForSession(run) {
  var currentRun = run || null;
  var armToken = currentRun && currentRun.state === "armed" ? currentRun.armToken || null : null;
  store.set({ autonomousRun: currentRun, autonomousArming: false, autonomousArmToken: armToken,
    autonomousSelectedMode: armToken ? "until-complete" : "normal", autonomousExpanded: false,
    autonomousCriteria: currentRun ? (currentRun.successCriteria || []).join("\n") : "",
    autonomousArmRequestId: null, autonomousArmSessionId: null,
    autonomousActionRequestId: null, autonomousActionSessionId: null });
  setCriteriaInput(currentRun ? (currentRun.successCriteria || []).join("\n") : "");
  render();
}

export function initAutonomousRun() {
  var button = document.getElementById("execution-mode-btn");
  var popover = document.getElementById("execution-mode-popover");
  if (button && popover) {
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      var opening = popover.classList.contains("hidden");
      popover.classList.toggle("hidden");
      button.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    document.getElementById("execution-normal-option").addEventListener("click", selectNormal);
    document.getElementById("execution-until-option").addEventListener("click", arm);
    document.addEventListener("click", function (event) { if (!popover.contains(event.target) && !button.contains(event.target)) closePopover(); });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || popover.classList.contains("hidden")) return;
      event.preventDefault();
      closePopover(true);
    });
  }
  document.getElementById("autonomous-run-toggle").addEventListener("click", function () { store.set({ autonomousExpanded: !store.get("autonomousExpanded") }); renderStatus(); });
  document.getElementById("autonomous-run-stop").addEventListener("click", function () { sendAction("autonomous_run_stop"); });
  document.getElementById("autonomous-run-resume").addEventListener("click", function () { sendAction("autonomous_run_resume"); });
  store.subscribe(function (state, prev) {
    if (state.processing !== prev.processing || state.dmMode !== prev.dmMode || state.activeSessionMode !== prev.activeSessionMode || state.splitGroups !== prev.splitGroups || state.paneSessionId !== prev.paneSessionId) renderSelector();
  });
  var home = document.getElementById("home-hub");
  if (home && typeof MutationObserver === "function") {
    new MutationObserver(function () { renderSelector(); }).observe(home, { attributes: true, attributeFilter: ["class"] });
  }
  setInterval(function () { if (active(store.get("autonomousRun"))) renderStatus(); }, 30000);
  render();
}
