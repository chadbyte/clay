var test = require('node:test');
var assert = require('node:assert/strict');
var workspace = require('../lib/project-debate-workspace');

test('project debate controls require the exact active session and its owner', function () {
  var calls = [];
  var replies = [];
  var session = { localId: 7, ownerId: 'owner', homeDebatePlanning: true };
  var engine = { handleHomeControl: function (ws, msg, target) { calls.push({ action: msg.action, target: target }); return true; } };
  var send = function (ws, msg) { replies.push(msg); };
  var ws = { _clayUser: { id: 'owner' } };
  workspace.handleProjectDebateControl(ws, { type: 'project_debate_control', sessionId: 8, action: 'stop' }, session, engine, send);
  workspace.handleProjectDebateControl({ _clayUser: { id: 'other' } }, { type: 'project_debate_control', sessionId: 7, action: 'stop' }, session, engine, send);
  assert.equal(calls.length, 0);
  assert.equal(replies.every(function (reply) { return reply.ok === false; }), true);
  workspace.handleProjectDebateControl(ws, { type: 'project_debate_control', sessionId: 7, action: 'cancel_stop' }, session, engine, send);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, session);
  assert.equal(replies[2].ok, true);
});

test('ordinary Mate debates retain stop cancellation, floor and resume routing', function () {
  var calls = [];
  var engine = {
    handleDebateCancelStop: function (ws, session) { calls.push(['cancel', session.localId]); return true; },
    handleDebateUserFloorResponse: function (ws, msg, session) { calls.push(['floor', msg.text, session.localId]); },
    handleDebateConcludeResponse: function (ws, msg, session) { calls.push(['conclude', msg.action, session.localId]); }
  };
  ['cancel_stop', 'user_floor', 'resume'].forEach(function (action) {
    workspace.handleProjectDebateControl({}, { type: 'project_debate_control', sessionId: 2, action: action, text: 'A thought' }, { localId: 2 }, engine, function () {});
  });
  assert.deepEqual(calls, [['cancel', 2], ['floor', 'A thought', 2], ['conclude', 'continue', 2]]);
});

test('restored debate state uses full history even when the start is outside the loaded page', function () {
  var session = { history: [
    { type: 'debate_started', topic: 'Navigation', moderatorName: 'Clay', panelists: [{ name: 'Designer' }] },
    { type: 'debate_turn', round: 4 }, { type: 'debate_user_floor' }, { type: 'debate_hand_raised' }
  ] };
  var header = workspace.debateHeader(session);
  assert.equal(header.topic, 'Navigation');
  assert.equal(header.round, 4);
  assert.equal(header.interaction, 'user_floor');
  assert.equal(header.handRaised, true);
  session.history.push({ type: 'debate_ended', reason: 'interrupted' });
  assert.equal(workspace.debateHeader(session).phase, 'interrupted');
  assert.equal(workspace.debateHeader(session).interaction, null);
});

test('debate state requests never reveal another owner’s history', function () {
  var response;
  workspace.handleProjectDebateControl({ _clayUser: { id: 'other' } }, { type: 'project_debate_state', sessionId: 7 }, { localId: 7, ownerId: 'owner', history: [{ type: 'debate_started', topic: 'Private' }] }, {}, function (ws, msg) { response = msg; });
  assert.equal(response.header, null);
});

var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

function clientFixture() {
  var state = { activeSessionId: 7, projectDebateMessages: [], isMate: true };
  var roots = [];
  var sent = [];
  var controlMessages = [];
  function element() {
    return { isConnected: true, children: [], setAttribute: function () {}, querySelector: function () { return null; }, classList: { contains: function () { return false; } }, appendChild: function (child) { this.children.push(child); child.parent = this; }, replaceWith: function (child) { var index = this.parent.children.indexOf(this); this.parent.children[index] = child; child.parent = this.parent; } };
  }
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (patch) { Object.assign(state, patch); }, snap: function () { return state; } },
    getWs: function () { return { readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } }; },
    getMessagesEl: function () { return { querySelector: function () { return null; } }; },
    document: { createElement: element, getElementById: function () { return null; } },
    isMateWorkspace: function () { return state.isMate; },
    addToMessages: function (root) { roots.push(root); }, scrollToBottom: function () {},
    createDebateControls: function () { return { render: function (messages) { controlMessages = messages; } }; },
    disposeChatBubbleTree: function () {}
  };
  var root = path.join(__dirname, '../lib/public/modules');
  var live = fs.readFileSync(path.join(root, 'home-debate-live.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
  vm.runInNewContext(live, context);
  context.createHomeDebateLiveCard = element;
  var bridge = fs.readFileSync(path.join(root, 'project-debate-workspace.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
  vm.runInNewContext(bridge, context);
  return { state: state, context: context, roots: roots, sent: sent, controls: function () { return controlMessages; } };
}

test('older debate history does not replace the active debate controls and reset clears the previous session', function () {
  var f = clientFixture();
  f.context.handleProjectDebateMessage({ type: 'debate_started', topic: 'Current' });
  f.context.handleProjectDebateMessage({ type: 'debate_conclude_confirm' });
  assert.equal(f.controls()[0].interaction, 'conclude');
  f.context.beginProjectDebatePrepend();
  f.context.handleProjectDebateMessage({ type: 'debate_started', topic: 'Older' });
  f.context.handleProjectDebateMessage({ type: 'debate_ended', reason: 'natural' });
  f.context.endProjectDebatePrepend();
  assert.equal(f.state.projectDebateMessages[0].topic, 'Current');
  assert.equal(f.controls()[0].interaction, 'conclude');
  assert.equal(f.roots.length, 2);
  f.context.resetProjectDebateWorkspace();
  assert.equal(f.state.projectDebateMessages.length, 0);
  assert.equal(f.controls().length, 0);
});

test('replay requests complete debate state and ignores responses for another session', function () {
  var f = clientFixture();
  f.state.replayingHistory = true;
  f.context.handleProjectDebateMessage({ type: 'debate_turn_done', turnId: 'last', mateId: 'panel', text: 'Latest turn' });
  assert.equal(f.controls().length, 0);
  f.context.handleProjectDebateMessage({ type: 'history_done' });
  assert.deepEqual(f.sent, [{ type: 'project_debate_state', sessionId: 7 }]);
  f.context.handleProjectDebateMessage({ type: 'project_debate_state', sessionId: 8, header: { role: 'debate_header', topic: 'Wrong' } });
  assert.equal(f.state.projectDebateMessages.length, 1);
  f.context.handleProjectDebateMessage({ type: 'project_debate_state', sessionId: 7, header: { role: 'debate_header', topic: 'Correct', phase: 'ended' } });
  assert.equal(f.state.projectDebateMessages[0].topic, 'Correct');
  assert.equal(f.state.projectDebateMessages[1].text, 'Latest turn');
});
