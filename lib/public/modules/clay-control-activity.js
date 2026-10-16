// Owner-authenticated presentation only; this module never invokes a product action.
import { contextualMateStamp } from './contextual-mate-identity.js';
import { store } from './store.js';
import { mateAvatarUrl } from './avatar.js';
import { activityCopy, validActivity } from './clay-control-copy.js';
import { controlTarget, activityPlacement, visibleTarget } from './clay-control-targets.js';

function forward(message) {
  if (!store.get('paneMode') || window.parent === window) return false;
  store.set({ clayControlForwarded: message });
  window.parent.postMessage({ type: 'clay-control-presentation', message: message }, location.origin);
  return true;
}
export function clearClayControlActivity() {
  var activity = store.get('clayControlActivity');
  if (activity) {
    clearTimeout(activity.timer);
    cancelAnimationFrame(activity.frame);
    if (activity.animation) activity.animation.cancel();
    if (activity.observer) activity.observer.disconnect();
    if (activity.resize) activity.resize.disconnect();
  }
  store.set({ clayControlActivity: null });
  var element = document.getElementById('clay-control-activity');
  if (element) element.remove();
}
function layout() {
  var activity = store.get('clayControlActivity'), element = document.getElementById('clay-control-activity');
  if (!activity || !element) return;
  var surface = document.getElementById('contextual-clay');
  var narrow = window.matchMedia('(max-width: 768px)').matches;
  var workbench = narrow && Array.from(document.querySelectorAll('#file-viewer, #mate-knowledge-workbench, #project-logs-panel, #issues-panel, #scheduled-tasks-panel')).find(function (item) { return visibleTarget(item); });
  var host = workbench || surface;
  var inline = narrow && host && !host.hidden && host.getClientRects().length;
  element.classList.toggle('is-inline', !!inline);
  if (inline) {
    if (element.parentNode !== host) {
      if (host === surface) host.insertBefore(element, surface.querySelector('.contextual-clay-body'));
      else host.insertBefore(element, host.children[1] || null);
    }
    element.classList.remove('has-target', 'is-flipped', 'is-reversed');
    element.dataset.targeted = 'false'; element.style.visibility = 'visible';
    element.style.marginTop = '6px';
    var inlineBox = element.getBoundingClientRect(), offset = 0;
    Array.from(document.querySelectorAll('.notif-banner.show')).forEach(function (banner) { var rect = banner.getBoundingClientRect(); if (rect.left < inlineBox.right && rect.right > inlineBox.left && rect.bottom > inlineBox.top && rect.top < inlineBox.bottom) offset = Math.max(offset, rect.bottom - inlineBox.top + 8); });
    if (offset) element.style.marginTop = (6 + offset) + 'px';
    return;
  }
  if (element.parentNode !== document.body) document.body.appendChild(element);
  element.style.removeProperty("margin-top");
  var contextual = store.get('contextualClay') || {};
  var background = activity.fromPane && (contextual.mode !== 'popover' || contextual.mateId !== activity.message.mateId);
  var row = !background && !window.matchMedia('(pointer: coarse), (max-width: 768px)').matches && controlTarget(activity.message.target);
  if (activity.targetNode !== row) {
    if (activity.targetNode) activity.resize.unobserve(activity.targetNode);
    activity.targetNode = row;
    if (row) activity.resize.observe(row, { box: 'border-box' });
  }
  var obstacles = Array.from(document.querySelectorAll('#input-area, #contextual-clay, .ask-user-container:not(.answered), [role="dialog"], .notif-banner.show, #file-viewer-body, .wireframe-workbench-canvas')).filter(function (item) {
    return (!row || !item.contains(row) || item.id === 'input-area') && !item.closest('details:not([open]), [hidden], [inert], [aria-hidden="true"]') && item.getClientRects().length && !item.hidden && getComputedStyle(item).visibility !== 'hidden' && Number(getComputedStyle(item).opacity) > 0;
  }).map(function (item) { return item.getBoundingClientRect(); });
  var box = element.getBoundingClientRect();
  var place = activityPlacement(row, box.width, box.height, obstacles);
  element.style.visibility = place ? 'visible' : 'hidden';
  if (!place) { if (activity.animation) activity.animation.cancel(); element.dataset.targeted = 'false'; element.classList.remove('has-target', 'is-flipped', 'is-reversed'); element.style.removeProperty('--tip-x'); element.style.removeProperty('--tip-y'); return; }
  var targeted = place.tipX !== undefined;
  if (!targeted && activity.animation) { activity.animation.cancel(); activity.animation = null; }
  element.classList.toggle('has-target', targeted);
  element.classList.toggle('is-flipped', !!place.flip);
  element.classList.toggle('is-reversed', !!place.reverse);
  element.style.left = place.left + 'px'; element.style.top = place.top + 'px';
  if (targeted) {
    element.style.setProperty('--tip-x', (place.tipX - place.left) + 'px');
    element.style.setProperty('--tip-y', (place.tipY - place.top) + 'px');
  }
  element.dataset.targeted = String(targeted);
  if (document.getAnimations().some(function (animation) {
    var node = animation.effect && animation.effect.target;
    if (animation.playState !== 'running' || !(node instanceof Element) || element.contains(node) ||
      !(row && (node === row || node.contains(row)) || node.matches('.notif-banner.show'))) return false;
    if (!activity.motionSeen) activity.motionSeen = new WeakSet();
    if (!activity.motionSeen.has(animation)) { activity.motionSeen.add(animation); activity.motionUntil = Date.now() + 5000; }
    return Date.now() < activity.motionUntil;
  })) scheduleLayout();
}
function scheduleLayout() {
  var activity = store.get('clayControlActivity');
  if (!activity || activity.frame) return;
  activity.frame = requestAnimationFrame(function () { activity.frame = null; layout(); });
}
function render(message, mate, copy, fromPane) {
  var existing = store.get('clayControlActivity');
  if (existing && existing.message.id === message.id) {
    existing.message = message;
    existing.fromPane = !!fromPane;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(clearClayControlActivity, message.terminal === false || ['review', 'running'].indexOf(message.phase) >= 0 ? 300000 : 6000);
    document.querySelector('#clay-control-activity .clay-control-bubble').textContent = copy;
    scheduleLayout(); return;
  }
  var previous = document.getElementById('clay-control-activity');
  var previousRect = previous && previous.classList.contains('has-target') && previous.getBoundingClientRect();
  clearClayControlActivity();
  var element = document.createElement('div'); element.id = 'clay-control-activity';
  element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite'); element.setAttribute('aria-atomic', 'true');
  var identity = document.createElement('span'); identity.className = 'clay-control-identity';
  var avatar = document.createElement('img'); avatar.alt = ''; avatar.width = 20; avatar.height = 20;
  avatar.addEventListener('error', function () { avatar.hidden = true; }, { once: true });
  avatar.src = mateAvatarUrl(mate, 20);
  var name = document.createElement('span'); name.className = 'clay-control-name';
  name.textContent = (mate.profile || {}).displayName || mate.displayName || mate.name || (mate.builtinKey === 'clay' ? 'Clay' : 'Mate');
  identity.append(avatar, name);
  var bubble = document.createElement('span'); bubble.className = 'clay-control-bubble'; bubble.textContent = copy;
  var pointer = document.createElement('span'); pointer.className = 'clay-control-pointer'; pointer.setAttribute('aria-hidden', 'true');
  element.append(pointer, identity, bubble); document.body.appendChild(element);
  var observer = new MutationObserver(function (changes) {
    if (changes.some(function (change) { return !element.contains(change.target); })) scheduleLayout();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'inert', 'data-session-id', 'data-control-session-origin', 'data-control-revision', 'data-ref', 'data-task-id', 'data-open-issue', 'data-control-runtime', 'data-control-mate-stamp'] });
  var resize = new ResizeObserver(scheduleLayout); resize.observe(document.body); resize.observe(element);
  var activity = { message: message, fromPane: !!fromPane, observer: observer, resize: resize, frame: null,
    timer: setTimeout(clearClayControlActivity, message.terminal === false || ['review', 'running'].indexOf(message.phase) >= 0 ? 300000 : 6000) };
  store.set({ clayControlActivity: activity }); layout();
  if (previousRect && element.classList.contains('has-target') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var next = element.getBoundingClientRect(), dx = previousRect.left - next.left, dy = previousRect.top - next.top;
    if (Math.hypot(dx, dy) <= 600 && (dx || dy)) activity.animation = element.animate([
      { transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'translate(0, 0)' }
    ], { duration: 140, easing: 'ease-out' });
  }
}
export function handleClayControlActivity(message) {
  if (message && message.type === 'clay_control_viewer') { store.set({ clayControlViewerRef: message.viewerRef }); return true; }
  if (!message || message.type !== 'clay_control_activity') return false;
  if (!validActivity(message) || message.recipientViewerRef !== store.get('clayControlViewerRef')) return true;
  if (store.get('paneMode') && (message.sourceSessionOriginId !== store.get('sessionOriginId') || message.sourceSessionId !== store.get('activeSessionId') || message.mateId !== store.get('activeProjectMateId'))) return true;
  if (!sourceMate(message)) return true;
  if (forward(message)) return true;
  acceptActivity(message);
  return true;
}
function sourceMate(message) {
  return (store.get('cachedMatesList') || []).find(function (mate) {
    return !mate.archived && !mate.lifecycleDeletion && mate.id === message.mateId && mate.builtinKey === 'clay' && contextualMateStamp(mate) === message.sourceMateStamp;
  });
}
function acceptActivity(message, fromPane) {
  if ((message.ownerId || null) !== (store.get('myUserId') || null) || !store.get('connected')) return;
  if (!sourceMate(message)) return;
  var active = store.get('clayControlActivity');
  var receipts = store.get('clayControlReceipts') || [];
  var old = receipts.find(function (entry) { return entry.id === message.id; });
  var order = store.get('clayControlOrder') || 0;
  if (message.order < order || old && message.sequence <= old.sequence) return;
  if (old && old.stopped) return;
  receipts = receipts.filter(function (entry) { return entry.id !== message.id && Date.now() - entry.time < 300000; }).slice(-99);
  receipts.push({ id: message.id, sequence: message.sequence, time: Date.now(), stopped: message.phase === 'clear' });
  store.set({ clayControlOrder: message.order, clayControlReceipts: receipts });
  if (message.phase === 'clear') { if (active && active.message.id === message.id) clearClayControlActivity(); return; }
  var mate = (store.get('cachedMatesList') || []).find(function (item) { return !item.archived && !item.lifecycleDeletion && item.id === message.mateId && item.builtinKey === 'clay'; });
  if (!mate) return;
  render(message, mate, activityCopy(message), fromPane);
}
// Ordinary Mates retain their existing restricted navigation invocation feedback.
export function showClayNavigationActivity(target, failed) {
  if (!target || !target.contextualSourceMateId) return;
  var mate = (store.get('cachedMatesList') || []).find(function (item) { return !item.archived && item.id === target.contextualSourceMateId; });
  if (!mate) return;
  render({ id: 'ordinary-navigation', target: Object.assign({ kind: 'session' }, target) }, mate,
    failed ? 'I could not start that navigation.' : 'I’m opening the reviewed conversation.');
}
function stopPresentation() {
  var active = store.get('clayControlActivity');
  if (active) {
    var receipts = (store.get('clayControlReceipts') || []).slice();
    receipts.push({ id: active.message.id, sequence: Number.MAX_SAFE_INTEGER, stopped: true, time: Date.now() });
    store.set({ clayControlReceipts: receipts.slice(-100) });
  }
  clearClayControlActivity();
}
export function initClayControlActivity() {
  store.subscribe(function (value, previous) {
    if (!value.connected && previous.connected) store.set({ clayControlOrder: 0, clayControlViewerRef: null });
    if (!value.clayControlActivity) return;
    if (!value.connected || value.myUserId !== previous.myUserId || value.currentSlug !== previous.currentSlug || value.activeSessionId !== previous.activeSessionId) { stopPresentation(); return; }
    if (value.cachedMatesList !== previous.cachedMatesList) {
      var actor = value.clayControlActivity.message.mateId;
      if (actor && !sourceMate(value.clayControlActivity.message)) stopPresentation();
    }
    scheduleLayout();
  });
  ['resize', 'scroll'].forEach(function (name) { window.addEventListener(name, scheduleLayout, true); });
  ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel'].forEach(function (name) { document.addEventListener(name, scheduleLayout, true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopPresentation(); });
  document.addEventListener('click', function (event) {
    if (event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) stopPresentation();
  }, true);
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data || event.data.type !== 'clay-control-presentation') return;
    var host = document.getElementById('contextual-clay'), message = event.data.message;
    if (!validActivity(message)) return;
    var frame = host && Array.from(host.querySelectorAll('iframe[data-canonical="true"]')).find(function (item) { return item.contentWindow === event.source; });
    var bridge = frame && frame.conversation;
    var identity = bridge && bridge.document === frame.contentDocument && bridge.source === frame.contentWindow && bridge.identity();
    if (!identity || message.phase !== 'clear' && (!identity.connected || !identity.available) || identity.ownerId !== store.get('myUserId') || identity.mateId !== message.mateId || identity.sessionId !== message.sourceSessionId || identity.sessionOriginId !== message.sourceSessionOriginId || identity.viewerRef !== message.recipientViewerRef || !sourceMate(message)) return;
    if (new URL(frame.src, location.href).pathname !== '/p/' + encodeURIComponent(message.sourceSlug) + '/') return;
    acceptActivity(message, true);
  });
  document.addEventListener('contextual-ask-stopped', stopPresentation, true);
}

export function withdrawPaneControlActivity() {
  var message = store.get('clayControlForwarded');
  if (message) forward(Object.assign({}, message, { phase: 'clear', sequence: message.sequence + 1 }));
}
