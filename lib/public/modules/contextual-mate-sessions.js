// Saved conversations are independent of which compact renderers are mounted.
import { handlePaletteClayConversation } from './palette-clay-conversation.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { contextualMate, contextualMateStamp, contextualFrame } from './contextual-mate-identity.js';
import { selectContextualConversation } from './contextual-clay.js';
import { pauseContextualSearchForSelection } from './contextual-search.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showToast } from './utils.js';

function selection() { var value = store.get('contextualClay') || {}; return JSON.stringify([value.mateId, value.sessionId, value.startingAsk]); }
function host() { return document.getElementById('contextual-clay'); }
function requestState(kind) { return store.get(kind === 'list' ? 'contextualConversationHistory' : 'contextualConversationRequest'); }
function save(kind, value) { var update = {}; update[kind === 'list' ? 'contextualConversationHistory' : 'contextualConversationRequest'] = value; store.set(update); }
function valid(request) { var mate = request && contextualMate(request.mateId); return request && request.ownerId === store.get('myUserId') && mate && contextualMateStamp(mate) === request.stamp; }
function guardDraft() {
  var frame = contextualFrame();
  try {
    if (frame && frame.conversation) frame.conversation.checkDraft();
    return true;
  } catch (error) { showToast(error.message, 'warn'); return false; }
}
function send(kind, item, lookup) {
  var mate = contextualMate((store.get('contextualClay') || {}).mateId), socket = getWs();
  if (!mate) return;
  var old = requestState(kind);
  if (kind !== 'list' && old && old.status === 'loading') { showToast('Wait for the current conversation request to finish.', 'warn'); return; }
  if (kind !== 'list' && !guardDraft()) return;
  var request = lookup ? Object.assign({}, old) : { requestId: 'mate-conversations-' + crypto.randomUUID(), mateId: mate.id, stamp: contextualMateStamp(mate), ownerId: store.get('myUserId'), selection: selection(), kind: kind, item: item };
  if (!valid(request)) return;
  request.status = 'loading'; request.error = null; request.socket = socket;
  save(kind, request);
  if (!store.get('connected') || !socket || socket.readyState !== 1) { save(kind, Object.assign({}, request, { status: 'error', error: 'Reconnect to load or start a conversation.' })); return; }
  var payload = { type: kind === 'list' ? 'home_mate_sessions_list' : kind === 'new' ? 'home_mate_new_session' : 'home_mate_session_open', presentation: 'contextual', mateId: request.mateId, mateStamp: request.stamp, requestId: request.requestId };
  if (item) { payload.sessionId = item.id; payload.sessionOriginId = item.sessionOriginId; }
  if (lookup && kind === 'new') payload.lookupOnly = true;
  try { socket.send(JSON.stringify(payload)); }
  catch (error) { save(kind, Object.assign({}, request, { status: 'error', error: 'The request is unconfirmed. Check again after reconnecting.' })); }
  setTimeout(function () {
    var current = requestState(kind);
    if (current && current.requestId === request.requestId && current.status === 'loading') save(kind, Object.assign({}, current, { status: 'error', error: kind === 'new' ? 'Creation is unconfirmed. Check the same request or browse history.' : 'Conversation history did not respond. Try again.' }));
  }, 15000);
}
function age(timestamp) {
  if (!timestamp) return '';
  var date = new Date(timestamp), today = new Date();
  return date.toDateString() === today.toDateString() ? 'Today' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function render() {
  var surface = host(); if (!surface) return;
  var mateId = (store.get('contextualClay') || {}).mateId;
  var request = requestState('action'), history = requestState('list');
  var busy = request && request.mateId === mateId && request.status === 'loading';
  surface.querySelector('[data-mate-new]').disabled = !!busy;
  surface.querySelector('[data-mate-new]').setAttribute('aria-busy', String(!!busy));
  var notice = surface.querySelector('[data-conversation-notice]');
  notice.hidden = !request || request.mateId !== mateId || request.status === 'done';
  if (!notice.hidden) {
    notice.querySelector('span').textContent = request.error || (request.kind === 'new' ? 'Starting a new chat…' : 'Opening conversation…');
    notice.querySelector('button').hidden = request.status !== 'error';
    notice.querySelector('button').textContent = request.kind === 'new' ? 'Check request' : 'Try again';
  }
  var list = surface.querySelector('[data-mate-session-list]');
  if (!surface.querySelector('[data-mate-history]').open) return;
  var key = JSON.stringify([history && history.requestId, history && history.status, history && history.error, mateId, (store.get('contextualClay') || {}).sessionId, !!busy]);
  if (list.dataset.renderKey === key) return;
  list.dataset.renderKey = key;
  list.replaceChildren();
  if (!history || history.mateId !== mateId || history.status !== 'done') {
    var status = document.createElement('p'); status.setAttribute('role', 'status');
    status.textContent = history && history.mateId === mateId && history.error || 'Loading conversations…'; list.appendChild(status);
    if (history && history.status === 'error') { var retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again'; retry.onclick = function () { send('list'); }; list.appendChild(retry); }
    return;
  }
  if (!history.sessions.length) { var empty = document.createElement('p'); empty.textContent = 'No saved conversations yet.'; list.appendChild(empty); }
  history.sessions.forEach(function (item) {
    var button = document.createElement('button'); button.type = 'button'; button.dataset.sessionId = String(item.localId);
    button.setAttribute('aria-current', String(String((store.get('contextualClay') || {}).sessionId) === String(item.localId)));
    var title = document.createElement('span'); title.textContent = item.title || 'New conversation';
    var detail = document.createElement('small'); detail.textContent = item.isProcessing ? 'Working' : age(item.lastActivity || item.createdAt);
    button.append(title, detail); button.title = title.textContent; button.disabled = !!busy;
    button.onclick = function () { send('open', item); };
    list.appendChild(button);
  });
  if (history.truncated) { var limit = document.createElement('p'); limit.textContent = 'Showing the 500 most recent conversations.'; list.appendChild(limit); }
}
export function attachContextualConversations(surface) {
  var actions = surface.querySelector('.contextual-clay-actions');
  var tools = document.createElement('div'); tools.className = 'contextual-conversation-tools';
  tools.innerHTML = '<button type="button" data-mate-new aria-label="New chat" title="New chat">' + iconHtml('square-pen') + '<span>New chat</span></button><details data-mate-history><summary role="button" aria-label="Conversation history" aria-haspopup="dialog" aria-expanded="false" aria-controls="contextual-conversation-history" title="Conversation history">' + iconHtml('history') + '</summary><div id="contextual-conversation-history" role="dialog" aria-label="Conversation history"><span class="contextual-history-label">Conversations</span><div data-mate-session-list></div></div></details>';
  actions.prepend(tools);
  var notice = document.createElement('div'); notice.dataset.conversationNotice = ''; notice.hidden = true;
  notice.innerHTML = '<span role="status"></span><button type="button">Check request</button>';
  surface.insertBefore(notice, surface.querySelector('.contextual-clay-body'));
  tools.querySelector('[data-mate-new]').onclick = function () { send('new'); };
  tools.querySelector('details').addEventListener('toggle', function () { this.querySelector('summary').setAttribute('aria-expanded', String(this.open)); if (this.open) send('list'); });
  surface.addEventListener('pointerdown', function (event) { var menu = tools.querySelector('details'); if (menu.open && !menu.contains(event.target)) menu.open = false; });

  notice.querySelector('button').onclick = function () { var value = requestState('action'); if (value) send(value.kind, value.item, true); };
  tools.addEventListener('keydown', function (event) {
    if (event.key === 'Tab') {
      var menu = tools.querySelector('details'), items = Array.from(tools.querySelectorAll('[data-mate-session-list] button:not(:disabled)'));
      if (menu.open && (event.shiftKey && event.target === menu.querySelector('summary') || !event.shiftKey && event.target === items[items.length - 1])) queueMicrotask(function () { menu.open = false; });
      return;
    }
    if (!/^Arrow(Down|Up)$/.test(event.key)) return;
    var buttons = Array.from(tools.querySelectorAll('[data-mate-session-list] button:not(:disabled)'));
    if (!buttons.length) return;
    var index = buttons.indexOf(document.activeElement);
    buttons[index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus(); event.preventDefault();
  });
  refreshIcons(); render();
}
export function handleContextualConversations(msg) {
  if (handlePaletteClayConversation(msg)) return true;
  if (msg.type !== 'contextual_mate_sessions_result') return false;
  var kind = requestState('list') && requestState('list').requestId === msg.requestId ? 'list' : 'action';
  var request = requestState(kind);
  if (!request || request.status !== 'loading' || request.requestId !== msg.requestId || request.socket !== getWs() || !valid(request) || msg.mateId !== request.mateId || msg.mateStamp !== request.stamp) return true;
  if (!msg.ok) { save(kind, Object.assign({}, request, { status: 'error', error: msg.error || 'Conversation unavailable.' })); return true; }
  if (kind === 'list') { save(kind, Object.assign({}, request, { status: 'done', sessions: msg.sessions || [], truncated: msg.truncated })); return true; }
  if (!Number.isSafeInteger(msg.sessionId) || msg.sessionId <= 0 || typeof msg.sessionOriginId !== 'string') return true;
  if (request.selection !== selection() || (store.get('contextualClay') || {}).mode !== 'popover') { save(kind, Object.assign({}, request, { status: 'error', error: 'Your selection changed. The conversation remains in history.' })); return true; }
  if (!guardDraft()) { save(kind, Object.assign({}, request, { status: 'error', error: 'Finish uploading or recording, then check this conversation again.' })); return true; }
  pauseContextualSearchForSelection();
  if (!selectContextualConversation(contextualMate(request.mateId), msg.sessionId, msg.sessionOriginId)) { save(kind, Object.assign({}, request, { status: 'error', error: 'This conversation could not be opened. Your draft is retained.' })); return true; }
  surfaceClose(true); save(kind, Object.assign({}, request, { status: 'done' })); return true;
}
function surfaceClose(restoreFocus) { var surface = host(); if (surface) { var menu = surface.querySelector('[data-mate-history]'); var focused = menu.contains(document.activeElement); menu.open = false; if (focused || restoreFocus) menu.querySelector('summary').focus({ preventScroll: true }); } }
store.subscribe(function (value, previous) {
  if (value.paneMode) return;
  if (value.myUserId !== previous.myUserId) { store.set({ contextualConversationHistory: null, contextualConversationRequest: null }); return; }
  if ((value.contextualClay || {}).mateId !== (previous.contextualClay || {}).mateId) surfaceClose();
  if (previous.connected && !value.connected) ['list', 'action'].forEach(function (kind) { var request = requestState(kind); if (request && request.status === 'loading') save(kind, Object.assign({}, request, { status: 'error', error: 'Disconnected. Check again when connected; your conversation is retained.' })); });
  render();
});
