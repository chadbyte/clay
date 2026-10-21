import { store } from './store.js';
import { getWs } from './ws-ref.js';

export function visible(element) {
  if (!element || !element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  var box = element.getBoundingClientRect(), style = getComputedStyle(element);
  if (style.visibility !== 'visible' || Number(style.opacity) === 0 || box.width <= 0 || box.height <= 0) return false;
  for (var parent = element.parentElement; parent; parent = parent.parentElement) if (getComputedStyle(parent).visibility !== 'visible' || Number(getComputedStyle(parent).opacity) === 0) return false;
  var left = Math.max(0, box.left), right = Math.min(innerWidth, box.right), top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
  return right > left && bottom > top && [0.2, 0.5, 0.8].some(function (x) {
    return [0.2, 0.5, 0.8].some(function (y) { var hit = document.elementFromPoint(left + (right - left) * x, top + (bottom - top) * y); return hit && element.contains(hit); });
  });
}
// Bounded evidence from the exact authenticated document, never navigation receipt.
export function observeNavigationRendering(message, socket) {
  var previous = store.get('clayNavigationRendering');
  if (previous) previous.finish(false);
  var target = message.target, owner = store.get('myUserId'), settled = false, stable = 0, frame, timer;
  function finish(rendered) {
    if (settled) return;
    settled = true; cancelAnimationFrame(frame); clearTimeout(timer); unsubscribe();
    document.removeEventListener('visibilitychange', hidden); document.removeEventListener('click', stop, true);
    if (store.get('clayNavigationRendering') === attempt) store.set({ clayNavigationRendering: null });
    if (getWs() === socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'clay_navigation_rendered', deliveryId: message.deliveryId,
      renderToken: message.renderToken, visible: rendered, projectSlug: target.projectSlug, sessionId: target.sessionId,
      sessionOriginId: target.sessionOriginId, surface: 'conversation', entryIndex: target.entryIndex }));
  }
  var attempt = { finish: finish };
  store.set({ clayNavigationRendering: attempt });
  function hidden() { if (document.hidden) finish(false); }
  var unsubscribe = store.subscribe(function (value, old) {
    if (!value.connected || value.myUserId !== owner || getWs() !== socket || value.currentSlug !== old.currentSlug && value.currentSlug !== target.projectSlug || value.activeSessionId !== old.activeSessionId && value.currentSlug === target.projectSlug && value.activeSessionId !== target.sessionId) finish(false);
  });
  function stop(event) { if (event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) finish(false); }
  document.addEventListener('click', stop, true);
  document.addEventListener('visibilitychange', hidden);
  timer = setTimeout(function () { finish(false); }, Math.max(0, Math.min(5000, message.renderDeadline - Date.now())));
  function inspect() {
    if (settled) return;
    if (document.hidden || getWs() !== socket || !store.get('connected') || store.get('myUserId') !== owner) { finish(false); return; }
    var transcript = document.getElementById('messages');
    var exact = store.get('currentSlug') === target.projectSlug && store.get('activeSessionId') === target.sessionId && store.get('sessionOriginId') === target.sessionOriginId &&
      !store.get('paneMode') && !store.get('dmMode') && !store.get('homeShellVisible') && !store.get('replayingHistory') && transcript &&
      transcript.dataset.controlSessionId === String(target.sessionId) && transcript.dataset.controlSessionOrigin === target.sessionOriginId && visible(transcript);
    if (exact && target.entryIndex !== undefined) exact = transcript.dataset.controlHistoryRevision === target.historyRevision && Array.from(transcript.querySelectorAll('[data-history-index], [data-history-indexes]')).some(function (item) {
      return (item.dataset.historyIndex === String(target.entryIndex) || (item.dataset.historyIndexes || '').split(',').indexOf(String(target.entryIndex)) >= 0) && visible(item);
    });
    stable = exact ? stable + 1 : 0;
    if (stable >= 2) finish(true); else frame = requestAnimationFrame(inspect);
  }
  frame = requestAnimationFrame(inspect);
}
