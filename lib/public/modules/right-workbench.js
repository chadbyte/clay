// Single arbitration point for the mutually exclusive right-side workbench.

import { store } from './store.js';

var closers = {};

export function registerRightWorkbench(name, close) {
  if (!name || typeof close !== "function") return;
  closers[name] = close;
}

export function claimRightWorkbench(name) {
  var previousRevision = store.get("rightWorkbenchRevision") || 0;
  var nextRevision = previousRevision + 1;
  storeSet(name, nextRevision);
  var keys = Object.keys(closers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === name) continue;
    try { closers[keys[i]](); } catch (error) { /* one panel must not block another */ }
  }
  return nextRevision;
}

function storeSet(name, value) {
  store.set({ rightWorkbenchOwner: name, rightWorkbenchRevision: value });
}

export function releaseRightWorkbench(name) {
  if (store.get("rightWorkbenchOwner") !== name) return;
  storeSet(null, (store.get("rightWorkbenchRevision") || 0) + 1);
}

export function isRightWorkbenchCurrent(name, expectedRevision) {
  return store.get("rightWorkbenchOwner") === name && store.get("rightWorkbenchRevision") === expectedRevision;
}

export function resetRightWorkbench() {
  storeSet(null, (store.get("rightWorkbenchRevision") || 0) + 1);
}

store.subscribe(function (state, previous) {
  if (state.currentSlug === previous.currentSlug && state.myUserId === previous.myUserId) return;
  resetRightWorkbench();
});
