import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { composerDepartureReason } from './input.js';
import { processMessage } from './app-message-router.js';

function notice(show, message) {
  var element = document.getElementById('session-switch-wait');
  if (!show) { if (element) element.remove(); return; }
  if (element) { if (message) element.textContent = message; return; }
  var area = document.getElementById('input-area');
  if (!area) return;
  element = document.createElement('div'); element.id = 'session-switch-wait';
  element.className = 'session-switch-wait'; element.setAttribute('role', 'status');
  element.textContent = 'Session change waiting. Finish or discard voice input, or wait for attachments. Your draft stays with this conversation.';
  area.prepend(element);
}

// Keep the source composer and its async completions together. The destination
// replay waits in order; it cannot change identity midway through an upload.
export function deferSessionSwitch(message) {
  var pending = store.get('deferredSessionSwitch');
  if (pending && pending.draining) return false;
  if (['account_auth_required', 'project_removed', 'project_access_revoked'].indexOf(message.type) >= 0) {
    store.set({ deferredSessionSwitch: null }); notice(false); return false;
  }
  if (!pending && message.type === 'session_switched' && composerDepartureReason()) {
    pending = { socket: getWs(), projectSlug: store.get('currentSlug'), ownerId: store.get('myUserId'),
      sessionId: store.get('activeSessionId'), origin: store.get('sessionOriginId'), processing: store.get('processing'), messages: [] };
    var speech = store.get('speechActive');
    if (speech) speech.autoSend = false;
    store.set({ deferredSessionSwitch: pending }); notice(true);
  }
  if (!pending) return false;
  if (pending.projectSlug === store.get('currentSlug') && pending.ownerId === store.get('myUserId')) pending.socket = getWs();
  if (store.get('connected') && pending.processing && !store.get('processing')) store.set({ processing: true });
  pending.messages.push(message);
  if (message.type === 'session_list' || message.type === 'session_switched') queueMicrotask(drain);
  return true;
}

function drain() {
  var pending = store.get('deferredSessionSwitch');
  if (!pending || pending.draining || composerDepartureReason() || !store.get('connected')) return;
  if (pending.socket !== getWs() || pending.projectSlug !== store.get('currentSlug') || pending.ownerId !== store.get('myUserId')) return;
  var latestSwitch, latestList;
  pending.messages.forEach(function (message) {
    if (message.type === 'session_switched') latestSwitch = message;
    if (message.type === 'session_list') latestList = message;
  });
  if (!latestSwitch || !latestList) return;
  var target = (latestList.sessions || []).find(function (session) { return session.id === latestSwitch.id; });
  if (!target || target.sessionOriginId !== latestSwitch.sessionOriginId) {
    notice(true, 'The conversation changed while your draft was waiting. Your draft is preserved. Choose a conversation to continue.');
    return;
  }
  // Restoring superseded snapshots must not trigger outbound session effects
  // before the final authoritative target is installed.
  pending.draining = true;
  pending.finalSwitch = latestSwitch;
  pending.messages.forEach(processMessage);
  store.set({ deferredSessionSwitch: null }); notice(false);
}

store.subscribe(function (state, previous) {
  if (state.deferredSessionSwitch && (state.composerUploadingCount !== previous.composerUploadingCount ||
      state.speechActive !== previous.speechActive || state.speechRetry !== previous.speechRetry || state.connected !== previous.connected)) queueMicrotask(drain);
});
