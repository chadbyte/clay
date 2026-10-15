// Isolated production chat/WS exercise. Only Claude transport and time are synthetic.
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-response-ui-'));
process.env.HOME = fixtureHome;
process.env.CLAY_HOME = path.join(fixtureHome, '.clay');
delete process.env.CLAY_CONFIG;
delete process.env.SUDO_USER;
var http = require('node:http');
var WebSocket = require('ws');
var createSessionManager = require('../../lib/sessions').createSessionManager;
var createSDKBridge = require('../../lib/sdk-bridge').createSDKBridge;
var attachUserMessage = require('../../lib/project-user-message').attachUserMessage;
var attachSessions = require('../../lib/project-sessions').attachSessions;
var root = path.resolve(__dirname, '../../lib/public');
var clients = new Set();
var timers = new Map();
var nextTimer = 0;
var attempts = [];
var handles = [];
var connectionCount = 0;
var holdConnections = false;
var slug = 'recovery-fixture';
var cwd = path.join(fixtureHome, 'project');
fs.mkdirSync(cwd);

function sendTo(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function send(msg) { clients.forEach(function(ws) { sendTo(ws, msg); }); }
var sm = createSessionManager({ cwd: cwd, slug: slug, send: send, sendTo: sendTo,
  sendEach: function(fn) { clients.forEach(function(ws) { fn(ws); }); } });
sm.availableVendors = ['claude'];
sm.installedVendors = ['claude'];
sm.defaultVendor = 'claude';
sm.availableModels = ['fixture-claude'];
sm.modelsByVendor = { claude: ['fixture-claude'] };
sm.capabilitiesByVendor = { claude: {} };
var session = sm.getActiveSession();
function configure(target) {
  target.vendor = 'claude'; target.model = 'fixture-claude'; target.title = 'Silent Claude recovery';
  target.pendingElicitations = {};
  sm.saveSessionFile(target);
}
configure(session);

function syntheticQuery(options) {
  var waiting;
  var ended = false;
  var holdStop = false;
  var queue = [];
  var resolveStopped;
  var stopped = new Promise(function(resolve) { resolveStopped = resolve; });
  function emit(event) {
    if (ended) return;
    if (waiting) { var resolve = waiting; waiting = null; resolve({ value: event, done: false }); }
    else queue.push(event);
  }
  function finish() {
    ended = true;
    if (waiting) { waiting({ done: true }); waiting = null; }
    resolveStopped();
  }
  function abort() { if (!holdStop) finish(); }
  options.abortController.signal.addEventListener('abort', abort);
  var handle = {
    pushMessage: function(text, images) {
      if (ended) return false;
      attempts.push({ text: text, images: images || null, sessionId: session.localId });
      emit({ yokeType: 'init', sessionId: 'fixture-claude-session-' + session.localId });
      return true;
    },
    abort: abort,
    close: function() {},
    stopAndWait: function() { holdStop = true; options.abortController.abort(); return stopped; },
    confirmStop: finish,
    reply: function() {
      emit({ yokeType: 'text_start', blockId: 'answer' });
      emit({ yokeType: 'text_delta', blockId: 'answer', text: 'Fixture Claude received your message and responded successfully.' });
      emit({ yokeType: 'result', subtype: 'success', resultText: 'Fixture response', cost: 0, numTurns: 1 });
    },
    [Symbol.asyncIterator]: function() { return { next: function() {
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
      if (ended) return Promise.resolve({ done: true });
      return new Promise(function(resolve) { waiting = resolve; });
    } }; },
  };
  handles.push(handle);
  return Promise.resolve(handle);
}
var adapter = { vendor: 'claude', createQuery: syntheticQuery, renameSession: function() { return Promise.resolve(); } };
var sdk = createSDKBridge({ cwd: cwd, slug: slug, sessionManager: sm, adapter: adapter, adapters: { claude: adapter }, send: send,
  getRuntimeEnv: function() { return { HOME: fixtureHome }; },
  getSessionSystemPrompt: function() { return 'Isolated recovery fixture. Never contact a model.'; },
  responseRecovery: {
    setTimeout: function(fn, ms) { var id = ++nextTimer; timers.set(id, { fn: fn, ms: ms }); return id; },
    clearTimeout: function(id) { timers.delete(id); },
  },
});
function sessionSend(id, msg) { var target = sm.sessions.get(id); if (target) sm.sendToSession(target, msg); }
var ctx = {
  cwd: cwd, slug: slug, sm: sm, sdk: sdk, adapter: adapter, clients: clients, opts: {},
  send: send, sendTo: sendTo, sendToSession: sessionSend,
  sendToSessionOthers: function(source, id, msg) { clients.forEach(function(ws) { if (ws !== source && ws._clayActiveSession === id) sendTo(ws, msg); }); },
  usersModule: require('../../lib/users'), matesModule: {}, nm: {}, tm: {},
  _loop: { handleLoopMessage: function() { return false; } }, browserState: { _browserTabList: {} },
  getSessionForWs: function(ws) { return sm.sessions.get(ws._clayActiveSession); },
  getLinuxUserForSession: function() { return null; }, ensureProjectAccessForSession: function() { return null; },
  getOsUserInfoForWs: function() { return null; }, hydrateImageRefs: function(msg) { return msg; },
  loadContextSources: function() { return []; }, imagesDir: fixtureHome,
  onProcessingChanged: function() {},
};
var userMessages = attachUserMessage(ctx);
var sessionMessages = attachSessions(ctx);
function state() {
  return { sessionId: session.localId, processing: session.isProcessing, attempts: attempts,
    timers: Array.from(timers.values()).map(function(timer) { return timer.ms; }),
    history: session.history, connections: connectionCount, viewers: clients.size,
    stopping: !!session._responseRecoveryStopPending, fixtureHome: fixtureHome };
}
function advance() {
  var entry = Array.from(timers.entries()).find(function(item) { return item[1].ms === 180000; });
  if (!entry) throw new Error('No unanswered-turn watchdog is armed.');
  timers.delete(entry[0]); entry[1].fn();
}
async function action(name) {
  if (name === 'advance') advance();
  else if (name === 'confirm') { if (handles.length) handles[handles.length - 1].confirmStop(); }
  else if (name === 'reply') { if (handles.length) handles[handles.length - 1].reply(); }
  else if (name === 'fresh') {
    sdk.cancelResponseRecovery(session);
    if (handles.length) handles[handles.length - 1].confirmStop();
    if (session.streamPromise) await session.streamPromise;
    session = sm.createSession({ vendor: 'claude', model: 'fixture-claude' });
    configure(session);
    clients.forEach(function(ws) { sm.switchSession(session.localId, ws); });
  } else if (name === 'disconnect' || name === 'disconnect-recover') {
    holdConnections = true;
    clients.forEach(function(ws) { ws.close(1012, 'Fixture disconnection'); });
    if (name === 'disconnect-recover') {
      advance();
      setTimeout(function() { handles[handles.length - 1].confirmStop(); }, 150);
    }
    setTimeout(function() { holdConnections = false; }, 1500);
  } else throw new Error('Unknown fixture action.');
  await new Promise(function(resolve) { setImmediate(resolve); });
}
var server = http.createServer(async function(req, res) {
  var pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/__fixture/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state())); return; }
  if (pathname.indexOf('/__fixture/action/') === 0 && req.method === 'POST') {
    try { await action(pathname.split('/').pop()); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state())); }
    catch (error) { res.writeHead(409); res.end(error.message); }
    return;
  }
  if (pathname === '/api/me') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ multiUser: false, permissions: { terminal: false } })); return; }
  if (pathname === '/api/speech/settings') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ selected: 'browser', language: 'en-US', models: [], providers: [] })); return; }
  if (pathname === '/info') { res.setHeader('Content-Type', 'application/json'); res.end('{}'); return; }
  if (pathname.indexOf('/api/') === 0) { res.writeHead(404); res.end('{}'); return; }
  if (pathname === '/' || pathname === '/p/' + slug + '/') {
    var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    html = html.replace('<head>', '<head><script>window.fixtureErrors=[];addEventListener("error",function(e){window.fixtureErrors.push(e.message)});addEventListener("unhandledrejection",function(e){window.fixtureErrors.push(String(e.reason))});</script>');
    html = html.replace(/<script type="module" src="app.js[^"]*"><\/script>/, '');
    html = html.replace('</body>', '<script type="module" src="/__fixture/client.js"></script></body>');
    res.setHeader('Content-Type', 'text/html'); res.end(html); return;
  }
  var file = pathname === '/__fixture/client.js' ? path.join(__dirname, 'response-recovery-browser.js')
    : path.resolve(root, '.' + pathname.replace(/^\/p\/recovery-fixture\//, '/'));
  if (pathname !== '/__fixture/client.js' && file.indexOf(root + path.sep) !== 0) { res.writeHead(404); res.end(); return; }
  fs.readFile(file, function(error, bytes) {
    if (error) { res.writeHead(404); res.end(); return; }
    var types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(bytes);
  });
});
var wss = new WebSocket.Server({ server: server });
wss.on('connection', function(ws) {
  if (holdConnections) { ws.close(1012, 'Fixture offline interval'); return; }
  clients.add(ws); connectionCount++;
  sendTo(ws, { type: 'info', project: 'Recovery fixture', title: 'Recovery fixture', slug: slug, cwd: cwd,
    projects: [{ slug: slug, title: 'Recovery fixture', cwd: cwd, path: cwd }], vendors: { claude: { name: 'Claude Code' } } });
  sm.switchSession(session.localId, ws);
  sendTo(ws, { type: 'model_info', vendor: 'claude', model: 'fixture-claude', models: ['fixture-claude'], availableVendors: ['claude'], installedVendors: ['claude'] });
  ws.on('close', function() { clients.delete(ws); });
  ws.on('message', function(raw) {
    var msg = JSON.parse(raw.toString());
    if (msg.type === 'ping') { sendTo(ws, { type: 'pong' }); return; }
    if (msg.type === 'switch_session') { sm.switchSession(Number(msg.id), ws); return; }
    if (msg.type === 'message') { userMessages.handleUserMessage(ws, msg); return; }
    if (msg.type === 'stop') sessionMessages.handleSessionsMessage(ws, msg);
  });
});
function shutdown() {
  sdk.stopIdleReaper();
  handles.forEach(function(handle) { handle.confirmStop(); });
  wss.clients.forEach(function(ws) { ws.terminate(); });
  wss.close(); server.close(function() { fs.rmSync(fixtureHome, { recursive: true, force: true }); process.exit(0); });
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
server.listen(Number(process.argv[2] || 0), '127.0.0.1', function() {
  var url = 'http://127.0.0.1:' + server.address().port + '/p/' + slug + '/';
  console.log('RECOVERY_FIXTURE_URL=' + url);
  if (process.send) process.send({ url: url });
});
