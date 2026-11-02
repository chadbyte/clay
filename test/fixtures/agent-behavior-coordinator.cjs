// Isolated production-coordinator fixture for the Personal Agent behavior
// policy. It runs the real project coordinator with real Notes, Logs, Issues and
// User Knowledge services in a temporary HOME. No provider query, vendor login,
// account or network is used. Usage: node agent-behavior-coordinator.cjs <tmp-root> [solo|accounts]
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var R = path.join(__dirname, '../../lib/');
var root = process.argv[2];
var mode = process.argv[3] || 'solo';
var multi = mode === 'accounts';

// Isolate every storage root before any Clay module is loaded.
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, 'config');
process.env.CLAY_CONFIG = '';
process.env.CODEX_HOME = path.join(root, '.codex');
fs.mkdirSync(process.env.CLAY_HOME, { recursive: true });

var users = null;
if (multi) {
  fs.writeFileSync(path.join(process.env.CLAY_HOME, 'users.json'), JSON.stringify({
    multiUser: true, setupCode: null, smtp: null, invites: [],
    users: [
      { id: 'u1', username: 'alice', role: 'admin', profile: { name: 'Alice' } },
      { id: 'u2', username: 'bob', role: 'user', profile: { name: 'Bob' } },
    ],
  }));
}
users = require(R + 'users');

var createProject = require(R + 'project').createProjectContext;
var logsStore = require(R + 'project-logs-store');
var projects = new Map();
var solo = { value: {} };

function policyFor(ownerId) { return multi ? users.getAgentBehavior(ownerId) : solo.value; }
function setPolicy(ownerId, changes) {
  if (multi) { var result = users.updateAgentBehavior(ownerId, changes); assert.equal(result.ok, true, JSON.stringify(result)); }
  else solo.value = Object.assign({}, solo.value, changes);
}
function resetPolicy(ownerId, keys) {
  var changes = {};
  keys.forEach(function (key) { changes[key] = key === 'issueLinkedNotes' ? true : 'auto'; });
  setPolicy(ownerId, changes);
}

var storeCache = new Map();
var logsService = require(R + 'project-logs-service').attachProjectLogsService({
  getProjects: function () { return projects; }, isMultiUser: function () { return multi; },
  canAccessProject: function () { return true; }, hasFullProjectAccess: function () { return true; },
  findUserById: function (id) { return users.findUserById(id); },
  openStore: function (cwd) { if (!storeCache.has(cwd)) storeCache.set(cwd, logsStore.createProjectLogsStore({ root: cwd, baseDir: path.join(root, 'logs') })); return storeCache.get(cwd); },
});
var issuesService = require(R + 'issues-service').attachIssuesService({
  getProjects: function () { return projects; }, isMultiUser: function () { return multi; },
  canAccessProject: function () { return true; }, hasFullProjectAccess: function () { return true; },
  osUsersEnabled: function () { return false; }, getOsUserInfoForActor: function () { return null; },
  findUserById: function (id) { return users.findUserById(id); },
});
var knowledge = require(R + 'user-knowledge-service').attachUserKnowledgeService({
  baseDir: path.join(root, 'you'), isMultiUser: function () { return multi; }, findUser: function () { return {}; },
  getProject: function (slug) { return projects.get(slug); }, canAccess: function () { return true; },
  resolveMate: function () { return null; }, onReport: function () {}, onChange: function () {},
});

function names(surface) { return surface.toolNames; }
function has(surface, tool) { return surface.toolNames.indexOf(tool) !== -1; }

var TOOLS = {
  meUse: ['search_user_knowledge', 'read_user_knowledge'], meCollection: ['report_user_observation'],
  logs: ['create_log', 'update_log', 'list_logs', 'read_log'], issues: ['create_issue', 'update_issue', 'list_issues'],
  notes: ['write_note', 'list_notes', 'close_note'], sessionHistory: ['list_other_driver_sessions', 'read_other_driver_session'],
  continuation: ['propose_driver_continuation'], sketch: ['present_wireframe'], markdownViewer: ['present_markdown_edit'],
  sharedBrowser: ['shared_browser'], workerProposals: ['propose_worker'], githubLinks: ['link_session_github', 'get_session_github', 'unlink_session_github'],
};
var MODE_IDS = Object.keys(TOOLS);

async function main() {
  var scheduler = require(R + 'durable-scheduler').attachDurableScheduler({ namespace: 'ab-fixture', storageDir: path.join(root, 'scheduler') });
  var dir = path.join(root, 'app'); fs.mkdirSync(dir);
  var mateDir = path.join(root, 'mate'); fs.mkdirSync(mateDir);
  var base = { durableScheduler: scheduler, port: 0, projectKnowledgeId: 'pk_app', projectOwnerId: multi ? 'u1' : null,
    onGetDaemonConfig: function () { return { agentBehavior: solo.value }; },
    getProjectAccess: function () { return { visibility: 'public', ownerId: multi ? 'u1' : null }; }, canAccessProjectSlug: function () { return true; },
    projectLogsService: logsService, issuesService: issuesService, userKnowledgeService: knowledge };
  var app = createProject(Object.assign({}, base, { cwd: dir, slug: 'app' }));
  var mate = createProject(Object.assign({}, base, { cwd: mateDir, slug: 'mate-fixture', isMate: true }));
  projects.set('app', app); projects.set('mate-fixture', mate);
  var owner = multi ? 'u1' : null;
  var session = { localId: 7, ownerId: owner, mode: 'gui', history: [], vendor: 'codex', model: 'gpt-6', _sdkQueryGeneration: 3, cliSessionId: 'c-7' };
  app.sm.sessions.set(7, session);
  var mateSession = { localId: 9, ownerId: owner, mode: 'gui', history: [], vendor: 'codex', _sdkQueryGeneration: 3, cliSessionId: 'c-9' };
  mate.sm.sessions.set(9, mateSession);
  var ws = { readyState: 1, send: function () {} };
  app.clients.add(ws);

  try {
    // 1. Default: nothing stored means today's surface, with no policy block.
    var baseline = app.getSessionAgentSurface(session);
    MODE_IDS.forEach(function (id) {
      TOOLS[id].forEach(function (tool) {
        if (id === 'githubLinks' || id === 'sharedBrowser' || id === 'workerProposals' || id === 'continuation' || id === 'sessionHistory') { /* availability depends on session eligibility */ }
        if (['write_note', 'create_log', 'create_issue', 'search_user_knowledge', 'present_wireframe', 'present_markdown_edit', 'shared_browser', 'link_session_github', 'propose_worker'].indexOf(tool) !== -1) assert.ok(has(baseline, tool), 'default exposes ' + tool);
      });
    });
    assert.doesNotMatch(baseline.systemPrompt, /Personal agent behavior/);
    assert.match(baseline.systemPrompt, /Create a note proactively/);
    assert.match(baseline.systemPrompt, /short linked Sticky Note/);
    assert.match(baseline.systemPrompt, /Capture durable user learning moments/);
    setPolicy(owner, { meUse: 'auto', notes: 'auto', issueLinkedNotes: true });
    var explicitAuto = app.getSessionAgentSurface(session);
    assert.deepEqual(names(explicitAuto), names(baseline), 'explicit Auto equals the unset default');
    assert.equal(explicitAuto.systemPrompt, baseline.systemPrompt);

    // 2. Off removes each governed tool and its instructions.
    var offExpect = {
      meUse: /Prefers fast reviews|consult relevant User Knowledge/, meCollection: /Report durable explicit preferences/,
      logs: /Project Logs \(durable project record/, issues: /Automatic Issue filing/, notes: /sticky notes \(cross-session/,
      continuation: null, sketch: /clay-sketch/, markdownViewer: /present_markdown_edit/, sharedBrowser: /clay-agent-browser/, workerProposals: null, githubLinks: /GitHub work links/,
    };
    for (var i = 0; i < MODE_IDS.length; i++) {
      var id = MODE_IDS[i];
      var present = TOOLS[id].filter(function (tool) { return has(baseline, tool); });
      var changes = {}; changes[id] = 'off';
      setPolicy(owner, changes);
      var off = app.getSessionAgentSurface(session);
      present.forEach(function (tool) { assert.equal(has(off, tool), false, id + ' Off removes ' + tool); });
      TOOLS[id].forEach(function () {});
      if (offExpect[id]) assert.doesNotMatch(off.systemPrompt, offExpect[id], id + ' Off removes its instructions');
      assert.match(off.systemPrompt, /Personal agent behavior/, id + ' Off adds the override notice');
      var other = MODE_IDS.filter(function (x) { return x !== id; });
      other.forEach(function (x) { TOOLS[x].filter(function (tool) { return has(baseline, tool); }).forEach(function (tool) { assert.ok(has(off, tool), id + ' Off keeps ' + tool); }); });
      resetPolicy(owner, [id]);
    }
    assert.ok(has(baseline, 'create_issue'), 'the fixture exposes Issues');
    assert.ok(has(baseline, 'propose_worker'), 'the fixture exposes Worker proposals');

    // 3. On request keeps the tools, drops proactive instructions, and states the mode.
    setPolicy(owner, { notes: 'request', issues: 'request', githubLinks: 'request', logs: 'request' });
    var request = app.getSessionAgentSurface(session);
    ['write_note', 'create_issue', 'link_session_github', 'create_log'].forEach(function (tool) { assert.ok(has(request, tool), 'On request keeps ' + tool); });
    assert.match(request.systemPrompt, /On request, only when the user's message asks for it: using Project Logs; using Project Issues; using Sticky Notes; linking this session to GitHub items/);
    assert.doesNotMatch(request.systemPrompt, /Create a note proactively/);
    assert.doesNotMatch(request.systemPrompt, /Automatic Issue filing/);
    assert.doesNotMatch(request.systemPrompt, /proactively call link_session_github/);
    assert.doesNotMatch(request.systemPrompt, /short linked Sticky Note/);
    resetPolicy(owner, ['notes', 'issues', 'githubLinks', 'logs']);

    // 4. Issues Auto with Notes On request must not ask for a note.
    setPolicy(owner, { issues: 'auto', notes: 'request' });
    var interplay = app.getSessionAgentSurface(session);
    assert.match(interplay.systemPrompt, /Automatic Issue filing/);
    assert.doesNotMatch(interplay.systemPrompt, /short linked Sticky Note/);
    assert.doesNotMatch(interplay.systemPrompt, /Sticky Note and Project Logs are three/);
    setPolicy(owner, { issues: 'auto', notes: 'auto', issueLinkedNotes: false });
    var unchecked = app.getSessionAgentSurface(session);
    assert.match(unchecked.systemPrompt, /Create a note proactively/);
    assert.doesNotMatch(unchecked.systemPrompt, /short linked Sticky Note/);
    resetPolicy(owner, ['issues', 'notes', 'issueLinkedNotes']);

    // 5. Me use and collection are independent.
    setPolicy(owner, { meUse: 'off' });
    var noUse = app.getSessionAgentSurface(session);
    assert.equal(has(noUse, 'search_user_knowledge'), false);
    assert.ok(has(noUse, 'report_user_observation'));
    assert.match(noUse.systemPrompt, /report_user_observation/);
    assert.doesNotMatch(noUse.systemPrompt, /consult relevant User Knowledge/);
    resetPolicy(owner, ['meUse']);
    setPolicy(owner, { meCollection: 'off' });
    var noCollect = app.getSessionAgentSurface(session);
    assert.ok(has(noCollect, 'search_user_knowledge'));
    assert.equal(has(noCollect, 'report_user_observation'), false);
    resetPolicy(owner, ['meCollection']);

    // 6. A tool exposed before the change is refused at the exact-query bridge.
    var bridge = app.getMcpBridgeHandler(7, true, 3);
    var before = await bridge.listTools();
    assert.ok(before.some(function (tool) { return tool.name === 'write_note'; }));
    assert.ok(before.some(function (tool) { return tool.name === 'create_issue'; }));
    var written = await bridge.callTool('clay-notes', 'write_note', { text: 'A reminder\nbefore the change' });
    assert.equal(written.isError, undefined, JSON.stringify(written));
    // The native SDK server catalog is rebuilt through the same policy adapter.
    var nativeBridge = app.getMcpBridgeHandler(7, false, 3);
    var nativeBefore = await nativeBridge.listTools();
    assert.ok(nativeBefore.some(function (tool) { return tool.server === 'clay-notes' && tool.name === 'write_note'; }), 'native catalog exposes notes');
    assert.ok(nativeBefore.some(function (tool) { return tool.server === 'clay-issues' && tool.name === 'create_issue'; }), 'native catalog exposes issues');
    setPolicy(owner, { notes: 'off', issues: 'off', logsLearning: 'off', meCollection: 'off', sharedBrowser: 'off' });
    var nativeAfter = await nativeBridge.listTools();
    assert.equal(nativeAfter.some(function (tool) { return tool.server === 'clay-notes' || tool.server === 'clay-issues'; }), false, 'native catalog drops Off servers');
    assert.ok(nativeAfter.some(function (tool) { return tool.server === 'clay-logs'; }), 'native catalog keeps other settings');
    var after = await bridge.listTools();
    ['write_note', 'list_notes', 'create_issue', 'report_user_observation', 'shared_browser'].forEach(function (tool) {
      assert.equal(after.some(function (item) { return item.name === tool; }), false, 'bridge listing drops ' + tool);
    });
    var late = await bridge.callTool('clay-notes', 'write_note', { text: 'Late note' });
    assert.equal(late.isError, true);
    assert.match(late.content[0].text, /Sticky Notes/);
    var lateIssue = await bridge.callTool('clay-issues', 'create_issue', { title: 'Late issue' });
    assert.equal(lateIssue.isError, true);
    var lateReport = await bridge.callTool('clay-you', 'report_user_observation', { observation: 'x', evidence: 'y' });
    assert.equal(lateReport.isError, true);
    // 7. Learning records at the service, with the Logbook itself still Auto.
    var learning = await bridge.callTool('clay-logs', 'create_log', { kind: 'learning', title: 'Retries', summary: 'Clarified retries.' });
    assert.equal(learning.isError, true);
    assert.match(learning.content[0].text, /Learning records are turned off/);
    var decision = await bridge.callTool('clay-logs', 'create_log', { kind: 'decision', title: 'Cache', summary: 'Adopted an append-only cache log.' });
    assert.equal(decision.isError, undefined, JSON.stringify(decision));
    resetPolicy(owner, ['notes', 'issues', 'logsLearning', 'meCollection', 'sharedBrowser']);
    var reenabled = await bridge.callTool('clay-notes', 'write_note', { text: 'Back again\nafter turning it on' });
    assert.equal(reenabled.isError, undefined, 'turning a setting back on restores the call');

    // 8. Mates never read the policy, even when every Driver feature is Off.
    var mateBefore = mate.getSessionAgentSurface(mateSession);
    var allOff = {}; MODE_IDS.forEach(function (id) { allOff[id] = 'off'; });
    allOff.issueLinkedNotes = false;
    setPolicy(owner, allOff);
    var mateAfter = mate.getSessionAgentSurface(mateSession);
    assert.deepEqual(names(mateAfter), names(mateBefore));
    assert.equal(mateAfter.systemPrompt, mateBefore.systemPrompt);
    assert.doesNotMatch(mateAfter.systemPrompt, /Personal agent behavior/);
    var mateBridge = mate.getMcpBridgeHandler(9, true, 3);
    var mateWrite = await mateBridge.callTool('clay-notes', 'write_note', { text: 'Mate note\nstill allowed' });
    assert.equal(mateWrite.isError, undefined, JSON.stringify(mateWrite));
    var driverAllOff = app.getSessionAgentSurface(session);
    MODE_IDS.forEach(function (id) { TOOLS[id].forEach(function (tool) { assert.equal(has(driverAllOff, tool), false, 'all Off removes ' + tool); }); });

    // 9. Changing the policy refreshes the owner's runtime without stopping a turn.
    resetPolicy(owner, MODE_IDS.concat(['issueLinkedNotes']));
    session.isProcessing = true;
    assert.ok(app.refreshAgentBehavior(owner) >= 1);
    assert.equal(session._runtimeRefreshRequested, true, 'a running turn is flagged for rebuild at the next message, not stopped');
    assert.equal(session.isProcessing, true);
    assert.equal(mate.refreshAgentBehavior(owner), 0, 'Mate projects are never refreshed by this policy');

    if (multi) {
      // 10. Another account's policy and sessions are independent.
      var other = { localId: 8, ownerId: 'u2', mode: 'gui', history: [], vendor: 'codex', model: 'gpt-6', _sdkQueryGeneration: 3, cliSessionId: 'c-8' };
      app.sm.sessions.set(8, other);
      setPolicy('u1', { notes: 'off' });
      assert.equal(has(app.getSessionAgentSurface(session), 'write_note'), false);
      assert.ok(has(app.getSessionAgentSurface(other), 'write_note'), 'account two keeps its own choice');
      session._runtimeRefreshRequested = false;
      other.isProcessing = true;
      assert.ok(app.refreshAgentBehavior('u2') >= 1);
      assert.equal(other._runtimeRefreshRequested, true, 'the changed account is refreshed');
      assert.equal(session._runtimeRefreshRequested, false, 'another account is not refreshed');
      other.isProcessing = false;
    }
    console.log('agent behavior coordinator ' + mode + ' passed');
  } finally { app.destroy(); mate.destroy(); await scheduler.shutdown(); }
}
main().then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
