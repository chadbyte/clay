import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons, iconHtml } from './icons.js';
import { showToast } from './utils.js';
import { closeProjectLogs } from './project-logs.js';
import { closeNotesBrowser } from './sticky-notes-browser.js';
import { closeFileViewer } from './filebrowser.js';
import { closeTerminal } from './terminal.js';
import { humanRecurrence } from './scheduled-task-recurrence.js';
import { humanScheduleRule } from './scheduled-task-schedule-rule.js';
import { readInterviewEngine, renderInterviewEngine, readExecutionRuntime, renderExecutionRuntime } from './scheduled-task-engine.js';
import { reconcileScheduledTaskEdit } from './scheduled-task-edit-state.js';
import { editorFields, fillEditor, readEditor, serverEditorData, validateEditor, handleEditorScheduleChange } from './scheduled-task-form.js';

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
  if (record.scheduleRule) return humanScheduleRule(record.scheduleRule);
  if (record.cron) return humanRecurrence(record.cron);
  if (record.source === "schedule" && record.date && record.time) {
    var date = new Date(record.date + "T" + record.time + ":00");
    if (!isNaN(date.getTime())) return "Once · " + date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }
  return "No schedule";
}

function executionLabel(record) {
  if (record.activeRun) {
    if (record.activeRun.status === "needs-input") return "Needs input";
    if (record.activeRun.status === "waiting-worker") return "Waiting for Worker";
    if (record.activeRun.status === "reviewing") return "Driver reviewing";
    return "Running";
  }
  if (!record.execution) return "Needs setup";
  if (record.readiness && record.readiness.ok === false) return "Unavailable";
  return record.enabled === false ? "Paused" : "Active";
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
        '<button class="scheduled-tasks-new" type="button" data-action="new" disabled>' + iconHtml("plus") + 'New</button>' +
        '<button id="scheduled-tasks-create-menu-trigger" class="scheduled-tasks-new-menu" type="button" data-action="new-menu" aria-label="More task creation options" aria-haspopup="menu" aria-expanded="false" aria-controls="scheduled-tasks-create-menu">' + iconHtml("chevron-down") + '</button>' +
        '<div id="scheduled-tasks-create-menu" class="scheduled-tasks-create-menu hidden" role="menu" aria-labelledby="scheduled-tasks-create-menu-trigger"><button type="button" role="menuitem" data-action="manual">Manual creation</button></div>' +
      '</div>' +
      '<div class="scheduled-tasks-window-actions">' +
        '<button class="scheduled-tasks-icon-btn" type="button" data-action="wide" title="Widen panel" aria-label="Widen Scheduled Tasks panel" aria-pressed="false">' + iconHtml("chevrons-left-right") + '</button>' +
        '<button class="scheduled-tasks-icon-btn" type="button" data-action="fullscreen" title="Toggle fullscreen" aria-label="Toggle Scheduled Tasks fullscreen" aria-pressed="false">' + iconHtml("maximize-2") + '</button>' +
        '<button class="scheduled-tasks-icon-btn" type="button" data-action="close" title="Close" aria-label="Close Scheduled Tasks">' + iconHtml("x") + '</button>' +
      '</div>' +
    '</header>' +
    '<div class="scheduled-task-engine"><span>Interview engine</span><select data-engine="vendor" aria-label="Interview engine provider"></select><select data-engine="model" aria-label="Interview engine model"></select><select data-engine="effort" aria-label="Interview engine effort"></select></div>' +
    '<div class="scheduled-task-draft-slot"></div>' +
    '<div class="scheduled-tasks-list" role="list"></div>';
  host.appendChild(panel);
  listEl = panel.querySelector(".scheduled-tasks-list");
  panel.addEventListener("click", handleClick);
  panel.addEventListener("change", function (event) {
    if (!event.target) return;
    if (event.target.dataset.runtime) {
      var form = event.target.closest(".scheduled-task-draft-form, .scheduled-task-edit-form");
      if (!form) return;
      var execution = readExecutionRuntime(form);
      var parts = event.target.dataset.runtime.split("-");
      if (parts[1] === "vendor") { execution[parts[0]].model = null; execution[parts[0]].effort = null; requestEngineState(execution[parts[0]].vendor); }
      if (parts[1] === "model") execution[parts[0]].effort = null;
      renderExecutionRuntime(form, store.get('scheduledTaskEngineState'), execution);
      return;
    }
    if (!event.target.dataset.engine) { handleEditorScheduleChange(event.target, store.get('scheduledTaskTimeZone')); return; }
    var selection = readInterviewEngine(panel);
    if (event.target.dataset.engine === "vendor") { selection.model = ""; selection.effort = ""; }
    if (event.target.dataset.engine === "model") selection.effort = "";
    store.set({ scheduledTaskEngineDraft: selection });
    renderEngine();
    if (event.target.dataset.engine === "vendor") requestEngineState(selection.vendor);
  });
  panel.addEventListener("input", function (event) { handleEditorScheduleChange(event.target, store.get('scheduledTaskTimeZone')); });
  refreshIcons();
}

function renderEngine() {
  var selection = renderInterviewEngine(panel, store.get('scheduledTaskEngineState'), store.get('scheduledTaskEngineDraft'));
  if (selection) store.set({ scheduledTaskEngineDraft: selection });
  var forms = panel ? panel.querySelectorAll(".scheduled-task-draft-form, .scheduled-task-edit-form") : [];
  for (var i = 0; i < forms.length; i++) renderExecutionRuntime(forms[i], store.get('scheduledTaskEngineState'), readExecutionRuntime(forms[i]));
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

function renderDraft() {
  if (!panel) return;
  var slot = panel.querySelector(".scheduled-task-draft-slot");
  var draft = store.get('scheduledTaskDraft');
  if (!draft) { slot.innerHTML = ""; slot.classList.add("hidden"); return; }
  slot.classList.remove("hidden");
  slot.innerHTML = '<div class="scheduled-task-draft-kicker">' + (draft.manual ? "Manual draft" : "Draft from this Driver conversation") + '</div><div class="scheduled-task-draft-form">' + editorFields(draft, "draft") + '</div>';
  fillEditor(slot, draft, store.get('scheduledTaskTimeZone'), store.get('scheduledTaskEngineState'));
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
  if (editForm && store.get('scheduledTaskEditingId')) {
    var editId = store.get('scheduledTaskEditingId');
    var prior = store.get('scheduledTaskEditForm');
    var records = store.get('scheduledTaskRecords') || [];
    var baseRevision = prior && prior.id === editId ? prior.revision : null;
    if (baseRevision == null) for (var i = 0; i < records.length; i++) if (records[i].id === editId) { baseRevision = records[i].updatedAt; break; }
    store.set({ scheduledTaskEditForm: { id: editId, revision: baseRevision, data: readEditor(editForm), conflict: prior && prior.id === editId ? prior.conflict || "" : "" } });
  }
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
  var stateLabel = executionLabel(record);
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
      fillEditor(detail, savedEdit && savedEdit.id === record.id ? Object.assign({}, record, savedEdit.data) : record, store.get('scheduledTaskTimeZone'), store.get('scheduledTaskEngineState'));
      if (savedEdit && savedEdit.id === record.id && savedEdit.conflict) detail.querySelector(".scheduled-task-form-error").textContent = savedEdit.conflict;
    } else {
      var instructions = document.createElement("p");
      instructions.className = "scheduled-task-instructions";
      instructions.textContent = record.instructions || record.task || record.prompt || record.description || "No instructions recorded.";
      detail.appendChild(instructions);
      var context = document.createElement("div");
      context.className = "scheduled-task-context";
      var executionState = executionLabel(record);
      context.textContent = (record.projectTitle || store.get('currentSlug') || "Project") + " · " + executionState + (record.execution ? " · Driver and Split Worker" : " · Choose execution pair in Edit");
      detail.appendChild(context);
      var actions = document.createElement("div");
      actions.className = "scheduled-task-actions";
      actions.innerHTML = '<button type="button" data-action="edit">' + iconHtml("pencil") + 'Edit</button><button type="button" data-action="toggle">' + iconHtml(record.enabled === false ? "play" : "pause") + (record.enabled === false ? "Resume" : "Pause") + '</button><button type="button" data-action="run">' + iconHtml("zap") + 'Run now</button>' + (record.activeRun || record.latestRun ? '<button type="button" data-action="open-run">' + iconHtml("columns-2") + 'Open run</button>' : '') + '<button type="button" data-action="delete" class="danger">' + iconHtml("trash-2") + 'Delete</button>';
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
  var engine = readInterviewEngine(panel);
  var engineDraft = store.get('scheduledTaskEngineDraft');
  if (!engine.vendor || !engineDraft || !engineDraft.catalogReady || !engineDraft.valid) { store.set({ scheduledTaskNewSessionPending: null }); showToast("Choose an available interview engine and model.", "error"); return; }
  if (!send({ type: "new_session", mode: "gui", forceNew: true, requestId: id, scheduleInterview: true, sourceSessionId: store.get('activeSessionId'), projectSlug: store.get('currentSlug'), vendor: engine.vendor, model: engine.model, effort: engine.effort })) {
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
    var draftRoot = button.closest(".scheduled-task-draft-form"); var draftData = serverEditorData(readEditor(draftRoot)); var draft = store.get('scheduledTaskDraft');
    if (!validateEditor(draftRoot, draftData) || !draft) return;
    var createId = requestId("create-task");
    store.set({ scheduledTaskActionRequestId: { requestId: createId, context: contextKey() } });
    send({ type: "scheduled_task_create", sessionId: store.get('activeSessionId'), requestId: createId, proposalId: draft.id, version: draft.version, data: draftData });
    return;
  }
  var record = recordForRow(button);
  if (!record) return;
  if (action === "expand") { store.set({ scheduledTaskExpandedId: store.get('scheduledTaskExpandedId') === record.id ? null : record.id, scheduledTaskDeleteId: null, scheduledTaskEditingId: null }); renderList(); return; }
  if (action === "edit") { store.set({ scheduledTaskEditingId: record.id, scheduledTaskEditForm: { id: record.id, revision: record.updatedAt, data: null, conflict: "" } }); renderList(); return; }
  if (action === "edit-cancel") { store.set({ scheduledTaskEditingId: null, scheduledTaskEditForm: null }); renderList(); return; }
  if (action === "edit-save") {
    var editRoot = button.closest(".scheduled-task-edit-form"); var editData = serverEditorData(readEditor(editRoot));
    if (!validateEditor(editRoot, editData)) return;
    if (record.linkedTaskId) delete editData.instructions;
    var editState = store.get('scheduledTaskEditForm');
    var editId = requestId("update-task"); store.set({ scheduledTaskActionRequestId: { requestId: editId, context: contextKey() } });
    send({ type: "scheduled_task_update", sessionId: store.get('activeSessionId'), requestId: editId, id: record.id, version: editState && editState.id === record.id ? editState.revision : record.updatedAt, data: editData }); return;
  }
  if (action === "toggle" || action === "run") {
    var taskActionId = requestId(action + "-task"); store.set({ scheduledTaskActionRequestId: { requestId: taskActionId, context: contextKey() } });
    send({ type: action === "toggle" ? "scheduled_task_toggle" : "scheduled_task_run", sessionId: store.get('activeSessionId'), requestId: taskActionId, id: record.id, version: record.updatedAt });
  }
  if (action === "open-run") { var openId = requestId("open-run"); store.set({ scheduledTaskActionRequestId: { requestId: openId, context: contextKey() } }); send({ type: "scheduled_task_open_run", sessionId: store.get('activeSessionId'), requestId: openId, id: record.id, version: record.updatedAt }); }
  if (action === "delete") { store.set({ scheduledTaskDeleteId: record.id }); renderList(); }
  if (action === "delete-cancel") { store.set({ scheduledTaskDeleteId: null }); renderList(); }
  if (action === "delete-confirm") { var deleteRequestId = requestId("delete-task"); store.set({ scheduledTaskActionRequestId: { requestId: deleteRequestId, context: contextKey() }, scheduledTaskDeleteId: null, scheduledTaskExpandedId: null }); send({ type: "scheduled_task_delete", sessionId: store.get('activeSessionId'), requestId: deleteRequestId, id: record.id, version: record.updatedAt }); }
}

function requestList() {
  var id = requestId("list-tasks"); var context = contextKey();
  store.set({ scheduledTaskListRequest: { requestId: id, context: context } });
  send({ type: "scheduled_tasks_list", sessionId: store.get('activeSessionId'), requestId: id });
}

function requestEngineState(vendor) {
  var id = requestId("interview-engine");
  var context = contextKey();
  store.set({ scheduledTaskEngineRequest: { requestId: id, context: context, vendor: vendor || "" } });
  if (!send({ type: "scheduled_task_interview_engine_get", sessionId: store.get('activeSessionId'), projectSlug: store.get('currentSlug'), requestId: id, vendor: vendor || "" })) store.set({ scheduledTaskEngineRequest: null });
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
  requestEngineState((store.get('scheduledTaskEngineDraft') || {}).vendor);
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
  if (msg.type === "scheduled_task_interview_engine_state") {
    var engineRequest = store.get('scheduledTaskEngineRequest');
    if (!engineRequest || msg.requestId !== engineRequest.requestId || engineRequest.context !== contextKey() || msg.projectSlug !== store.get('currentSlug') || Number(msg.sessionId) !== Number(store.get('activeSessionId'))) return true;
    store.set({ scheduledTaskEngineRequest: null, scheduledTaskEngineState: msg });
    renderEngine();
    if (msg.error) showToast(msg.error, "error");
    return true;
  }
  if (msg.type === "scheduled_task_driver_edit_state") {
    if (Number(msg.sessionId) !== Number(store.get('activeSessionId')) || !msg.record) return true;
    captureForms();
    var records = (store.get('scheduledTaskRecords') || []).slice();
    var replaced = false;
    for (var ri = 0; ri < records.length; ri++) {
      if (records[ri].id === msg.record.id) { records[ri] = Object.assign({}, records[ri], msg.record, { updatedAt: msg.record.revision }); replaced = true; break; }
    }
    if (!replaced) records.push(Object.assign({}, msg.record, { updatedAt: msg.record.revision }));
    var activeEdit = store.get('scheduledTaskEditForm');
    var reconciledEdit = reconcileScheduledTaskEdit(activeEdit, msg.record);
    if (reconciledEdit !== activeEdit) store.set({ scheduledTaskEditForm: reconciledEdit });
    store.set({ scheduledTaskRecords: records, scheduledTaskExpandedId: msg.record.id });
    if (msg.open) openScheduledTasks(); else renderList();
    return true;
  }
  if (msg.type === "scheduled_tasks_state") {
    var listRequest = store.get('scheduledTaskListRequest');
    if (!listRequest || msg.requestId !== listRequest.requestId || listRequest.context !== contextKey()) return true;
    captureForms();
    var listedRecords = msg.records || [];
    var listedEdit = store.get('scheduledTaskEditForm');
    for (var li = 0; listedEdit && li < listedRecords.length; li++) if (listedRecords[li].id === listedEdit.id) listedEdit = reconcileScheduledTaskEdit(listedEdit, { id: listedRecords[li].id, revision: listedRecords[li].updatedAt });
    store.set({ scheduledTaskRecords: listedRecords, scheduledTaskListRequest: null, scheduledTaskEditForm: listedEdit, scheduledTaskTimeZone: msg.timeZone || null }); renderList(); return true;
  }
  if (msg.type === "scheduled_task_interview_state") {
    if (Number(msg.sessionId) !== Number(store.get('activeSessionId'))) return true;
    var focusManual = !!store.get('scheduledTaskManualRequest') && !!(msg.draft && msg.draft.manual);
    captureForms();
    var priorDraft = store.get('scheduledTaskDraft'); var draftForm = store.get('scheduledTaskDraftForm');
    store.set({ scheduledTaskDraft: msg.draft || null, scheduledTaskInterviewId: msg.interviewId || null, scheduledTaskTimeZone: msg.timeZone || store.get('scheduledTaskTimeZone') || null });
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
    else if (msg.action === "scheduled_task_open_run" && msg.sessionId) send({ type: "switch_session", id: msg.sessionId });
    else { store.set({ scheduledTaskEditingId: null, scheduledTaskEditForm: null }); requestList(); }
    return true;
  }
  if (msg.type === "loop_registry_updated") { if (store.get('scheduledTasksOpen')) requestList(); return false; }
  if (msg.type === "loop_registry_error") { showToast(msg.text || "Scheduled task action failed.", "error"); return false; }
  return false;
}

export function handleScheduledTaskSessionSwitched(msg) {
  captureForms();
  store.set({ scheduledTaskDraft: msg.scheduledTaskDraft || null, scheduledTaskEditingId: null, scheduledTaskEditForm: null, scheduledTaskExpandedId: null, scheduledTaskDeleteId: null, scheduledTaskListRequest: null, scheduledTaskActionRequestId: null, scheduledTaskManualRequest: null, scheduledTaskCreateMenuOpen: false, scheduledTaskEngineRequest: null, scheduledTaskEngineState: null, scheduledTaskEngineDraft: null, scheduledTaskTimeZone: null });
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
      store.set({ scheduledTaskRecords: [], scheduledTaskDraft: null, scheduledTaskNewSessionPending: null, scheduledTaskExpandedId: null, scheduledTaskDeleteId: null, scheduledTaskListRequest: null, scheduledTaskManualRequest: null, scheduledTaskCreateMenuOpen: false, scheduledTaskEngineRequest: null, scheduledTaskEngineState: null, scheduledTaskEngineDraft: null, scheduledTaskTimeZone: null });
    }
    if (state.connected === false && previous.connected === true) store.set({ scheduledTaskRecords: [], scheduledTaskDraft: null, scheduledTaskNewSessionPending: null, scheduledTaskInterviewRequestId: null, scheduledTaskActionRequestId: null, scheduledTaskListRequest: null, scheduledTaskManualRequest: null, scheduledTaskCreateMenuOpen: false, scheduledTaskEngineRequest: null, scheduledTaskEngineState: null, scheduledTaskEngineDraft: null, scheduledTaskTimeZone: null });
    if ((state.dmMode && !previous.dmMode) || state.mateProjectSlug !== previous.mateProjectSlug || state.activeSessionMode !== previous.activeSessionMode) {
      closeScheduledTasks();
      store.set({ scheduledTaskManualRequest: null, scheduledTaskCreateMenuOpen: false, scheduledTaskEngineRequest: null, scheduledTaskEngineState: null, scheduledTaskEngineDraft: null });
    }
  });
}
