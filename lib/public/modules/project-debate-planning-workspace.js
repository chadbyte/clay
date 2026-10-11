// Project-chat adapter for Clay's existing server-owned debate setup flow.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { addToMessages, scrollToBottom } from './chat-render-runtime.js';
import { openMateWorkspace } from './project-mate-navigation.js';
import { createHomeDebateQuestionCard, createHomeDebateProposalCard, normalizeHomeTranscript, applyHomeDebateProposal, resolveHomeDebateProposal, failHomeDebateQuestion } from './home-debate-planning.js';
import { refreshIcons, iconHtml } from './icons.js';

var root = null;
var sequence = 0;
var liveReplaySessionId = null;
var suppressLiveSetupReplay = false;

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function clayMate() {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) if (mates[i] && mates[i].builtinKey === 'clay') return mates[i];
  return null;
}

function requestId() { sequence += 1; return 'project-debate-planning-' + Date.now() + '-' + sequence; }
function same(left, right) { return left != null && right != null && String(left) === String(right); }

function context() {
  return { mateId: store.get('projectDebatePlanningMateId'), sessionId: store.get('projectDebatePlanningSessionId'), requestId: store.get('projectDebatePlanningRequestId') };
}

function messages() { return store.get('projectDebatePlanningMessages') || []; }
function setMessages(value) { store.set({ projectDebatePlanningMessages: value }); }

function retryPlanning() {
  var state = store.snap();
  store.set({ projectDebatePlanningError: '', projectDebatePlanningRetryable: false });
  if (!state.projectDebatePlanningSessionId) {
    store.set({ projectDebatePlanningPendingStart: true });
    maybeStart();
    return;
  }
  var id = requestId();
  if (!send({ type: 'home_mate_debate_plan', mateId: state.projectDebatePlanningMateId, sessionId: state.projectDebatePlanningSessionId, topic: state.projectDebatePlanningTopic, requestId: id })) {
    store.set({ projectDebatePlanningError: 'Reconnect to retry debate setup.', projectDebatePlanningRetryable: true });
    render();
    return;
  }
  store.set({ projectDebatePlanningRequestId: id, projectDebatePlanningAwaitingHistory: true });
}

function ensureRoot() {
  if (root && root.isConnected) return root;
  root = document.createElement('section');
  root.className = 'project-debate-planning-transcript home-mate-chat-transcript home-chat-bubble-layout';
  root.setAttribute('aria-label', 'Debate setup');
  addToMessages(root);
  return root;
}

function respondToQuestion(message, action, opener, answers) {
  if (!message || message.status === 'submitting') return;
  if (!send(Object.assign({ type: 'home_debate_question_response', toolId: message.toolId, answers: answers || {} }, context()))) return;
  setMessages(messages().map(function (item) { return item === message ? Object.assign({}, item, { status: 'submitting' }) : item; }));
  render();
}

function respondToProposal(message, action, opener, answers, modelOverrides) {
  if (!message || message.status === 'submitting') return;
  if (!send(Object.assign({ type: 'home_debate_proposal_response', proposalId: message.proposal.proposalId, action: action === 'start' ? 'start' : 'cancel', modelOverrides: modelOverrides || [] }, context()))) return;
  setMessages(messages().map(function (item) { return item === message ? Object.assign({}, item, { status: 'submitting' }) : item; }));
  render();
}

function render() {
  var container = ensureRoot();
  container.innerHTML = '';
  var intro = document.createElement('header');
  intro.className = 'project-mate-creation-intro';
  intro.innerHTML = iconHtml('messages-square') + '<span>Plan a debate with Clay</span>';
  container.appendChild(intro);
  var list = messages();
  for (var i = 0; i < list.length; i++) {
    if (list[i].role === 'question') container.appendChild(createHomeDebateQuestionCard(list[i], respondToQuestion));
    if (list[i].role === 'proposal') container.appendChild(createHomeDebateProposalCard(list[i], respondToProposal));
  }
  var errorText = store.get('projectDebatePlanningError');
  if (errorText) {
    var error = document.createElement('section');
    error.className = 'project-debate-planning-error';
    error.setAttribute('role', 'alert');
    var copy = document.createElement('p');
    copy.textContent = errorText;
    error.appendChild(copy);
    if (store.get('projectDebatePlanningRetryable')) {
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry debate setup';
      retry.addEventListener('click', retryPlanning);
      error.appendChild(retry);
    }
    container.appendChild(error);
  }
  scrollToBottom();
  refreshIcons();
}

function clear() {
  root = null;
  store.set({ projectDebatePlanningActive: false, projectDebatePlanningMateId: null, projectDebatePlanningSessionId: null, projectDebatePlanningLocalId: null, projectDebatePlanningRequestId: null, projectDebatePlanningPendingStart: false, projectDebatePlanningAwaitingHistory: false, projectDebatePlanningAwaitingMateList: false, projectDebatePlanningHistoryReady: false, projectDebatePlanningTopic: '', projectDebatePlanningMessages: [], projectDebatePlanningError: '', projectDebatePlanningRetryable: false });
}

function maybeStart() {
  var state = store.snap();
  if (!state.projectDebatePlanningPendingStart || !state.connected || state.activeProjectSlug !== 'mate-' + state.projectDebatePlanningMateId) return;
  var id = requestId();
  if (!send({ type: 'home_mate_debate_plan', mateId: state.projectDebatePlanningMateId, topic: state.projectDebatePlanningTopic, requestId: id })) return;
  store.set({ projectDebatePlanningPendingStart: false, projectDebatePlanningAwaitingHistory: true, projectDebatePlanningRequestId: id });
}

export function startProjectDebatePlanning(topic) {
  var clay = clayMate();
  if (!clay) {
    store.set({ projectDebatePlanningError: 'Clay is unavailable. Refresh and try again.', projectDebatePlanningRetryable: false });
    return false;
  }
  root = null;
  store.set({ projectDebatePlanningActive: true, projectDebatePlanningMateId: clay.id, projectDebatePlanningSessionId: null, projectDebatePlanningLocalId: null, projectDebatePlanningRequestId: null, projectDebatePlanningPendingStart: true, projectDebatePlanningAwaitingHistory: false, projectDebatePlanningAwaitingMateList: false, projectDebatePlanningHistoryReady: false, projectDebatePlanningTopic: typeof topic === 'string' ? topic.trim().slice(0, 1000) : '', projectDebatePlanningMessages: [], projectDebatePlanningError: '', projectDebatePlanningRetryable: false });
  openMateWorkspace(clay.id);
  maybeStart();
  return true;
}

function exact(msg, allowUnbound) {
  var state = store.snap();
  if (!state.projectDebatePlanningActive || !same(msg.mateId, state.projectDebatePlanningMateId) || !same(msg.requestId, state.projectDebatePlanningRequestId)) return false;
  if (!state.projectDebatePlanningSessionId) return allowUnbound === true;
  return same(msg.sessionId, state.projectDebatePlanningSessionId);
}

function openHistory(msg) {
  if (!exact(msg, store.get('projectDebatePlanningAwaitingHistory') && !store.get('projectDebatePlanningSessionId'))) return false;
  store.set({ projectDebatePlanningSessionId: msg.sessionId, projectDebatePlanningLocalId: typeof msg.localId === 'number' ? msg.localId : store.get('projectDebatePlanningLocalId'), projectDebatePlanningAwaitingHistory: false });
  if (typeof msg.localId === 'number' && String(store.get('activeSessionId')) !== String(msg.localId)) {
    send({ type: 'switch_session', id: msg.localId });
    return true;
  }
  setMessages(normalizeHomeTranscript(msg.messages || []).filter(function (message) { return message.role === 'question' || message.role === 'proposal'; }));
  render();
  return true;
}

function resume() {
  var state = store.snap();
  if (!state.projectDebatePlanningActive || !state.projectDebatePlanningMateId || !state.projectDebatePlanningSessionId) return;
  var id = requestId();
  if (!send({ type: 'home_mate_session_open', mateId: state.projectDebatePlanningMateId, sessionId: state.projectDebatePlanningSessionId, requestId: id })) return;
  store.set({ projectDebatePlanningRequestId: id, projectDebatePlanningAwaitingHistory: true });
}

function activateRestored(msg, clay) {
  root = null;
  store.set({ projectDebatePlanningActive: true, projectDebatePlanningMateId: clay.id, projectDebatePlanningSessionId: msg.cliSessionId || 'local:' + msg.id, projectDebatePlanningLocalId: msg.id, projectDebatePlanningRequestId: requestId(), projectDebatePlanningPendingStart: false, projectDebatePlanningAwaitingHistory: false, projectDebatePlanningAwaitingMateList: false, projectDebatePlanningHistoryReady: false, projectDebatePlanningTopic: '', projectDebatePlanningMessages: [] });
}

function restoreAfterMateList() {
  var state = store.snap();
  if (!state.projectDebatePlanningAwaitingMateList) return;
  var clay = clayMate();
  if (!clay || state.currentSlug !== 'mate-' + clay.id || state.projectDebatePlanningLocalId == null) return;
  var historyReady = state.projectDebatePlanningHistoryReady;
  activateRestored({ id: state.projectDebatePlanningLocalId, cliSessionId: state.projectDebatePlanningSessionId && state.projectDebatePlanningSessionId.indexOf('local:') !== 0 ? state.projectDebatePlanningSessionId : null }, clay);
  if (historyReady) resume();
}

export function handleProjectDebatePlanningMessage(msg) {
  if (msg.type === 'session_switched') {
    if (msg.debatePlanning === true && msg.debatePhase === 'live') {
      clear();
      liveReplaySessionId = msg.id;
      suppressLiveSetupReplay = true;
      return false;
    }
    liveReplaySessionId = null;
    suppressLiveSetupReplay = false;
    var clay = clayMate();
    var state = store.snap();
    var starting = msg.debatePlanning === true && state.projectDebatePlanningActive && state.projectDebatePlanningAwaitingHistory && !state.projectDebatePlanningSessionId && state.currentSlug === 'mate-' + state.projectDebatePlanningMateId;
    if (starting) store.set({ projectDebatePlanningSessionId: msg.cliSessionId || 'local:' + msg.id, projectDebatePlanningLocalId: msg.id, projectDebatePlanningMessages: [] });
    else if (msg.debatePlanning === true && clay && state.currentSlug === 'mate-' + clay.id) activateRestored(msg, clay);
    else if (msg.debatePlanning === true && !clay && /^mate-/.test(state.currentSlug || '')) store.set({ projectDebatePlanningActive: false, projectDebatePlanningAwaitingMateList: true, projectDebatePlanningHistoryReady: false, projectDebatePlanningLocalId: msg.id, projectDebatePlanningSessionId: msg.cliSessionId || 'local:' + msg.id, projectDebatePlanningMessages: [] });
    else if (!(state.projectDebatePlanningActive && (state.projectDebatePlanningPendingStart || state.projectDebatePlanningAwaitingHistory) && state.currentSlug === 'mate-' + state.projectDebatePlanningMateId && !state.projectDebatePlanningSessionId)) clear();
    return false;
  }
  if (msg.type === 'home_mate_session_identity') {
    var identityState = store.snap();
    if (!identityState.projectDebatePlanningActive || !same(msg.mateId, identityState.projectDebatePlanningMateId) || !same(msg.requestId, identityState.projectDebatePlanningRequestId) || !same(msg.previousSessionId, identityState.projectDebatePlanningSessionId) || !msg.sessionId) return false;
    store.set({ projectDebatePlanningSessionId: msg.sessionId });
    return true;
  }
  if (msg.type === 'home_debate_event' && msg.eventType === 'debate_started') {
    suppressLiveSetupReplay = false;
    if (store.get('projectDebatePlanningActive')) clear();
    return false;
  }
  if (msg.type === 'debate_started' && suppressLiveSetupReplay && same(store.get('activeSessionId'), liveReplaySessionId)) {
    suppressLiveSetupReplay = false;
    return false;
  }
  if (suppressLiveSetupReplay && same(store.get('activeSessionId'), liveReplaySessionId)
      && ((msg.type === 'tool_executing' && msg.name === 'AskUserQuestion') || msg.type === 'ask_user_answered'
        || msg.type === 'debate_proposal' || msg.type === 'debate_proposal_resolved' || msg.type === 'delta'
        || msg.type === 'result' || msg.type === 'done' || msg.type === 'error')) return true;
  if (msg.type === 'history_done') {
    if (store.get('projectDebatePlanningAwaitingMateList')) store.set({ projectDebatePlanningHistoryReady: true });
    else if (!store.get('projectDebatePlanningAwaitingHistory')) resume();
    return false;
  }
  var raw = (msg.type === 'tool_executing' && msg.name === 'AskUserQuestion') || msg.type === 'debate_proposal' || msg.type === 'debate_proposal_resolved' || msg.type === 'ask_user_answered' || msg.type === 'delta' || msg.type === 'result' || msg.type === 'done' || msg.type === 'error' || msg.type === 'home_mate_delta' || msg.type === 'home_mate_done';
  if (raw && store.get('projectDebatePlanningAwaitingMateList')) return same(store.get('activeSessionId'), store.get('projectDebatePlanningLocalId'));
  if (!store.get('projectDebatePlanningActive')) return false;
  if (msg.type === 'home_mate_history' && msg.debatePlanning === true) return openHistory(msg);
  if (raw) return same(store.get('activeSessionId'), store.get('projectDebatePlanningLocalId'));
  if (!exact(msg, msg.type === 'home_mate_error' && store.get('projectDebatePlanningAwaitingHistory'))) return false;
  if (msg.type === 'home_debate_question') {
    setMessages(messages().concat([{ role: 'question', flow: 'debate', toolId: msg.toolId, questions: msg.questions || [], status: 'pending', error: '' }])); render(); return true;
  }
  if (msg.type === 'home_debate_question_resolved') {
    setMessages(messages().map(function (item) { return item.role === 'question' && item.toolId === msg.toolId ? Object.assign({}, item, { status: msg.status === 'answered' ? 'answered' : 'expired', answers: msg.answers || null, error: msg.error || '' }) : item; })); render(); return true;
  }
  if (msg.type === 'home_debate_proposal') { setMessages(applyHomeDebateProposal(messages(), msg)); render(); return true; }
  if (msg.type === 'home_debate_proposal_resolved') { setMessages(resolveHomeDebateProposal(messages(), msg)); render(); return true; }
  if (msg.type === 'home_mate_error') {
    if (/^question_/.test(msg.code || '')) setMessages(failHomeDebateQuestion(messages(), msg));
    else store.set({ projectDebatePlanningError: msg.text || 'Debate setup could not continue.', projectDebatePlanningRetryable: true, projectDebatePlanningAwaitingHistory: false });
    render();
    return true;
  }
  return false;
}

export function initProjectDebatePlanningWorkspace() {
  store.subscribe(function (state, previous) {
    if (state.projectDebatePlanningPendingStart !== previous.projectDebatePlanningPendingStart || state.connected !== previous.connected || state.activeProjectSlug !== previous.activeProjectSlug) maybeStart();
    if (state.cachedMatesList !== previous.cachedMatesList) restoreAfterMateList();
  });
}
