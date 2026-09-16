import { store } from './store.js';

function scopeKey() {
  var sessionId = store.get('paneSessionId') || store.get('activeSessionId') || "unknown";
  var project = store.get('currentSlug') || "unknown-project";
  var pane = store.get('paneMode') ? "pane" : "main";
  return project + "\u0000" + pane + "\u0000" + String(sessionId);
}

function requestKey(toolId) {
  return scopeKey() + "\u0000" + String(toolId);
}

function requests() {
  return store.get('askUserRequests') || {};
}

export function getAskUserRequestKey(toolId) {
  return requestKey(toolId);
}

export function rememberAskUserRequest(toolId) {
  var key = requestKey(toolId);
  var current = requests();
  if (!current[key]) {
    var next = Object.assign({}, current);
    next[key] = { toolId: String(toolId), scope: scopeKey(), answered: false };
    store.set({ askUserRequests: next });
  }
  return key;
}

export function hasAskUserRequest(toolId) {
  return !!requests()[requestKey(toolId)];
}

export function markAskUserRequestAnswered(toolId) {
  var key = requestKey(toolId);
  var current = requests();
  if (!current[key]) return;
  var next = Object.assign({}, current);
  next[key] = Object.assign({}, next[key], { answered: true });
  store.set({ askUserRequests: next });
}

export function findAskUserCard(root, toolId) {
  if (!root || !root.querySelectorAll) return null;
  var key = requestKey(toolId);
  var cards = root.querySelectorAll(".ask-user-container");
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset && cards[i].dataset.askUserRequestKey === key) return cards[i];
  }
  return null;
}

export function saveAskUserState() {
  return Object.assign({}, requests());
}

export function restoreAskUserState(saved) {
  store.set({ askUserRequests: Object.assign({}, saved || {}) });
}

export function resetAskUserState() {
  store.set({ askUserRequests: {} });
}
