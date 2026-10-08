// A small acknowledgement-only title shimmer for locally created sidebar
// folders and sessions. The queue lives in the store so list rendering and the
// acknowledgement may arrive in either order without replaying the effect.

import { store } from './store.js';

var MAX_EFFECTS = 4;
var MAX_ACTIVE_SHIMMERS = 4;
var MAX_ATTEMPTS = 40;
var RETRY_MS = 50;
var SHIMMER_MS = 5700;

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function effectKey(effect) {
  return effect.kind + ':' + effect.requestId;
}

function visibleElement(nodes) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].getClientRects().length > 0) return nodes[i];
  }
  return null;
}

function folderTarget(effect) {
  var sections = document.querySelectorAll('.session-folder[data-folder-id]');
  var matches = [];
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].dataset.folderId === String(effect.targetId) && !sections[i].classList.contains('session-folder-favorites')) matches.push(sections[i]);
  }
  var section = visibleElement(matches);
  return section ? section.querySelector('.session-folder-label') : null;
}

function sessionTarget(effect) {
  var sections = document.querySelectorAll('.session-folder[data-folder-id]');
  var matches = [];
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].dataset.folderId !== String(effect.folderId) || sections[i].classList.contains('session-folder-favorites')) continue;
    var units = sections[i].querySelectorAll('.session-folder-unit[data-unit-key]');
    for (var j = 0; j < units.length; j++) {
      if (units[j].dataset.unitKey !== String(effect.targetId)) continue;
      var title = units[j].querySelector('.session-item-title, .mobile-session-title');
      if (title) matches.push(title);
    }
  }
  return visibleElement(matches);
}

function findTarget(effect) {
  return effect.kind === 'folder' ? folderTarget(effect) : sessionTarget(effect);
}

function removeEffectDom() {
  var targets = document.querySelectorAll('.sidebar-creation-shimmer');
  for (var i = 0; i < targets.length; i++) {
    targets[i].classList.remove('sidebar-creation-shimmer');
    delete targets[i].dataset.creationEffect;
  }
}

function playEffect(effect, target) {
  if (!target.isConnected || prefersReducedMotion()) return;
  var active = document.querySelectorAll('.sidebar-creation-shimmer');
  for (var i = 0; i <= active.length - MAX_ACTIVE_SHIMMERS; i++) {
    active[i].classList.remove('sidebar-creation-shimmer');
    delete active[i].dataset.creationEffect;
  }
  target.classList.remove('sidebar-creation-shimmer');
  void target.offsetWidth;
  target.dataset.creationEffect = effectKey(effect);
  target.classList.add('sidebar-creation-shimmer');
  setTimeout(function () {
    if (target.dataset.creationEffect !== effectKey(effect)) return;
    target.classList.remove('sidebar-creation-shimmer');
    delete target.dataset.creationEffect;
  }, SHIMMER_MS);
}

export function clearSidebarCreationEffects() {
  if ((store.get('sidebarCreationEffects') || []).length) store.set({ sidebarCreationEffects: [] });
  removeEffectDom();
}

export function flushSidebarCreationEffects() {
  var queue = store.get('sidebarCreationEffects') || [];
  if (!queue.length) return;
  if (prefersReducedMotion()) {
    clearSidebarCreationEffects();
    return;
  }
  var slug = store.get('currentSlug');
  var pending = [];
  var ready = [];
  for (var i = 0; i < queue.length; i++) {
    var effect = queue[i];
    if (effect.slug !== slug) continue;
    var target = findTarget(effect);
    if (target) {
      ready.push({ effect: effect, target: target });
    } else if (effect.attempts < MAX_ATTEMPTS) {
      pending.push(Object.assign({}, effect, { attempts: effect.attempts + 1 }));
    }
  }
  // Consume before touching the DOM. A render or duplicate acknowledgement can
  // therefore never play an already resolved effect a second time.
  store.set({ sidebarCreationEffects: pending });
  for (var j = 0; j < ready.length; j++) playEffect(ready[j].effect, ready[j].target);
  if (pending.length) setTimeout(flushSidebarCreationEffects, RETRY_MS);
}

export function queueSidebarCreationEffect(kind, requestId, targetId, folderId) {
  if (!requestId || targetId === undefined || targetId === null || prefersReducedMotion()) return false;
  var queue = (store.get('sidebarCreationEffects') || []).slice();
  var next = { kind: kind, requestId: requestId, targetId: targetId, folderId: folderId || null, slug: store.get('currentSlug'), attempts: 0 };
  var key = effectKey(next);
  for (var i = 0; i < queue.length; i++) if (effectKey(queue[i]) === key) return false;
  queue.push(next);
  if (queue.length > MAX_EFFECTS) queue = queue.slice(queue.length - MAX_EFFECTS);
  store.set({ sidebarCreationEffects: queue });
  setTimeout(flushSidebarCreationEffects, 0);
  return true;
}

store.subscribe(function (state, previous) {
  if (state.currentSlug !== previous.currentSlug || state.dmMode !== previous.dmMode || (previous.connected && !state.connected)) clearSidebarCreationEffects();
});
