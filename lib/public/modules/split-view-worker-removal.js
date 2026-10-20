import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showConfirm, hideConfirm } from './app-misc.js';
import { showToast } from './utils.js';
import { spawnDustParticles } from './sidebar.js';
import { workerRemovalTarget } from './split-view-workers.js';

// Runtime resources belong to this module; the store contains only removal data.
var removalResources = null;

function state() { return store.get('splitViewWorkerRemoval'); }
function same(left, right) { return !!left && !!right && JSON.stringify(left) === JSON.stringify(right); }
function live(record) {
  return record && removalResources && getWs() === removalResources.socket && same(record.target, workerRemovalTarget(removalResources.container, record.target.driverOriginId, record.target.workerOriginId, record.target.generation));
}
function paint(button, phase) {
  button.classList.toggle('armed', phase === 'armed');
  button.classList.toggle('pending', phase === 'pending' || phase === 'confirming');
  button.disabled = phase === 'pending' || phase === 'confirming';
  button.setAttribute('aria-label', phase === 'armed' ? 'Confirm Worker removal' : phase === 'pending' ? 'Removing Worker' : 'Remove Worker session');
  button.setAttribute('aria-pressed', String(phase === 'armed'));
  button.innerHTML = iconHtml(phase === 'armed' ? 'check' : 'x'); refreshIcons();
}
function send(record, action, token, resources) {
  resources = resources || removalResources;
  if (!resources || !resources.socket || resources.socket.readyState !== 1) return false;
  resources.socket.send(JSON.stringify(Object.assign({}, record.target, { type: 'split_worker_remove', requestId: record.requestId, action: action, token: token || null })));
  return true;
}
function clear(cancel, focus) {
  var record = state(); if (!record) return;
  var resources = removalResources;
  removalResources = null;
  store.set({ splitViewWorkerRemoval: null });
  if (resources && resources.timer) clearTimeout(resources.timer);
  if (cancel && record.requestId) send(record, 'cancel', null, resources);
  if (record.phase === 'confirming') hideConfirm();
  if (resources && resources.button.isConnected) { paint(resources.button, 'idle'); if (focus) resources.button.focus(); }
}
function request(record, token) {
  if (!live(record)) { clear(true, false); return; }
  var next = Object.assign({}, record, { phase: 'pending' });
  if (removalResources.timer) clearTimeout(removalResources.timer);
  removalResources.timer = setTimeout(function () {
    if (!state() || state().requestId !== next.requestId || state().phase !== 'pending') return;
    clear(true, true); showToast('Worker removal outcome is unknown. Check the session before trying again.', 'error');
  }, 10000);
  store.set({ splitViewWorkerRemoval: next }); paint(removalResources.button, 'pending');
  try { if (!send(next, token ? 'confirm' : 'request', token)) throw new Error('Connection lost.'); }
  catch (error) { clear(true, true); showToast('Worker removal could not be sent.', 'error'); }
}
export function reconcileWorkerRemoval(container) {
  var record = state(); if (!record || !removalResources || removalResources.container !== container) return;
  var frame = container.querySelector('.split-pane-frame');
  var stillListed = (getCachedSessions() || []).some(function (session) { return session.sessionOriginId === record.target.workerOriginId; });
  if (!live(record) && (record.phase !== 'pending' || stillListed) || container.hidden || container.inert || !container.isConnected || frame && (frame.hidden || frame.inert)) clear(true, false);
}
export function appendWorkerRemoval(pill, button, container, driver, worker) {
  var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'split-view-worker-remove';
  remove.dataset.workerOrigin = worker.sessionOriginId; remove.dataset.workerGeneration = String(worker.workerGeneration);
  paint(remove, 'idle'); pill.appendChild(remove);
  var target = workerRemovalTarget(container, driver.sessionOriginId, worker.sessionOriginId, worker.workerGeneration);
  remove.disabled = !target;
  var existing = state();
  if (existing && same(existing.target, target)) {
    removalResources.button = remove; removalResources.container = container;
    paint(remove, existing.phase);
  }
  remove.addEventListener('click', function (event) {
    event.preventDefault(); event.stopPropagation();
    var current = workerRemovalTarget(container, driver.sessionOriginId, worker.sessionOriginId, worker.workerGeneration);
    if (!remove.isConnected || remove.disabled || !same(current, target)) { clear(true, false); return; }
    var previous = state();
    if (previous && same(previous.target, target) && previous.phase === 'armed') {
      var rect = pill.getBoundingClientRect();
      var record = Object.assign({}, previous, { requestId: 'remove_' + crypto.randomUUID().replace(/-/g, ''),
        center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } });
      request(record); return;
    }
    clear(true, false);
    removalResources = { socket: getWs(), container: container, button: remove, timer: null };
    store.set({ splitViewWorkerRemoval: { phase: 'armed', target: target } });
    paint(remove, 'armed');
  });
}
export function handleWorkerRemovalResult(msg) {
  var record = state();
  if (!record || !removalResources || record.requestId !== msg.requestId || record.target.workerOriginId !== msg.workerOriginId ||
      record.target.generation !== msg.generation || record.target.projectSlug !== msg.projectSlug || getWs() !== removalResources.socket) return;
  if (msg.status === 'removed') {
    var container = removalResources.container, center = record.center;
    var visible = store.get('connected') && store.get('currentSlug') === record.target.projectSlug &&
      (store.get('myUserId') || null) === record.target.ownerId && container.isConnected && !container.hidden && !container.inert;
    clear(false, false);
    if (visible) {
      spawnDustParticles(center.x, center.y, { containerClass: 'worker-removal-particles' });
      var focus = container.querySelector('.split-view-worker-chip') || container.querySelector('.split-pane-info');
      if (focus) focus.focus();
    }
    return;
  }
  if (!live(record)) { clear(true, false); return; }
  if (msg.status === 'confirmation_required' && record.phase === 'pending' && msg.token) {
    clearTimeout(removalResources.timer); removalResources.timer = null;
    var next = Object.assign({}, record, { phase: 'confirming' });
    store.set({ splitViewWorkerRemoval: next }); paint(removalResources.button, 'confirming');
    showConfirm('Stop and remove Worker? This deletes Split Worker #' + record.target.workerId + ' and its conversation.', function () {
      if (state() && state().requestId === next.requestId) request(state(), msg.token);
    }, 'Stop and remove Worker', true, function () { if (state() && state().phase === 'confirming') clear(true, true); });
    var ok = document.getElementById('confirm-ok'); if (ok) ok.focus();
    return;
  }
  clear(false, true); showToast(msg.error || 'Worker removal was not completed.', 'error');
}
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && state()) { event.preventDefault(); event.stopImmediatePropagation(); clear(true, true); }
}, true);
document.addEventListener('click', function (event) {
  var record = state(); if (!record || record.phase !== 'armed') return;
  if (removalResources && (event.target === removalResources.button || removalResources.button.contains(event.target))) return;
  clear(true, false);
}, true);
store.subscribe(function (next, previous) {
  var record = state(); if (!record) return;
  if (next.connected !== previous.connected || next.currentSlug !== previous.currentSlug || next.myUserId !== previous.myUserId ||
      next.projectSplitViewRevision !== previous.projectSplitViewRevision || next.projectSplitViewActiveId !== previous.projectSplitViewActiveId ||
      next.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration ||
      next.projectSplitViewFocusedOrigin !== previous.projectSplitViewFocusedOrigin) { clear(true, false); return; }
  if (next.paneBindingSessions !== previous.paneBindingSessions && !live(record)) {
    // Deletion broadcasts may precede their receipt. Retain only that pending
    // receipt; absence from the list alone never claims removal or animates it.
    var stillListed = (getCachedSessions() || []).some(function (session) { return session.sessionOriginId === record.target.workerOriginId; });
    if (record.phase !== 'pending' || stillListed) clear(true, false);
  }
});
