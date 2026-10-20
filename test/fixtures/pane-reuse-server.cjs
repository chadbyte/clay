// Real app/HTTP authentication/WS/project services, with isolated storage and
// provider transports fenced before any product imports. No fixture Git commits.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-pane-reuse-app-'));
os.homedir = function () { return root; };
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CLAY_CONFIG = path.join(root, '.clay/daemon.json');
process.env.CODEX_HOME = path.join(root, '.codex');
process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
process.env.CLAY_DEV = '';
fs.mkdirSync(process.env.CLAY_HOME, { recursive: true });
['execFile', 'execFileSync', 'spawn', 'spawnSync'].forEach(function (name) {
  var original = cp[name];
  cp[name] = function (command, args) {
    if (/^(claude|codex|copilot|opencode)$/.test(path.basename(String(command)))) throw new Error('Provider execution is forbidden in this fixture');
    if (command === 'git' && (args || []).some(function (arg) { return ['commit', 'commit-tree', 'push', 'fetch', 'pull'].indexOf(arg) >= 0; })) throw new Error('Fixture commits and remote Git are forbidden');
    return original.apply(cp, arguments);
  };
});
// Opt-in in-process transport: a turn stays open until the fixture emits output.
// It never contacts a provider, process or network.
var syntheticHandles = [];
function syntheticQuery(options) {
  var waiting = null, ended = false, queue = [];
  function emit(event) { if (ended) return; if (waiting) { var resolve = waiting; waiting = null; resolve({ value: event, done: false }); } else queue.push(event); }
  function finish() { ended = true; if (waiting) { waiting({ done: true }); waiting = null; } }
  options.abortController.signal.addEventListener('abort', finish);
  var handle = { emit: emit,
    pushMessage: function () { if (ended) return false; emit({ yokeType: 'init', sessionId: 'fixture-synthetic-' + syntheticHandles.length }); return true; },
    abort: finish, close: function () {}, stopAndWait: function () { finish(); return Promise.resolve(); }, confirmStop: finish,
    [Symbol.asyncIterator]: function () { return { next: function () {
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
      if (ended) return Promise.resolve({ done: true });
      return new Promise(function (resolve) { waiting = resolve; });
    } }; } };
  syntheticHandles.push(handle);
  return Promise.resolve(handle);
}
var yoke = require('../../lib/yoke');
yoke.createAdapters = function () {
  var adapters = {};
  ['claude', 'codex'].forEach(function (vendor) {
    adapters[vendor] = { vendor: vendor,
      init: async function () { return { models: [{ value: 'fixture', displayName: 'Fixture' }], slashCommands: [], capabilities: {} }; },
      createToolServer: function (value) { return value; }, shutdown: function () {},
      createQuery: process.env.CLAY_FIXTURE_SYNTHETIC_TURN === '1' ? syntheticQuery : function () { throw new Error('Provider execution is forbidden'); } };
  });
  return { adapters: adapters, auth: { claude: true, codex: true } };
};
yoke.completeOnce = function () { return Promise.reject(new Error('Live completion forbidden')); };
require('../../lib/updater').fetchVersion = function () { return Promise.resolve(null); };
require('../../lib/updater').fetchLatestVersion = function () { return Promise.resolve(null); };
require('../../lib/claude-hook-installer').installNotificationHook = function () { return { installed: [], errors: [] }; };
require('../../lib/claude-hook-installer').installAllowList = function () { return { installed: [], errors: [] }; };
var users = require('../../lib/users');
users.saveUsers({ multiUser: true, users: [{ id: 'owner', username: 'pane-owner', role: 'admin', pinHash: 'fixture-only' },
  { id: 'replacement-owner', username: 'replacement-owner', role: 'member', pinHash: 'fixture-only' }], invites: [] });
fs.writeFileSync(path.join(process.env.CLAY_HOME, 'auth-tokens.json'), JSON.stringify({ 'pane-fixture-token': 'owner', 'pane-replacement-token': 'replacement-owner' }));
var access = { slug: 'reuse', ownerId: 'owner', visibility: 'private', allowedUsers: [] };
var splitStore, splitModule = require('../../lib/session-split-groups'), attachSplit = splitModule.attachSplitGroups;
splitModule.attachSplitGroups = function (ctx) { var attached = attachSplit(ctx); splitStore = attached.store; return attached; };
var viewStore, viewModule = require('../../lib/project-split-views'), attachViews = viewModule.attachProjectSplitViews;
viewModule.attachProjectSplitViews = function (ctx) { var attached = attachViews(ctx); viewStore = attached.store; return attached; };
var relay = require('../../lib/server').createServer({ port: 0, onGetProjectAccess: function () { return access; } });
var cwd = path.join(root, 'reuse'); fs.mkdirSync(cwd);
relay.addProject(cwd, 'reuse', 'Pane reuse fixture', null, 'owner', null, { projectKnowledgeId: 'pane-reuse-fixture' });
var project;
relay.forEachProject(function (value, slug) { if (slug === 'reuse') project = value; });
var sm = project.getSessionManager(), sessions = [], groups = [], stopped = [], reviews = [], dialogs = [];
var provenance = require('../../lib/session-provenance');
var benchmark = process.env.CLAY_PANE_BENCH === 'long-turn' ? 'long-turn' : 'normal';
var pairCount = process.env.CLAY_PANE_BENCH ? 33 : 3;
var historySize = benchmark === 'long-turn' ? 2173 : 650;
function create(title) {
  var session = sm.createSessionRaw({ ownerId: 'owner', vendor: 'codex', model: 'fixture', effort: 'medium' });
  session.title = title;
  session.history = Array.from({ length: historySize }, function (_, index) {
    return { type: (benchmark === 'long-turn' ? index === 0 : index % 5 === 0) ? 'user_message' : 'delta', text: 'Saved ' + title + ' entry ' + index + '. ' };
  });
  session.history.push({ type: 'delta', text: 'EXACT_TRANSCRIPT_' + session.localId }, { type: 'done' });
  sm.saveSessionFile(session); sessions.push(session); return session;
}
for (var i = 0; i < pairCount; i++) {
  var driver = create('Driver ' + i), worker = create('Worker ' + i);
  provenance.markWorker(driver, worker, sm.sessions);
  sm.saveSessionFile(worker);
  var result = splitStore.createOwned('owner', { members: [driver.localId, worker.localId], pair: { driverId: driver.localId, workerId: worker.localId } });
  if (!result.ok) throw new Error(JSON.stringify(result));
  groups.push(result.group);
}
var benchmarkViews = [];
if (process.env.CLAY_PANE_BENCH) {
  groups.forEach(function (group, index) {
    var driver = sm.sessions.get(group.pair.driverId), companion = create('Companion ' + index);
    var origins = [driver.sessionOriginId, companion.sessionOriginId];
    var result = viewStore.create('owner', null, { name: 'Benchmark view ' + index, layout: 'columns', expectedRevision: viewStore.state('owner', null).revision,
      sessionOrigins: origins, activeSessionOriginId: driver.sessionOriginId,
      tree: require('../../lib/split-view-layout').createPreset(origins, 'columns') },
      origins.map(function (origin) { return { originId: origin, ownerId: 'owner', linuxUser: null }; }));
    if (!result.ok) throw new Error(JSON.stringify(result));
    benchmarkViews.push({ id: result.view.id, members: [driver.localId, companion.localId],
      origins: origins, titles: [driver.title, companion.title], workerId: group.pair.workerId,
      workerOrigin: sm.sessions.get(group.pair.workerId).sessionOriginId });
  });
}
var standalone = create('Standalone');
var otherStandalone = [create('Other standalone'), create('Final standalone')];
var restoreView = null;
if (process.env.CLAY_PANE_PRESENTATION === '1') {
  var restoreDriver = sm.sessions.get(groups[0].pair.driverId), companion = create('Restore companion');
  var origins = [restoreDriver.sessionOriginId, companion.sessionOriginId];
  var restored = viewStore.create('owner', null, { name: 'Restore view', layout: 'columns', expectedRevision: 0,
    sessionOrigins: origins, activeSessionOriginId: restoreDriver.sessionOriginId,
    tree: require('../../lib/split-view-layout').createPreset(origins, 'columns') },
    origins.map(function (origin) { return { originId: origin, ownerId: 'owner', linuxUser: null }; }));
  if (!restored.ok) throw new Error(JSON.stringify(restored));
  restoreView = { id: restored.view.id, members: [restoreDriver.localId, companion.localId], pair: { driverId: restoreDriver.localId }, workerId: groups[0].pair.workerId };
}
var original = relay.server.listeners('request'); relay.server.removeAllListeners('request');
relay.server.on('request', function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture/login') {
    var loginToken = url.searchParams.get('account') === 'replacement' ? 'pane-replacement-token' : 'pane-fixture-token';
    res.writeHead(302, { 'Set-Cookie': 'relay_auth_user=' + loginToken + '; Path=/; HttpOnly; SameSite=Strict', Location: '/p/reuse/' }); res.end(); return;
  }
  if (url.pathname.indexOf('/fixture/') !== 0) {
    if (url.pathname === '/p/reuse/' && req.headers.cookie) {
      var end = res.end;
      res.end = function (body) {
        if (typeof body === 'string' && body.indexOf('</body>') >= 0) body = body.replace('</body>', '<script type="module" src="/fixture/bench.js"></script></body>');
        return end.call(res, body);
      };
    }
    original.forEach(function (handler) { handler(req, res); }); return;
  }
  if (!String(req.headers.cookie || '').includes('relay_auth_user=pane-fixture-token')) { res.writeHead(403); res.end(); return; }
  if (url.pathname === '/fixture/bench.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'pane-reuse-bench.js'))); return; }
  if (url.pathname === '/fixture/running' && req.method === 'POST') {
    var running = sm.sessions.get(Number(url.searchParams.get('id')));
    if (!running) { res.writeHead(404); res.end(); return; }
    running.isProcessing = true; running.abortController = new AbortController();
    running.abortController.signal.addEventListener('abort', function () { stopped.push(running.localId); running.isProcessing = false; });
  }
  if (url.pathname === '/fixture/review' && req.method === 'POST') {
    var reviewed = sm.sessions.get(Number(url.searchParams.get('id'))), reviewId = 'review-' + reviewed.localId;
    reviewed.pendingPermissions[reviewId] = { requestId: reviewId, toolName: 'Read', toolInput: { path: 'fixture.txt' }, resolve: function (decision) { reviews.push({ sessionId: reviewed.localId, decision: decision }); } };
    sm.permissionRequestIndex[reviewId] = reviewed.localId;
  }
  if (url.pathname === '/fixture/switch' && req.method === 'POST') {
    var id = Number(url.searchParams.get('id'));
    project.clients.forEach(function (ws) {
      if (!ws._clayPane && ws._clayUser && ws._clayUser.id === 'owner') project.handleMessage(ws, { type: 'switch_session', id: id });
    });
  }
  if (url.pathname === '/fixture/dialog' && req.method === 'POST') {
    var dialogSession = sm.sessions.get(Number(url.searchParams.get('id'))), dialogId = 'dialog-' + dialogSession.localId;
    dialogSession.pendingUserDialogs = {};
    dialogSession.pendingUserDialogs[dialogId] = { request: { dialogKind: 'review', payload: { title: 'Exact fixture decision', message: 'Only this session may respond.' } },
      resolve: function (decision) { dialogs.push({ sessionId: dialogSession.localId, decision: decision }); } };
  }
  if (url.pathname === '/fixture/live' && req.method === 'POST') {
    // Synthetic provider output through the production recording/fan-out path.
    var liveTarget = sm.sessions.get(Number(url.searchParams.get('id')));
    if (!liveTarget || liveTarget.ownerId !== 'owner') { res.writeHead(404); res.end(); return; }
    var liveKind = url.searchParams.get('kind');
    if (liveKind === 'status') sm.sendToSession(liveTarget, { type: 'status', status: url.searchParams.get('status') || 'processing' });
    else {
      sm.sendAndRecord(liveTarget, { type: 'delta', text: url.searchParams.get('text') || 'LIVE_DELTA' });
      if (liveKind === 'turn') sm.sendAndRecord(liveTarget, { type: 'done' });
    }
  }
  if (url.pathname === '/fixture/synthetic' && req.method === 'POST') {
    syntheticHandles.forEach(function (handle) {
      if (url.searchParams.get('kind') === 'result') handle.emit({ yokeType: 'result', subtype: 'success', resultText: 'Fixture response', cost: 0, numTurns: 1 });
      else { handle.emit({ yokeType: 'text_start', blockId: 'answer' }); handle.emit({ yokeType: 'text_delta', blockId: 'answer', text: url.searchParams.get('text') || 'SYNTHETIC_OUTPUT ' }); }
    });
  }
  if (url.pathname === '/fixture/history' && req.method === 'POST') {
    var target = sm.sessions.get(Number(url.searchParams.get('id')));
    if (!target || target.ownerId !== 'owner') { res.writeHead(404); res.end(); return; }
    sm.sendAndRecord(target, { type: 'user_message', text: 'Fresh fixture question ' + target.history.length });
    sm.sendAndRecord(target, { type: 'delta', text: 'UNSEEN_' + target.localId + '_' + target.history.length });
    sm.sendAndRecord(target, { type: 'done' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ benchmark: benchmark, historySize: historySize, groups: groups, benchmarkViews: benchmarkViews, restoreView: restoreView, sessions: sm.mapSessionsForClient(sessions, null, {}, 'owner'), standaloneId: standalone.localId, otherIds: otherStandalone.map(function (session) { return session.localId; }), stopped: stopped, reviews: reviews, dialogs: dialogs }));
});
async function stop() { await relay.destroyAll(); relay.server.close(); fs.rmSync(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
relay.server.listen(Number(process.argv[2]) || 0, '127.0.0.1', function () {
  var info = { port: relay.server.address().port, root: root };
  console.log(JSON.stringify(info)); if (process.send) process.send(info);
});
