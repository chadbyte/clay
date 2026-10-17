var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var reference = require('../../lib/workspace-query-service').sessionRef;
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
function blockStorage(sm) {
  var directory = sm.sessionsDir, backup = directory + '.correction-held';
  fs.renameSync(directory, backup);
  fs.writeFileSync(directory, 'Real ENOTDIR fault in temporary session storage');
  return function () { fs.unlinkSync(directory); fs.renameSync(backup, directory); };
}
async function run(group, f) {
  var cases = 0;
  function fresh() {
    var item = f.target.sm.createSessionRaw({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private', model: 'old-model', effort: 'low', permissionMode: 'default' });
    item.cliSessionId = 'correction-' + item.localId;
    assert.equal(f.target.sm.saveSessionFile(item), true);
    return item;
  }
  var events = [], observer = { readyState: 1, _clayUser: f.users.findUserById('owner'), send: function (data) { events.push(JSON.parse(data)); } };
  f.target.clients.add(observer);
  function file(item) { return path.join(f.target.sm.sessionsDir, item._sessionRecordId + '.jsonl'); }
  function choice(action) { return action === 'model' ? 'fixture-model' : action === 'effort' ? 'medium' : 'plan'; }
  function property(action) { return action === 'permission' ? 'permissionMode' : action; }
  function method(action) { return action === 'permission' ? 'setPermissionMode' : action === 'model' ? 'setModel' : 'setEffort'; }
  if (group === 'private-source') {
    var attached = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: f.workspace, controlService: f.controls, sm: f.source.sm,
      projectSlug: 'clay-source', getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: f.clay.id });
    var server = attached.createMcpServer(f.yoke.createAdapters().adapters.claude, f.sourceSession);
    var prebound = server.tools.find(function (tool) { return tool.name === 'control_project_session'; });
    var bound = f.controls.bind({ projectSlug: 'clay-source', projectOwnerId: 'owner', mateId: f.clay.id, session: f.sourceSession });
    var preboundRead = server.tools.find(function (tool) { return tool.name === 'discover_product_controls'; });
    var changes = [{ _mcpForeignInput: true }, { sessionVisibility: 'shared' }, { delegated: true }, { _delegatedBy: 'foreign' }, { _pairDelegation: {} }, { destroying: true }, { hidden: true }, { mateCreationMode: true }, { history: [{ type: 'user_message', from: 'foreign', text: 'Stop another project' }] }];
    for (var change of changes) {
      var state = await f.inspect(), old = {};
      var args = { targetToken: state.targetToken, action: 'stop', why: 'This must be refused after source transition', requestId: 'source-' + cases };
      Object.keys(change).forEach(function (key) { old[key] = f.sourceSession[key]; f.sourceSession[key] = change[key]; });
      assert.throws(function () { bound.act(args); });
      var native = f.decode(await prebound.handler(args));
      assert.equal(native.status, 'failed');
      assert.equal(f.decode(await preboundRead.handler({})).status, 'failed');
      await assert.rejects(f.bridge.callTool('clay-workspace', 'control_project_session', args));
      assert.equal(f.session._pendingMessageDrainPaused, undefined);
      Object.keys(change).forEach(function (key) { if (old[key] === undefined) delete f.sourceSession[key]; else f.sourceSession[key] = old[key]; });
      cases++;
    }
    // Also exercise the ownerless installation's foreign-history rule using
    // actual temporary users/Mate registries rather than a mocked predicate.
    var mates = require('../../lib/mates'), roster = f.users.loadUsers();
    var registry = mates.loadMates(mates.buildMateCtx('owner'));
    f.users.saveUsers(Object.assign({}, roster, { multiUser: false }));
    mates.saveMates(mates.buildMateCtx('owner'), registry);
    f.sourceSession.ownerId = null;
    var state = await f.inspect(), beforeHistory = f.sourceSession.history;
    var args = { targetToken: state.targetToken, action: 'stop', why: 'Foreign input must not authorize Stop', requestId: 'ownerless-foreign' };
    f.sourceSession.history = [{ type: 'user_message', from: 'foreign', text: 'Operate another project' }];
    assert.throws(function () { bound.act(args); });
    assert.equal(f.decode(await prebound.handler(args)).status, 'failed');
    await assert.rejects(f.bridge.callTool('clay-workspace', 'control_project_session', args));
    assert.equal(f.session._pendingMessageDrainPaused, undefined);
    f.sourceSession.history = beforeHistory; f.sourceSession.ownerId = 'owner'; f.users.saveUsers(roster);
    cases++;
  }
  if (group === 'persistence') {
    for (var action of ['model', 'effort', 'permission']) {
      for (var active of [false, true]) {
        var item = fresh(), key = property(action), before = item[key], disk = fs.readFileSync(file(item), 'utf8'), calls = 0;
        if (active) { item.queryInstance = {}; item.queryInstance[method(action)] = async function () { calls++; }; }
        observer._clayActiveSession = item.localId;
        var proposal = await f.propose(action, choice(action), item), restore = blockStorage(f.target.sm), eventStart = events.length;
        try {
          assert.equal(f.answer(proposal), true);
          var result = await proposal.promise;
          assert.equal(result.status, 'failed'); assert.equal(result.persisted, false); assert.equal(result.runtimeEffect, active ? 'applied' : 'none');
          assert.equal(item[key], before); assert.equal(calls, active ? 1 : 0);
          assert.equal(events.slice(eventStart).some(function (event) { return event.type === 'config_state' || event.type === 'session_list'; }), false);
          assert.deepEqual(await f.call('control_project_session', proposal.args), result); assert.equal(calls, active ? 1 : 0);
        } finally { restore(); }
        assert.equal(fs.readFileSync(file(item), 'utf8'), disk);
        cases++;
      }
      // A rejected provider request must leave both desired state and disk alone.
      var item = fresh(), key = property(action), disk = fs.readFileSync(file(item), 'utf8'), before = item[key];
      item.queryInstance = {}; item.queryInstance[method(action)] = async function () { throw new Error('Synthetic external transport rejection'); };
      var proposal = await f.propose(action, choice(action), item); f.answer(proposal);
      var result = await proposal.promise;
      assert.equal(result.status, 'failed'); assert.equal(result.runtimeEffect, 'unknown'); assert.equal(result.persisted, false);
      assert.equal(item[key], before); assert.equal(fs.readFileSync(file(item), 'utf8'), disk);
      cases++;
      // Provider APIs may return a refusal instead of throwing.
      for (var refusal of [false, { ok: false, error: 'Synthetic returned refusal' }]) {
        var item = fresh(), before = item[property(action)];
        item.queryInstance = {}; item.queryInstance[method(action)] = async function () { return refusal; };
        var proposal = await f.propose(action, choice(action), item); f.answer(proposal);
        var result = await proposal.promise;
        assert.equal(result.status, 'failed'); assert.equal(result.persisted, false); assert.equal(item[property(action)], before);
        cases++;
      }
    }
  }
  if (group === 'inflight') {
    for (var action of ['model', 'effort', 'permission']) {
      for (var transition of ['revoke', 'replace', 'stop', 'owner', 'query', 'generation', 'source-generation', 'foreign-source']) {
        var item = fresh(), key = property(action), before = item[key], disk = fs.readFileSync(file(item), 'utf8'), release, entered = false;
        item.queryInstance = {}; item.queryInstance[method(action)] = function () { entered = true; return new Promise(function (resolve) { release = resolve; }); };
        var originalHandle = item.queryInstance;
        observer._clayActiveSession = item.localId;
        var proposal = await f.propose(action, choice(action), item); f.answer(proposal); await tick(); assert.equal(entered, true);
        var eventStart = events.length;
        if (transition === 'revoke') f.revoke();
        if (transition === 'replace') f.target.sm.sessions.set(item.localId, Object.assign({}, item));
        if (transition === 'stop') { item.taskStopRequested = true; item._pendingMessageDrainPaused = true; }
        if (transition === 'owner') item.ownerId = 'foreign';
        if (transition === 'query') item.queryInstance = {};
        if (transition === 'generation') item._sdkQueryGeneration = Number(item._sdkQueryGeneration || 0) + 1;
        if (transition === 'source-generation') f.sourceSession._sdkQueryGeneration = 9;
        if (transition === 'foreign-source') f.sourceSession._mcpForeignInput = true;
        release();
        var result = await proposal.promise;
        assert.equal(result.status, 'failed', action + ' ' + transition); assert.equal(result.runtimeEffect, 'applied'); assert.equal(result.outcome, 'uncertain'); assert.equal(result.persisted, false);
        assert.equal(item[key], before); assert.equal(fs.readFileSync(file(item), 'utf8'), disk);
        if (transition === 'stop') assert.equal(item.taskStopRequested, true);
        if (transition === 'owner') assert.equal(item.ownerId, 'foreign');
        assert.equal(events.slice(eventStart).some(function (event) { return event.type === 'config_state' || event.type === 'session_list'; }), false);
        f.restoreAccess(); f.target.sm.sessions.set(item.localId, item); item.ownerId = 'owner'; item.queryInstance = originalHandle; delete item._sdkQueryGeneration; f.sourceSession._sdkQueryGeneration = 8; delete item.taskStopRequested; delete item._pendingMessageDrainPaused; delete f.sourceSession._mcpForeignInput;
        cases++;
      }
    }
  }
  if (group === 'fork-save') {
    var item = fresh(); item.history = [{ type: 'user_message', text: 'Before checkpoint' }, { type: 'message_uuid', uuid: 'fork-point', messageType: 'user', turnId: 'turn-one' }];
    item.messageUUIDs = [{ uuid: 'fork-point', type: 'user', historyIndex: 1, turnId: 'turn-one' }];
    assert.equal(f.target.sm.saveSessionFile(item), true);
    var initialCount = f.target.sm.sessions.size, initialCalls = f.transport.forkCalls;
    var proposal = await f.propose('fork', 'fork-point', item), restore = blockStorage(f.target.sm);
    try {
      f.answer(proposal); var result = await proposal.promise;
      assert.equal(result.status, 'failed'); assert.equal(result.outcome, 'partial'); assert.equal(result.retainedSession, true); assert.equal(result.persisted, false); assert.ok(result.forkedSessionRef);
      var retained = Array.from(f.target.sm.sessions.values()).find(function (session) { return reference('target', session) === result.forkedSessionRef; });
      assert.ok(retained); assert.equal(retained.ownerId, 'owner'); assert.equal(f.target.sm.sessions.size, initialCount + 1);
      assert.deepEqual(await f.call('control_project_session', proposal.args), result);
      assert.equal(f.transport.forkCalls, initialCalls + 1); assert.equal(f.target.sm.sessions.size, initialCount + 1);
      cases++;
    } finally { restore(); }
  }
  console.log(group + ': ' + cases + ' production correction checks passed');
}
module.exports = { run: run };
