import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { appendWorkerTranscript } from './split-view-worker-transcript.js';
import { captureWorkerDisclosures, restoreWorkerDisclosures, workerActivityNames } from './split-view-worker-activity.js';
import { iconHtml, refreshIcons } from './icons.js';

function panel() { return document.getElementById('background-task-viewer'); }
function current(state) {
  return state && store.get('connected') && state.socketGeneration === store.get('projectSplitViewSocketGeneration') && state.origin === store.get('sessionOriginId') &&
    state.slug === store.get('currentSlug') && state.owner === store.get('myUserId') &&
    (store.get('backgroundTaskCatalog') || []).some(function (task) { return task.task_id === state.taskId && (task.run_id || null) === state.runId; });
}
export function closeBackgroundTask(focus) {
  var state = store.get('backgroundTaskViewer');
  if (state && state.timer) clearTimeout(state.timer);
  if (state && state.timeout) clearTimeout(state.timeout);
  store.set({ backgroundTaskViewer: null });
  var element = panel(); if (element) element.remove();
  if (focus && state) {
    var chip = document.querySelector('[data-background-task="' + CSS.escape(state.taskId) + '"]'); if (chip) chip.focus();
  }
}
export function openBackgroundTask(task) {
  closeBackgroundTask(false);
  var state = { taskId: task.task_id, runId: task.run_id || null, title: task.description || 'Background task',
    origin: store.get('sessionOriginId'), slug: store.get('currentSlug'), owner: store.get('myUserId'), socketGeneration: store.get('projectSplitViewSocketGeneration'), offset: 0 };
  if (!current(state)) return;
  store.set({ backgroundTaskViewer: state });
  var element = document.createElement('section'); element.id = 'background-task-viewer'; element.className = 'split-view-worker-popover background-task-viewer';
  element.setAttribute('role', 'dialog'); element.setAttribute('aria-label', 'Background task conversation');
  element.innerHTML = '<header class="split-view-worker-popover-header"><strong></strong><button type="button" aria-label="Close background task">' + iconHtml('x') + '</button></header>' +
    '<div class="split-view-worker-popover-source">Read-only · Native background task</div><div class="split-view-worker-popover-body readonly-session-transcript" tabindex="0"></div>' +
    '<footer class="split-view-worker-popover-footer"><span role="status"></span><button type="button" data-page="previous">Previous</button><button type="button" data-page="next">Next</button><button type="button" data-retry>Refresh</button></footer>';
  element.querySelector('strong').textContent = state.title;
  element.querySelector('[aria-label="Close background task"]').addEventListener('click', function () { closeBackgroundTask(true); });
  element.querySelector('[data-retry]').addEventListener('click', request);
  element.querySelectorAll('[data-page]').forEach(function (button) { button.addEventListener('click', function () {
    var live = store.get('backgroundTaskViewer'); if (!current(live) || live.pending) return;
    store.set({ backgroundTaskViewer: Object.assign({}, live, { offset: button.dataset.page === 'next' ? live.offset + 100 : Math.max(0, live.offset - 100) }) }); request();
  }); });
  document.body.appendChild(element); refreshIcons(); request();
  element.querySelector('button').focus();
}
function request() {
  var state = store.get('backgroundTaskViewer');
  if (!current(state)) { closeBackgroundTask(false); return; }
  if (state.pending) return;
  if (state.timer) clearTimeout(state.timer);
  var id = crypto.randomUUID();
  var timeout = setTimeout(function () {
    var live = store.get('backgroundTaskViewer'); if (!live || live.requestId !== id) return;
    store.set({ backgroundTaskViewer: Object.assign({}, live, { pending: false, timeout: null }) });
    var element = panel(); if (element) element.querySelector('[role="status"]').textContent = 'Task read timed out. Use Refresh to retry.';
  }, 18000);
  store.set({ backgroundTaskViewer: Object.assign({}, state, { requestId: id, pending: true, timeout: timeout, timer: null }) });
  var sent = getWs().send(JSON.stringify({ type: 'background_task_read', requestId: id, taskId: state.taskId, runId: state.runId, sessionOriginId: state.origin, offset: state.offset }));
  if (sent === false) { clearTimeout(timeout); var live = store.get('backgroundTaskViewer'); if (live && live.requestId === id) { store.set({ backgroundTaskViewer: Object.assign({}, live, { pending: false, timeout: null }) }); panel().querySelector('[role="status"]').textContent = 'Task pane is not ready. Use Refresh to retry.'; } }
}
export function handleBackgroundTaskRead(message) {
  var state = store.get('backgroundTaskViewer'), element = panel();
  if (!element || !current(state) || message.requestId !== state.requestId || message.sessionOriginId !== state.origin ||
      message.taskId !== state.taskId || (message.runId || null) !== state.runId) return;
  clearTimeout(state.timeout);
  var body = element.querySelector('.split-view-worker-popover-body'), footer = element.querySelector('[role="status"]');
  var data = message.data;
  if (message.error) { footer.textContent = message.error; state = Object.assign({}, state, { failures: (state.failures || 0) + 1 }); }
  else if (data) {
    var signature = JSON.stringify(data), changed = signature !== state.signature;
    if (changed) {
      var follow = body.scrollHeight - body.scrollTop - body.clientHeight < 48, top = body.scrollTop;
      var disclosures = captureWorkerDisclosures(body); body.textContent = '';
      if (data.kind === 'shell') { var pre = document.createElement('pre'); pre.textContent = data.output || 'No output yet.'; body.appendChild(pre); }
      else appendWorkerTranscript(body, data.messages || [], { vendor: 'claude', userName: 'Parent agent', assistantName: 'Background agent' });
      restoreWorkerDisclosures(body, disclosures);
      body.scrollTop = follow ? body.scrollHeight : top;
    }
    footer.textContent = (data.active ? 'Running' : 'Finished') + (data.truncated ? ' · Last 8 KiB of output' : '') +
      (data.kind === 'agent' && !data.messages.length ? ' · No transcript messages yet' : '');
    element.querySelector('[data-page="previous"]').hidden = data.kind !== 'agent' || state.offset === 0;
    element.querySelector('[data-page="next"]').hidden = !data.hasMore;
    state = Object.assign({}, state, { signature: signature, failures: 0 });
  }
  var task = (store.get('backgroundTaskCatalog') || []).find(function (item) { return item.task_id === state.taskId; });
  var timer = task && task.active !== false && (state.failures || 0) < 3 ? setTimeout(function () { if (!document.hidden) request(); else schedule(); }, 2000) : null;
  store.set({ backgroundTaskViewer: Object.assign({}, state, { pending: false, timeout: null, timer: timer }) });
}
function schedule() {
  var state = store.get('backgroundTaskViewer'); if (!current(state)) return;
  var timer = setTimeout(function () { if (!document.hidden) request(); else schedule(); }, 2000);
  store.set({ backgroundTaskViewer: Object.assign({}, state, { timer: timer }) });
}
store.subscribe(function (state, prev) {
  if (state.backgroundTaskViewer && (state.sessionOriginId !== prev.sessionOriginId || state.currentSlug !== prev.currentSlug ||
      state.myUserId !== prev.myUserId || state.projectSplitViewSocketGeneration !== prev.projectSplitViewSocketGeneration || !state.connected || state.backgroundTaskCatalog !== prev.backgroundTaskCatalog && !current(state.backgroundTaskViewer))) closeBackgroundTask(false);
});
document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && panel()) { event.preventDefault(); closeBackgroundTask(true); } });
document.addEventListener('click', function (event) { var element = panel(); if (element && !element.contains(event.target) && !event.target.closest('[data-background-task]')) closeBackgroundTask(false); });
