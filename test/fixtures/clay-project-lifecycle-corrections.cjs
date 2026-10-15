var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
async function run(group, f) {
  var count = 0;
  async function create(name) { var result = await f.apply({ action: 'create', name: name }); assert.equal(result.status, 'completed', JSON.stringify(result)); return result; }
  async function removeFailure(slug, id) {
    f.shutdownFailure(true);
    var p = await f.propose({ action: 'remove', projectSlug: slug }, id); f.answer(p); var result = await p.promise;
    f.shutdownFailure(false); assert.equal(result.status, 'failed'); assert.equal(result.persisted, true); assert.equal(result.recoveryAction, 'reconcile'); assert.ok(result.operationId); return result;
  }
  async function recover(slug, operationId, action) {
    var result = await f.apply({ action: action || 'reconcile', projectSlug: slug, value: operationId });
    assert.equal(result.status, 'completed', JSON.stringify(result)); return result;
  }
  if (group === 'recovery') {
    var target = await create('rejected-shutdown'); var failed = await removeFailure(target.slug, 'original-remove');
    assert.ok(f.config().projects.find(function (item) { return item.slug === target.slug; }).lifecycleOperationId);
    f.reconstruct(); await recover(target.slug, failed.operationId); assert.equal(f.config().projects.some(function (item) { return item.slug === target.slug; }), false); count++;
    var inspected = await f.inspect({ action: 'remove', projectSlug: target.slug });
    var retried = await f.call('control_project_lifecycle', { targetToken: inspected.targetToken, requestId: 'original-remove', why: 'Read the reconciled original outcome' }); assert.equal(retried.status, 'completed'); assert.equal(retried.filesDeleted, false); count++;
    target = await create('final-save-failure'); var release, hold = new Promise(function (resolve) { release = resolve; }); f.shutdownHold(hold);
    var p = await f.propose({ action: 'remove', projectSlug: target.slug }); f.answer(p); await f.tick(); var restore = f.diskFault(); release(true); f.shutdownHold(null);
    try { failed = await p.promise; assert.equal(failed.persisted, true); assert.equal(failed.retrySafe, false); assert.ok(failed.operationId); } finally { restore(); }
    var calls = f.shutdownCalls(); f.reconstruct(); await recover(target.slug, failed.operationId); assert.equal(f.shutdownCalls(), calls); count++;
    target = await create('stopped-recovery'); hold = new Promise(function (resolve) { release = resolve; }); f.shutdownHold(hold);
    p = await f.propose({ action: 'remove', projectSlug: target.slug }); f.answer(p); await f.tick(); f.session.taskStopRequested = true; f.session.abortController.abort(); release(true); f.shutdownHold(null);
    failed = await p.promise; assert.equal(failed.status, 'failed'); assert.ok(failed.operationId); assert.ok(f.config().projects.some(function (item) { return item.slug === target.slug; }));
    f.session.taskStopRequested = false; f.session.abortController = new AbortController(); f.reconstruct();
    p = await f.propose({ action: 'reconcile', projectSlug: target.slug, value: failed.operationId }); f.answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); assert.ok(f.config().projects.some(function (item) { return item.slug === target.slug; })); count++;
    await recover(target.slug, failed.operationId); assert.equal(f.config().projects.some(function (item) { return item.slug === target.slug; }), false); count++;
    target = await create('changed-registration'); hold = new Promise(function (resolve) { release = resolve; }); f.shutdownHold(hold);
    p = await f.propose({ action: 'remove', projectSlug: target.slug }, 'changed-original-remove'); f.answer(p); await f.tick(); f.config().projects.find(function (item) { return item.slug === target.slug; }).title = 'Keep the human revision'; release(true); f.shutdownHold(null);
    failed = await p.promise; assert.equal(failed.status, 'failed');
    var changed = await f.inspect({ action: 'reconcile', projectSlug: target.slug, value: failed.operationId }); assert.equal(changed.recovery.conflict, true);
    p = await f.propose({ action: 'reconcile', projectSlug: target.slug, value: failed.operationId }); f.answer(p); assert.equal((await p.promise).status, 'failed'); count++;
    var restored = await recover(target.slug, failed.operationId, 'recover_registration'); assert.equal(restored.registrationRestored, true); assert.equal(restored.executionPaused, true);
    assert.equal(f.get(target.slug).getStatus().title, 'Keep the human revision'); assert.equal(f.config().projects.find(function (item) { return item.slug === target.slug; }).lifecycleState, undefined); assert.equal(f.queryCalls(), 0); count++;
    var historical = await f.inspect({ action: 'remove', projectSlug: target.slug }); var originalReceipt = await f.call('control_project_lifecycle', { targetToken: historical.targetToken, requestId: 'changed-original-remove', why: 'Read the superseded removal receipt' }); assert.equal(originalReceipt.status, 'superseded'); assert.equal(originalReceipt.registrationRestored, true); count++;
    assert.throws(function () { f.lifecycle.resumeRecovered(target.slug, 'foreign'); }, /owner/);
    f.reconstruct(); assert.equal(f.config().projects.find(function (item) { return item.slug === target.slug; }).lifecycleExecutionPaused, true); assert.equal(f.queryCalls(), 0); count++;
    var sm = f.get(target.slug).getSessionManager(), driver = sm.createSessionRaw({ ownerId: 'owner', vendor: 'codex' }); driver._sdkQueryGeneration = 1;
    var attemptsBefore = f.queryCalls(); driver.isProcessing = true; assert.equal(await f.get(target.slug).sdk.startQuery(driver, 'Automatic work must remain paused', null, null), false); assert.equal(f.queryCalls(), attemptsBefore); assert.equal(driver.isProcessing, false); count++;
    var ownerSocket = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: driver.localId, send: function () {}, close: function () {} }; f.get(target.slug).clients.add(ownerSocket);
    f.get(target.slug).handleMessage(ownerSocket, { type: 'message', text: 'Explicitly resume this recovered project.' }); await f.tick(); await f.tick();
    assert.equal(f.config().projects.find(function (item) { return item.slug === target.slug; }).lifecycleExecutionPaused, undefined); count++;
    // A stale recovery review cannot delete a newer registration revision.
    target = await create('stale-recovery'); failed = await removeFailure(target.slug);
    p = await f.propose({ action: 'reconcile', projectSlug: target.slug, value: failed.operationId }); f.config().projects.find(function (item) { return item.slug === target.slug; }).title = 'Changed during recovery review'; assert.equal(f.answer(p), false); f.cancel(p); await p.promise;
    await recover(target.slug, failed.operationId, 'recover_registration'); count++;
  } else if (group === 'publication') {
    var next = await f.propose({ action: 'create', name: 'partial-created' }); f.failAdapter(); f.answer(next); var result = await next.promise;
    assert.equal(result.status, 'failed'); assert.equal(result.persisted, true); assert.equal(result.retrySafe, false); assert.ok(result.operationId); assert.ok(result.slug); var slug = result.slug; assert.equal(f.get(slug), undefined); count++;
    f.reconstruct(); await recover(slug, result.operationId); assert.ok(f.get(slug)); assert.equal(f.config().projects.filter(function (item) { return item.slug === slug; }).length, 1); count++;
    var parent = await create('register-parent'), candidate = path.join(f.config().projects.find(function (item) { return item.slug === parent.slug; }).path, 'existing'); fs.mkdirSync(candidate);
    f.events.length = 0; f.failAdapter(); f.source.handleMessage(f.ws, { type: 'add_project', path: candidate });
    result = f.events.find(function (event) { return event.type === 'add_project_result'; }); assert.equal(result.ok, false); assert.equal(result.persisted, true); assert.equal(result.retrySafe, false); assert.ok(result.operationId); assert.ok(result.slug); count++;
    f.reconstruct(); await recover(result.slug, result.operationId); assert.ok(f.get(result.slug)); count++;
    var restoreDisk;
    f.environmentHook(function () { if (!restoreDisk) restoreDisk = f.diskFault(); });
    try { result = await f.apply({ action: 'environment', projectSlug: parent.slug, value: 'FIXTURE_UPDATED=retained' }); assert.equal(result.status, 'failed'); assert.equal(result.persisted, true); assert.equal(result.retrySafe, false); assert.ok(result.operationId); }
    finally { f.environmentHook(null); if (restoreDisk) restoreDisk(); }
    var targetProject = f.get(parent.slug), pausedSession = targetProject.getSessionManager().createSessionRaw({ ownerId: 'owner', vendor: 'codex' });
    var oldCalls = f.queryCalls(); assert.equal(await targetProject.sdk.startQuery(pausedSession, 'Pending publication must not execute', null, null), false); assert.equal(f.queryCalls(), oldCalls); count++;
    f.reconstruct(); await recover(parent.slug, result.operationId); assert.equal(f.config().projects.find(function (item) { return item.slug === parent.slug; }).envrc, 'FIXTURE_UPDATED=retained'); count++;
    restoreDisk = null; f.environmentHook(function () { if (!restoreDisk) restoreDisk = f.diskFault(); });
    try {
      f.events.length = 0; f.source.handleMessage(f.ws, { type: 'set_project_env', slug: parent.slug, envrc: 'FIXTURE_UI_ENV=retained', requestId: 'ui-env-partial' });
      result = f.events.find(function (event) { return event.type === 'set_project_env_result'; }); assert.equal(result.persisted, true); assert.equal(result.retrySafe, false); assert.ok(result.operationId);
    } finally { f.environmentHook(null); if (restoreDisk) restoreDisk(); }
    f.reconstruct(); await recover(parent.slug, result.operationId); assert.equal(f.config().projects.find(function (item) { return item.slug === parent.slug; }).envrc, 'FIXTURE_UI_ENV=retained'); count++;
    var refreshCalls = 0; f.environmentHook(function () { refreshCalls++; });
    try { f.events.length = 0; f.source.handleMessage(f.ws, { type: 'set_project_env', slug: parent.slug, envrc: 'FIXTURE_UI_ENV=once' }); assert.equal(f.events.find(function (event) { return event.type === 'set_project_env_result'; }).ok, true); assert.equal(refreshCalls, 2); } finally { f.environmentHook(null); } count++;
  } else if (group === 'compatibility') {
    var target = await create('same-project'); var candidate = f.config().projects.find(function (item) { return item.slug === target.slug; }).path;
    f.events.length = 0; f.source.handleMessage(f.ws, { type: 'add_project', path: candidate }); var response = f.events.find(function (event) { return event.type === 'add_project_result'; }); assert.equal(response.ok, true); assert.equal(response.existing, true); assert.equal(response.slug, target.slug); assert.equal(f.config().projects.length, 1); count++;
    var foreign = f.callbacks.onAddProject(candidate, f.users.findUserById('foreign')); assert.equal(foreign.ok, false); assert.equal(foreign.slug, undefined); count++;
    f.lifecycle.update(target.slug, 'allowed_users', ['foreign']); response = f.callbacks.onAddProject(candidate, f.users.findUserById('foreign')); assert.equal(response.existing, true); count++; f.lifecycle.update(target.slug, 'allowed_users', []);
    var alias = path.join(f.root, 'same-alias'); fs.symlinkSync(candidate, alias); response = f.callbacks.onAddProject(alias, f.users.findUserById('owner')); assert.equal(response.existing, true); assert.equal(f.config().projects.length, 1); count++;
    var intent = { action: 'owner', projectSlug: target.slug, value: 'foreign' }, p = await f.propose(intent, 'transfer-once'); f.answer(p); assert.equal((await p.promise).status, 'completed');
    assert.equal((await f.call('control_project_lifecycle', p.args)).status, 'completed'); count++;
    f.reconstruct(); var state = await f.inspect(intent); assert.equal(state.receiptOnly, true); assert.equal(state.current, undefined);
    response = await f.call('control_project_lifecycle', { targetToken: state.targetToken, requestId: 'transfer-once', why: 'Read only the original outcome after reload' }); assert.equal(response.status, 'completed'); assert.equal(response.ownerId, undefined); assert.equal(response.envrc, undefined); count++;
    response = await f.call('control_project_lifecycle', { targetToken: state.targetToken, requestId: 'different-transfer', why: 'Must not repeat a transfer' }); assert.equal(response.status, 'failed'); assert.equal(f.get(target.slug).getStatus().projectOwnerId, 'foreign'); count++;
    var record = f.config().projects.find(function (item) { return item.slug === target.slug; }); record.projectKnowledgeId = 'replacement-identity';
    response = await f.call('control_project_lifecycle', { targetToken: state.targetToken, requestId: 'transfer-once', why: 'Do not return a replacement target receipt' }); assert.equal(response.status, 'failed'); count++;
    var stat = fs.statSync(candidate); assert.equal(stat.uid, process.getuid()); assert.equal(stat.mode & 0o777, 0o700); count++;
  } else if (group === 'restart-prepare') {
    var target = await create('restart-pending'); await removeFailure(target.slug); count++;
  } else if (group === 'restart-recover') {
    var project = f.config().projects.find(function (item) { return item.slug === 'restart-pending'; }); assert.ok(project.lifecycleOperationId);
    var proofFile = path.join(f.cfg.CONFIG_DIR, 'project-lifecycle-operations', project.lifecycleOperationId + '.json'); assert.equal(fs.existsSync(proofFile), false);
    await recover(project.slug, project.lifecycleOperationId); assert.equal(f.config().projects.some(function (item) { return item.slug === project.slug; }), false); count++;
  } else if (group === 'linux') {
    var parent = await create('linux-parent'), parentPath = f.config().projects.find(function (item) { return item.slug === parent.slug; }).path;
    var shim = path.join(f.root, 'linux-shim'); fs.mkdirSync(shim); var uidFile = path.join(shim, 'uid'), logFile = path.join(shim, 'acl.log');
    fs.writeFileSync(path.join(shim, 'getent'), '#!' + process.execPath + '\nvar fs=require("fs"); var uid=fs.existsSync(' + JSON.stringify(uidFile) + ')?fs.readFileSync(' + JSON.stringify(uidFile) + ',"utf8"):process.getuid(); console.log("fixture_os:x:"+uid+":"+process.getgid()+":Fixture:"+' + JSON.stringify(f.root) + '+":/bin/sh");\n', { mode: 0o700 });
    fs.writeFileSync(path.join(shim, 'setfacl'), '#!' + process.execPath + '\nvar fs=require("fs"); fs.appendFileSync(' + JSON.stringify(logFile) + ',"grant\\n"); process.exit(fs.existsSync(' + JSON.stringify(path.join(shim, 'fail-acl')) + ')?1:0);\n', { mode: 0o700 });
    var beforePath = process.env.PATH, roster = f.users.loadUsers(); process.env.PATH = shim + path.delimiter + beforePath;
    f.users.saveUsers(Object.assign({}, roster, { users: roster.users.map(function (user) { return user.id === 'owner' ? Object.assign({}, user, { linuxUser: 'fixture_os' }) : user; }) })); f.config().osUsers = true;
    try {
      var candidate = path.join(parentPath, 'linux-existing'); fs.mkdirSync(candidate); f.events.length = 0; f.source.handleMessage(f.ws, { type: 'add_project', path: candidate });
      var response = f.events.find(function (event) { return event.type === 'add_project_result'; }); assert.equal(response.ok, true, JSON.stringify(response)); assert.ok(fs.readFileSync(logFile, 'utf8').split('\n').length >= 3); count++;
      response = f.callbacks.onAddProject(candidate, f.users.findUserById('owner')); assert.equal(response.existing, true); count++;
      var unregistered = path.join(parentPath, 'unmapped'); fs.mkdirSync(unregistered); var user = Object.assign({}, f.users.findUserById('owner')); delete user.linuxUser;
      f.users.saveUsers(Object.assign({}, roster, { users: roster.users })); response = f.callbacks.onAddProject(unregistered, user); assert.equal(response.ok, false); assert.match(response.error, /provisioned/); assert.equal(f.config().projects.some(function (item) { return item.path === unregistered; }), false); count++;
      f.users.saveUsers(Object.assign({}, roster, { users: roster.users.map(function (item) { return item.id === 'owner' ? Object.assign({}, item, { linuxUser: 'fixture_os' }) : item; }) }));
      fs.writeFileSync(uidFile, String(process.getuid() + 10000)); response = f.callbacks.onAddProject(unregistered, f.users.findUserById('owner')); assert.equal(response.ok, false); assert.match(response.error, /mapped Linux/); fs.unlinkSync(uidFile); count++;
      var symlink = path.join(parentPath, 'linux-alias'); fs.symlinkSync(unregistered, symlink); response = f.callbacks.onAddProject(symlink, f.users.findUserById('owner')); assert.equal(response.ok, false); assert.match(response.error, /canonical/); count++;
      fs.writeFileSync(path.join(shim, 'fail-acl'), 'fail'); response = f.callbacks.onAddProject(unregistered, f.users.findUserById('owner')); assert.equal(response.ok, false); assert.match(response.error, /acknowledged/); fs.unlinkSync(path.join(shim, 'fail-acl')); count++;
      if (process.getuid() !== 0) { fs.chmodSync(unregistered, 0o000); try { response = f.callbacks.onAddProject(unregistered, f.users.findUserById('owner')); assert.equal(response.ok, false); } finally { fs.chmodSync(unregistered, 0o700); } count++; }
      assert.equal(f.config().projects.some(function (item) { return item.path === unregistered; }), false); count++;
    } finally { process.env.PATH = beforePath; f.users.saveUsers(roster); f.config().osUsers = false; }
  } else throw new Error('Unknown correction group: ' + group);
  console.log(group + ': ' + count + ' production lifecycle correction scenarios passed');
}
module.exports = { run: run };
