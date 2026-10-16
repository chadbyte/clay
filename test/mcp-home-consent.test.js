var test = require('node:test');
var assert = require('node:assert/strict');
var events = require('../lib/server-home-chat-events');
test('home and search Clay project server-owned import questions, settle them and expire restored requests', function () {
  var event = { type: 'tool_executing', source: 'mcp-import', name: 'AskUserQuestion', id: 'import', input: { questions: [{ question: 'Import exact disabled copy?', allowOther: false, options: [{ label: 'Keep unchanged' }, { label: 'Import disabled copy' }] }] } };
  var session = { localId: 1, history: [event] }, projected = events.transformEvent(event, 'clay', session, 'request', 'local:1');
  assert.equal(projected.type, 'home_mcp_import_question'); assert.equal(projected.questions[0].allowOther, false); assert.equal(projected.requestId, 'request');
  var messages = events.historyToHomeChat([event], false, false, { import: {} }); assert.equal(messages[0].flow, 'mcp_import'); assert.equal(messages[0].status, 'pending');
  assert.equal(events.historyToHomeChat([event], false, false, {})[0].status, 'expired');
  projected = events.transformEvent({ type: 'ask_user_answered', toolId: 'import', answers: { 0: 'Keep unchanged' } }, 'clay', session, 'request', 'local:1'); assert.equal(projected.type, 'home_mcp_import_question_resolved');
  projected = events.transformEvent({ type: 'mcp_import_consent_expired', toolId: 'import', error: 'Expired' }, 'clay', session, 'request', 'local:1'); assert.equal(projected.status, 'expired');
});
test('Home consent routes only an exact pending request from the authenticated actor and tap', function () {
  var calls = [], errors = [], owner = { id: 'owner' }, ws = { _clayUser: owner, readyState: 1 }, session = { localId: 1, ownerId: owner.id, pendingAskUser: { import: { request: { source: 'mcp-import' } } } }, tap = { mateSlug: 'mate-clay', sessionId: 1, requestId: 'request' };
  var found = { slug: 'mate-clay', mate: { id: 'clay' }, ctx: { handleHomeAskUserResponse: function (msg, value, peer) { calls.push({ msg: msg, session: value, ws: peer }); return true; } } };
  var service = require('../lib/server-home-mcp-consent').attachHomeMcpConsent({ findMateProject: function (userId) { return userId === owner.id ? found : null; }, resolveHomeSession: function (value, userId, ref) { return ref === 'local:1' ? session : null; }, messageTap: function () { return tap; }, isActorLive: function (peer, userId) { return peer._clayUser.id === userId; }, sendError: function () { errors.push(true); } });
  var msg = { mateId: 'clay', sessionId: 'local:1', requestId: 'request', toolId: 'import', answers: { 0: 'Import disabled copy' } };
  service.respond(ws, 'foreign', msg); assert.equal(calls.length, 0);
  service.respond(ws, owner.id, Object.assign({}, msg, { requestId: 'other' })); assert.equal(calls.length, 0);
  service.respond(ws, owner.id, msg); assert.equal(calls.length, 1); assert.equal(calls[0].ws, ws);
  delete session.pendingAskUser.import; service.respond(ws, owner.id, msg); assert.equal(calls.length, 1); assert.equal(errors.length, 3);
});
test('Home import review keeps exact cards through history, correlates replies and submits the owner choice', async function () {
  var fs = require('fs'), vm = require('vm'), ui = await import('../lib/public/modules/home-debate-planning.js');
  var identity = await import('../lib/public/modules/home-chat-stream-state.js');
  var state = { homeChatMateId: 'clay', homeChatSessionId: 'local:1' }, sent = [];
  var noop = function () {};
  var box = { store: { get: function (key) { return state[key]; }, set: function (update) { Object.assign(state, update); }, subscribe: function () {} }, getWs: function () { return { readyState: 1, send: function (data) { sent.push(JSON.parse(data)); } }; },
    isOwnedHomeSessionMessage: identity.isOwnedHomeSessionMessage,
    createHomeDebateResponder: ui.createHomeDebateResponder, createHomeMateProposalResponder: function () { return noop; },
    applyHomeDebateQuestion: ui.applyHomeDebateQuestion, resolveHomeDebateQuestion: ui.resolveHomeDebateQuestion, normalizeHomeTranscript: ui.normalizeHomeTranscript,
    finalizeHomeAssistant: identity.finalizeHomeAssistant, markHomeChatActivity: noop, settleHomeDebateLaunch: noop, clearHomeDebatePlanningPending: noop,
    restoreHomeDebateQuestionFocus: noop, syncHomeDebateLaunchHistory: noop, syncHomeDebatePlanningPending: noop, rememberHomeSession: noop };
  var source = fs.readFileSync(require.resolve('../lib/public/modules/home-mate-chat.js'), 'utf8').replace(/^import .*$/gm, '').replace(/export function /g, 'function ');
  vm.runInNewContext(source + '\nrenderHomeChat=function(){};activeSessionRequestId="request";this.api={handle:handleHomeDebateTranscript,history:handleHomeMateHistory,respond:respondToDebateTranscript,getMessages:function(){return messages;}};', box);
  var question = { type: 'home_mcp_import_question', toolId: 'consent', mateId: 'clay', sessionId: 'local:1', requestId: 'request', questions: [{ question: 'Import disabled copy?', allowOther: false, options: [{ label: 'Keep unchanged' }, { label: 'Import disabled copy' }] }] };
  box.api.handle(Object.assign({}, question, { requestId: 'foreign' })); assert.equal(box.api.getMessages().length, 0);
  box.api.handle(Object.assign({}, question, { mateId: 'foreign' })); assert.equal(box.api.getMessages().length, 0);
  box.api.handle(question); var card = box.api.getMessages()[0]; assert.equal(card.flow, 'mcp_import');
  box.api.respond(card, 'answer', null, { 0: 'Import disabled copy' }); assert.equal(sent[0].type, 'home_mcp_import_response'); assert.equal(sent[0].sessionId, 'local:1'); assert.equal(sent[0].mateId, 'clay'); assert.equal(sent[0].requestId, 'request'); assert.equal(sent[0].answers[0], 'Import disabled copy'); assert.equal(card.status, 'submitting');
  box.api.respond(card, 'answer', null, { 0: 'Keep unchanged' }); assert.equal(sent.length, 1);
  box.api.handle({ type: 'home_mcp_import_question_resolved', toolId: 'consent', mateId: 'clay', sessionId: 'local:1', requestId: 'request', status: 'expired', error: 'Timeout' }); assert.equal(box.api.getMessages()[0].status, 'expired');
  box.api.history({ type: 'home_mate_history', mateId: 'clay', sessionId: 'local:1', requestId: 'request', isProcessing: false, messages: box.api.getMessages() }); assert.equal(box.api.getMessages()[0].flow, 'mcp_import'); assert.equal(box.api.getMessages()[0].status, 'expired');
});
