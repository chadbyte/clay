// Palette selection resolves one existing private conversation before presentation.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { contextualMate, contextualMateStamp, contextualFrame, contextualTrigger } from './contextual-mate-identity.js';
import { selectContextualConversation, enterComposer } from './contextual-clay.js';
import { pauseContextualSearchForSelection } from './contextual-search.js';
import { closeCommandPalette } from './command-palette.js';
import { showToast } from './utils.js';

var socket = null, timer = null, surface = null;
function current() { return store.get('paletteClayConversation'); }
function parentView() { return JSON.stringify([store.get('currentSlug'), store.get('activeSessionId'), store.get('projectSplitViewActiveId')]); }
function selection() { return JSON.stringify(store.get('contextualClay') || null); }
function warn(message) { showToast(message || 'This conversation is unavailable. Refresh search and try again.', 'warn'); }
function clear() {
  clearTimeout(timer); timer = null; socket = null;
  if (surface) { surface.removeEventListener('contextual-clay-ready', ready); surface.removeEventListener('contextual-ask-stopped', stopped); }
  surface = null; store.set({ paletteClayConversation: null });
}
function stopped() { if (current()) { clear(); warn('Opening was stopped. Select the conversation again to resume.'); } }
function live(request) {
  var mate = contextualMate(request.mateId);
  return store.get('connected') && socket === getWs() && socket && socket.readyState === 1 && request.ownerId === store.get('myUserId') && mate && !mate.lifecycleDeletion && mate.builtinKey === 'clay' && mate.createdBy === request.ownerId && contextualMateStamp(mate) === request.stamp && parentView() === request.view;
}
function guard() {
  var action = store.get('contextualConversationRequest'), popup = store.get('contextualClay') || {};
  if (action && action.status === 'loading' || popup.startingAsk || popup.mode === 'opening') { warn('Wait for the current conversation request to finish.'); return false; }
  try { var frame = contextualFrame(); if (frame && frame.conversation) frame.conversation.checkDraft(); return true; }
  catch (error) { warn(error.message); return false; }
}
export function openPaletteClayConversation(item, query, entryIndex) {
  var mateId = item.mateId || String(item.projectSlug || '').slice(5);
  var mate = contextualMate(mateId), owner = store.get('myUserId');
  if (!mate || mate.lifecycleDeletion || item.projectSlug !== 'mate-' + mateId) { warn(); return true; }
  if (mate.builtinKey !== 'clay') return false;
  if (!owner || mate.createdBy !== owner || !Number.isSafeInteger(item.sessionId) || item.sessionId <= 0 || typeof item.sessionOriginId !== 'string' || !item.sessionOriginId) { warn(); return true; }
  if (current()) { warn('Wait for the current conversation request to finish.'); return true; }
  if (!guard()) return true;
  socket = getWs();
  if (!store.get('connected') || !socket || socket.readyState !== 1) { socket = null; warn('Reconnect before opening this conversation.'); return true; }
  var request = { requestId: 'mate-conversations-' + crypto.randomUUID(), phase: 'resolving', mateId: mate.id, stamp: contextualMateStamp(mate), ownerId: owner,
    sessionId: item.sessionId, sessionOriginId: item.sessionOriginId, view: parentView(), selection: selection(), query: query || null,
    entryIndex: entryIndex != null && Number.isSafeInteger(Number(entryIndex)) && Number(entryIndex) >= 0 ? Number(entryIndex) : null };
  store.set({ paletteClayConversation: request });
  surface = document.getElementById('contextual-clay');
  if (surface) surface.addEventListener('contextual-ask-stopped', stopped);
  timer = setTimeout(function () { if (current() && current().requestId === request.requestId) { clear(); warn('The conversation did not become ready. Select it again to retry.'); } }, 15000);
  try { socket.send(JSON.stringify({ type: 'home_mate_session_open', presentation: 'contextual', requestId: request.requestId, mateId: request.mateId, mateStamp: request.stamp, sessionId: 'local:' + request.sessionId, sessionOriginId: request.sessionOriginId })); }
  catch (error) { clear(); warn('The connection changed. Select the conversation again after reconnecting.'); }
  return true;
}
export function handlePaletteClayConversation(msg) {
  var request = current();
  if (msg.type !== 'contextual_mate_sessions_result' || !request || msg.requestId !== request.requestId) return false;
  if (request.phase !== 'resolving') return true;
  if (!live(request) || request.selection !== selection() || msg.mateId !== request.mateId || msg.mateStamp !== request.stamp || !msg.ok || msg.sessionId !== request.sessionId || msg.sessionOriginId !== request.sessionOriginId) { clear(); warn(); return true; }
  if (!guard()) { clear(); return true; }
  pauseContextualSearchForSelection();
  store.set({ paletteClayConversation: Object.assign({}, request, { phase: 'selecting' }) });
  var selected = false;
  try { selected = selectContextualConversation(contextualMate(request.mateId), request.sessionId, request.sessionOriginId); } catch (error) { /* An unavailable child must not fall back to native navigation. */ }
  if (!selected || !current() || !live(request)) { clear(); warn('This conversation could not be opened. Your draft is retained.'); return true; }
  store.set({ paletteClayConversation: Object.assign({}, request, { phase: 'opening', selection: selection() }) });
  closeCommandPalette();
  if (surface) surface.removeEventListener('contextual-ask-stopped', stopped);
  surface = document.getElementById('contextual-clay');
  if (surface) { var trigger = contextualTrigger(request.mateId); if (trigger) { surface.dataset.focusEntry = 'true'; trigger.focus({ preventScroll: true }); enterComposer(); } surface.addEventListener('contextual-clay-ready', ready); surface.addEventListener('contextual-ask-stopped', stopped); }
  ready();
  return true;
}
function ready() {
  var request = current();
  if (!request || request.phase !== 'opening') return;
  if (!live(request) || request.selection !== selection()) { clear(); warn('Your view changed. Select the conversation again.'); return; }
  var frame = contextualFrame(request.mateId, request.sessionId), controller = frame && frame.conversation;
  if (!controller || controller.source !== frame.contentWindow || frame.hidden || frame.inert) return;
  var identity = controller.identity();
  if (!identity.ready) return;
  if (identity.ownerId !== request.ownerId || identity.mateId !== request.mateId || identity.sessionId !== request.sessionId || identity.sessionOriginId !== request.sessionOriginId || !identity.connected || identity.available === false) { clear(); warn(); return; }
  if ((request.query || request.entryIndex !== null) && (!controller.navigateEntry || !controller.navigateEntry(request))) { clear(); warn('The conversation opened, but the requested passage could not be located.'); return; }
  clear();
}
store.subscribe(function () {
  var request = current();
  if (!request && socket) { clear(); return; }
  if (request && (!live(request) || request.phase !== 'selecting' && request.selection !== selection())) { clear(); warn('Your view or connection changed. Select the conversation again.'); }
});
