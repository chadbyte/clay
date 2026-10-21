var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
// Entire production connection module in an isolated VM. Every storage/provider
// dependency is fenced before evaluation; no sockets/listeners/SDKs are started.
function connection(options) {
  options = options || {};
  var sent = [], events = {}, saves = 0;
  var active = { localId: 1, sessionOriginId: 'origin', ownerId: 'owner', mode: options.mode || 'gui', history: [], pendingPermissions: {} };
  var sessions = [active, { localId: 2, ownerId: 'foreign' }, { localId: 3, ownerId: 'owner', hidden: true }];
  var permission = { requestedPermissionMode: 'ask', effectivePermissionMode: 'ask', permissionCapabilities: {}, mcpPermissionModeOverrides: {} };
  var dependencies = {
    fs: {}, path: path,
    './users': { isMultiUser: function () { return true; }, canAccessSession: function (id, session) { return id === session.ownerId; } },
    './user-presence': { getPresence: function () { return null; }, setPresence: function () {}, sessionIdForPersistence: function () { return 'origin'; } },
    './email-accounts': { listAccounts: function () { return [{ id: 'mail' }]; }, PROVIDER_PRESETS: ['mail'] },
    './yoke/settings': { messages: function () { return [{ type: 'provider_config', enabled: true }]; } },
    './yoke': { clampEffort: function () { return 'medium'; } },
    './session-permission-mode': { clientState: function () { return permission; } },
    './session-provenance': { isWorker: function () { return false; } },
    './clay-control-target-projection': { runtime: function () { return 'runtime'; }, digest: function () { return 'digest'; } },
    './yoke/vendor-registry': { publicInfo: function () { return {}; } },
    './yoke/usage': { context: function () { return null; } },
  };
  var context = vm.createContext({ console: console, module: { exports: {} }, require: function (name) {
    assert.ok(Object.prototype.hasOwnProperty.call(dependencies, name), 'Unfenced dependency ' + name); return dependencies[name];
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/project-connection.js'), 'utf8'), context);
  var ws = { readyState: 1, _clayPane: options.pane !== false, _clayContextual: !!options.contextual, _clayPaneSession: options.target || 1,
    on: function (event, fn) { events[event] = fn; } };
  function send(socket, message) { if (socket.readyState === 1) sent.push(JSON.parse(JSON.stringify(message))); }
  function service(type) { return { sendConnectionState: function (socket) { send(socket, { type: type, payload: 'same' }); } }; }
  var ctx = { cwd: '/project', slug: 'test', isMate: !!options.mate, opts: {}, clients: new Set(),
    sm: { sessions: new Map(sessions.map(function (session) { return [session.localId, session]; })), defaultVendor: 'claude', availableModels: [],
      mapSessionsForClient: function (list, unused, ignored, viewer) { assert.equal(viewer, 'owner'); return list.map(function (session) { return { id: session.localId, origin: session.sessionOriginId }; }); },
      saveSessionFile: function () { saves++; } },
    tm: { list: function () { return [{ id: 'terminal' }]; } }, nm: { list: function () { return [{ id: 'note' }]; } },
    _loop: Object.assign(service('loop_state'), { loopState: {} }), _mcp: service('mcp_state'), _notifications: service('notifications'),
    _splitGroups: service('split_groups'), _splitViews: service('project_split_views'),
    _projectLogs: { sendScheduledResultState: function (socket) { send(socket, { type: 'scheduled_result' }); } },
    sendTo: send, sendSessionFoldersState: function (socket) { send(socket, { type: 'folders' }); },
    broadcastClientCount: function () {}, broadcastPresence: function () {}, restoreDebateState: function () {},
    getProjectOwnerId: function () { return 'owner'; }, getProjectList: function () { return []; }, getTitle: function () { return 'Project'; },
    getProject: function () { return 'test'; }, getHubSchedules: function () { return []; }, loadContextSources: function () { return []; } };
  var api = context.module.exports.attachConnection(ctx);
  api.handleConnection(ws, { id: 'owner' }, function (socket, msg) { send(socket, msg); }, function () {});
  return { sent: sent, events: events, ws: ws, saves: saves };
}
test('ordinary GUI pane sends authoritative identity first with identical complete initial state', function () {
  var pane = connection(), legacy = connection({ target: 99 });
  var types = pane.sent.map(function (msg) { return msg.type; });
  assert.ok(types.indexOf('config_state') < types.indexOf('session_list'));
  assert.ok(types.indexOf('split_groups') < types.indexOf('provider_config'));
  assert.deepEqual(pane.sent.find(function (msg) { return msg.type === 'session_list'; }).sessions, [{ id: 1, origin: 'origin' }]);
  function byType(a, b) { return a.type.localeCompare(b.type); }
  assert.deepEqual(pane.sent.slice().sort(byType), legacy.sent.slice().sort(byType));
  assert.equal(types.filter(function (type) { return type === 'session_list'; }).length, 1);
  ['permission_request_pending', 'stop', 'attachment_state'].forEach(function (type) { pane.events.message(JSON.stringify({ type: type, id: 1 })); assert.equal(pane.sent.at(-1).type, type); });
  var count = pane.sent.length; pane.ws.readyState = 3; pane.events.message('{"type":"stop"}'); assert.equal(pane.sent.length, count);
});
test('parent, contextual, Mate and legacy TUI keep their original connection order', function () {
  [{ pane: false }, { contextual: true }, { mate: true }, { mode: 'tui' }].forEach(function (options) {
    var sent = connection(options).sent.map(function (msg) { return msg.type; });
    assert.ok(sent.indexOf('provider_config') < sent.indexOf('session_list'));
    assert.ok(sent.indexOf('session_list') < sent.indexOf('split_groups'));
  });
});
function sidebar(state, search) {
  var count = 0, paints = 0;
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/mate-sidebar.js'), 'utf8');
  source = source.slice(source.indexOf('export function renderMateSessionList('), source.indexOf('\nfunction renderDebateGroup(')).replace('export ', '');
  var context = vm.createContext({ cachedSessions: [], listEl: { appendChild: function () { count++; } }, searchMatchIds: null,
    store: { get: function (key) { return state[key]; } }, window: { frameElement: { clayPane: {} } }, location: { search: search || '' }, URLSearchParams: URLSearchParams,
    renderMateSessionItem: function () { return {}; }, refreshIcons: function () { paints++; } });
  vm.runInContext(source, context);
  return { context: context, count: function () { return count; }, paints: function () { return paints; } };
}
test('ordinary pane keeps the exact Mate cache while avoiding all hidden row construction', function () {
  var rows = Array.from({ length: 3000 }, function (_, i) { return { id: i, lastActivity: i }; });
  var state = { paneMode: true }, pane = sidebar(state);
  pane.context.renderMateSessionList(rows); assert.equal(pane.context.cachedSessions, rows); assert.equal(pane.count(), 0); assert.equal(pane.paints(), 0);
  state.paneMode = false; pane.context.renderMateSessionList(null); assert.equal(pane.count(), 3000); assert.equal(pane.paints(), 1);
  [{ paneMode: false }, { paneMode: true, activeProjectMateId: 'mate' }, { paneMode: true, dmMode: true }, { paneMode: true, paneActivationUnsupported: true }].forEach(function (value) {
    var f = sidebar(value); f.context.renderMateSessionList(rows); assert.equal(f.count(), 3000);
  });
  var contextual = sidebar({ paneMode: true }, '?contextual=1'); contextual.context.renderMateSessionList(rows); assert.equal(contextual.count(), 3000);
});
test('fixture timer preserves callback identity, delivery and exceptions and caps payload-free records', function () {
  function Socket() {}
  Object.defineProperty(Socket.prototype, 'onmessage', { configurable: true, get: function () { return this.callback; }, set: function (fn) { this.callback = fn; } });
  var clock = 0, context = vm.createContext({ WebSocket: Socket, WeakMap: WeakMap, window: {}, performance: { now: function () { return clock++; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/pane-message-timing.js'), 'utf8'), context);
  var socket = new Socket(), received = [];
  function callback(event) { assert.equal(this, socket); received.push(event); }
  socket.onmessage = callback; assert.equal(socket.onmessage, callback);
  for (var i = 0; i < 300; i++) socket.callback({ data: '{"type":"session_list","private":"secret"}' });
  assert.equal(received.length, 300); assert.equal(context.window.__paneFixtureMessageTiming.length, 256);
  assert.equal(context.window.__paneFixtureMessageTimingOverflow, true); assert.ok(!JSON.stringify(context.window.__paneFixtureMessageTiming).includes('secret'));
  socket.onmessage = function () { throw new Error('handler failed'); }; assert.throws(function () { socket.callback({ data: '{}' }); }, /handler failed/);
  socket.onmessage = null; assert.equal(socket.callback, null);
});
