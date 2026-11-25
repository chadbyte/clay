// Synthetic production-path diagnostic. No provider or live history is used.
// Run with Node 22; NODE_PATH may point at an existing dependency installation.
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var perf = require('perf_hooks');
var assert = require('assert/strict');
var fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-history-cpu-'));
process.env.CLAY_HOME = fixtureRoot;
process.env.HOME = fixtureRoot;
process.env.CLAY_CONFIG = path.join(fixtureRoot, 'daemon.json');
process.env.CODEX_HOME = path.join(fixtureRoot, '.codex');
process.env.SUDO_USER = '';
process.env.SUDO_HOME = '';
var root = process.env.CLAY_HISTORY_BENCHMARK_ROOT || path.resolve(__dirname, '../..');
var createSessionManager = require(path.join(root, 'lib/sessions')).createSessionManager;
var attachConnection = require(path.join(root, 'lib/project-connection')).attachConnection;
var projection = require(path.join(root, 'lib/clay-control-target-projection'));
var histories = new Set();
var originalDigest = projection.digest;
var originalCreateHash = crypto.createHash;
var stats;
crypto.createHash = function () {
  var hash = originalCreateHash.apply(crypto, arguments);
  var update = hash.update;
  hash.update = function (data) {
    if (stats && stats.inHistory) {
      stats.hashCalls++;
      stats.hashBytes += Buffer.byteLength(data);
    }
    return update.apply(hash, arguments);
  };
  return hash;
};
projection.digest = function (value) {
  if (!stats || !histories.has(value)) return originalDigest(value);
  stats.historyDigests++;
  var start = perf.performance.now();
  stats.inHistory = true;
  try { return originalDigest(value); }
  finally { stats.inHistory = false; stats.digestMs += perf.performance.now() - start; }
};
function send(ws, message) {
  var data = JSON.stringify(message);
  if (stats) { stats.sentMessages++; stats.sentBytes += Buffer.byteLength(data); if (message.type === 'history_done') stats.replays++; }
}
function project(number, entries, payloadBytes) {
  var directory = path.join(fixtureRoot, 'project-' + number);
  var sm = createSessionManager({ cwd: directory, sessionsBase: path.join(fixtureRoot, 'sessions'), cliSessionsDir: path.join(fixtureRoot, 'cli'),
    send: function (message) { send(null, message); }, sendTo: send, sendEach: function () {} });
  var session = sm.createSessionRaw({ cliSessionId: 'synthetic-' + number, vendor: 'claude' });
  session.title = 'Synthetic history';
  session.isProcessing = true;
  session.lastActivity = Date.now() + 60000;
  session.history = Array.from({ length: entries }, function (_, index) {
    return index % 10 === 0 ? { type: 'user_message', text: 'Turn ' + index, _ts: 1700000000000 + index }
      : { type: 'tool_result', id: 'tool-' + index, content: 'x'.repeat(payloadBytes), _ts: 1700000000000 + index };
  });
  histories.add(session.history);
  var connection = attachConnection({ cwd: directory, slug: 'synthetic-' + number, clients: new Set(), opts: {}, sm: sm,
    tm: { list: function () { return []; }, detachAll: function () {} }, nm: { list: function () { return []; } },
    _loop: { loopState: {}, sendConnectionState: function () {} }, sendTo: send,
    broadcastClientCount: function () {}, broadcastPresence: function () {}, getProjectList: function () { return []; },
    getHubSchedules: function () { return []; }, getTitle: function () { return 'Synthetic'; }, getProject: function () { return 'synthetic'; },
    getProjectOwnerId: function () { return null; }, hydrateImageRefs: function (item) { return item; },
    loadContextSources: function () { return []; }, restoreDebateState: function () {} });
  return { sm: sm, session: session, connection: connection };
}
function turn() { return new Promise(function (resolve) { setImmediate(resolve); }); }
async function measure(projects, mode, clients) {
  stats = { mode: mode, simulatedClients: clients, rounds: 5, replays: 0, historyDigests: 0, hashCalls: 0, hashBytes: 0, digestMs: 0, sentMessages: 0, sentBytes: 0 };
  var current = stats;
  var delay = perf.monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  var start = perf.performance.now();
  for (var round = 0; round < current.rounds; round++) {
    for (var client = 0; client < clients; client++) {
      var target = projects[round % projects.length];
      var ws = { readyState: 1, on: function () {} };
      if (mode === 'connect') target.connection.handleConnection(ws, null, function () {}, function () {});
      else target.sm.switchSession(target.session.localId, ws);
    }
    await turn();
  }
  current.elapsedMs = perf.performance.now() - start;
  assert.equal(current.replays, current.rounds * clients, 'every simulated client must finish a history replay');
  assert.equal(current.hashCalls, current.historyDigests);
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  current.eventLoopMaxMs = delay.max / 1e6;
  current.eventLoopP99Ms = delay.percentile(99) / 1e6;
  delay.disable();
  stats = null;
  delete current.inHistory;
  return current;
}
async function main() {
  var results = [];
  for (var entries of [400, 1600]) {
    var projects = [project(entries + '-a', entries, 16384), project(entries + '-b', entries, 16384)];
    // Warm require paths and JIT without counting them.
    projects[0].sm.switchSession(projects[0].session.localId, { readyState: 1 });
    for (var mode of ['switch', 'connect']) {
      for (var clients of [1, 4]) {
        var result = await measure(projects, mode, clients);
        result.entries = entries;
        result.historyBytes = Buffer.byteLength(JSON.stringify(projects[0].session.history));
        results.push(result);
      }
    }
  }
  process.stdout.write(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, results: results }, null, 2) + '\n');
}
main().catch(function (error) { console.error(error); process.exitCode = 1; }).finally(function () {
  crypto.createHash = originalCreateHash;
  projection.digest = originalDigest;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});
