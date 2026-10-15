var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
var terminals = [], failKill = false, holdExit = false;
function installTransport() {
  // Only the external PTY transport is synthetic; its manager and handlers are real.
  require('../../lib/terminal').createTerminal = function () {
    var exited;
    var item = { onData: function () {}, onExit: function (fn) { exited = fn; }, write: function () {}, resize: function () {},
      kills: 0, kill: function () { item.kills++; if (failKill) throw new Error('Fixture terminal rejected shutdown'); if (!holdExit) setImmediate(function () { exited({ exitCode: 0 }); }); },
      finish: function () { exited({ exitCode: 0 }); } };
    terminals.push(item); return item;
  };
}
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
function blockStorage(sm) {
  var dir = sm.sessionsDir, backup = dir + '.runtime-held'; fs.renameSync(dir, backup); fs.writeFileSync(dir, 'ENOTDIR');
  return function () { fs.unlinkSync(dir); fs.renameSync(backup, dir); };
}
async function run(f) {
  var count = 0;
  function fresh(vendor) {
    var session = f.target.sm.createSessionRaw({ ownerId: 'owner', vendor: vendor || 'claude', sessionVisibility: 'private' });
    session.cliSessionId = 'runtime-thread-' + session.localId; session.title = 'Runtime ' + session.localId;
    assert.equal(f.target.sm.saveSessionFile(session), true); return session;
  }
  async function apply(action, value, session) { var p = await f.propose(action, value, session); assert.equal(f.answer(p), true); return p.promise; }
  function attachTerminal(session) {
    var events = [], ws = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: session.localId, send: function (data) { events.push(JSON.parse(data)); } };
    f.target.clients.add(ws); f.target.handleMessage(ws, { type: 'term_create' });
    var event = events.find(function (item) { return item.type === 'term_created'; }); assert.ok(event, JSON.stringify(events));
    session.mode = 'tui'; session.runtimeMode = 'tui'; session.runtimeTerminalId = event.id;
    var transport = terminals[terminals.length - 1]; transport.ws = ws; transport.events = events; return transport;
  }
  var original = fresh('codex'), originalThread = original.cliSessionId;
  original.history = [{ type: 'user_message', text: 'Keep this original transcript.' }];
  var before = f.target.sm.sessions.size, result = await apply('vendor_new_session', 'claude', original);
  assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.threadMigrated, false); assert.equal(result.executionStarted, false); assert.equal(result.originalRetained, true); assert.equal(f.target.sm.sessions.size, before + 1);
  var reference = require('../../lib/workspace-query-service').sessionRef;
  var created = Array.from(f.target.sm.sessions.values()).find(function (s) { return reference('target', s) === result.newSessionRef; });
  assert.ok(created); assert.equal(created.ownerId, 'owner'); assert.equal(created.sessionVisibility, 'private'); assert.equal(created.cliSessionId, null); assert.equal(created.history.length, 0); assert.equal(original.cliSessionId, originalThread); count++;
  var control = await f.inspect(created); assert.ok(control.targetToken); count++;
  var p = await f.propose('vendor_new_session', 'claude', original); f.answer(p); result = await p.promise;
  before = f.target.sm.sessions.size; assert.deepEqual(await f.call('control_project_session', p.args), result); assert.equal(f.target.sm.sessions.size, before); count++;
  var failingObserver = { readyState: 1, _clayUser: f.users.findUserById('owner'), send: function (data) { if (JSON.parse(data).type === 'session_list') throw new Error('Fixture client publication unavailable'); } };
  p = await f.propose('vendor_new_session', 'claude', original); f.target.clients.add(failingObserver); f.answer(p);
  try { result = await p.promise; assert.equal(result.status, 'failed'); assert.equal(result.persisted, true); assert.equal(result.retainedInMemory, true); assert.equal(result.retrySafe, false); assert.ok(result.newSessionRef); }
  finally { f.target.clients.delete(failingObserver); } before = f.target.sm.sessions.size; count++;
  p = await f.propose('vendor_new_session', 'claude', original); f.answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); assert.equal(f.target.sm.sessions.size, before); count++;
  assert.equal((await apply('vendor_new_session', 'missing-provider', original)).status, 'failed'); assert.equal(f.target.sm.sessions.size, before); count++;
  assert.equal((await apply('vendor', 'claude', original)).status, 'failed'); assert.equal(original.vendor, 'codex'); count++;
  p = await f.propose('vendor_new_session', 'claude', original); var restore = blockStorage(f.target.sm); f.answer(p);
  try { result = await p.promise; assert.equal(result.status, 'failed'); assert.equal(result.persisted, false); assert.equal(result.retainedInMemory, true); assert.ok(result.newSessionRef); assert.equal(result.retrySafe, false); }
  finally { restore(); } count++;
  before = f.target.sm.sessions.size; assert.deepEqual(await f.call('control_project_session', p.args), result); assert.equal(f.target.sm.sessions.size, before); count++;
  p = await f.propose('vendor_new_session', 'claude', original); original.title = 'Newer title'; assert.equal(f.answer(p), false); f.sourceSession.pendingAskUser[p.id].respond.cancel('Stale'); await p.promise; count++;
  p = await f.propose('vendor_new_session', 'claude', original); f.revoke(); assert.equal(f.answer(p), false); f.sourceSession.pendingAskUser[p.id].respond.cancel('Revoked'); await p.promise; f.restoreAccess(); count++;
  var session = fresh(); var pty = attachTerminal(session), thread = session.cliSessionId;
  holdExit = true; p = await f.propose('runtime', 'gui', session); f.answer(p); var settled = false; p.promise.then(function () { settled = true; }); await tick(); assert.equal(settled, false); assert.equal(session.runtimeMode, 'tui'); pty.finish(); holdExit = false;
  result = await p.promise; assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.runtimeEffect, 'terminal_closed'); assert.equal(session.runtimeMode, 'gui'); assert.equal(session.cliSessionId, thread); assert.equal(session.mode, 'tui'); assert.equal(result.executionStarted, false); count++;
  var switched = pty.events.find(function (event) { return event.type === 'session_switched'; }); assert.ok(switched); assert.equal(switched.id, session.localId); assert.equal(switched.runtimeMode, 'gui'); assert.equal(pty.ws._clayActiveSession, session.localId); count++;
  assert.equal((await f.call('control_project_session', p.args)).status, 'completed'); count++;
  assert.equal(f.answer(p), false); count++;
  session = fresh(); pty = attachTerminal(session); p = await f.propose('runtime', 'gui', session); f.answer(p, f.ws, 'Keep unchanged');
  assert.equal((await p.promise).status, 'cancelled'); assert.equal(session.runtimeMode, 'tui'); count++;
  var starts = terminals.length; assert.equal((await apply('runtime', 'tui', session)).status, 'failed'); assert.equal(terminals.length, starts); count++;
  assert.equal((await apply('runtime', 'gui', fresh('codex'))).status, 'completed'); count++;
  session = fresh('codex'); attachTerminal(session); assert.equal((await apply('runtime', 'gui', session)).status, 'failed'); assert.equal(session.runtimeMode, 'tui'); count++;
  session = fresh(); attachTerminal(session); failKill = true;
  try { result = await apply('runtime', 'gui', session); assert.equal(result.status, 'failed'); assert.equal(result.runtimeEffect, 'closure_unconfirmed'); assert.equal(session.runtimeMode, 'tui'); } finally { failKill = false; } count++;
  assert.equal((await apply('runtime', 'gui', session)).status, 'completed'); count++;
  session = fresh(); pty = attachTerminal(session); holdExit = true;
  try { result = await apply('runtime', 'gui', session); assert.equal(result.status, 'failed'); assert.match(result.error, /timed out/); assert.equal(result.runtimeEffect, 'closure_unconfirmed'); assert.equal(session.runtimeMode, 'tui'); }
  finally { holdExit = false; pty.finish(); } count++;
  session = fresh(); session.queryInstance = {}; assert.equal((await apply('runtime', 'gui', session)).status, 'failed'); session.queryInstance = null; count++;
  session = fresh(); pty = attachTerminal(session); p = await f.propose('runtime', 'gui', session); restore = blockStorage(f.target.sm); f.answer(p);
  try { result = await p.promise; assert.equal(result.status, 'failed'); assert.equal(result.runtimeEffect, 'terminal_closed'); assert.equal(result.persisted, false); assert.equal(result.retrySafe, false); } finally { restore(); } count++;
  session = fresh(); attachTerminal(session); p = await f.propose('runtime', 'gui', session); f.target.clients.add(failingObserver); f.answer(p);
  try { result = await p.promise; assert.equal(result.status, 'failed'); assert.equal(result.runtimeEffect, 'terminal_closed'); assert.equal(result.persisted, true); assert.equal(session.runtimeMode, 'gui'); }
  finally { f.target.clients.delete(failingObserver); } count++;
  // Replacing the second attachment while the first exits must preserve both live terminals.
  session = fresh(); var first = attachTerminal(session), firstId = session.runtimeTerminalId;
  var second = attachTerminal(session), secondId = session.runtimeTerminalId; session.terminalId = firstId;
  holdExit = true; p = await f.propose('runtime', 'gui', session); f.answer(p); await tick();
  assert.equal(first.kills, 1); assert.equal(second.kills, 0);
  var replacement = attachTerminal(session), replacementId = session.runtimeTerminalId;
  first.finish(); result = await p.promise; holdExit = false;
  assert.equal(result.status, 'failed'); assert.equal(result.runtimeEffect, 'terminal_closed'); assert.equal(result.persisted, false);
  assert.equal(second.kills, 0); assert.equal(replacement.kills, 0); assert.equal(session.runtimeTerminalId, replacementId); assert.equal(session.terminalId, firstId); assert.equal(session.runtimeMode, 'tui'); count++;
  // After the first acknowledged exit, a new first attachment cannot be orphaned by GUI preparation.
  session = fresh(); first = attachTerminal(session); firstId = session.runtimeTerminalId;
  second = attachTerminal(session); secondId = session.runtimeTerminalId; session.terminalId = firstId;
  holdExit = true; p = await f.propose('runtime', 'gui', session); f.answer(p); await tick(); first.finish(); await tick();
  assert.equal(second.kills, 1);
  replacement = attachTerminal(session); replacementId = session.runtimeTerminalId; session.terminalId = replacementId; session.runtimeTerminalId = secondId;
  second.finish(); result = await p.promise; holdExit = false;
  assert.equal(result.status, 'failed'); assert.equal(result.runtimeEffect, 'terminal_closed'); assert.equal(result.persisted, false);
  assert.equal(replacement.kills, 0); assert.equal(session.terminalId, replacementId); assert.equal(session.runtimeTerminalId, secondId); assert.equal(session.runtimeMode, 'tui'); count++;
  for (var race of ['revoke', 'replace', 'stop', 'source-stop', 'foreign-input', 'generation']) {
    session = fresh(); pty = attachTerminal(session); holdExit = true; p = await f.propose('runtime', 'gui', session); f.answer(p); await tick();
    var generation = f.sourceSession._sdkQueryGeneration;
    if (race === 'revoke') f.revoke();
    if (race === 'replace') f.target.sm.sessions.set(session.localId, Object.assign({}, session));
    if (race === 'stop') session.taskStopRequested = true;
    if (race === 'source-stop') { f.sourceSession.taskStopRequested = true; f.sourceSession.abortController.abort(); }
    if (race === 'foreign-input') f.sourceSession._mcpForeignInput = true;
    if (race === 'generation') f.sourceSession._sdkQueryGeneration++;
    pty.finish(); holdExit = false; result = await p.promise;
    assert.equal(result.status, 'failed', race + ': ' + JSON.stringify(result)); assert.equal(result.runtimeEffect, 'terminal_closed'); assert.equal(result.executionStarted, false); count++;
    f.restoreAccess(); f.target.sm.sessions.set(session.localId, session); session.taskStopRequested = false; f.sourceSession.taskStopRequested = false; f.sourceSession._mcpForeignInput = false; f.sourceSession._sdkQueryGeneration = generation; f.sourceSession.abortController = new AbortController();
  }
  session = fresh(); attachTerminal(session); p = await f.propose('runtime', 'gui', session); session.runtimeTerminalId++;
  assert.equal(f.answer(p), false); f.sourceSession.pendingAskUser[p.id].respond.cancel('Runtime replaced'); await p.promise; count++;
  session = fresh(); pty = attachTerminal(session); p = await f.propose('runtime', 'gui', session);
  f.target.handleMessage(pty.ws, { type: 'term_close', id: session.runtimeTerminalId });
  assert.equal(f.answer(p), false); f.sourceSession.pendingAskUser[p.id].respond.cancel('Terminal closed during review'); await p.promise; count++;
  session = fresh(); session._pendingMessageDrainPaused = true; assert.equal((await apply('runtime', 'gui', session)).status, 'failed'); assert.equal((await apply('vendor_new_session', 'claude', session)).status, 'failed'); count++;
  var attached = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: f.workspace, controlService: f.controls, sm: f.source.sm, projectSlug: 'clay-source', getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: f.clay.id });
  var native = attached.createMcpServer(f.yoke.createAdapters().adapters.claude, f.sourceSession).tools;
  var resumed = attached.getBridgeTools(f.sourceSession, function (value) { return value; });
  assert.deepEqual(native.map(function (item) { return item.name; }), resumed.map(function (item) { return item.name; }));
  var deferredName = 'list_project_session_pull_requests';
  [native, resumed, attached.getDynamicToolDefs(f.sourceSession), await f.source.getMcpBridgeHandler(f.sourceSession.localId, true, f.sourceSession._sdkQueryGeneration).listTools()].forEach(function (tools) {
    assert.equal(tools.some(function (tool) { return tool.name === deferredName; }), false);
  });
  var bound = f.controls.bind({ projectSlug: 'clay-source', projectOwnerId: 'owner', mateId: f.clay.id, session: f.sourceSession });
  assert.equal(bound.sessionPullRequests, undefined); assert.equal(f.target.inspectSessionPullRequests, undefined);
  assert.equal(require.cache[path.resolve(__dirname, '../../lib/clay-project-pr-inventory.js')], undefined);
  assert.equal(require('../../lib/claude-hook-installer').CLAY_MANAGED_ALLOW.includes('mcp__clay-workspace__' + deferredName), false);
  assert.equal(f.source.sdk.checkToolWhitelist('mcp__clay-workspace__' + deferredName, {}), null);
  await assert.rejects(attached.callBridgeTool(f.sourceSession, deferredName, { projectSlug: 'target' }), /not found/); count++;
  var capabilities = await f.call('discover_product_controls'); assert.ok(capabilities.actions.includes('runtime')); assert.ok(capabilities.actions.includes('vendor_new_session')); assert.match(capabilities.unsupported.runtime, /migration are unavailable/); count++;
  assert.equal(original.cliSessionId, originalThread); assert.equal(original.history.length, 1);
  var isolated = require('../../lib/project-session-vendor').attachSessionVendor({ sm: f.target.sm, slug: 'target', osUsers: true, adapters: f.yoke.createAdapters().adapters, getLinuxUserForSession: function () { return null; } });
  before = f.target.sm.sessions.size;
  assert.throws(function () { isolated.newSession(original, 'claude', function () {}); }, /mapped OS identity/); assert.equal(f.target.sm.sessions.size, before); count++;
  console.log(count + ' production runtime control scenarios passed');
}
module.exports = { installTransport: installTransport, run: run };
