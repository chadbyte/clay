import { store } from './store.js';
import { messagePreviewKey, rememberAgentMessage } from './agent-message-bubbles.js';
export function backgroundPreviewKey(task) { return messagePreviewKey('background', [store.get('sessionOriginId'), task.task_id, task.run_id || null]); }
export function handleBackgroundTaskPreview(message) {
  if (!store.get('connected') || message.sessionOriginId !== store.get('sessionOriginId')) return;
  var task = (store.get('backgroundTaskCatalog') || []).find(function (task) { return task.task_id === message.taskId && (task.run_id || null) === (message.runId || null); });
  if (task) rememberAgentMessage(backgroundPreviewKey(task), message.preview, message.live === true);
}
