// Real app/HTTP authentication/WS/project services, with isolated storage and
// provider transports fenced before any product imports. No fixture Git commits.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-split-view-app-'));
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
var yoke = require('../../lib/yoke');
yoke.createAdapters = function () {
  var adapters = {};
  ['claude', 'codex'].forEach(function (vendor) {
    adapters[vendor] = { vendor: vendor,
      init: async function () { return { models: [{ value: 'fixture', displayName: 'Fixture' }], slashCommands: [], capabilities: {} }; },
      createToolServer: function (value) { return value; }, shutdown: function () {},
      createQuery: function () { throw new Error('Provider execution is forbidden'); } };
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
var paneActivationLog = [], paneActivationModule = require('../../lib/pane-session-activation'), originalPaneActivationBegin = paneActivationModule.begin;
paneActivationModule.begin = function (ctx, ws, msg) {
  var startedAt = performance.now();
  var result = originalPaneActivationBegin(ctx, ws, msg);
  if (msg && Object.prototype.hasOwnProperty.call(msg, 'paneActivation')) {
    if (paneActivationLog.length >= 100) paneActivationLog.shift();
    var receipt = { id: msg.id, startedAt: startedAt, historyEntries: 0, historyText: 0,
    requestId: msg.paneActivation && msg.paneActivation.requestId, generation: msg.paneActivation && msg.paneActivation.generation,
    origin: msg.paneActivation && msg.paneActivation.sessionOriginId, result: result === false ? 'rejected' : result ? 'accepted' : 'legacy',
    paneSocket: ws._clayPane === true, viewerId: ws._clayUser && ws._clayUser.id || null,
    activeIdBeforeSwitch: ws._clayActiveSession || null, groupStamp: msg.paneActivation && msg.paneActivation.groupStamp };
    paneActivationLog.push(receipt);
    if (result && result.send) {
      var history = result.send.history, finish = result.finish;
      result.send.history = function (message) {
        if (message._historyIndex != null) receipt.historyEntries++;
        receipt.historyText += typeof message.text === 'string' ? message.text.length : 0;
        return history(message);
      };
      result.finish = function () {
        var value = finish(); receipt.snapshotMs = performance.now() - startedAt;
        return value;
      };
    }
  }
  return result;
};
var splitStore, splitModule = require('../../lib/session-split-groups'), attachSplit = splitModule.attachSplitGroups;
splitModule.attachSplitGroups = function (ctx) { var attached = attachSplit(ctx); splitStore = attached.store; return attached; };
var relay = require('../../lib/server').createServer({ port: 0, onGetProjectAccess: function () { return access; } });
var cwd = path.join(root, 'reuse'); fs.mkdirSync(cwd);
relay.addProject(cwd, 'reuse', 'Pane reuse fixture', null, 'owner', null, { projectKnowledgeId: 'pane-reuse-fixture' });
var project;
relay.forEachProject(function (value, slug) { if (slug === 'reuse') project = value; });
var sm = project.getSessionManager(), sessions = [], groups = [], stopped = [], reviews = [], dialogs = [];
var provenance = require('../../lib/session-provenance');
var benchmark = process.env.CLAY_PANE_BENCH === 'long-turn' ? 'long-turn' : 'normal';
var pairCount = 2;
var historySize = benchmark === 'long-turn' ? 2173 : 24;
function create(title, vendor) {
  var session = sm.createSessionRaw({ ownerId: 'owner', vendor: vendor || 'codex', model: 'fixture', effort: 'medium' });
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
var archivedDriver = sessions.find(function (session) { return session.title === 'Driver 0'; });
var archivedWorker = sessions.find(function (session) { return session.title === 'Worker 0'; });
var currentWorker = create('Implementation');
provenance.markWorker(archivedDriver, currentWorker, sm.sessions); sm.saveSessionFile(currentWorker);
currentWorker.isProcessing = true;
currentWorker.abortController = new AbortController();
currentWorker.history = [];
for (var generationEntry = 0; generationEntry < 185; generationEntry++) {
  currentWorker.history.push({ type: 'user_message', text: generationEntry === 0 ? 'Current generation request 0' : 'Current generation request ' + generationEntry });
  currentWorker.history.push({ type: 'delta', text: generationEntry === 184 ? 'Current worker response\n\n**Readable emphasis**\n\n- First item\n- Second item\n\n```js\nvar answer = 42;\n```\n\n<img src=x onerror=alert(1)><input value=unsafe><div style=position:fixed>Recorded HTML</div>' : 'Current worker response ' + generationEntry });
}
currentWorker.history[360] = { type: 'tool_start', id: 'read-current', name: 'Read' };
currentWorker.history[361] = { type: 'tool_result', id: 'read-current', content: '<script>unsafe()</script>\nRecorded tool output', is_error: true };
currentWorker.history[359] = { type: 'tool_start', id: 'command-current', name: 'Bash' };
currentWorker.history[362] = { type: 'tool_result', id: 'command-current', content: 'Command output' };
currentWorker.history[363] = { type: 'tool_result', id: 'orphan-current', content: 'Orphan output' };
currentWorker.history[240] = { type: 'tool_start', id: 'late-current', name: 'Grep' };
currentWorker.history[364] = { type: 'tool_result', id: 'late-current', content: 'Late-page search output' };
sm.saveSessionFile(currentWorker);
archivedWorker.isProcessing = true;
archivedWorker.abortController = new AbortController();
archivedWorker.history = [];
sm.saveSessionFile(archivedWorker);
var multiWorkerGate = require('../../lib/multi-worker-feature').fromServerConfig({ multiWorkerRuntimeEnabled: true });
var extendedPair = splitStore.addWorker('owner', { groupId: groups[0].id, driverId: archivedDriver.localId,
  driverOriginId: archivedDriver.sessionOriginId, newWorkerId: currentWorker.localId, newWorkerOriginId: currentWorker.sessionOriginId }, multiWorkerGate);
if (!extendedPair.ok) throw new Error(JSON.stringify(extendedPair));
groups[0].pair = extendedPair.group.pair;
groups[0].members = extendedPair.group.members;
var oldWorker = create('Archived Implementation');
provenance.markWorker(archivedDriver, oldWorker, sm.sessions); sm.saveSessionFile(oldWorker);
oldWorker.history = [{ type: 'user_message', text: 'Archived generation request' }, { type: 'delta', text: 'Archived worker response\n\n**Readable emphasis**\n\n- First item\n- Second item\n\n```js\nvar answer = 42;\n```\n\n<img src=x onerror=alert(1)><input value=unsafe><div style=position:fixed>Recorded HTML</div>' }, { type: 'tool_start', name: 'Read' }, { type: 'tool_result', content: 'Archived tool output' }];
var archivedLatest = oldWorker.history;
oldWorker.history = [];
for (var archivedEntry = 0; archivedEntry < 145; archivedEntry++) {
  oldWorker.history.push({ type: 'user_message', text: 'Archived generation request ' + archivedEntry });
  oldWorker.history.push({ type: 'delta', text: 'Archived worker response ' + archivedEntry });
}
oldWorker.history = oldWorker.history.concat(archivedLatest);
oldWorker.history[160] = { type: 'tool_start', id: 'late-archive', name: 'Grep' };
oldWorker.history[292].id = 'read-archive'; oldWorker.history[293].id = 'read-archive';
oldWorker.history.push({ type: 'tool_start', id: 'parallel-archive', name: 'Bash' },
  { type: 'tool_start', id: 'parallel-read', name: 'Read' },
  { type: 'tool_result', id: 'parallel-archive', content: 'Command failed', is_error: true },
  { type: 'tool_result', id: 'parallel-read', content: 'Read returned' },
  { type: 'tool_result', id: 'orphan-archive', content: 'Orphan output' },
  { type: 'tool_result', id: 'late-archive', content: 'Late-page search output' });
sm.saveSessionFile(oldWorker);
var sourceWithoutWorker = create('Unpaired sample');
var standalone = create('Standalone 0');
var otherStandalone = Array.from({ length: 8 }, function (_value, index) { return create('Standalone ' + (index + 1), index % 2 === 0 ? 'claude' : 'codex'); });
// Dedicated, disjoint cohorts keep preparation independent of regression layouts.
[1, 4, 8].forEach(function (count) { for (var index = 0; index < count; index++) create('Benchmark ' + count + ' pane ' + index, index % 2 ? 'claude' : 'codex'); });
var failNextPresentationWrite = false;
var refreshReceipt = null;
var originalRenameSync = fs.renameSync;
fs.renameSync = function (source, destination) {
  if (failNextPresentationWrite && /presentation-split-views\.json$/.test(String(destination))) {
    failNextPresentationWrite = false;
    var error = new Error('Fixture injected Split view persistence failure'); error.code = 'EIO'; throw error;
  }
  return originalRenameSync.apply(fs, arguments);
};
var canonicalViews = require('./split-view-canonical-controls.cjs').attach(relay);
var original = relay.server.listeners('request'); relay.server.removeAllListeners('request');
relay.server.on('request', function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture/login') {
    var loginToken = url.searchParams.get('account') === 'replacement' ? 'pane-replacement-token' : 'pane-fixture-token';
    res.writeHead(302, { 'Set-Cookie': 'relay_auth_user=' + loginToken + '; Path=/; HttpOnly; SameSite=Strict', Location: '/p/reuse/?split_view_fixture=1' }); res.end(); return;
  }
  if (url.pathname.indexOf('/fixture/') !== 0) {
    if (url.pathname === '/p/reuse/' && req.headers.cookie) {
      var end = res.end;
      res.end = function (body) {
        if (typeof body === 'string' && body.indexOf('<head>') >= 0) body = body.replace('<head>', '<head><script>' + fs.readFileSync(path.join(__dirname, 'pane-startup-diagnostics.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'pane-message-timing.js'), 'utf8') + '</script>');
        if (typeof body === 'string' && url.searchParams.get('pane_open_benchmark') === '1') body = body.replace('</body>', '<script type="module" src="/fixture/pane-open-benchmark-browser.js"></script></body>');
        if (typeof body === 'string' && url.searchParams.get('split_view_fixture') === '1' && body.indexOf('</body>') >= 0) body = body.replace('</body>', '<script type="module" src="/fixture/split-view-browser.js?v=singleton-pane-v28"></script><script type="module" src="/fixture/split-view-refresh-browser.js"></script><script type="module" src="/fixture/split-view-workbench-browser.js"></script><script type="module" src="/fixture/split-view-organization-browser.js"></script><script type="module" src="/fixture/split-view-geometry-browser.js"></script><script type="module" src="/fixture/split-view-canonical-browser.js"></script></body>');
        return end.call(res, body);
      };
    }
    original.forEach(function (handler) { handler(req, res); }); return;
  }
  if (!String(req.headers.cookie || '').includes('relay_auth_user=pane-fixture-token')) { res.writeHead(403); res.end(); return; }
  if (canonicalViews.handle(req, res, url)) return;
  if (url.pathname === '/fixture/pane-context-reuse-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'pane-context-reuse-browser.js'))); return; }
  if (url.pathname === '/fixture/pane-benchmark-cohorts.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'pane-benchmark-cohorts.js'))); return; }
  if (url.pathname === '/fixture/pane-open-benchmark-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'pane-open-benchmark-browser.js'))); return; }
  if (url.pathname === '/fixture/split-view-geometry-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'split-view-geometry-browser.js'))); return; }
  if (url.pathname === '/fixture/split-view-organization-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'split-view-organization-browser.js'))); return; }
  if (url.pathname === '/fixture/split-view-workbench-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'split-view-workbench-browser.js'))); return; }
  if (url.pathname === '/fixture/split-view-refresh-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'split-view-refresh-browser.js'))); return; }
  if (url.pathname === '/fixture/refresh-receipt') {
    if (req.method === 'POST') {
      var receiptBody = '';
      req.on('data', function (chunk) { receiptBody += chunk; if (receiptBody.length > 16384) req.destroy(); });
      req.on('end', function () { try { refreshReceipt = JSON.parse(receiptBody); res.end('saved'); } catch (error) { res.writeHead(400); res.end(); } });
    } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(refreshReceipt)); }
    return;
  }
  if (url.pathname === '/fixture/split-view-startup-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'split-view-startup-browser.js'))); return; }
  if (url.pathname === '/fixture/split-view-worker-paging-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'split-view-worker-paging-browser.js'))); return; }
  if (url.pathname === '/fixture/split-view-browser.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'split-view-production-browser.js'))); return; }
  if (url.pathname === '/fixture/activation-log') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(paneActivationLog)); return; }
  if (url.pathname === '/fixture/fail-next-write' && req.method === 'POST') { failNextPresentationWrite = true; res.end('armed'); return; }
  if (url.pathname === '/fixture/running' && req.method === 'POST') {
    var running = sm.sessions.get(Number(url.searchParams.get('id')));
    if (!running) { res.writeHead(404); res.end(); return; }
    running.isProcessing = true; running.abortController = new AbortController();
    running.abortController.signal.addEventListener('abort', function () { stopped.push(running.localId); running.isProcessing = false; });
    sm.sendToSession(running, { type: 'status', status: 'processing' });
  }
  if (url.pathname === '/fixture/review' && req.method === 'POST') {
    var reviewed = sm.sessions.get(Number(url.searchParams.get('id'))), reviewId = 'review-' + reviewed.localId;
    reviewed.pendingPermissions[reviewId] = { requestId: reviewId, toolName: 'Read', toolInput: { path: 'fixture.txt' }, resolve: function (decision) { reviews.push({ sessionId: reviewed.localId, decision: decision }); } };
    sm.permissionRequestIndex[reviewId] = reviewed.localId;
    sm.sendToSession(reviewed, { type: 'permission_request', requestId: reviewId, toolName: 'Read', toolInput: { path: 'fixture.txt' }, vendor: reviewed.vendor });
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
  if (url.pathname === '/fixture/history' && req.method === 'POST') {
    var target = sm.sessions.get(Number(url.searchParams.get('id')));
    if (!target || target.ownerId !== 'owner') { res.writeHead(404); res.end(); return; }
    sm.sendAndRecord(target, { type: 'user_message', text: 'Fresh fixture question ' + target.history.length });
    sm.sendAndRecord(target, { type: 'delta', text: 'UNSEEN_' + target.localId + '_' + target.history.length });
    sm.sendAndRecord(target, { type: 'done' });
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ benchmark: benchmark, historySize: historySize, groups: groups, sessions: sm.mapSessionsForClient(sessions, null, {}, 'owner'), standaloneId: standalone.localId, otherIds: otherStandalone.map(function (session) { return session.localId; }), stopped: stopped, reviews: reviews, dialogs: dialogs }));
});
async function stop() { await relay.destroyAll(); relay.server.close(); fs.rmSync(root, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
relay.server.listen(Number(process.argv[2]) || 0, '127.0.0.1', function () {
  var info = { port: relay.server.address().port, root: root };
  console.log(JSON.stringify(info)); if (process.send) process.send(info);
});
