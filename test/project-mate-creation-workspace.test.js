var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var buildRestoredSessionMessage = require('../lib/project-connection').buildRestoredSessionMessage;

var root = path.join(__dirname, '..');

function harness(initial) {
  var source = fs.readFileSync(path.join(root, 'lib/public/modules/project-mate-creation-workspace.js'), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/export function /g, 'function ');
  var state = Object.assign({
    cachedMatesList: [{ id: 'clay-id', builtinKey: 'clay' }], currentSlug: 'sample', activeProjectSlug: 'sample', connected: true,
    activeSessionId: 1, projectMateCreationActive: false, projectMateCreationMateId: null,
    projectMateCreationSessionId: null, projectMateCreationRequestId: null, projectMateCreationPendingStart: false,
    projectMateCreationAwaitingHistory: false, projectMateCreationAwaitingMateList: false,
    projectMateCreationLocalId: null, projectMateCreationMessages: [], projectMateCreationPendingMateId: null,
  }, initial || {});
  var listeners = [];
  var sent = [];
  var opened = [];
  var context = {
    console: console,
    Date: Date,
    JSON: JSON,
    Object: Object,
    Array: Array,
    String: String,
    document: { removeEventListener: function () {}, addEventListener: function () {}, querySelector: function () { return null; } },
    requestAnimationFrame: function (fn) { fn(); },
    store: {
      get: function (key) { return state[key]; },
      snap: function () { return state; },
      set: function (patch) { var previous = state; state = Object.assign({}, state, patch); for (var i = 0; i < listeners.length; i++) listeners[i](state, previous); },
      subscribe: function (listener) { listeners.push(listener); },
    },
    getWs: function () { return { readyState: 1, send: function (text) { sent.push(JSON.parse(text)); } }; },
    openMateWorkspace: function (id) { opened.push(id); },
    normalizeHomeTranscript: function (messages) { return messages.slice(); },
    applyHomeMateProposal: function (messages, msg) { return messages.concat([{ role: 'mate_proposal', proposal: msg.proposal, status: 'pending' }]); },
    resolveHomeMateProposal: function (messages, msg) { return messages.map(function (item) { return item.role === 'mate_proposal' && item.proposal.proposalId === msg.proposalId ? Object.assign({}, item, { status: msg.action === 'create' ? 'created' : 'cancelled', mateId: msg.createdMateId || null }) : item; }); },
    failHomeDebateQuestion: function (messages, msg) { return messages.map(function (item) { return item.role === 'question' ? Object.assign({}, item, { error: msg.text }) : item; }); },
    iconHtml: function () { return ''; }, refreshIcons: function () {}, addToMessages: function () {}, scrollToBottom: function () {},
    createHomeDebateQuestionCard: function () { return {}; }, createHomeMateProposalCard: function () { return {}; },
  };
  vm.runInNewContext(source, context);
  context.renderCreationMessages = function () {};
  context.renderCreationError = function () {};
  return { context: context, state: function () { return state; }, sent: sent, opened: opened };
}

function routerFor(fixture) {
  var router = fs.readFileSync(path.join(root, 'lib/public/modules/app-message-router.js'), 'utf8');
  var start = router.indexOf('function dispatchMessage');
  var genericQuestions = 0;
  var context = {
    handleProjectMateCreationMessage: fixture.context.handleProjectMateCreationMessage,
    handlePendingMessageQueueMessage: function () { return false; }, handleDefaultAiMessage: function () { return false; }, handleCursorSharingMessage: function () { return false; },
    handleSearchClayMessage: function () { return false; }, handleHomeProtocolMessage: function () { return false; },
    processAppMessage: function (message) {
      if (message.type === 'session_switched') fixture.context.store.set({ activeSessionId: message.id });
      if (message.type === 'tool_executing' && message.name === 'AskUserQuestion') genericQuestions++;
    },
  };
  vm.runInNewContext(router.slice(start), context);
  return { dispatch: context.dispatchMessage, genericQuestions: function () { return genericQuestions; } };
}

test('production router ordering suppresses the generic opening question on start and restore', function () {
  var fresh = harness({ connected: false });
  fresh.context.startMateCreation();
  fresh.context.store.set({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', connected: true });
  fresh.context.maybeStartPendingCreation();
  var plan = fresh.sent.find(function (message) { return message.type === 'home_mate_creation_plan'; });
  var freshRouter = routerFor(fresh);
  freshRouter.dispatch({ type: 'session_switched', id: 7, cliSessionId: null, mateCreation: true });
  freshRouter.dispatch({ type: 'tool_executing', name: 'AskUserQuestion', id: 'opening', input: { questions: [{ question: 'What kind?' }] } });
  freshRouter.dispatch({ type: 'history_done' });
  freshRouter.dispatch({ type: 'home_mate_history', mateId: 'clay-id', requestId: plan.requestId, sessionId: 'local:7', localId: 7, mateCreation: true, messages: [{ role: 'question', toolId: 'opening', questions: [{ question: 'What kind?' }], status: 'pending' }] });
  assert.equal(freshRouter.genericQuestions(), 0);
  assert.equal(fresh.state().projectMateCreationMessages.length, 1);

  var restored = harness({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: 1 });
  var restoredRouter = routerFor(restored);
  restoredRouter.dispatch({ type: 'session_switched', id: 7, cliSessionId: 'provider-7', mateCreation: true });
  restoredRouter.dispatch({ type: 'tool_executing', name: 'AskUserQuestion', id: 'opening', input: { questions: [{ question: 'What kind?' }] } });
  restoredRouter.dispatch({ type: 'history_done' });
  var open = restored.sent.find(function (message) { return message.type === 'home_mate_session_open'; });
  restoredRouter.dispatch({ type: 'home_mate_history', mateId: 'clay-id', requestId: open.requestId, sessionId: 'provider-7', localId: 7, mateCreation: true, messages: [{ role: 'question', toolId: 'opening', questions: [{ question: 'What kind?' }], status: 'pending' }] });
  assert.equal(restoredRouter.genericQuestions(), 0);
  assert.equal(restored.state().projectMateCreationMessages.length, 1);
});

test('connect-time hydration marks a persisted creation session before replaying its opening question', function () {
  var restored = harness({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: null });
  var router = routerFor(restored);
  var switched = buildRestoredSessionMessage({
    localId: 7,
    cliSessionId: null,
    mateCreationMode: true,
    homeMateCreationPhase: 'interview',
    history: [{ type: 'tool_executing', name: 'AskUserQuestion' }],
  }, 'medium', {}, {
    requestedPermissionMode: 'default', effectivePermissionMode: 'default', permissionCapabilities: {}, mcpPermissionModeOverrides: {},
  });
  router.dispatch(switched);
  router.dispatch({ type: 'tool_executing', name: 'AskUserQuestion', id: 'opening', input: { questions: [{ question: 'What kind?' }] } });
  router.dispatch({ type: 'history_done' });
  var open = restored.sent.find(function (message) { return message.type === 'home_mate_session_open'; });
  assert.equal(switched.mateCreation, true);
  assert.equal(switched.mateCreationPhase, 'interview');
  assert.equal(router.genericQuestions(), 0);
  assert.ok(open);
  assert.equal(open.sessionId, 'local:7');
  router.dispatch({ type: 'home_mate_history', mateId: 'clay-id', requestId: open.requestId, sessionId: 'local:7', localId: 7, mateCreation: true, messages: [{ role: 'question', toolId: 'opening', questions: [{ question: 'What kind?' }], status: 'pending' }] });
  assert.equal(restored.state().projectMateCreationMessages.length, 1);
});

test('connect-time replay stays creation-owned while the Clay identity list is still loading', function () {
  var restored = harness({ cachedMatesList: [], currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: null });
  restored.context.initProjectMateCreationWorkspace();
  var router = routerFor(restored);
  var switched = buildRestoredSessionMessage({ localId: 7, cliSessionId: null, mateCreationMode: true, history: [{}] }, 'medium', {}, {
    requestedPermissionMode: 'default', effectivePermissionMode: 'default', permissionCapabilities: {}, mcpPermissionModeOverrides: {},
  });
  router.dispatch(switched);
  router.dispatch({ type: 'tool_executing', name: 'AskUserQuestion', id: 'opening', input: { questions: [{ question: 'What kind?' }] } });
  router.dispatch({ type: 'history_done' });
  assert.equal(router.genericQuestions(), 0);
  assert.equal(restored.state().projectMateCreationAwaitingMateList, true);
  restored.context.store.set({ cachedMatesList: [{ id: 'clay-id', builtinKey: 'clay' }] });
  var open = restored.sent.find(function (message) { return message.type === 'home_mate_session_open'; });
  assert.ok(open);
  router.dispatch({ type: 'home_mate_history', mateId: 'clay-id', requestId: open.requestId, sessionId: 'local:7', localId: 7, mateCreation: true, messages: [{ role: 'question', toolId: 'opening', questions: [{ question: 'What kind?' }], status: 'pending' }] });
  assert.equal(restored.state().projectMateCreationMessages.length, 1);
});

test('project Mate creation binds the start handshake, local session, and provider identity exactly', function () {
  var f = harness({ connected: false });
  f.context.startMateCreation();
  assert.equal(f.state().projectMateCreationPendingStart, true);
  assert.deepEqual(f.opened, ['clay-id']);

  f.context.store.set({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', connected: true });
  f.context.maybeStartPendingCreation();
  var plan = f.sent.find(function (message) { return message.type === 'home_mate_creation_plan'; });
  assert.ok(plan && plan.requestId);
  assert.equal(f.state().projectMateCreationAwaitingHistory, true);

  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'session_switched', id: 7, cliSessionId: null, mateCreation: true }), false);
  assert.equal(f.state().projectMateCreationActive, true);
  assert.equal(f.state().projectMateCreationLocalId, 7);
  assert.equal(f.state().projectMateCreationSessionId, 'local:7');
  assert.equal(f.state().projectMateCreationRequestId, plan.requestId);
  f.context.store.set({ activeSessionId: 7 });
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'tool_executing', name: 'AskUserQuestion', id: 'opening', input: { questions: [] } }), true);
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'history_done' }), false);
  assert.equal(f.sent.filter(function (message) { return message.type === 'home_mate_session_open'; }).length, 0);

  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_history', mateId: 'other', requestId: plan.requestId, sessionId: 'local:7', localId: 7, mateCreation: true, messages: [] }), false);
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_history', mateId: 'clay-id', requestId: 'stale', sessionId: 'local:7', localId: 7, mateCreation: true, messages: [] }), false);
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_history', mateId: 'clay-id', requestId: plan.requestId, sessionId: 'local:7', localId: 7, mateCreation: true, messages: [] }), true);
  assert.equal(f.sent.some(function (message) { return message.type === 'switch_session'; }), false);

  var requestId = plan.requestId;
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_session_identity', mateId: 'clay-id', requestId: requestId, previousSessionId: 'local:7', sessionId: 'provider-7' }), true);
  assert.equal(f.state().projectMateCreationSessionId, 'provider-7');

  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_creation_question', mateId: 'clay-id', requestId: requestId, sessionId: 'local:7', toolId: 'stale', questions: [] }), false);
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_creation_question', mateId: 'clay-id', requestId: requestId, sessionId: 'provider-7', toolId: 'q1', questions: [] }), true);
  var question = f.state().projectMateCreationMessages[0];
  f.context.respondToQuestion(question, 'answer', null, { 0: 'A planning partner' });
  var answer = f.sent[f.sent.length - 1];
  assert.equal(answer.sessionId, 'provider-7');
  assert.equal(answer.requestId, requestId);
});

test('project Mate creation ignores stale completion, preserves lifecycle frames, and clears on switch away', function () {
  var f = harness({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: 7, projectMateCreationActive: true, projectMateCreationMateId: 'clay-id', projectMateCreationSessionId: 'provider-7', projectMateCreationRequestId: 'request-7', projectMateCreationLocalId: 7, projectMateCreationMessages: [{ role: 'mate_proposal', proposal: { proposalId: 'p1' }, status: 'pending' }], cachedMatesList: [{ id: 'clay-id', builtinKey: 'clay' }, { id: 'new-mate' }] });
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_creation_proposal_resolved', mateId: 'clay-id', requestId: 'other', sessionId: 'provider-7', proposalId: 'p1', action: 'create', createdMateId: 'wrong' }), false);
  assert.deepEqual(f.opened, []);
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'result' }), false);
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'done' }), false);
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'error' }), false);
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'delta' }), true);

  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_creation_proposal_resolved', mateId: 'clay-id', requestId: 'request-7', sessionId: 'provider-7', proposalId: 'p1', action: 'cancel' }), true);
  assert.equal(f.state().projectMateCreationMessages[0].status, 'cancelled');
  f.context.store.set({ projectMateCreationMessages: [{ role: 'mate_proposal', proposal: { proposalId: 'p2' }, status: 'pending' }] });
  assert.equal(f.context.handleProjectMateCreationMessage({ type: 'home_mate_creation_proposal_resolved', mateId: 'clay-id', requestId: 'request-7', sessionId: 'provider-7', proposalId: 'p2', action: 'create', createdMateId: 'new-mate' }), true);
  assert.deepEqual(f.opened, ['new-mate']);

  f.context.store.set({ currentSlug: 'sample', activeProjectSlug: 'sample' });
  f.context.handleProjectMateCreationMessage({ type: 'session_switched', id: 1, mateCreation: false });
  assert.equal(f.state().projectMateCreationActive, false);
  assert.equal(f.state().projectMateCreationMessages.length, 0);
});

test('restored creation resumes after a late Clay Mate list and router forwards lifecycle frames', function () {
  var f = harness({ cachedMatesList: [], currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: 7 });
  f.context.initProjectMateCreationWorkspace();
  f.context.handleProjectMateCreationMessage({ type: 'session_switched', id: 7, cliSessionId: 'provider-7', mateCreation: true });
  f.context.handleProjectMateCreationMessage({ type: 'history_done' });
  assert.equal(f.sent.length, 0);
  f.context.store.set({ cachedMatesList: [{ id: 'clay-id', builtinKey: 'clay' }] });
  assert.equal(f.state().projectMateCreationActive, true);
  assert.equal(f.sent[0].type, 'home_mate_session_open');
  assert.equal(f.sent[0].sessionId, 'provider-7');

  var early = harness({ cachedMatesList: [], currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: 8 });
  early.context.initProjectMateCreationWorkspace();
  early.context.handleProjectMateCreationMessage({ type: 'session_switched', id: 8, cliSessionId: 'provider-8', mateCreation: true });
  early.context.store.set({ cachedMatesList: [{ id: 'clay-id', builtinKey: 'clay' }] });
  assert.equal(early.sent.length, 0);
  early.context.handleProjectMateCreationMessage({ type: 'history_done' });
  assert.equal(early.sent.filter(function (message) { return message.type === 'home_mate_session_open'; }).length, 1);

  var router = fs.readFileSync(path.join(root, 'lib/public/modules/app-message-router.js'), 'utf8');
  var start = router.indexOf('function dispatchMessage');
  var calls = [];
  var routerContext = {
    handleProjectMateCreationMessage: function () { return false; },
    handlePendingMessageQueueMessage: function () { return false; }, handleDefaultAiMessage: function () { return false; }, handleCursorSharingMessage: function () { return false; },
    handleSearchClayMessage: function () { return false; }, handleHomeProtocolMessage: function () { return false; },
    processAppMessage: function (message) { calls.push(message.type); },
  };
  vm.runInNewContext(router.slice(start), routerContext);
  routerContext.dispatchMessage({ type: 'result' });
  routerContext.dispatchMessage({ type: 'done' });
  routerContext.dispatchMessage({ type: 'error' });
  assert.deepEqual(calls, ['result', 'done', 'error']);
});
