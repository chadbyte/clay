import { store } from './store.js';
import { queueContext, sameQueueContext } from './pending-message-queue-recovery.js';

function validDrag(drag) {
  var queue = store.get('pendingMessageQueue') || {};
  return drag && queueContext(store.snap()).enabled && sameQueueContext(drag.context, queueContext(store.snap())) && queue.revision === drag.revision;
}

export function paintPendingQueueDrag(element) {
  var drag = store.get('pendingMessageQueueDrag');
  element.classList.toggle('is-reordering', !!drag && drag.moved);
  element.querySelectorAll('[data-pending-id]').forEach(function (row) {
    row.classList.toggle('is-dragging', !!drag && drag.moved && row.dataset.pendingId === drag.id);
    row.classList.toggle('is-drop-target', !!drag && drag.moved && row.dataset.pendingId === drag.targetId);
    row.classList.toggle('is-drop-after', !!drag && drag.after && row.dataset.pendingId === drag.targetId);
  });
}

export function bindPendingQueueDrag(element, reorder) {
  function cleanupDrag(event) {
    var drag = store.get('pendingMessageQueueDrag');
    if (!drag || (event && drag.pointerId !== event.pointerId)) return null;
    store.set({ pendingMessageQueueDrag: null });
    if (element.hasPointerCapture(drag.pointerId)) element.releasePointerCapture(drag.pointerId);
    paintPendingQueueDrag(element);
    return drag;
  }
  element.addEventListener('pointerdown', function (event) {
    var row = event.target.closest('[data-pending-id]');
    var handle = row && row.querySelector('[data-action="drag"]');
    if (event.target.closest('textarea, input, a, [contenteditable="true"]') || (event.target.closest('button') && !event.target.closest('[data-action="drag"]'))) return;
    if (!handle || handle.disabled || !event.isPrimary || event.button !== 0) return;
    if (store.get('pendingMessageQueueEdit') && store.get('pendingMessageQueueEdit').id === row.dataset.pendingId) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    // Rows can be replaced by a live queue refresh during this gesture.
    element.setPointerCapture(event.pointerId);
    store.set({ pendingMessageQueueDrag: { id: row.dataset.pendingId, pointerId: event.pointerId, targetId: null, context: queueContext(store.snap()), revision: (store.get('pendingMessageQueue') || {}).revision, startX: event.clientX, startY: event.clientY, moved: false } });
  });
  element.addEventListener('pointermove', function (event) {
    var drag = store.get('pendingMessageQueueDrag');
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!validDrag(drag)) { cleanupDrag(event); return; }
    var moved = drag.moved || Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4;
    var hit = document.elementFromPoint(event.clientX, event.clientY);
    var row = hit && hit.closest('[data-pending-id]');
    var targetId = row && element.contains(row) && row.querySelector('button[data-action="drag"]:not(:disabled)') && row.dataset.pendingId !== drag.id ? row.dataset.pendingId : null;
    var rows = Array.from(element.querySelectorAll('[data-pending-id]'));
    var source = rows.findIndex(function (candidate) { return candidate.dataset.pendingId === drag.id; });
    store.set({ pendingMessageQueueDrag: Object.assign({}, drag, { moved: moved, targetId: targetId, after: targetId && rows.indexOf(row) > source }) });
    paintPendingQueueDrag(element);
  });
  element.addEventListener('pointerup', function (event) {
    var drag = cleanupDrag(event);
    if (validDrag(drag) && drag.moved && drag.targetId) reorder(drag.id, 0, drag.targetId);
  });
  element.addEventListener('pointercancel', cleanupDrag);
  element.addEventListener('lostpointercapture', cleanupDrag);
  element.addEventListener('keydown', function (event) { if (event.key === 'Escape') cleanupDrag(); });
  window.addEventListener('blur', function () { cleanupDrag(); });
  store.subscribe(function (state, previous) {
    var drag = state.pendingMessageQueueDrag;
    if (drag && !validDrag(drag)) cleanupDrag();
    else if (!drag && previous.pendingMessageQueueDrag) {
      if (element.hasPointerCapture(previous.pendingMessageQueueDrag.pointerId)) element.releasePointerCapture(previous.pendingMessageQueueDrag.pointerId);
      paintPendingQueueDrag(element);
    }
  });
}
