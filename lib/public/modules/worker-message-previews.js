import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { bindAgentMessageBubble, messagePreviewKey, rememberAgentMessage, rememberAgentActivity, forgetAgentMessage } from './agent-message-bubbles.js';
import { observeWorkerActivity, syncWorkerActivityIndicator, setWorkerActivityRuntime } from './worker-activity-indicator.js';

var scheduled = false;
function key(target) { return messagePreviewKey('worker', [target.parentSessionOriginId, target.workerSessionOriginId, target.generation]); }
function exactWorker(target) {
  var list = getCachedSessions() || [];
  var driver = list.find(function (item) { return item.sessionOriginId === target.parentSessionOriginId && item.sessionRole === 'driver' && (item.ownerId || null) === (store.get('myUserId') || null); });
  return driver && list.find(function (item) { return item.sessionOriginId === target.workerSessionOriginId && item.sessionRole === 'worker' &&
    item.parentAvailable && item.parentSessionId === driver.id && item.workerGeneration === target.generation && !item.hidden && (item.ownerId || null) === (driver.ownerId || null); });
}
function targets() {
  var found = [];
  if (document.hidden) return found;
  document.querySelectorAll('.split-view-worker-chip[data-worker-parent]').forEach(function (chip) {
    if (!chip.getClientRects().length || chip.closest('[hidden], .split-pane-cached')) return;
    var target = { parentSessionOriginId: chip.dataset.workerParent, workerSessionOriginId: chip.dataset.workerOrigin, generation: Number(chip.dataset.workerGeneration) };
    var worker = exactWorker(target); if (!worker) return;
    bindAgentMessageBubble(chip, key(target)); syncWorkerActivityIndicator(chip, worker);
    found.push(target);
  });
  return found.slice(0, 32);
}
function cleanup(list) {
  var keep = new Set(list.map(key)), all = Object.assign({}, store.get('workerActivityIndicators') || {}), changed = false;
  Object.keys(all).forEach(function (id) { if (!keep.has(id)) { delete all[id]; forgetAgentMessage(id); changed = true; } });
  if (changed) store.set({ workerActivityIndicators: all });
}
export function syncWorkerMessagePreviews() {
  if (scheduled || store.get('paneMode')) return;
  scheduled = true;
  requestAnimationFrame(function () {
    scheduled = false; var socket = getWs(), connected = store.get('connected') && socket && socket.readyState === 1;
    var list = connected ? targets() : []; cleanup(list);
    if (!connected) { store.set({ workerMessagePreviewSubscription: null }); return; }
    var signature = JSON.stringify([store.get('currentSlug'), store.get('myUserId'), store.get('projectSplitViewSocketGeneration'), list]);
    var previous = store.get('workerMessagePreviewSubscription'); if (previous && previous.signature === signature && previous.socket === socket) return;
    var requestId = crypto.randomUUID();
    store.set({ workerMessagePreviewSubscription: { requestId: requestId, signature: signature, targets: list, socket: socket,
      slug: store.get('currentSlug'), owner: store.get('myUserId'), socketGeneration: store.get('projectSplitViewSocketGeneration') } });
    socket.send(JSON.stringify({ type: 'split_worker_preview_request', requestId: requestId, targets: list }));
  });
}
export function handleWorkerMessagePreview(message) {
  var state = store.get('workerMessagePreviewSubscription');
  if (!state || !store.get('connected') || document.hidden || message.requestId !== state.requestId || state.socket !== getWs() ||
      state.slug !== store.get('currentSlug') || state.owner !== store.get('myUserId') || state.socketGeneration !== store.get('projectSplitViewSocketGeneration')) return;
  if (!state.targets.some(function (target) { return target.parentSessionOriginId === message.parentSessionOriginId && target.workerSessionOriginId === message.workerSessionOriginId && target.generation === message.generation; })) return;
  var worker = exactWorker(message); if (!worker) return;
  var chips = Array.from(document.querySelectorAll('.split-view-worker-chip[data-worker-parent]')).filter(function (chip) {
    return chip.dataset.workerParent === message.parentSessionOriginId && chip.dataset.workerOrigin === message.workerSessionOriginId &&
      Number(chip.dataset.workerGeneration) === message.generation && chip.getClientRects().length && !chip.closest('[hidden], .split-pane-cached');
  });
  if (!chips.length) return;
  var id = key(message), observed = observeWorkerActivity(id, message.activity || null, message.live === true);
  var current = (store.get('workerActivityIndicators') || {})[id];
  if (observed !== null || current && current.cursor && message.activity && current.cursor.epoch === message.activity.epoch && current.cursor.sequence === message.activity.sequence && current.cursor.queryGeneration === message.activity.queryGeneration) setWorkerActivityRuntime(id, message.isProcessing);
  if (observed !== null) rememberAgentActivity(id, message.activity || null, message.vendor, message.observedAt);
  rememberAgentMessage(id, message.preview, message.live === true);
  chips.forEach(function (chip) { syncWorkerActivityIndicator(chip, Object.assign({}, worker, { isProcessing: typeof message.isProcessing === 'boolean' ? message.isProcessing : worker.isProcessing })); });
}
store.subscribe(function (state, previous) {
  if (state.paneBindingSessions !== previous.paneBindingSessions && state.connected) targets().forEach(function (target) {
    var worker = exactWorker(target); if (worker) setWorkerActivityRuntime(key(target), worker.isProcessing === true);
  });
  if (state.splitPanes !== previous.splitPanes || state.projectSplitViewActiveId !== previous.projectSplitViewActiveId || state.paneBindingSessions !== previous.paneBindingSessions ||
      state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId || state.connected !== previous.connected || state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration) syncWorkerMessagePreviews();
});
var observer = new MutationObserver(syncWorkerMessagePreviews);
function observe() { var root = document.getElementById('split-host'); if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
document.addEventListener('visibilitychange', syncWorkerMessagePreviews);
