// Project-chat adapter for the existing Clay-owned Mate creation workflow.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { addToMessages, scrollToBottom } from './chat-render-runtime.js';
import { openMateWorkspace } from './project-mate-navigation.js';
import { createHomeDebateQuestionCard, normalizeHomeTranscript, failHomeDebateQuestion } from './home-debate-planning.js';
import { createHomeMateProposalCard, applyHomeMateProposal, resolveHomeMateProposal } from './home-mate-creation.js';

var choiceDialog = null;
var creationRoot = null;
var requestSequence = 0;

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

function nextRequestId() {
  requestSequence++;
  return 'project-mate-creation-' + Date.now() + '-' + requestSequence;
}

function closeChoice(restoreFocus) {
  var opener = choiceDialog ? choiceDialog._opener : null;
  if (choiceDialog) choiceDialog.remove();
  choiceDialog = null;
  document.removeEventListener('keydown', handleChoiceKeydown, true);
  if (restoreFocus && opener && opener.isConnected) opener.focus({ preventScroll: true });
}

function handleChoiceKeydown(event) {
  if (!choiceDialog) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeChoice(true);
    return;
  }
  if (event.key !== 'Tab') return;
  var controls = choiceDialog.querySelectorAll('button:not([disabled])');
  if (!controls.length) return;
  if (event.shiftKey && document.activeElement === controls[0]) {
    event.preventDefault();
    controls[controls.length - 1].focus();
  } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
    event.preventDefault();
    controls[0].focus();
  }
}

function startMateCreation() {
  var clay = clayMate();
  if (!clay) {
    var status = choiceDialog && choiceDialog.querySelector('[role="alert"]');
    if (status) status.textContent = 'Clay is unavailable. Refresh and try again.';
    return;
  }
  closeChoice(false);
  store.set({
    projectMateCreationActive: true,
    projectMateCreationMateId: clay.id,
    projectMateCreationSessionId: null,
    projectMateCreationRequestId: null,
    projectMateCreationPendingStart: true,
    projectMateCreationAwaitingHistory: false,
    projectMateCreationAwaitingMateList: false,
    projectMateCreationHistoryReady: false,
    projectMateCreationLocalId: null,
    projectMateCreationMessages: [],
  });
  openMateWorkspace(clay.id);
  maybeStartPendingCreation();
}

function maybeStartPendingCreation() {
  var state = store.snap();
  if (!state.projectMateCreationPendingStart || !state.connected || state.activeProjectSlug !== 'mate-' + state.projectMateCreationMateId) return;
  var requestId = nextRequestId();
  if (!send({ type: 'home_mate_creation_plan', mateId: state.projectMateCreationMateId, requestId: requestId })) return;
  store.set({ projectMateCreationPendingStart: false, projectMateCreationAwaitingHistory: true, projectMateCreationRequestId: requestId });
}

function choiceButton(icon, title, description) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'project-create-choice-option';
  button.innerHTML = iconHtml(icon);
  var copy = document.createElement('span');
  var heading = document.createElement('strong');
  heading.textContent = title;
  var detail = document.createElement('small');
  detail.textContent = description;
  copy.appendChild(heading);
  copy.appendChild(detail);
  button.appendChild(copy);
  return button;
}

export function openProjectCreateChoice(opener, openProject) {
  closeChoice(false);
  var overlay = document.createElement('div');
  overlay.className = 'project-create-choice-overlay';
  overlay.setAttribute('role', 'presentation');
  var dialog = document.createElement('section');
  dialog.className = 'project-create-choice';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'project-create-choice-title');
  var eyebrow = document.createElement('span');
  eyebrow.className = 'project-create-choice-eyebrow';
  eyebrow.textContent = 'Create new';
  var title = document.createElement('h2');
  title.id = 'project-create-choice-title';
  title.textContent = 'What would you like to add?';
  var mate = choiceButton('users', 'Mate', 'Shape a new collaborator with Clay');
  mate.addEventListener('click', startMateCreation);
  var project = choiceButton('folder-plus', 'Project', 'Add a local workspace');
  project.addEventListener('click', function () {
    closeChoice(false);
    openProject();
  });
  var cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'project-create-choice-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', function () { closeChoice(true); });
  var status = document.createElement('p');
  status.className = 'project-create-choice-error';
  status.setAttribute('role', 'alert');
  dialog.appendChild(eyebrow);
  dialog.appendChild(title);
  dialog.appendChild(mate);
  dialog.appendChild(project);
  dialog.appendChild(status);
  dialog.appendChild(cancel);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', function (event) { if (event.target === overlay) closeChoice(true); });
  overlay._opener = opener || document.activeElement;
  document.body.appendChild(overlay);
  choiceDialog = overlay;
  document.addEventListener('keydown', handleChoiceKeydown, true);
  refreshIcons();
  requestAnimationFrame(function () { mate.focus({ preventScroll: true }); });
}

function context() {
  return {
    mateId: store.get('projectMateCreationMateId'),
    sessionId: store.get('projectMateCreationSessionId'),
    requestId: store.get('projectMateCreationRequestId'),
  };
}

function sameValue(left, right) {
  return left != null && right != null && String(left) === String(right);
}

export function isExactProjectMateCreationMessage(state, msg, allowUnboundSession) {
  if (!state.projectMateCreationActive || !sameValue(msg.mateId, state.projectMateCreationMateId) || !sameValue(msg.requestId, state.projectMateCreationRequestId)) return false;
  if (!state.projectMateCreationSessionId) return allowUnboundSession === true;
  return sameValue(msg.sessionId, state.projectMateCreationSessionId);
}

function creationMessages() {
  return store.get('projectMateCreationMessages') || [];
}

function setCreationMessages(messages) {
  store.set({ projectMateCreationMessages: messages });
}

function respondToQuestion(message, action, opener, answers) {
  if (!message || message.status === 'submitting') return;
  var payload = Object.assign({ type: 'home_mate_creation_question_response', toolId: message.toolId, answers: answers || {} }, context());
  if (!send(payload)) {
    setCreationMessages(creationMessages().map(function (item) { return item === message ? Object.assign({}, item, { error: 'Clay is offline. Reconnect and try again.' }) : item; }));
    renderCreationMessages();
    return;
  }
  setCreationMessages(creationMessages().map(function (item) { return item === message ? Object.assign({}, item, { status: 'submitting' }) : item; }));
  renderCreationMessages();
}

function respondToProposal(message, action) {
  if (!message || message.status === 'submitting') return;
  var payload = Object.assign({ type: 'home_mate_creation_proposal_response', proposalId: message.proposal.proposalId, action: action === 'create' ? 'create' : 'cancel' }, context());
  if (!send(payload)) {
    setCreationMessages(creationMessages().map(function (item) { return item === message ? Object.assign({}, item, { error: 'Clay is offline. Reconnect and try again.' }) : item; }));
    renderCreationMessages();
    return;
  }
  setCreationMessages(creationMessages().map(function (item) { return item === message ? Object.assign({}, item, { status: 'submitting' }) : item; }));
  renderCreationMessages();
}

function ensureCreationRoot() {
  if (creationRoot && creationRoot.isConnected) return creationRoot;
  creationRoot = document.createElement('section');
  creationRoot.className = 'project-mate-creation-transcript home-mate-chat-transcript home-chat-bubble-layout';
  creationRoot.setAttribute('aria-label', 'Mate creation interview');
  addToMessages(creationRoot);
  return creationRoot;
}

function renderCreationMessages() {
  var root = ensureCreationRoot();
  root.innerHTML = '';
  var intro = document.createElement('header');
  intro.className = 'project-mate-creation-intro';
  intro.innerHTML = iconHtml('sparkles');
  var copy = document.createElement('span');
  copy.textContent = 'Create a Mate with Clay';
  intro.appendChild(copy);
  root.appendChild(intro);
  var messages = creationMessages();
  for (var i = 0; i < messages.length; i++) {
    var message = messages[i];
    if (message.role === 'question') root.appendChild(createHomeDebateQuestionCard(message, respondToQuestion));
    if (message.role === 'mate_proposal') root.appendChild(createHomeMateProposalCard(message, respondToProposal, function (created) { openMateWorkspace(created.mateId); }));
  }
  scrollToBottom();
  refreshIcons();
}

function renderCreationError(text) {
  var root = ensureCreationRoot();
  var prior = root.querySelector('.project-mate-creation-error');
  if (prior) prior.remove();
  var error = document.createElement('div');
  error.className = 'project-mate-creation-error';
  error.setAttribute('role', 'alert');
  var copy = document.createElement('span');
  copy.textContent = text || 'The Mate interview could not continue.';
  var retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', function () {
    error.remove();
    send(Object.assign({ type: 'home_mate_creation_plan' }, context()));
  });
  error.appendChild(copy);
  error.appendChild(retry);
  root.appendChild(error);
  retry.focus({ preventScroll: true });
}

function openCreationSession(msg) {
  var state = store.snap();
  if (!isExactProjectMateCreationMessage(state, msg, state.projectMateCreationAwaitingHistory && !state.projectMateCreationSessionId)) return false;
  store.set({
    projectMateCreationSessionId: msg.sessionId,
    projectMateCreationLocalId: typeof msg.localId === 'number' ? msg.localId : state.projectMateCreationLocalId,
    projectMateCreationAwaitingHistory: false,
  });
  if (typeof msg.localId === 'number' && String(store.get('activeSessionId')) !== String(msg.localId)) {
    send({ type: 'switch_session', id: msg.localId });
    return true;
  }
  setCreationMessages(normalizeHomeTranscript(msg.messages || []).filter(function (message) {
    return message.role === 'question' || message.role === 'mate_proposal';
  }));
  renderCreationMessages();
  return true;
}

function navigateCreatedMate(mateId) {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) if (mates[i] && mates[i].id === mateId) {
    openMateWorkspace(mateId);
    return;
  }
  store.set({ projectMateCreationPendingMateId: mateId });
}

function resumeActiveCreation() {
  var state = store.snap();
  if (!state.projectMateCreationActive || !state.projectMateCreationMateId || !state.projectMateCreationSessionId) return;
  var requestId = nextRequestId();
  if (!send({ type: 'home_mate_session_open', mateId: state.projectMateCreationMateId, sessionId: state.projectMateCreationSessionId, requestId: requestId })) return;
  store.set({ projectMateCreationRequestId: requestId, projectMateCreationAwaitingHistory: true });
}

function clearCreationBinding() {
  creationRoot = null;
  store.set({
    projectMateCreationActive: false,
    projectMateCreationMateId: null,
    projectMateCreationSessionId: null,
    projectMateCreationRequestId: null,
    projectMateCreationPendingStart: false,
    projectMateCreationAwaitingHistory: false,
    projectMateCreationAwaitingMateList: false,
    projectMateCreationHistoryReady: false,
    projectMateCreationLocalId: null,
    projectMateCreationMessages: [],
  });
}

function activateRestoredCreation(msg, clay) {
  creationRoot = null;
  store.set({
    projectMateCreationActive: true,
    projectMateCreationMateId: clay.id,
    projectMateCreationSessionId: msg.cliSessionId || 'local:' + msg.id,
    projectMateCreationRequestId: nextRequestId(),
    projectMateCreationAwaitingHistory: false,
    projectMateCreationAwaitingMateList: false,
    projectMateCreationHistoryReady: false,
    projectMateCreationLocalId: msg.id,
    projectMateCreationMessages: [],
  });
}

function restoreAfterMateList() {
  var state = store.snap();
  if (!state.projectMateCreationAwaitingMateList) return;
  var clay = clayMate();
  if (!clay || state.currentSlug !== 'mate-' + clay.id || state.projectMateCreationLocalId == null) return;
  var historyReady = state.projectMateCreationHistoryReady;
  activateRestoredCreation({ id: state.projectMateCreationLocalId, cliSessionId: state.projectMateCreationSessionId && state.projectMateCreationSessionId.indexOf('local:') !== 0 ? state.projectMateCreationSessionId : null }, clay);
  if (historyReady) resumeActiveCreation();
}

export function handleProjectMateCreationMessage(msg) {
  if (msg.type === 'session_switched') {
    var clay = clayMate();
    var state = store.snap();
    var startingHere = msg.mateCreation === true && state.projectMateCreationActive && state.projectMateCreationAwaitingHistory && !state.projectMateCreationSessionId && state.currentSlug === 'mate-' + state.projectMateCreationMateId;
    if (startingHere) {
      creationRoot = null;
      store.set({ projectMateCreationSessionId: msg.cliSessionId || 'local:' + msg.id, projectMateCreationLocalId: msg.id, projectMateCreationMessages: [] });
    } else if (msg.mateCreation === true && clay && state.currentSlug === 'mate-' + clay.id) activateRestoredCreation(msg, clay);
    else if (msg.mateCreation === true && !clay && /^mate-/.test(state.currentSlug || '')) {
      creationRoot = null;
      store.set({ projectMateCreationActive: false, projectMateCreationAwaitingMateList: true, projectMateCreationHistoryReady: false, projectMateCreationLocalId: msg.id, projectMateCreationSessionId: msg.cliSessionId || 'local:' + msg.id, projectMateCreationMessages: [] });
    } else if (!(state.projectMateCreationActive && (state.projectMateCreationPendingStart || state.projectMateCreationAwaitingHistory) && state.currentSlug === 'mate-' + state.projectMateCreationMateId && !state.projectMateCreationSessionId)) clearCreationBinding();
    return false;
  }
  if (msg.type === 'history_done') {
    if (store.get('projectMateCreationAwaitingMateList')) store.set({ projectMateCreationHistoryReady: true });
    else if (!store.get('projectMateCreationAwaitingHistory')) resumeActiveCreation();
    return false;
  }
  var rawCreationEvent = (msg.type === 'tool_executing' && msg.name === 'AskUserQuestion') || msg.type === 'mate_creation_proposal' || msg.type === 'mate_creation_proposal_resolved' || msg.type === 'ask_user_answered' || msg.type === 'delta';
  if (rawCreationEvent && store.get('projectMateCreationAwaitingMateList')) return sameValue(store.get('activeSessionId'), store.get('projectMateCreationLocalId'));
  if (!store.get('projectMateCreationActive')) return false;
  if (msg.type === 'home_mate_history' && msg.mateCreation === true) {
    return openCreationSession(msg);
  }
  if (msg.type === 'home_mate_session_identity') {
    var identityState = store.snap();
    if (!isExactProjectMateCreationMessage(identityState, Object.assign({}, msg, { sessionId: msg.previousSessionId }), false)) return false;
    store.set({ projectMateCreationSessionId: msg.sessionId });
    return true;
  }
  if (rawCreationEvent) return sameValue(store.get('activeSessionId'), store.get('projectMateCreationLocalId'));
  if (!isExactProjectMateCreationMessage(store.snap(), msg, msg.type === 'home_mate_error' && store.get('projectMateCreationAwaitingHistory'))) return false;
  if (msg.type === 'home_mate_creation_question') {
    var questions = creationMessages().slice();
    questions.push({ role: 'question', flow: 'mate_creation', toolId: msg.toolId, questions: msg.questions || [], status: 'pending', error: '' });
    setCreationMessages(questions);
    renderCreationMessages();
    return true;
  }
  if (msg.type === 'home_mate_creation_question_resolved') {
    setCreationMessages(creationMessages().map(function (item) { return item.role === 'question' && item.toolId === msg.toolId ? Object.assign({}, item, { status: msg.status === 'answered' ? 'answered' : 'expired', answers: msg.answers || null, error: msg.error || '' }) : item; }));
    renderCreationMessages();
    return true;
  }
  if (msg.type === 'home_mate_creation_proposal') {
    setCreationMessages(applyHomeMateProposal(creationMessages(), msg));
    renderCreationMessages();
    return true;
  }
  if (msg.type === 'home_mate_creation_proposal_resolved') {
    setCreationMessages(resolveHomeMateProposal(creationMessages(), msg));
    renderCreationMessages();
    if (msg.action === 'create' && msg.createdMateId) navigateCreatedMate(msg.createdMateId);
    return true;
  }
  if (msg.type === 'home_mate_error') {
    if (/^question_/.test(msg.code || '')) {
      setCreationMessages(failHomeDebateQuestion(creationMessages(), msg));
      renderCreationMessages();
    } else renderCreationError(msg.text);
    return true;
  }
  return false;
}

export function initProjectMateCreationWorkspace() {
  store.subscribe(function (state, previous) {
    if (state.projectMateCreationPendingStart !== previous.projectMateCreationPendingStart || state.connected !== previous.connected || state.activeProjectSlug !== previous.activeProjectSlug) maybeStartPendingCreation();
    if (state.cachedMatesList !== previous.cachedMatesList) restoreAfterMateList();
    if (state.projectMateCreationPendingMateId && state.cachedMatesList !== previous.cachedMatesList) {
      var pending = state.projectMateCreationPendingMateId;
      var mates = state.cachedMatesList || [];
      for (var i = 0; i < mates.length; i++) if (mates[i] && mates[i].id === pending) {
        store.set({ projectMateCreationPendingMateId: null });
        openMateWorkspace(pending);
        break;
      }
    }
  });
}
