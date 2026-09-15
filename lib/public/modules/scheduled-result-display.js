import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { shouldAcknowledgeScheduledResult, shouldFocusScheduledResult } from './scheduled-result-client.js';

function sendRead(ref) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({ type: "scheduled_task_result_mark_read", ref: ref }));
  return true;
}

var openRequestCounter = 0;
export function openScheduledResultSession(entry) {
  if (!entry || !entry.scheduledResult) return false;
  openRequestCounter += 1;
  var requestId = "open-scheduled-session-" + Date.now() + "-" + openRequestCounter;
  store.set({ scheduledResultSessionRequestId: requestId });
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { showToast("Reconnect to view this scheduled session.", "warn"); return false; }
  ws.send(JSON.stringify({ type: "scheduled_task_result_open_session", requestId: requestId, ref: entry.ref })); return true;
}

function acknowledgeVisible() {
  var ref = store.get('scheduledResultPendingReadRef');
  if (!ref || document.visibilityState === "hidden") return;
  store.set({ scheduledResultPendingReadRef: null });
  var state = store.snap();
  if (state.projectLogsOpen && state.projectLogsView === "detail" && state.projectLogsSelectedRef === ref) sendRead(ref);
}

export function clearPendingScheduledResultRead() {
  store.set({ scheduledResultPendingReadRef: null });
}

export function handleScheduledResultDisplayed(entry) {
  var state = store.snap();
  if (shouldFocusScheduledResult(entry, state)) {
    store.set({ scheduledResultFocusRef: null });
    var heading = document.querySelector("#project-logs-detail .project-log-document h1");
    if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus(); }
  }
  if (shouldAcknowledgeScheduledResult(entry, store.snap(), document.visibilityState)) {
    clearPendingScheduledResultRead(); sendRead(entry.ref);
  } else if (entry && entry.scheduledResult && document.visibilityState === "hidden") store.set({ scheduledResultPendingReadRef: entry.ref });
}

export function initScheduledResultDisplay() {
  document.addEventListener("visibilitychange", acknowledgeVisible);
}
