import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { isDriverOperatedView } from './worker-pane-lock.js';

function requestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return "loop-interview-" + globalThis.crypto.randomUUID();
  return "loop-interview-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

function eligible() {
  var state = store.snap();
  var home = document.getElementById("home-hub");
  var onHome = home && !home.classList.contains("hidden");
  return !state.dmMode && !onHome && state.activeSessionMode === "gui" && !isDriverOperatedView(state);
}

function render() {
  var button = document.getElementById("loop-interview-btn");
  var card = document.getElementById("loop-interview-card");
  if (!button) return;
  var state = store.snap();
  var visible = eligible();
  button.classList.toggle("hidden", !visible);
  button.disabled = !visible || !!state.loopInterviewStarting || !!state.processing;
  button.classList.toggle("arming", !!state.loopInterviewStarting);
  button.setAttribute("aria-label", state.loopInterviewStarting ? "Starting Loop interview" : "Start Loop interview");
  button.title = state.processing ? "Wait for the current task to finish" : "Start a Loop interview with the Driver";
  if (card) {
    var proposal = state.loopInterviewBrief;
    card.classList.toggle("hidden", !proposal);
    if (proposal) {
      var cardKey = proposal.id + ":" + proposal.version + ":" + (state.loopInterviewEditing ? "edit" : "view");
      if (cardKey !== card.getAttribute("data-loop-render-key")) {
        if (state.loopInterviewEditing) {
          card.innerHTML = "<strong>Edit Loop brief</strong><label for=\"loop-interview-objective-input\">Objective</label><textarea id=\"loop-interview-objective-input\" data-loop-field=\"objective\"></textarea><label for=\"loop-interview-criteria-input\">Completion checks</label><textarea id=\"loop-interview-criteria-input\" data-loop-field=\"criteria\"></textarea><div class=\"loop-interview-actions\"><button type=\"button\" data-loop-action=\"save\">Save</button><button type=\"button\" data-loop-action=\"cancel-edit\">Cancel</button></div>";
          card.querySelector('[data-loop-field="objective"]').value = proposal.objective;
          card.querySelector('[data-loop-field="criteria"]').value = proposal.successCriteria.join("\n");
        } else {
          card.innerHTML = "<strong>Loop brief ready for review</strong><div class=\"loop-interview-objective\"></div><div class=\"loop-interview-criteria\"></div><div class=\"loop-interview-limits\"></div><div class=\"loop-interview-disclosure\">Start enables Skip Permissions for this run. Your previous setting is restored when it ends.</div><div class=\"loop-interview-actions\"><button type=\"button\" data-loop-action=\"start\">Start</button><button type=\"button\" data-loop-action=\"edit\">Edit</button><button type=\"button\" data-loop-action=\"cancel\">Cancel</button></div>";
          card.querySelector(".loop-interview-objective").textContent = proposal.objective;
          card.querySelector(".loop-interview-criteria").textContent = proposal.successCriteria.join(" · ");
          card.querySelector(".loop-interview-limits").textContent = "Limits: " + proposal.maxContinuations + " continuations · " + proposal.maxMinutes + " minutes";
        }
        card.setAttribute("data-loop-render-key", cardKey);
      }
      var startButton = card.querySelector('[data-loop-action="start"]');
      if (startButton) startButton.disabled = !!state.loopInterviewRunRequestId;
    } else {
      card.removeAttribute("data-loop-render-key");
    }
  }
}

function sendAction(type, payload) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    showToast("Loop action could not be sent while disconnected.", "error");
    return false;
  }
  ws.send(JSON.stringify(Object.assign({ type: type, sessionId: store.get("activeSessionId"), requestId: requestId() }, payload || {})));
  return true;
}

function startBrief() {
  var proposal = store.get("loopInterviewBrief");
  if (!proposal || store.get("processing") || store.get("loopInterviewRunRequestId")) return;
  var id = requestId();
  if (sendAction("loop_interview_start_run", { requestId: id, proposalId: proposal.id, version: proposal.version })) {
    store.set({ loopInterviewRunRequestId: id, loopInterviewRunSessionId: store.get("activeSessionId") });
    render();
  }
}

function start() {
  if (!eligible() || store.get("loopInterviewStarting") || store.get("processing")) return;
  var sessionId = store.get("activeSessionId");
  var id = requestId();
  store.set({ loopInterviewStarting: true, loopInterviewRequestId: id, loopInterviewSessionId: sessionId });
  render();
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    store.set({ loopInterviewStarting: false, loopInterviewRequestId: null, loopInterviewSessionId: null });
    render();
    showToast("Loop interview could not start while disconnected.", "error");
    return;
  }
  ws.send(JSON.stringify({ type: "loop_interview_start", sessionId: sessionId, requestId: id }));
}

export function handleLoopInterviewMessage(msg) {
  if (msg.type === "loop_interview_brief") {
    if (Number(msg.sessionId) !== Number(store.get("activeSessionId"))) return true;
    store.set({ loopInterviewBrief: msg.brief || null });
    render();
    return true;
  }
  if (msg.type === "loop_interview_start_run_result" && Number(msg.sessionId) === Number(store.get("activeSessionId")) && Number(msg.sessionId) === Number(store.get("loopInterviewRunSessionId")) && msg.requestId === store.get("loopInterviewRunRequestId")) {
    store.set({ loopInterviewBrief: msg.ok ? null : store.get("loopInterviewBrief"), loopInterviewRunRequestId: null, loopInterviewRunSessionId: null });
    if (!msg.ok) showToast(msg.error || "The approved Loop run could not start.", "error");
    render();
    return true;
  }
  if (msg.type !== "loop_interview_start_result") return false;
  var state = store.snap();
  if (Number(msg.sessionId) !== Number(state.loopInterviewSessionId) || msg.requestId !== state.loopInterviewRequestId) return true;
  store.set({ loopInterviewStarting: false, loopInterviewRequestId: null, loopInterviewSessionId: null, loopInterviewRunRequestId: null, loopInterviewRunSessionId: null, loopInterviewEditing: false });
  if (!msg.ok) showToast(msg.error || "Loop interview could not start.", "error");
  render();
  return true;
}

export function syncLoopInterviewForSession() {
  store.set({ loopInterviewStarting: false, loopInterviewRequestId: null, loopInterviewSessionId: null, loopInterviewBrief: null, loopInterviewRunRequestId: null, loopInterviewRunSessionId: null, loopInterviewEditing: false });
  requestLoopInterviewState();
  render();
}

export function requestLoopInterviewState() {
  var ws = getWs();
  if (ws && ws.readyState === 1 && store.get("activeSessionId")) ws.send(JSON.stringify({ type: "loop_interview_state", sessionId: store.get("activeSessionId") }));
}

export function initLoopInterview() {
  var button = document.getElementById("loop-interview-btn");
  if (!button) return;
  button.addEventListener("click", start);
  var card = document.getElementById("loop-interview-card");
  if (card) card.addEventListener("click", function (event) {
    var action = event.target.getAttribute("data-loop-action");
    if (action === "start") startBrief();
    if (action === "cancel") { var cancelBrief = store.get("loopInterviewBrief"); if (cancelBrief) sendAction("loop_interview_cancel", { proposalId: cancelBrief.id, version: cancelBrief.version }); }
    if (action === "edit") { store.set({ loopInterviewEditing: true }); render(); }
    if (action === "cancel-edit") { store.set({ loopInterviewEditing: false }); render(); }
    if (action === "save") {
      var proposal = store.get("loopInterviewBrief");
      var objective = card.querySelector('[data-loop-field="objective"]').value;
      var successCriteria = card.querySelector('[data-loop-field="criteria"]').value.split("\n");
      if (sendAction("loop_interview_edit", { proposalId: proposal.id, version: proposal.version, brief: { id: proposal.id, objective: objective, successCriteria: successCriteria, maxContinuations: proposal.maxContinuations, maxMinutes: proposal.maxMinutes } })) store.set({ loopInterviewEditing: false });
    }
  });
  store.subscribe(function (state, prev) {
    if (state.activeSessionId !== prev.activeSessionId || state.connected !== prev.connected) syncLoopInterviewForSession();
    if (state.processing !== prev.processing || state.dmMode !== prev.dmMode || state.activeSessionMode !== prev.activeSessionMode || state.splitGroups !== prev.splitGroups || state.paneSessionId !== prev.paneSessionId) render();
  });
  var home = document.getElementById("home-hub");
  if (home && typeof MutationObserver === "function") new MutationObserver(function () { if (!home.classList.contains("hidden")) syncLoopInterviewForSession(); }).observe(home, { attributes: true, attributeFilter: ["class"] });
  render();
  refreshIcons();
}
