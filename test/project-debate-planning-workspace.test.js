var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var vm = require('node:vm');
var buildRestoredSessionMessage = require('../lib/project-connection').buildRestoredSessionMessage;
var createSessionManager = require('../lib/sessions').createSessionManager;
var attachHomeDebatePlanning = require('../lib/server-home-debate-planning').attachHomeDebatePlanning;

var root = path.join(__dirname, '..');

function harness(initial) {
  var source = fs.readFileSync(path.join(root, 'lib/public/modules/project-debate-planning-workspace.js'), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/export function /g, 'function ');
  var state = Object.assign({
    cachedMatesList: [{ id: 'clay-id', builtinKey: 'clay' }], currentSlug: 'sample', activeProjectSlug: 'sample', connected: true,
    activeSessionId: 1, projectDebatePlanningActive: false, projectDebatePlanningMateId: null,
    projectDebatePlanningSessionId: null, projectDebatePlanningLocalId: null, projectDebatePlanningRequestId: null,
    projectDebatePlanningPendingStart: false, projectDebatePlanningAwaitingHistory: false,
    projectDebatePlanningAwaitingMateList: false, projectDebatePlanningHistoryReady: false,
    projectDebatePlanningTopic: '', projectDebatePlanningMessages: [], projectDebatePlanningError: '', projectDebatePlanningRetryable: false,
  }, initial || {});
  var listeners = [];
  var sent = [];
  var opened = [];
  var context = {
    console: console, Date: Date, JSON: JSON, Object: Object, Array: Array, String: String,
    document: { createElement: function () { return { isConnected: true, className: '', setAttribute: function () {}, appendChild: function () {}, addEventListener: function () {}, innerHTML: '', textContent: '' }; } },
    store: {
      get: function (key) { return state[key]; }, snap: function () { return state; },
      set: function (patch) { var previous = state; state = Object.assign({}, state, patch); for (var i = 0; i < listeners.length; i++) listeners[i](state, previous); },
      subscribe: function (listener) { listeners.push(listener); },
    },
    getWs: function () { return { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } }; },
    openMateWorkspace: function (id) { opened.push(id); },
    normalizeHomeTranscript: function (items) { return items.slice(); },
    applyHomeDebateProposal: function (items, msg) { return items.concat([{ role: 'proposal', proposal: msg.proposal, status: 'pending' }]); },
    resolveHomeDebateProposal: function (items, msg) { return items.map(function (item) { return item.role === 'proposal' ? Object.assign({}, item, { status: msg.action }) : item; }); },
    failHomeDebateQuestion: function (items, msg) { return items.map(function (item) { return item.role === 'question' ? Object.assign({}, item, { error: msg.text }) : item; }); },
    createHomeDebateQuestionCard: function () { return {}; }, createHomeDebateProposalCard: function () { return {}; },
    addToMessages: function () {}, scrollToBottom: function () {}, refreshIcons: function () {}, iconHtml: function () { return ''; },
  };
  vm.runInNewContext(source, context);
  context.render = function () {};
  return { context: context, state: function () { return state; }, sent: sent, opened: opened };
}

test('new debate setup activates builtin Clay and binds the exact project session', function () {
  var fixture = harness({ connected: false });
  assert.equal(fixture.context.startProjectDebatePlanning('Local-first storage?'), true);
  assert.deepEqual(fixture.opened, ['clay-id']);
  assert.equal(fixture.state().projectDebatePlanningPendingStart, true);
  fixture.context.store.set({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', connected: true });
  fixture.context.maybeStart();
  var plan = fixture.sent.find(function (message) { return message.type === 'home_mate_debate_plan'; });
  assert.ok(plan && plan.requestId);
  assert.equal(plan.topic, 'Local-first storage?');
  fixture.context.handleProjectDebatePlanningMessage({ type: 'session_switched', id: 7, cliSessionId: null, debatePlanning: true });
  fixture.context.store.set({ activeSessionId: 7 });
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'home_mate_history', mateId: 'clay-id', requestId: plan.requestId, sessionId: 'local:7', localId: 7, debatePlanning: true, messages: [{ role: 'question', toolId: 'q1', questions: [] }] }), true);
  assert.equal(fixture.state().projectDebatePlanningSessionId, 'local:7');
  assert.equal(fixture.state().projectDebatePlanningMessages.length, 1);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'home_debate_question', mateId: 'other', requestId: plan.requestId, sessionId: 'local:7', toolId: 'stale', questions: [] }), false);
});

test('restored debate planning survives initial hydration before the Mate list arrives', function () {
  var fixture = harness({ cachedMatesList: [], currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: null });
  fixture.context.initProjectDebatePlanningWorkspace();
  var restored = buildRestoredSessionMessage({ localId: 9, cliSessionId: null, debateSetupMode: true, homeDebatePhase: 'planning', history: [{}] }, 'medium', {}, {
    requestedPermissionMode: 'default', effectivePermissionMode: 'default', permissionCapabilities: {}, mcpPermissionModeOverrides: {},
  });
  assert.equal(restored.debatePlanning, true);
  assert.equal(restored.debatePhase, 'planning');
  fixture.context.handleProjectDebatePlanningMessage(restored);
  fixture.context.store.set({ activeSessionId: restored.id });
  assert.equal(fixture.state().projectDebatePlanningAwaitingMateList, true);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'tool_executing', name: 'AskUserQuestion' }), true);
  fixture.context.handleProjectDebatePlanningMessage({ type: 'history_done' });
  fixture.context.store.set({ cachedMatesList: [{ id: 'clay-id', builtinKey: 'clay' }] });
  var open = fixture.sent.find(function (message) { return message.type === 'home_mate_session_open'; });
  assert.ok(open);
  assert.equal(open.sessionId, 'local:9');
});

test('provider identity promotion updates exact replies and rejects the stale local identity', function () {
  var fixture = harness({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: 7, projectDebatePlanningActive: true, projectDebatePlanningMateId: 'clay-id', projectDebatePlanningSessionId: 'local:7', projectDebatePlanningLocalId: 7, projectDebatePlanningRequestId: 'request-7' });
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'home_mate_session_identity', mateId: 'clay-id', requestId: 'request-7', previousSessionId: 'local:7', sessionId: 'provider-7' }), true);
  assert.equal(fixture.state().projectDebatePlanningSessionId, 'provider-7');
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'home_debate_question', mateId: 'clay-id', requestId: 'request-7', sessionId: 'local:7', toolId: 'stale', questions: [] }), false);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'home_debate_question', mateId: 'clay-id', requestId: 'request-7', sessionId: 'provider-7', toolId: 'q1', questions: [] }), true);
  fixture.context.respondToQuestion(fixture.state().projectDebatePlanningMessages[0], 'answer', null, { 0: 'Round table' });
  assert.equal(fixture.sent[0].sessionId, 'provider-7');
});

test('launch errors stay actionable while question errors remain attached to their card', function () {
  var fixture = harness({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: 7, projectDebatePlanningActive: true, projectDebatePlanningMateId: 'clay-id', projectDebatePlanningSessionId: 'local:7', projectDebatePlanningLocalId: 7, projectDebatePlanningRequestId: 'request-7' });
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'home_mate_error', mateId: 'clay-id', requestId: 'request-7', sessionId: 'local:7', code: 'model_unavailable', text: 'Sign in and retry.' }), true);
  assert.equal(fixture.state().projectDebatePlanningError, 'Sign in and retry.');
  assert.equal(fixture.state().projectDebatePlanningRetryable, true);

  var missing = harness({ cachedMatesList: [] });
  assert.equal(missing.context.startProjectDebatePlanning('Topic'), false);
  assert.match(missing.state().projectDebatePlanningError, /Clay is unavailable/);
});

test('raw setup frames are suppressed only until the live debate transition', function () {
  var fixture = harness({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: 7, projectDebatePlanningActive: true, projectDebatePlanningMateId: 'clay-id', projectDebatePlanningSessionId: 'local:7', projectDebatePlanningLocalId: 7, projectDebatePlanningRequestId: 'request-7' });
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'delta', text: 'hidden setup narration' }), true);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'home_debate_event', eventType: 'debate_started', sessionId: 'local:7' }), false);
  assert.equal(fixture.state().projectDebatePlanningActive, false);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'delta', text: 'live transcript frame' }), false);
  var router = fs.readFileSync(path.join(root, 'lib/public/modules/app-message-router.js'), 'utf8');
  assert.match(router, /handleProjectDebatePlanningMessage\(msg\)[\s\S]*msg\.type === "home_debate_event"[\s\S]*processAppMessage\(Object\.assign\(\{\}, msg, \{ type: msg\.eventType, mateId: msg\.speakerMateId \|\| null \}\)\)/);
});

test('live-session hydration hides setup replay until the first debate event', function () {
  var fixture = harness({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: 12 });
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'session_switched', id: 12, debatePlanning: true, debatePhase: 'live' }), false);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'tool_executing', id: 'old-question', name: 'AskUserQuestion' }), true);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'ask_user_answered', toolId: 'old-question' }), true);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'debate_proposal', proposal: { proposalId: 'old-proposal' } }), true);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'debate_started', topic: 'Live debate' }), false);
  assert.equal(fixture.context.handleProjectDebatePlanningMessage({ type: 'debate_turn', mateId: 'clay-id' }), false);
});

test('real SessionManager start, switch, and disk hydration preserve planning metadata before the adapter sees it', async function (t) {
  var tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-debate-ordering-'));
  t.after(function () { fs.rmSync(tempRoot, { recursive: true, force: true }); });
  var projectDir = path.join(tempRoot, 'mate-clay-id');
  var sessionsBase = path.join(tempRoot, 'sessions');
  fs.mkdirSync(projectDir, { recursive: true });
  var sent = [];
  var manager = createSessionManager({
    cwd: projectDir,
    sessionsBase: sessionsBase,
    cliSessionsDir: path.join(tempRoot, 'provider-transcripts'),
    send: function (message) { sent.push(message); },
    sendTo: function (target, message) { sent.push(message); target.send(JSON.stringify(message)); },
  });
  var clay = { id: 'clay-id', builtinKey: 'clay', name: 'Clay' };
  var providerStarts = [];
  var persisted = [];
  var project = {
    getSessionManager: function () { return manager; },
    sdk: {
      startQuery: function (session) {
        providerStarts.push({ session: session, switchedBeforeStart: sent.some(function (message) { return message.type === 'session_switched' && message.id === session.localId; }) });
      },
    },
  };
  var browserMessages = [];
  var ws = { readyState: 1, send: function (value) { browserMessages.push(JSON.parse(value)); } };
  var planning = attachHomeDebatePlanning({
    findMateProject: function () { return { mate: clay, ctx: project }; },
    homeModels: { resolveMateModel: function () { return Promise.resolve({ vendor: 'stub', model: 'stubbed-before-startup', effort: null }); } },
    resolveHomeSession: function (found, ownerId, reference) {
      var localId = Number(String(reference || '').replace(/^local:/, ''));
      return found.ctx.getSessionManager().sessions.get(localId) || null;
    },
    sessionReference: function (session) { return session.cliSessionId || 'local:' + session.localId; },
    setupTap: function (target, found, localId, requestId) { target._homeChatTap = { mateId: found.mate.id, sessionId: localId, requestId: requestId }; },
    sendHistory: function () {},
    sendSessionList: function () {},
    sendError: function () {},
    sendModelError: function (target, found, message, error) { throw error; },
    persistActiveSession: function (target, found, ownerId, session) { persisted.push({ ownerId: ownerId, localId: session.localId, title: session.title }); },
  });

  planning.start(ws, 'owner-a', { type: 'home_mate_debate_plan', requestId: 'real-ordering', topic: 'Safe ordering' });
  await new Promise(function (resolve) { setImmediate(resolve); });
  var switched = browserMessages.find(function (message) { return message.type === 'session_switched'; });
  assert.ok(switched);
  assert.equal(switched.debatePlanning, true);
  assert.equal(switched.debatePhase, 'planning');
  assert.equal(providerStarts.length, 1);
  assert.equal(providerStarts[0].switchedBeforeStart, true);
  assert.deepEqual(persisted, [{ ownerId: 'owner-a', localId: switched.id, title: 'Debate planning' }]);

  var client = harness({ currentSlug: 'mate-clay-id', activeProjectSlug: 'mate-clay-id', activeSessionId: switched.id });
  assert.equal(client.context.handleProjectDebatePlanningMessage(switched), false);
  assert.equal(client.state().projectDebatePlanningActive, true);
  assert.equal(client.state().projectDebatePlanningSessionId, 'local:' + switched.id);

  var reloadedMessages = [];
  var reloaded = createSessionManager({
    cwd: projectDir,
    sessionsBase: sessionsBase,
    cliSessionsDir: path.join(tempRoot, 'provider-transcripts'),
    send: function (message) { reloadedMessages.push(message); },
  });
  var restored = Array.from(reloaded.sessions.values())[0];
  assert.ok(restored);
  assert.equal(restored.title, 'Debate planning');
  assert.equal(restored.debateSetupMode, true);
  assert.equal(restored.homeDebatePlanning, true);
  assert.equal(restored.homeDebatePhase, 'planning');
  reloaded.switchSession(restored.localId);
  var hydratedSwitch = reloadedMessages.find(function (message) { return message.type === 'session_switched'; });
  assert.equal(hydratedSwitch.debatePlanning, true);
  assert.equal(hydratedSwitch.debatePhase, 'planning');
});
