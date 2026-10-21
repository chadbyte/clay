import { bindAgentMessageBubble, rememberAgentMessage } from './agent-message-bubbles.js';
import { backgroundPreviewKey } from './background-task-previews.js';
// Native background work uses the same compact conversation chips as Workers.

import { openBackgroundTask } from './background-task-viewer.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';

export function initBackgroundTasksUi() {
  store.subscribe(function (state, prev) {
    if (state.sessionOriginId !== prev.sessionOriginId || state.currentSlug !== prev.currentSlug) { store.set({ activeBackgroundTasks: [], backgroundTaskCatalog: [] }); return; }
    if (state.backgroundTaskViewer !== prev.backgroundTaskViewer) document.querySelectorAll('[data-background-task]').forEach(function (chip) { var view = state.backgroundTaskViewer; chip.setAttribute('aria-expanded', String(!!view && chip.dataset.backgroundTask === view.taskId)); });
    if (state.activeBackgroundTasks !== prev.activeBackgroundTasks || state.backgroundTaskCatalog !== prev.backgroundTaskCatalog) renderBackgroundTasks();
  });
  renderBackgroundTasks();
}

// "45s", "2m 14s", "1h 03m" - short enough to sit in a row without wrapping.
export function formatElapsed(startedAt, now) {
  if (typeof startedAt !== "number" || !isFinite(startedAt) || startedAt <= 0) return "";
  var current = typeof now === "number" ? now : Date.now();
  var totalSeconds = Math.floor((current - startedAt) / 1000);
  if (totalSeconds < 0) totalSeconds = 0;
  if (totalSeconds < 60) return totalSeconds + "s";
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  if (minutes < 60) return minutes + "m " + pad(seconds) + "s";
  var hours = Math.floor(minutes / 60);
  return hours + "h " + pad(minutes % 60) + "m";
}

function pad(value) {
  return value < 10 ? "0" + value : String(value);
}

// Ambient tasks are the CLI's own housekeeping. The SDK asks hosts to keep
// them out of activity indicators; Clay still lists them so the user can see
// what runs on their behalf. Absent means false (Codex has no ambient concept,
// and older CLI builds report only user work).
export function isAmbientTask(task) {
  return !!(task && task.ambient === true);
}

export function splitTasks(tasks) {
  var user = [];
  var ambient = [];
  var list = Array.isArray(tasks) ? tasks : [];
  for (var i = 0; i < list.length; i++) {
    if (!list[i]) continue;
    if (isAmbientTask(list[i])) ambient.push(list[i]);
    else user.push(list[i]);
  }
  return { user: user, ambient: ambient };
}

function renderBackgroundTasks() {
  var existing = document.getElementById('background-tasks-bar'); if (existing) existing.remove();
  var split = splitTasks(store.get('backgroundTaskCatalog') || store.get('activeBackgroundTasks') || []);
  var tasks = split.user.length ? split.user.concat(split.ambient) : [];
  var root = document.getElementById('background-task-tabs');
  if (!tasks.length) { if (root) root.remove(); return; }
  var messages = document.getElementById('messages'); if (!messages) return;
  if (!root) { root = document.createElement('div'); root.id = 'background-task-tabs'; root.className = 'split-view-workers background-task-tabs'; root.setAttribute('aria-label', 'Background tasks'); messages.parentNode.insertBefore(root, messages); }
  var signature = JSON.stringify(tasks.map(function (task) { return [task.task_id, task.run_id, task.active, task.description]; }));
  if (root.dataset.signature === signature) return;
  root.dataset.signature = signature; root.textContent = '';
  tasks.forEach(function (task) {
    var pill = document.createElement('span'); pill.className = 'split-view-worker-pill' + (task.ambient ? ' background-task-ambient' : '');
    var button = document.createElement('button'); button.type = 'button'; button.className = 'split-view-worker-chip'; button.dataset.backgroundTask = task.task_id;
    bindAgentMessageBubble(button, backgroundPreviewKey(task));
    if (task.preview) rememberAgentMessage(backgroundPreviewKey(task), task.preview, false);
    button.title = (task.ambient ? 'Housekeeping · ' : '') + (task.description || 'Background task') + (task.started_at ? ' · ' + formatElapsed(task.started_at) : '') + (task.active === false ? ' · Finished' : ' · Running'); button.setAttribute('aria-haspopup', 'dialog');
    var view = store.get('backgroundTaskViewer'); button.setAttribute('aria-expanded', String(!!view && view.taskId === task.task_id));
    var dot = document.createElement('span'); dot.className = 'split-view-worker-dot'; dot.dataset.state = task.active === false ? 'ready' : 'working';
    var label = document.createElement('span'); label.className = 'split-view-worker-name'; label.textContent = task.description || 'Background task';
    dot.setAttribute('aria-label', task.active === false ? 'Finished' : 'Running');
    button.append(dot, label); button.addEventListener('click', function () { openBackgroundTask(task); }); pill.appendChild(button);
    if (task.active !== false) {
      var stop = document.createElement('button'); stop.type = 'button'; stop.className = 'split-view-worker-remove'; stop.setAttribute('aria-label', 'Stop ' + (task.description || 'background task')); stop.title = 'Stop task'; stop.innerHTML = iconHtml('square');
      stop.addEventListener('click', function () { var ws = getWs(); if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'background_task_stop', requestId: crypto.randomUUID(), taskId: task.task_id, runId: task.run_id || null, sessionOriginId: store.get('sessionOriginId') })); });
      pill.appendChild(stop);
    }
    root.appendChild(pill);
  });
  refreshIcons();
}
