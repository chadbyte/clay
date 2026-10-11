// Adapt project events to the shared Home debate presentation.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getMessagesEl } from './dom-refs.js';
import { addToMessages, scrollToBottom } from './chat-render-runtime.js';
import { isMateWorkspace } from './project-mate-navigation.js';
import { applyHomeDebateEvent, createHomeDebateLiveCard } from './home-debate-live.js';
import { createHomeDebateProposalCard, applyHomeDebateProposal, resolveHomeDebateProposal } from './home-debate-planning.js';
import { createDebateControls } from './debate-controls.js';
import { renderAssistantBubbleText, finalizeAssistantBubble, disposeChatBubbleTree } from './chat-bubble-renderer.js';

var transcriptEl = null;
var prependEl = null;
var controls = createDebateControls({
  slotId: 'project-debate-controls',
  composerId: 'input-area',
  send: function (action, data, sessionId) {
    var ws = getWs();
    if (!ws || ws.readyState !== 1 || String(store.get('activeSessionId')) !== sessionId) return false;
    ws.send(JSON.stringify({ type: 'project_debate_control', sessionId: store.get('activeSessionId'), action: action, text: data.text || '', response: data.response || null }));
    return true;
  }
});

function stateKey() {
  return store.get('projectDebatePrepending') ? 'projectDebatePrependMessages' : 'projectDebateMessages';
}

function ensureTranscript() {
  var prepending = store.get('projectDebatePrepending');
  var root = prepending ? prependEl : transcriptEl;
  if (!root || !root.isConnected) {
    root = document.createElement('section');
    root.className = 'project-debate-transcript home-mate-chat-transcript home-chat-bubble-layout';
    root.setAttribute('aria-label', 'Debate transcript');
    addToMessages(root);
    if (prepending) prependEl = root;
    else transcriptEl = root;
  }
  return root;
}

function renderControls() {
  var slot = document.getElementById('project-debate-controls');
  var composer = document.getElementById('input-area');
  if (!slot && composer) {
    slot = document.createElement('div');
    slot.id = 'project-debate-controls';
    slot.className = 'home-debate-controls-slot project-debate-controls';
    slot.hidden = true;
    composer.parentNode.insertBefore(slot, composer);
  }
  controls.render(store.get('projectDebateMessages') || [], String(store.get('activeSessionId') || ''));
}

function respondToProposal(message, action, opener, answers, modelOverrides) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1 || message.status === 'submitting') return;
  ws.send(JSON.stringify({ type: 'debate_proposal_response', proposalId: message.proposal.proposalId, sessionId: store.get('activeSessionId'), action: action, modelOverrides: modelOverrides || [] }));
  var messages = (store.get('projectDebateMessages') || []).map(function (item) {
    return item === message ? Object.assign({}, item, { status: 'submitting' }) : item;
  });
  store.set({ projectDebateMessages: messages });
  renderMessages(messages);
}

function renderMessages(messages) {
  var root = ensureTranscript();
  messages.forEach(function (message, index) {
    var existing = root.children[index];
    if (existing && existing._debateMessage === message) return;
    if (existing && message.role === 'debate_turn' && existing.classList.contains('home-debate-live-turn')) {
      var activity = existing.querySelector('.home-debate-live-activity');
      if (message.status === 'done') {
        if (activity) activity.remove();
        finalizeAssistantBubble(existing, message.text || '', !store.get('replayingHistory'));
      } else {
        if (activity) {
          var label = message.activity || (message.text ? 'Speaking' : 'Preparing');
          activity.firstChild.textContent = label;
          activity.setAttribute('aria-label', (message.mateName || 'Mate') + ' is ' + label.toLowerCase());
        }
        renderAssistantBubbleText(existing, message.text || '', false);
      }
      existing._debateMessage = message;
      return;
    }
    var card = message.role === 'proposal'
      ? createHomeDebateProposalCard(message, respondToProposal)
      : createHomeDebateLiveCard(message, message.status === 'done');
    card._debateMessage = message;
    if (existing) { disposeChatBubbleTree(existing); existing.replaceWith(card); }
    else root.appendChild(card);
  });
}

export function resetProjectDebateWorkspace() {
  store.set({ projectDebateMessages: [], projectDebatePrependMessages: [], projectDebatePrepending: false });
  transcriptEl = null;
  prependEl = null;
  controls.render([], null);
}

export function beginProjectDebatePrepend() {
  prependEl = null;
  store.set({ projectDebatePrepending: true, projectDebatePrependMessages: [] });
}

export function endProjectDebatePrepend() {
  prependEl = null;
  store.set({ projectDebatePrepending: false, projectDebatePrependMessages: [] });
}

export function handleProjectDebateMessage(msg) {
  if (!isMateWorkspace(store.snap())) return false;
  if (msg.type === 'project_debate_control_result') {
    if (String(msg.sessionId) !== String(store.get('activeSessionId'))) return true;
    if (!msg.ok) {
      controls.render([], null);
      renderControls();
      var slot = document.getElementById('project-debate-controls');
      var error = document.createElement('p');
      error.className = 'project-debate-error';
      error.setAttribute('role', 'alert');
      error.textContent = msg.error || 'The debate action could not be completed.';
      if (slot) slot.appendChild(error);
    }
    return true;
  }
  if (msg.type === 'history_done') {
    renderControls();
    var ws = getWs();
    if (ws && ws.readyState === 1 && (store.get('projectDebateMessages') || []).length) {
      ws.send(JSON.stringify({ type: 'project_debate_state', sessionId: store.get('activeSessionId') }));
    }
    return false;
  }
  if (msg.type === 'project_debate_state') {
    if (String(msg.sessionId) !== String(store.get('activeSessionId')) || !msg.header) return true;
    var restored = (store.get('projectDebateMessages') || []).slice();
    var headerIndex = -1;
    restored.forEach(function (item, index) { if (item.role === 'debate_header') headerIndex = index; });
    if (headerIndex === -1) restored.unshift(msg.header);
    else restored[headerIndex] = msg.header;
    if (msg.header.phase !== 'live') restored = restored.map(function (item) {
      return item.role === 'debate_turn' && item.status === 'active' ? Object.assign({}, item, { status: 'done', activity: '' }) : item;
    });
    store.set({ projectDebateMessages: restored });
    renderMessages(restored);
    renderControls();
    return true;
  }
  if (msg.type === 'debate_preparing') {
    var root = ensureTranscript();
    var preparation = document.createElement('p');
    preparation.className = 'debate-preparing-indicator home-debate-live-status';
    preparation.setAttribute('role', 'status');
    preparation.textContent = (msg.moderatorName || 'The moderator') + ' is preparing the debate…';
    root.appendChild(preparation);
    return true;
  }
  if (msg.type === 'tool_executing' && msg.name && msg.name.indexOf('propose_debate') !== -1) return true;
  var types = ['debate_started', 'debate_turn', 'debate_activity', 'debate_stream', 'debate_turn_done', 'debate_tool_decision', 'debate_stop_requested', 'debate_stop_cancelled', 'debate_hand_raised', 'debate_conclude_confirm', 'debate_user_floor', 'debate_user_floor_done', 'debate_comment_injected', 'debate_user_resume', 'debate_resumed', 'debate_ended', 'debate_proposal', 'debate_proposal_resolved'];
  if (types.indexOf(msg.type) === -1) return false;
  var key = stateKey();
  var messages = store.get(key) || [];
  if (msg.type === 'debate_tool_decision') messages = messages.map(function (item) {
    return item.role === 'debate_tool_decision' ? Object.assign({}, item, { entries: (item.entries || []).slice() }) : item;
  });
  if (msg.type === 'debate_proposal') messages = applyHomeDebateProposal(messages, msg);
  else if (msg.type === 'debate_proposal_resolved') messages = resolveHomeDebateProposal(messages, msg);
  else messages = applyHomeDebateEvent(messages, Object.assign({}, msg, { eventType: msg.type, speakerMateId: msg.mateId }));
  if (msg.type === 'debate_ended') messages = messages.map(function (item) {
    return item.role === 'debate_turn' && item.status === 'active' ? Object.assign({}, item, { status: 'done', activity: '' }) : item;
  });
  var patch = {};
  patch[key] = messages;
  store.set(patch);
  var preparation = getMessagesEl().querySelector('.debate-preparing-indicator');
  if (preparation) preparation.remove();
  renderMessages(messages);
  if (!store.get('projectDebatePrepending') && !store.get('replayingHistory')) renderControls();
  scrollToBottom();
  return true;
}
