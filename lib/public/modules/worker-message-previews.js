import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { bindAgentMessageBubble, messagePreviewKey, rememberAgentMessage } from './agent-message-bubbles.js';

var scheduled = false;
function targets() {
  var found = [];
  document.querySelectorAll('.split-view-worker-chip[data-worker-parent]').forEach(function (chip) {
    if (!chip.getClientRects().length || chip.closest('[hidden], .split-pane-cached')) return;
    var target = { parentSessionOriginId: chip.dataset.workerParent, workerSessionOriginId: chip.dataset.workerOrigin, generation: Number(chip.dataset.workerGeneration) };
    bindAgentMessageBubble(chip, messagePreviewKey('worker', [target.parentSessionOriginId, target.workerSessionOriginId, target.generation]));
    found.push(target);
  });
  return found.slice(0, 32);
}
export function syncWorkerMessagePreviews() {
  if (scheduled || store.get('paneMode')) return;
  scheduled = true;
  requestAnimationFrame(function () {
    scheduled = false; var socket = getWs(); if (!store.get('connected') || !socket || socket.readyState !== 1) return;
    var list = targets(), signature = JSON.stringify([store.get('currentSlug'), store.get('myUserId'), store.get('projectSplitViewSocketGeneration'), list]);
    var previous = store.get('workerMessagePreviewSubscription'); if (previous && previous.signature === signature) return;
    var requestId = crypto.randomUUID(); store.set({ workerMessagePreviewSubscription: { requestId: requestId, signature: signature, targets: list } });
    socket.send(JSON.stringify({ type: 'split_worker_preview_request', requestId: requestId, targets: list }));
  });
}
export function handleWorkerMessagePreview(message) {
  var state = store.get('workerMessagePreviewSubscription'); if (!state || !store.get('connected') || message.requestId !== state.requestId) return;
  if (!state.targets.some(function (target) { return target.parentSessionOriginId === message.parentSessionOriginId && target.workerSessionOriginId === message.workerSessionOriginId && target.generation === message.generation; })) return;
  var chip = Array.from(document.querySelectorAll('.split-view-worker-chip[data-worker-parent]')).find(function (chip) { return chip.dataset.workerParent === message.parentSessionOriginId && chip.dataset.workerOrigin === message.workerSessionOriginId && Number(chip.dataset.workerGeneration) === message.generation; });
  if (!chip || !chip.getClientRects().length) return;
  rememberAgentMessage(messagePreviewKey('worker', [message.parentSessionOriginId, message.workerSessionOriginId, message.generation]), message.preview, message.live === true);
}
store.subscribe(function (state, previous) {
  if (state.splitPanes !== previous.splitPanes || state.projectSplitViewActiveId !== previous.projectSplitViewActiveId || state.paneBindingSessions !== previous.paneBindingSessions || state.connected !== previous.connected || state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration) syncWorkerMessagePreviews();
});
var observer = new MutationObserver(syncWorkerMessagePreviews);
function observe() { var root = document.getElementById('split-host'); if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
