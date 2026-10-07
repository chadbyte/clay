import '/app.js';
import { store } from '/modules/store.js';
import { processMessage } from '/modules/app-message-router.js';
import { resetHistoryReplayBatch } from '/modules/history-replay-batch.js';
import { getTools } from '/modules/tools.js';

function frame() { return new Promise(function (resolve) { requestAnimationFrame(resolve); }); }
function check(value, message) { if (!value) throw new Error(message); }

window.runHistoryFixture = async function (vendor) {
  store.set({ currentSlug: 'fixture', activeProjectSlug: 'fixture', dmMode: false, pendingOutboundMessages: [], deliveryReceipts: {} });
  processMessage({ type: 'session_switched', id: 101, vendor: vendor || 'claude', hasHistory: true, isProcessing: true, capabilities: {}, model: 'fixture' });
  document.getElementById('connect-overlay').classList.add('hidden');
  document.getElementById('home-hub').classList.add('hidden');
  var messages = document.getElementById('messages');
  processMessage({ type: 'history_meta', from: 0, total: 6010 });
  processMessage({ type: 'user_message', text: 'Review the restored conversation.' });
  processMessage({ type: 'thinking_start' });
  var expected = '';
  for (var i = 0; i < 3000; i++) {
    processMessage({ type: 'thinking_delta', text: 'Reason ' + i + '. ', _ts: i + 1 });
    if (i % 500 === 0) {
      await frame();
      check(messages.children.length === 0, 'historical Thinking painted before completion');
    }
  }
  processMessage({ type: 'thinking_stop', duration: 20 });
  processMessage({ type: 'tool_start', id: 'read-1', name: 'Read' });
  processMessage({ type: 'tool_executing', id: 'read-1', name: 'Read', input: { file_path: '/fixture/example.js' } });
  processMessage({ type: 'tool_result', id: 'read-1', content: 'Saved file contents' });
  processMessage({ type: 'tool_start', id: 'ask-1', name: 'AskUserQuestion' });
  processMessage({ type: 'tool_executing', id: 'ask-1', name: 'AskUserQuestion', input: { questions: [{ header: 'Scope', question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }] } });
  processMessage({ type: 'ask_user_answered', toolId: 'ask-1', answers: { 'Continue?': 'Yes' } });
  for (var j = 0; j < 3000; j++) {
    var text = 'Word' + j + ' ';
    expected += text;
    processMessage({ type: 'delta', text: text, _ts: j + 4000 });
    if (j % 500 === 0) {
      await frame();
      check(messages.children.length === 0, 'historical answer painted before completion');
    }
  }
  var started = performance.now();
  processMessage({ type: 'history_done' });
  var restoreMs = performance.now() - started;
  await frame();
  check(messages.textContent.includes('Saved file contents'), 'tool result missing');
  check(messages.querySelector('.ask-user-answer-summary'), 'saved question answer missing');
  check(store.get('currentFullText') === expected, 'answer text differs');
  check(messages.querySelectorAll('.thinking-item').length === 1, 'thinking entry missing or duplicated');
  var current = store.get('currentMsgEl');
  check(current && current.isConnected, 'active answer was finalized');
  processMessage({ type: 'delta', text: 'LIVE CONTINUATION' });
  await frame();
  check(store.get('currentMsgEl') === current, 'live text created another answer');
  check(current.textContent.includes('LIVE CONTINUATION'), 'live continuation missing');
  processMessage({ type: 'session_switched', id: 101, vendor: vendor || 'claude', hasHistory: true, isProcessing: true, capabilities: {}, model: 'fixture' });
  processMessage({ type: 'history_meta', from: 0, total: 2 });
  processMessage({ type: 'tool_start', id: 'active-tool', name: 'Read' });
  processMessage({ type: 'tool_executing', id: 'active-tool', name: 'Read', input: { file_path: '/fixture/active.js' } });
  processMessage({ type: 'history_done' });
  check(!getTools()['active-tool'].done, 'active tool was marked done on restore');
  processMessage({ type: 'tool_result', id: 'active-tool', content: 'Live result' });
  processMessage({ type: 'history_meta' });
  processMessage({ type: 'delta', text: 'STALE REPLAY' });
  resetHistoryReplayBatch();
  processMessage({ type: 'delta', text: 'After reconnect' });
  await frame();
  check(!messages.textContent.includes('STALE REPLAY'), 'interrupted history leaked');
  processMessage({ type: 'permission_request_pending', requestId: 'pending-1', toolName: 'Read', toolInput: { file_path: '/fixture/permission.js' }, vendor: vendor || 'claude' });
  var permission = messages.querySelector('[data-request-id="pending-1"]');
  check(permission && permission.querySelector('button:not(:disabled)'), 'pending approval is not actionable');
  return { vendor: vendor || 'claude', restoreMs: Math.round(restoreMs), textChunks: 3000, thinkingChunks: 3000, partialPaints: 0, errors: window.fixtureErrors.slice() };
};
// Delivers a captured server sequence through the real socket onmessage path,
// one browser task per message, so paints can happen between messages exactly
// as they do with a live WebSocket.
function nextTask() {
  return new Promise(function (resolve) {
    var channel = new MessageChannel();
    channel.port1.onmessage = function () { resolve(); };
    channel.port2.postMessage(null);
  });
}

async function currentSocket() {
  for (var i = 0; i < 200; i++) {
    var socket = window.fixtureSockets[window.fixtureSockets.length - 1];
    if (socket && socket.readyState === 1 && socket.onmessage) return socket;
    await frame();
  }
  throw new Error('fixture socket never opened');
}

window.runReconnectFixture = async function (messages) {
  var socket = await currentSocket();
  var messagesEl = document.getElementById('messages');
  var replayDom = null;
  var partialPaints = 0;
  var started = 0;
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.type === 'history_done') started = performance.now();
    socket.onmessage({ data: JSON.stringify(msg) });
    if (msg.type === 'history_meta') replayDom = messagesEl.innerHTML;
    if (msg.type === 'history_done') {
      replayDom = null;
      var restoreMs = performance.now() - started;
    }
    if (replayDom !== null && i % 250 === 0) {
      await frame();
      if (messagesEl.innerHTML !== replayDom) partialPaints++;
    } else {
      await nextTask();
    }
  }
  await frame();
  var tools = getTools();
  var current = store.get('currentMsgEl');
  var result = {
    restoreMs: Math.round(restoreMs || 0),
    partialPaints: partialPaints,
    sessionIsProcessing: store.get('sessionIsProcessing'),
    replayingHistory: store.get('replayingHistory'),
    openAnswer: !!(current && current.isConnected),
    assistantBubbles: messagesEl.querySelectorAll('.msg-assistant').length,
    thinkingItems: messagesEl.querySelectorAll('.thinking-item').length,
    toolsDone: {},
    permissionActionable: !!messagesEl.querySelector('[data-request-id="perm-1"] button:not(:disabled)'),
    savedToolText: messagesEl.textContent.indexOf('Saved file contents') !== -1,
    errors: window.fixtureErrors.slice(),
  };
  Object.keys(tools).forEach(function (id) { result.toolsDone[id] = !!tools[id].done; });
  socket.onmessage({ data: JSON.stringify({ type: 'delta', text: ' LIVE CONTINUATION' }) });
  await frame();
  var after = store.get('currentMsgEl');
  result.liveSameBubble = !!(current && after === current);
  result.liveVisible = messagesEl.textContent.indexOf('LIVE CONTINUATION') !== -1;
  result.assistantBubblesAfterLive = messagesEl.querySelectorAll('.msg-assistant').length;
  return result;
};

window.fixtureReady = true;
