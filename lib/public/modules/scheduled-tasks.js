import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons, iconHtml } from './icons.js';
import { showToast } from './utils.js';
import { closeProjectLogs } from './project-logs.js';
import { closeNotesBrowser } from './sticky-notes-browser.js';
import { closeFileViewer } from './filebrowser.js';
import { closeTerminal } from './terminal.js';
import { isStrictCron, humanRecurrence } from './scheduled-task-recurrence.js';

export { isStrictCron, humanRecurrence } from './scheduled-task-recurrence.js';

var panel = null;
var listEl = null;
var requestCounter = 0;

function contextKey() { return String(store.get('currentSlug') || "") + "|" + String(store.get('activeSessionId') || ""); }

function canOpen() {
  var permissions = store.get('permissions');
  return !!store.get('currentSlug') && !!store.get('activeSessionId') && store.get('activeSessionMode') === "gui" && !store.get('dmMode') && !store.get('mateProjectSlug') && (!permissions || permissions.scheduledTasks !== false);
}

function requestId(prefix) {
  requestCounter += 1;
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return prefix + "-" + globalThis.crypto.randomUUID();
  return prefix + "-" + Date.now() + "-" + requestCounter;
}

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function formatNext(value) {
  if (!value) return "No next run";
  var date = new Date(value);
  if (isNaN(date.getTime())) return "No next run";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function scheduleLabel(record) {
  if (record.cron) return humanRecurrence(record.cron);
  if (record.source === "schedule" && record.date && record.time) {
    var date = new Date(record.date + "T" + record.time + ":00");
    if (!isNaN(date.getTime())) return "Once · " + date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }
  return "No schedule";
}

function ensurePanel() {
  if (panel) return;
  var host = document.getElementById("main-panels");
  if (!host) return;
  panel = document.createElement("section");
  panel.id = "scheduled-tasks-panel";
  panel.className = "scheduled-tasks-panel hidden";
  panel.setAttribute("aria-label", "Scheduled Tasks");
  panel.innerHTML =
    '<header class="scheduled-tasks-topbar">' +
      '<span class="scheduled-tasks-title">' + iconHtml("calendar-clock") + 'Scheduled Tasks</span>' +
      '<div class="scheduled-tasks-create-group">' +
        '<button class="scheduled-tasks-new" type="button" data-action="new">' + iconHtml("plus") + 'New</button>' +
        '<button id="scheduled-tasks-create-menu-trigger" class="scheduled-tasks-new-menu" type="button" data-action="new-menu" aria-label="More task creation options" aria-haspopup="menu" aria-expanded="false" aria-controls="scheduled-tasks-create-menu">' + iconHtml("chevron-down") + '</button>' +
        '<div id="scheduled-tasks-create-menu" class="scheduled-tasks-create-menu hidden" role="menu" aria-labelledby="scheduled-tasks-create-menu-trigger"><button type="button" role="menuitem" data-action="manual">Manual creation</button></div>' +
      '</div>' +
      '<div class="scheduled-tasks-window-actions">' +
        '<button class="scheduled-tasks-icon-btn" type="button" data-action="wide" title="Widen panel" aria-label="Widen Scheduled Tasks panel" aria-pressed="false">' + iconHtml("chevrons-left-right") + '</button>' +
        '<button class="scheduled-tasks-icon-btn" type="button" data-action="fullscreen" title="Toggle fullscreen" aria-label="Toggle Scheduled Tasks fullscreen" aria-pressed="false">' + iconHtml("maximize-2") + '</button>' +
        '<button class="scheduled-tasks-icon-btn" type="button" data-action="close" title="Close" aria-label="Close Scheduled Tasks">' + iconHtml("x") + '</button>' +
      '</div>' +
    '</header>' +
    '<div class="scheduled-task-draft-slot"></div>' +
    '<div class="scheduled-tasks-list" role="list"></div>';
  host.appendChild(panel);
  listEl = panel.querySelector(".scheduled-tasks-list");
  panel.addEventListener("click", handleClick);
  refreshIcons();
}

function applyWindowState(wide, fullscreen) {
  store.set({ scheduledTasksWide: !!wide, scheduledTasksFullscreen: !!fullscreen });
  if (!panel) return;
  panel.classList.toggle("scheduled-tasks-wide", !!wide && !fullscreen);
  panel.classList.toggle("panel-fullscreen", !!fullscreen);
  var wideButton = panel.querySelector('[data-action="wide"]');
  var fullButton = panel.querySelector('[data-action="fullscreen"]');
  if (wideButton) { wideButton.disabled = !!fullscreen; wideButton.setAttribute("aria-pressed", wide ? "true" : "false"); }
  if (fullButton) fullButton.setAttribute("aria-pressed", fullscreen ? "true" : "false");
}

function editorFields(record, prefix) {
  var oneOff = record && !record.cron && record.source === "schedule";
  var linked = record && !!record.linkedTaskId;
  var schedule = oneOff
    ? '<label>Date<input data-field="date" type="date"></label><label>Time<input data-field="time" type="time"></label>'
    : '<label>Schedule<input data-field="cron" value="" placeholder="0 9 * * 1-5"><small>Five-field cron, for example 0 9 * * 1-5</small></label>';
  return '<label>Name<input data-field="name" value=""></label>' +
    '<label>Instructions<textarea data-field="instructions"' + (linked ? ' disabled' : '') + '></textarea>' + (linked ? '<small>Instructions are owned by the linked task and remain unchanged here.</small>' : '') + '</label>' +
    '<div class="scheduled-task-field-row">' + schedule + '<label>Max runs per trigger<input data-field="maxIterations" type="number" min="1" max="100" value="1"></label></div>' +
    '<label class="scheduled-task-checkbox"><input data-field="skipIfRunning" type="checkbox"> Skip if another run is active</label>' +
    '<p class="scheduled-task-form-error" role="status"></p>' +
    '<div class="scheduled-task-form-actions"><button type="button" data-action="' + prefix + '-save" class="primary">' + (prefix === "draft" ? "Create task" : "Save") + '</button><button type="button" data-action="' + prefix + '-cancel">Cancel</button></div>';
}

function fillEditor(root, data) {
  root.querySelector('[data-field="name"]').value = data.name || "";
  root.querySelector('[data-field="instructions"]').value = data.instructions || data.task || data.prompt || "";
  var cron = root.querySelector('[data-field="cron"]'); if (cron) cron.value = data.cron || "";
  var date = root.querySelector('[data-field="date"]'); if (date) date.value = data.date || "";
  var time = root.querySelector('[data-field="time"]'); if (time) time.value = data.time || "";
  root.querySelector('[data-field="maxIterations"]').value = data.maxIterations || 1;
  root.querySelector('[data-field="skipIfRunning"]').checked = data.skipIfRunning !== false;
}

function readEditor(root) {
  var result = {
    name: root.querySelector('[data-field="name"]').value.trim(),
    instructions: root.querySelector('[data-field="instructions"]').value.trim(),
    maxIterations: Number(root.querySelector('[data-field="maxIterations"]').value),
    skipIfRunning: root.querySelector('[data-field="skipIfRunning"]').checked,
  };
  var cron = root.querySelector('[data-field="cron"]');
  if (cron) result.cron = cron.value.trim();
  else { result.cron = null; result.date = root.querySelector('[data-field="date"]').value; result.time = root.querySelector('[data-field="time"]').value; }
  return result;
}

function validateEditor(root, data) {
  var error = "";
  if (!data.name) error = "Enter a task name.";
  else if (!data.instructions) error = "Enter task instructions.";
  else if (data.cron !== null && !isStrictCron(data.cron)) error = "Enter a valid five-field cron schedule. Steps must be at least 1.";
  else if (data.cron === null && (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time))) error = "Enter a valid date and time.";
  var status = root.querySelector(".scheduled-task-form-error");
  if (status) status.textContent = error;
  return !error;
}

function renderDraft() {
  if (!panel) return;
  var slot = panel.querySelector(".scheduled-task-draft-slot");
  var draft = store.get('scheduledTaskDraft');
  if (!draft) { slot.innerHTML = ""; slot.classList.add("hidden"); return; }
  slot.classList.remove("hidden");
  slot.innerHTML = '<div class="scheduled-task-draft-kicker">' + (draft.manual ? "Manual draft" : "Draft from this Driver conversation") + '</div><div class="scheduled-task-draft-form">' + editorFields(draft, "draft") + '</div>';
  fillEditor(slot, draft);
}

function setCreateMenu(open, focusItem) {
  store.set({ scheduledTaskCreateMenuOpen: !!open });
  if (!panel) return;
  var trigger = panel.querySelector('[data-action="new-menu"]');
  var menu = panel.querySelector(".scheduled-tasks-create-menu");
  if (!trigger || !menu) return;
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
  menu.classList.toggle("hidden", !open);
  if (open && focusItem) menu.querySelector('[role="menuitem"]').focus();
}

function captureForms() {
  if (!panel) return;
  var draftForm = panel.querySelector(".scheduled-task-draft-form");
  if (draftForm && store.get('scheduledTaskDraft')) store.set({ scheduledTaskDraftForm: { key: store.get('scheduledTaskDraft').id + ":" + store.get('scheduledTaskDraft').version, data: readEditor(draftForm) } });
  var editForm = panel.querySelector(".scheduled-task-edit-form");
  if (editForm && store.get('scheduledTaskEditingId')) store.set({ scheduledTaskEditForm: { id: store.get('scheduledTaskEditingId'), data: readEditor(editForm) } });
}

function renderList() {
  if (!listEl) return;
  var records = store.get('scheduledTaskRecords') || [];
  if (!records.length) {
    listEl.innerHTML = '<div class="scheduled-tasks-empty">No scheduled tasks in this project yet.<br>Choose <strong>New</strong> to shape one with a Driver.</div>';
    return;
  }
  listEl.innerHTML = "";
  for (var i = 0; i < records.length; i++) listEl.appendChild(buildRow(records[i]));
  refreshIcons();
}

function buildRow(record) {
  var expandedId = store.get('scheduledTaskExpandedId');
  var deleteId = store.get('scheduledTaskDeleteId');
  var row = document.createElement("article");
  row.className = "scheduled-task-row" + (record.enabled === false ? " paused" : "");
  row.dataset.taskId = record.id;
  row.setAttribute("role", "listitem");
  var stateLabel = record.enabled === false ? "Paused" : "Active";
  row.innerHTML =
    '<button class="scheduled-task-summary" type="button" data-action="expand" aria-expanded="' + (expandedId === record.id ? "true" : "false") + '">' +
      '<span class="scheduled-task-state-dot" aria-hidden="true"></span>' +
      '<span class="scheduled-task-summary-main"><strong></strong><span class="scheduled-task-summary-meta"><span class="scheduled-task-owner"></span><span class="scheduled-task-recurrence"></span><span class="scheduled-task-next"></span></span></span>' + iconHtml(expandedId === record.id ? "chevron-up" : "chevron-down") +
    '</button>';
  row.querySelector("strong").textContent = record.name || "Untitled";
  row.querySelector(".scheduled-task-recurrence").textContent = scheduleLabel(record);
  row.querySelector(".scheduled-task-owner").textContent = record.ownerName || "Unassigned";
  row.querySelector(".scheduled-task-next").textContent = stateLabel + " · " + formatNext(record.nextRunAt);
  if (expandedId === record.id) {
    var detail = document.createElement("div");
    detail.className = "scheduled-task-detail";
    if (deleteId === record.id) {
      detail.innerHTML = '<div class="scheduled-task-delete-confirm"><strong>Delete this task?</strong><span>The schedule record will be removed.</span><div><button type="button" data-action="delete-confirm" class="danger">Delete</button><button type="button" data-action="delete-cancel">Cancel</button></div></div>';
    } else if (store.get('scheduledTaskEditingId') === record.id) {
      detail.innerHTML = '<div class="scheduled-task-edit-form">' + editorFields(record, "edit") + '</div>';
      var savedEdit = store.get('scheduledTaskEditForm');
      fillEditor(detail, savedEdit && savedEdit.id === record.id ? Object.assign({}, record, savedEdit.data) : record);
    } else {
      var instructions = document.createElement("p");
      instructions.className = "scheduled-task-instructions";
      instructions.textContent = record.task || record.prompt || record.description || "No instructions recorded.";
      detail.appendChild(instructions);
      var context = document.createElement("div");
      context.className = "scheduled-task-context";
      context.textContent = (record.projectTitle || store.get('currentSlug') || "Project") + " · " + (record.enabled === false ? "Paused" : "Ready") + " · " + (record.maxIterations || 1) + " run" + ((record.maxIterations || 1) === 1 ? "" : "s") + " per trigger";
      detail.appendChild(context);
      var actions = document.createElement("div");
      actions.className = "scheduled-task-actions";
      actions.innerHTML = '<button type="button" data-action="edit">' + iconHtml("pencil") + 'Edit</button><button type="button" data-action="toggle">' + iconHtml(record.enabled === false ? "play" : "pause") + (record.enabled === false ? "Resume" : "Pause") + '</button><button type="button" data-action="run">' + iconHtml("zap") + 'Run now</button><button type="button" data-action="delete" class="danger">' + iconHtml("trash-2") + 'Delete</button>';
      detail.appendChild(actions);
    }
    row.appendChild(detail);
  }
  return row;
}

function recordForRow(target) {
  var row = target.closest(".scheduled-task-row");
  if (!row) return null;
  var records = store.get('scheduledTaskRecords') || [];
  for (var i = 0; i < records.length; i++) if (records[i].id === row.dataset.taskId) return records[i];
  return null;
}

function startNewInterview() {
  if (store.get('scheduledTaskNewSessionPending')) return;
  var id = requestId("new-schedule-session");
  store.set({ scheduledTaskNewSessionPending: { requestId: id, context: contextKey() } });
  if (!send({ type: "new_session", mode: "gui", forceNew: true, requestId: id })) {
    store.set({ scheduledTaskNewSessionPending: null });
    showToast("A Driver session could not be created while disconnected.", "error");
  }
}

function startManualDraft() {
  if (store.get('scheduledTaskManualRequest')) return;
  var id = requestId("manual-schedule");
  store.set({ scheduledTaskManualRequest: { requestId: id, context: contextKey() } });
  if (!send({ type: "scheduled_task_manual_start", sessionId: store.get('activeSessionId'), requestId: id })) {
    store.set({ scheduledTaskManualRequest: null });
    showToast("A manual task draft could not be started while disconnected.", "error");
  }
}

function handleDocumentClick(event) {
  if (!store.get('scheduledTaskCreateMenuOpen') || !panel || event.target.closest(".scheduled-tasks-create-group")) return;
  setCreateMenu(false);
}

function handleDocumentKeydown(event) {
  if (!store.get('scheduledTaskCreateMenuOpen') || !panel) return;
  var trigger = panel.querySelector('[data-action="new-menu"]');
  var item = panel.querySelector('.scheduled-tasks-create-menu [role="menuitem"]');
  if (event.key === "Escape") { event.preventDefault(); setCreateMenu(false); trigger.focus(); }
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); item.focus(); }
  else if (event.key === "Tab") setCreateMenu(false);
}

function handleClick(event) {
  var button = event.target.closest("button[data-action]");
  if (!button) return;
  var action = button.dataset.action;
  if (action === "close") { closeScheduledTasks(); return; }
  if (action === "wide") { applyWindowState(!store.get('scheduledTasksWide'), store.get('scheduledTasksFullscreen')); return; }
  if (action === "fullscreen") { applyWindowState(store.get('scheduledTasksWide'), !store.get('scheduledTasksFullscreen')); return; }
  if (action === "new") { setCreateMenu(false); startNewInterview(); return; }
  if (action === "new-menu") { setCreateMenu(!store.get('scheduledTaskCreateMenuOpen'), true); return; }
  if (action === "manual") { setCreateMenu(false); startManualDraft(); return; }
  if (action === "draft-cancel") {
    var draft = store.get('scheduledTaskDraft');
    if (draft) send({ type: "scheduled_task_cancel", sessionId: store.get('activeSessionId'), proposalId: draft.id, version: draft.version });
    return;
  }
  if (action === "draft-save") {
    var draftRoot = button.closest(".scheduled-task-draft-form"); var draftData = readEditor(draftRoot); var draft = store.get('scheduledTaskDraft');
    if (!validateEditor(draftRoot, draftData) || !draft) return;
    var createId = requestId("create-task");
    store.set({ scheduledTaskActionRequestId: { requestId: createId, context: contextKey() } });
    send({ type: "scheduled_task_create", sessionId: store.get('activeSessionId'), requestId: createId, proposalId: draft.id, version: draft.version, data: draftData });
    return;
  }
  var record = recordForRow(button);
  if (!record) return;
  if (action === "expand") { store.set({ scheduledTaskExpandedId: store.get('scheduledTaskExpandedId') === record.id ? null : record.id, scheduledTaskDeleteId: null, scheduledTaskEditingId: null }); renderList(); return; }
  if (action === "edit") { store.set({ scheduledTaskEditingId: record.id }); renderList(); return; }
  if (action === "edit-cancel") { store.set({ scheduledTaskEditingId: null }); renderList(); return; }
  if (action === "edit-save") {
    var editRoot = button.closest(".scheduled-task-edit-form"); var editData = readEditor(editRoot);
    if (!validateEditor(editRoot, editData)) return;
    var editId = requestId("update-task"); store.set({ scheduledTaskActionRequestId: { requestId: editId, context: contextKey() } });
    send({ type: "scheduled_task_update", sessionId: store.get('activeSessionId'), requestId: editId, id: record.id, version: record.updatedAt, data: editData }); return;
  }
  if (action === "toggle") { send({ type: "loop_registry_toggle", id: record.id }); requestList(); }
  if (action === "run") { send({ type: "loop_registry_rerun", id: record.id }); requestList(); }
  if (action === "delete") { store.set({ scheduledTaskDeleteId: record.id }); renderList(); }
  if (action === "delete-cancel") { store.set({ scheduledTaskDeleteId: null }); renderList(); }
  if (action === "delete-confirm") { send({ type: "loop_registry_remove", id: record.id }); store.set({ scheduledTaskDeleteId: null, scheduledTaskExpandedId: null }); requestList(); }
}

function requestList() {
  var id = requestId("list-tasks"); var context = contextKey();
  store.set({ scheduledTaskListRequest: { requestId: id, context: context } });
  send({ type: "scheduled_tasks_list", sessionId: store.get('activeSessionId'), requestId: id });
}

export function openScheduledTasks() {
  if (!canOpen()) { closeScheduledTasks(); return; }
  ensurePanel();
  if (!panel) return;
  closeProjectLogs(); closeNotesBrowser(); closeFileViewer(); closeTerminal();
  panel.classList.remove("hidden");
  applyWindowState(store.get('scheduledTasksWide'), false);
  store.set({ scheduledTasksOpen: true });
  var button = document.getElementById("scheduler-btn"); if (button) button.classList.add("active");
  renderDraft(); renderList(); requestList();
}

export function closeScheduledTasks() {
  if (panel) panel.classList.add("hidden");
  setCreateMenu(false);
  applyWindowState(store.get('scheduledTasksWide'), false);
  store.set({ scheduledTasksOpen: false, scheduledTaskEditingId: null });
  var button = document.getElementById("scheduler-btn"); if (button) button.classList.remove("active");
}

export function isScheduledTasksOpen() { return store.get('scheduledTasksOpen') === true; }

export function handleScheduledTaskMessage(msg) {
  if (msg.type === "scheduled_tasks_state") {
    var listRequest = store.get('scheduledTaskListRequest');
    if (!listRequest || msg.requestId !== listRequest.requestId || listRequest.context !== contextKey()) return true;
    captureForms(); store.set({ scheduledTaskRecords: msg.records || [], scheduledTaskListRequest: null }); renderList(); return true;
  }
  if (msg.type === "scheduled_task_interview_state") {
    if (Number(msg.sessionId) !== Number(store.get('activeSessionId'))) return true;
    var focusManual = !!store.get('scheduledTaskManualRequest') && !!(msg.draft && msg.draft.manual);
    captureForms();
    var priorDraft = store.get('scheduledTaskDraft'); var draftForm = store.get('scheduledTaskDraftForm');
    store.set({ scheduledTaskDraft: msg.draft || null, scheduledTaskInterviewId: msg.interviewId || null });
    if (msg.draft && priorDraft && msg.draft.id === priorDraft.id && msg.draft.version === priorDraft.version && draftForm && draftForm.key === msg.draft.id + ":" + msg.draft.version) store.set({ scheduledTaskDraft: Object.assign({}, msg.draft, draftForm.data) });
    if (msg.open) openScheduledTasks(); else renderDraft();
    var focusTarget = focusManual && panel ? panel.querySelector('.scheduled-task-draft-form [data-field="name"]') : null;
    if (focusTarget) focusTarget.focus();
    return true;
  }
  if (msg.type === "new_session_result") {
    var pendingNew = store.get('scheduledTaskNewSessionPending');
    if (!pendingNew || msg.requestId !== pendingNew.requestId) return false;
    store.set({ scheduledTaskNewSessionPending: null });
    if (!msg.ok) { showToast(msg.error || "A Driver session could not be created.", "error"); return true; }
    var id = requestId("schedule-interview");
    store.set({ scheduledTaskInterviewRequestId: id });
    send({ type: "scheduled_task_interview_start", sessionId: msg.sessionId, requestId: id });
    return true;
  }
  if (msg.type === "scheduled_task_interview_start_result") {
    if (msg.requestId !== store.get('scheduledTaskInterviewRequestId') || Number(msg.sessionId) !== Number(store.get('activeSessionId'))) return true;
    store.set({ scheduledTaskInterviewRequestId: null });
    if (!msg.ok) showToast(msg.error || "The schedule interview could not start.", "error");
    return true;
  }
  if (msg.type === "scheduled_task_manual_start_result") {
    var manualRequest = store.get('scheduledTaskManualRequest');
    if (!manualRequest || msg.requestId !== manualRequest.requestId || manualRequest.context !== contextKey() || Number(msg.sessionId) !== Number(store.get('activeSessionId'))) return true;
    store.set({ scheduledTaskManualRequest: null });
    if (!msg.ok) showToast(msg.error || "The manual task draft could not be started.", "error");
    return true;
  }
  if (msg.type === "scheduled_task_action_result") {
    var actionRequest = store.get('scheduledTaskActionRequestId');
    if (!actionRequest || msg.requestId !== actionRequest.requestId || actionRequest.context !== contextKey()) return true;
    store.set({ scheduledTaskActionRequestId: null });
    if (!msg.ok) showToast(msg.error || "The scheduled task could not be saved.", "error");
    else { store.set({ scheduledTaskEditingId: null }); requestList(); }
    return true;
  }
  if (msg.type === "loop_registry_updated") { if (store.get('scheduledTasksOpen')) requestList(); return false; }
  if (msg.type === "loop_registry_error") { showToast(msg.text || "Scheduled task action failed.", "error"); return false; }
  return false;
}

export function handleScheduledTaskSessionSwitched(msg) {
  captureForms();
  store.set({ scheduledTaskDraft: msg.scheduledTaskDraft || null, scheduledTaskEditingId: null, scheduledTaskEditForm: null, scheduledTaskExpandedId: null, scheduledTaskDeleteId: null, scheduledTaskListRequest: null, scheduledTaskActionRequestId: null, scheduledTaskManualRequest: null, scheduledTaskCreateMenuOpen: false });
  setCreateMenu(false);
  renderDraft();
}

export function initScheduledTasks() {
  var button = document.getElementById("scheduler-btn");
  if (button) button.addEventListener("click", function () { if (isScheduledTasksOpen()) closeScheduledTasks(); else openScheduledTasks(); });
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
  store.subscribe(function (state, previous) {
    if (state.currentSlug !== previous.currentSlug) {
      closeScheduledTasks();
      store.set({ scheduledTaskRecords: [], scheduledTaskDraft: null, scheduledTaskNewSessionPending: null, scheduledTaskExpandedId: null, scheduledTaskDeleteId: null, scheduledTaskListRequest: null, scheduledTaskManualRequest: null, scheduledTaskCreateMenuOpen: false });
    }
    if (state.connected === false && previous.connected === true) store.set({ scheduledTaskRecords: [], scheduledTaskDraft: null, scheduledTaskNewSessionPending: null, scheduledTaskInterviewRequestId: null, scheduledTaskActionRequestId: null, scheduledTaskListRequest: null, scheduledTaskManualRequest: null, scheduledTaskCreateMenuOpen: false });
    if ((state.dmMode && !previous.dmMode) || state.mateProjectSlug !== previous.mateProjectSlug || state.activeSessionMode !== previous.activeSessionMode) {
      closeScheduledTasks();
      store.set({ scheduledTaskManualRequest: null, scheduledTaskCreateMenuOpen: false });
    }
  });
}
