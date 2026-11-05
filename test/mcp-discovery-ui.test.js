var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var vm = require('vm');
function fixture() {
  var state = { mcpConnections: { screen: 'discovery', servers: [], sourceDraft: { vendor: 'copilot', file: '/draft/mcp.json' }, discovery: { scanId: 'old', candidates: [] } }, connected: true };
  var timers = [], listeners = [], sent = [], ws = { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } };
  var source = fs.readFileSync(require.resolve('../lib/public/modules/mcp-ui.js'), 'utf8').replace(/^import .*$/gm, '').replace(/^export \{.*$/gm, '').replace(/export function /g, 'function ');
  var box = { crypto: { randomUUID: function () { return String(sent.length + 1); } }, document: { getElementById: function () { return null; } }, ensureMcpSkillsWorkbench: function () {}, getWs: function () { return ws; },
    store: { get: function (key) { return state[key]; }, set: function (patch) { var previous = Object.assign({}, state); Object.assign(state, patch); listeners.forEach(function (handler) { handler(state, previous); }); }, subscribe: function (handler) { listeners.push(handler); } },
    setTimeout: function (callback, delay) { timers.push({ callback: callback, delay: delay, cleared: false }); return timers.length; }, clearTimeout: function (id) { timers[id - 1].cleared = true; } };
  vm.runInNewContext(source + '\nthis.api={discover:discover,action:action,result:handleMcpConnectionMessage,init:initMcp,navigate:navigate};', box);
  return { api: box.api, state: state, timers: timers, ws: ws, box: box, sent: sent };
}
test('scan timeout retains drafts/results, permits retry and ignores late answers', function () {
  var f = fixture(); f.api.discover(); var request = f.sent[0].requestId;
  assert.equal(f.timers[0].delay, 30000); f.timers[0].callback(); assert.equal(f.state.mcpConnections.pending, null);
  assert.equal(f.state.mcpConnections.sourceDraft.file, '/draft/mcp.json'); assert.equal(f.state.mcpConnections.discovery.scanId, 'old'); assert.match(f.state.mcpConnections.error, /scan did not respond/);
  f.api.discover(); f.api.result({ type: 'mcp_discovery_result', requestId: request, ok: true, scanId: 'late' }); assert.equal(f.state.mcpConnections.discovery.scanId, 'old');
  f.api.result({ type: 'mcp_discovery_result', requestId: f.sent[1].requestId, ok: false, error: 'Unreadable' }); assert.equal(f.state.mcpConnections.discovery.scanId, 'old'); assert.equal(f.state.mcpConnections.pending, null); assert.equal(f.timers[1].cleared, true);
});
test('scan send failure, socket disconnect and recovery clear pending without erasing draft', function () {
  var f = fixture(); f.ws.send = function () { throw new Error('closed'); }; f.api.discover(); assert.equal(f.state.mcpConnections.pending, null); assert.equal(f.timers[0].cleared, true);
  f = fixture(); f.api.init(); f.api.discover(); f.box.store.set({ connected: false }); assert.equal(f.state.mcpConnections.pending, null); assert.equal(f.state.mcpConnections.sourceDraft.vendor, 'copilot');
  f.box.store.set({ connected: true }); assert.equal(f.sent[f.sent.length - 1].type, 'mcp_state_request'); f.api.discover(); assert.ok(f.state.mcpConnections.pending);
});
test('Xcode cancellation preempts pending setup and ignores its late success receipt', function () {
  var f = fixture(); f.api.action('xcode_connect'); var connectingId = f.sent[0].requestId;
  f.api.action('xcode_disconnect'); assert.equal(f.sent[1].action, 'xcode_disconnect'); assert.equal(f.timers[0].cleared, true);
  var cancelId = f.sent[1].requestId;
  f.api.result({ type: 'mcp_action_result', action: 'xcode_connect', requestId: connectingId, ok: true });
  assert.equal(f.state.mcpConnections.pending.requestId, cancelId); assert.equal(f.state.mcpConnections.notice, '');
  f.api.result({ type: 'mcp_action_result', action: 'xcode_disconnect', requestId: cancelId, ok: true });
  assert.equal(f.state.mcpConnections.pending, null); assert.match(f.state.mcpConnections.notice, /disabled/);
});
test('Xcode preset checks setup on entry and clears stale state when the project changes', function () {
  var f = fixture(); f.api.init();
  f.api.navigate('xcode');
  assert.equal(f.sent[0].type, 'mcp_state_request'); assert.equal(f.sent[1].action, 'xcode_check');
  var requestId = f.sent[1].requestId;
  f.box.store.set({ currentSlug: 'other-project' });
  f.api.result({ type: 'mcp_action_result', action: 'xcode_check', requestId: requestId, ok: false, error: 'late' });
  assert.equal(f.state.mcpConnections.pending, undefined); assert.equal(f.state.mcpConnections.error, undefined);
});
