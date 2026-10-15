import '/app.js';
import { store } from '/modules/store.js';
import { processMessage } from '/modules/app-message-router.js';
import { renderMarkdown } from '/modules/markdown.js';
import { getTools } from '/modules/tools.js';
import { setIsUserScrolledUp, disarmStickyBottom } from '/modules/chat-render-runtime.js';

function pause() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
function check(value, message) { if (!value) throw new Error(message); }
var controls = document.createElement('div');
controls.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:white;color:black;max-height:35vh;overflow:auto';
controls.innerHTML = '<button id="freeze-claude">Run Claude stream</button><button id="freeze-codex">Run Codex stream</button><pre id="freeze-result">Ready</pre>';
document.body.appendChild(controls);

window.runFreezeFixture = async function (vendor) {
  var result = document.getElementById('freeze-result');
  result.textContent = 'Running synthetic ' + vendor + ' stream…';
  try {
    store.set({ currentSlug: 'fixture', activeProjectSlug: 'fixture', dmMode: false, pendingOutboundMessages: [], deliveryReceipts: {} });
    processMessage({ type: 'session_switched', id: Number(new URLSearchParams(location.search).get('session')) || 101, vendor: vendor, hasHistory: true, isProcessing: true, capabilities: {}, model: 'fixture' });
    document.getElementById('connect-overlay').classList.add('hidden');
    var messages = document.getElementById('messages');
    processMessage({ type: 'history_meta', from: 0, total: 122 });
    processMessage({ type: 'user_message', text: 'Synthetic delegated instruction. '.repeat(200) });
    for (var h = 0; h < 40; h++) {
      var id = 'read-' + h;
      processMessage({ type: 'tool_start', id: id, name: 'Read' });
      processMessage({ type: 'tool_executing', id: id, name: 'Read', input: { file_path: '/fixture/file-' + h + '.js' } });
      processMessage({ type: 'tool_result', id: id, content: 'Synthetic large tool result\n'.repeat(400) });
    }
    processMessage({ type: 'history_done' });
    await pause();
    disarmStickyBottom();
    setIsUserScrolledUp(true);
    messages.scrollTop = 0;
    processMessage({ type: 'tool_start', id: 'live-tool', name: 'Bash' });
    processMessage({ type: 'tool_executing', id: 'live-tool', name: 'Bash', input: { command: 'synthetic-check' } });
    processMessage({ type: 'tool_result', id: 'live-tool', content: 'interim', detached: true });
    check(!getTools()['live-tool'].done, 'interim result stays active');
    var initialNodes = messages.querySelectorAll('*').length;
    var expected = '';
    var thinkingUpdates = 0;
    var observer = new MutationObserver(function (records) { thinkingUpdates += records.filter(function (record) { return record.target.classList && record.target.classList.contains('thinking-label'); }).length; });
    observer.observe(messages, { subtree: true, childList: true });
    var parseCalls = 0;
    var parseMs = 0;
    var parse = marked.parse;
    marked.parse = function () { var start = performance.now(); parseCalls++; var html = parse.apply(this, arguments); parseMs += performance.now() - start; return html; };
    var maxGap = 0;
    var last = performance.now();
    var heartbeat = setInterval(function () { var now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 10);
    var started = performance.now();
    var maxBatch = 0;
    processMessage({ type: 'thinking_start' });
    // Both providers reach the same client event path. Equal payloads isolate rendering cost.
    for (var batch = 0; batch < 20; batch++) {
      var batchStart = performance.now();
      for (var i = 0; i < 50; i++) {
        var chunk = '**Inspecting section ' + (batch * 50 + i) + '**\n\nReview the synthetic implementation and preserve all behavior.\n\n';
        expected += chunk;
        processMessage({ type: 'thinking_delta', text: chunk });
      }
      maxBatch = Math.max(maxBatch, performance.now() - batchStart);
      await pause();
    }
    processMessage({ type: 'thinking_stop', duration: 20 });
    await pause();
    var elapsed = performance.now() - started;
    var collapsedNodes = messages.querySelectorAll('*').length;
    if (!window.freezeBaseline) check(messages.querySelector('.thinking-content').children.length === 0, 'collapsed reasoning creates no detail DOM');
    clearInterval(heartbeat);
    observer.disconnect();
    marked.parse = parse;
    check(store.get('thinkingState').detailsText === expected, 'complete reasoning text retained');
    check(messages.querySelectorAll('.thinking-item').length === 1, 'one thinking record');
    check(Object.keys(getTools()).length === 41, 'tool state retained');
    check(!getTools()['live-tool'].done, 'reasoning does not complete active tool');
    check(messages.scrollTop === 0, 'reading position retained');
    var header = messages.querySelector('.thinking-header');
    var expandedStart = performance.now();
    header.click();
    var expandMs = performance.now() - expandedStart;
    check(header.getAttribute('aria-expanded') === 'true', 'details expand');
    check(messages.querySelector('.thinking-content').innerHTML === renderMarkdown(expected), 'every reasoning detail rendered in order');
    if (!window.freezeBaseline) {
      check(parseCalls === 0, 'collapsed reasoning never parses Markdown');
      check(thinkingUpdates < 1000, 'view updates coalesce token bursts');
    }
    header.click();
    processMessage({ type: 'tool_result', id: 'live-tool', content: 'Complete live tool result' });
    check(getTools()['live-tool'].done, 'terminal tool result completes original card');
    processMessage({ type: 'delta', text: 'Complete assistant answer.' });
    await new Promise(function (resolve) { requestAnimationFrame(resolve); });
    check(messages.textContent.includes('Complete assistant answer.'), 'assistant continuation retained');
    var report = { vendor: vendor, pane: location.search || 'primary', elapsedMs: Math.round(elapsed), maxBatchMs: Math.round(maxBatch), maxHeartbeatGapMs: Math.round(maxGap), markdownCalls: parseCalls, markdownMs: Math.round(parseMs), reasoningChars: expected.length, thinkingUpdates: thinkingUpdates, initialNodes: initialNodes, collapsedNodes: collapsedNodes, expandMs: Math.round(expandMs), domNodes: messages.querySelectorAll('*').length, errors: window.fixtureErrors, checks: 'passed' };
    result.textContent = JSON.stringify(report, null, 2);
    await fetch('/report', { method: 'POST', body: JSON.stringify(report) });
    return report;
  } catch (error) {
    result.textContent = 'FAIL: ' + error.message;
    await fetch('/report', { method: 'POST', body: JSON.stringify({ error: error.message }) });
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (observer) observer.disconnect();
    if (parse) marked.parse = parse;
  }
};
document.getElementById('freeze-claude').onclick = function () { window.runFreezeFixture('claude'); };
document.getElementById('freeze-codex').onclick = function () { window.runFreezeFixture('codex'); };
