var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
async function run(f) {
  var count = 0, sequence = 0;
  async function call(name, args) { try { return await f.call(name, args); } catch (error) { return { status: 'failed', error: error.message }; } }
  async function read(area, action, args, slug) { return call('read_project_records', { projectSlug: slug || 'target', operation: Object.assign({ area: area, action: action }, args) }); }
  async function propose(op, slug) {
    var inspected = await call('inspect_project_record_change', { projectSlug: slug || 'target', operation: op });
    assert.ok(inspected.targetToken, JSON.stringify(inspected));
    var args = { targetToken: inspected.targetToken, requestId: 'record-' + (++sequence), why: 'Apply the exact fixture change' };
    var promise = call('control_project_records', args);
    await new Promise(function (resolve) { setImmediate(resolve); });
    var ids = Object.keys(f.sourceSession.pendingAskUser || {});
    assert.ok(ids.length, JSON.stringify(await Promise.race([promise, Promise.resolve({ waiting: true })])));
    return { args: args, promise: promise, id: ids[ids.length - 1] };
  }
  async function success(op, slug) {
    var p = await propose(op, slug); assert.equal(f.answer(p), true);
    var result = await p.promise; assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.persisted, true); count++;
    return result.result;
  }
  function cancel(p) { var pending = f.sourceSession.pendingAskUser[p.id]; if (pending) pending.respond.cancel('Fixture invalidation'); }
  var sourceArgs = { projectSlug: 'clay-source', projectOwnerId: 'owner', isMate: true, mateId: f.clay.id, session: f.sourceSession };
  var bound = f.controls.bind(sourceArgs);
  assert.ok(bound); assert.equal(f.services.issues.bindCanonicalClay({ projectSlug: 'target', authority: {} }), null);
  assert.equal(f.services.logs.bindCanonicalClay({ projectSlug: 'target', authority: {} }), null); count++;
  for (var vendor of ['claude', 'codex']) {
    f.sourceSession.vendor = vendor;
    for (var fresh of [true, false]) {
      var catalog = await f.source.getMcpBridgeHandler(f.sourceSession.localId, fresh, 8).listTools();
      ['read_project_records', 'inspect_project_record_change', 'control_project_records'].forEach(function (name) { assert.ok(catalog.some(function (item) { return item.name === name; })); }); count++;
    }
  }
  f.sourceSession.vendor = 'claude';
  var definitions = require('../../lib/clay-product-control-tools').getToolDefs(bound);
  assert.ok(definitions.some(function (tool) { return tool.name === 'control_project_records'; })); count++;
  assert.equal((await read('issues', 'list', {}, 'other-mate')).status, 'failed'); count++;
  var otherSession = f.projects.get('other-mate').sm.createSession({ ownerId: 'owner' });
  assert.equal(f.controls.bind(Object.assign({}, sourceArgs, { projectSlug: 'other-mate', mateId: f.custom.id, session: otherSession })), null); count++;
  var driver = f.services.issues.bindProjectSession({ projectSlug: 'target', session: f.session });
  var logDriver = f.services.logs.bindProjectSession({ projectSlug: 'target', session: f.session });
  var initial = await read('issues', 'list'); assert.ok(initial.issues, JSON.stringify(initial)); assert.equal(initial.issues.length, 0);
  var p = await propose({ area: 'issues', action: 'create', title: 'Reviewed issue', body: 'Reproduction', type: 'bug' });
  assert.equal((await read('issues', 'list')).issues.length, 0);
  assert.equal(f.answer(p, { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.sourceSession.localId }), false);
  assert.equal(f.answer(p), true); var result = await p.promise; assert.equal(result.status, 'completed', JSON.stringify(result)); var issue = result.result;
  assert.equal(issue.createdBy.type, 'canonicalClay'); assert.equal(issue.createdBy.mateId, f.clay.id); assert.equal(issue.createdBy.sourceProjectSlug, 'clay-source'); assert.equal(issue.createdBy.sessionOriginId, f.sourceSession.sessionOriginId); count++;
  assert.equal(f.answer(p), false); assert.deepEqual(await call('control_project_records', p.args), result); assert.equal((await read('issues', 'list')).issues.length, 1); count++;
  assert.equal((await call('control_project_records', Object.assign({}, p.args, { why: 'Different' }))).status, 'failed'); count++;
  issue = await success({ area: 'issues', action: 'update', ref: issue.ref, expectedRevision: issue.revision, status: 'in_progress', summary: 'Investigating' });
  assert.equal((await read('issues', 'search', { query: 'Reviewed' })).issues.length, 1); count++;
  assert.equal((await read('issues', 'revision', { ref: issue.ref, revision: 1 })).title, 'Reviewed issue');
  assert.equal((await read('issues', 'history', { ref: issue.ref })).revisions.length, 2); count++;
  issue = await success({ area: 'issues', action: 'comment', ref: issue.ref, expectedRevision: issue.revision, body: 'Please clarify' });
  var feedback = await read('issues', 'feedback'); assert.equal(feedback.feedback.length, 1); count++;
  issue = await success({ area: 'issues', action: 'review', ref: issue.ref, expectedRevision: issue.revision, commentId: feedback.feedback[0].commentId, reviewAction: 'clarify', response: 'Which trigger?' });
  assert.equal((await read('issues', 'feedback')).feedback.length, 0); count++;
  issue = await success({ area: 'issues', action: 'comment', ref: issue.ref, expectedRevision: issue.revision, body: 'Update reproduction' });
  feedback = await read('issues', 'feedback');
  issue = await success({ area: 'issues', action: 'review', ref: issue.ref, expectedRevision: issue.revision, commentId: feedback.feedback[0].commentId, reviewAction: 'incorporate', body: 'Confirmed reproduction' });
  assert.equal(issue.body, 'Confirmed reproduction'); count++;
  var invalid = await call('inspect_project_record_change', { projectSlug: 'target', operation: { area: 'issues', action: 'update', ref: issue.ref, expectedRevision: 1, title: 'Conflict' } }); assert.match(invalid.error, /conflict/); count++;
  p = await propose({ area: 'issues', action: 'update', ref: issue.ref, expectedRevision: issue.revision, title: 'Stale' });
  issue = await driver.updateIssue({ ref: issue.ref, expectedRevision: issue.revision, title: 'Driver edit' });
  assert.equal(f.answer(p), false); cancel(p); await p.promise; count++;
  p = await propose({ area: 'issues', action: 'update', ref: issue.ref, expectedRevision: issue.revision, status: 'resolved', resolutionSummary: 'Requires real evidence', commitSha: '1234567' });
  f.answer(p); result = await p.promise; assert.equal(result.status, 'failed'); assert.match(result.error, /Git|git|repository|ambiguous|revision/); assert.equal((await read('issues', 'read', { ref: issue.ref })).status, 'in_progress'); count++;
  // Reuse an existing commit in an isolated repository; never create a commit.
  var cp = require('node:child_process'), repository = path.resolve(__dirname, '../..'), cwd = f.target.getStatus().path;
  var sha = cp.execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  cp.execFileSync('git', ['-C', cwd, 'init', '-q']);
  cp.execFileSync('git', ['-C', cwd, 'fetch', '-q', '--no-tags', '--depth=1', repository, sha]);
  var gitCli = require('../../lib/git-cli'), originalGit = gitCli.runGit;
  for (var invalidation of ['foreignInput', 'stop', 'query', 'revoked', 'targetDeleted']) {
    var release, entered;
    var gate = new Promise(function (resolve) { release = resolve; });
    var atAwait = new Promise(function (resolve) { entered = resolve; });
    gitCli.runGit = function (directory, args) {
      return originalGit.apply(gitCli, arguments).then(async function (output) {
        if (args[0] === 'show') { entered(); await gate; }
        return output;
      });
    };
    p = await propose({ area: 'issues', action: 'update', ref: issue.ref, expectedRevision: issue.revision, status: 'resolved', resolutionSummary: 'Existing fixture evidence', commitSha: sha });
    f.answer(p); await atAwait;
    if (invalidation === 'foreignInput') f.sourceSession._mcpForeignInput = true;
    if (invalidation === 'stop') f.sourceSession.taskStopRequested = true;
    if (invalidation === 'query') f.sourceSession._sdkQueryGeneration++;
    if (invalidation === 'revoked') f.revoke();
    if (invalidation === 'targetDeleted') f.projects.delete('target');
    release(); result = await p.promise;
    gitCli.runGit = originalGit;
    assert.equal(result.status, 'failed', invalidation); count++;
    f.sourceSession._mcpForeignInput = false; f.sourceSession.taskStopRequested = false; f.sourceSession._sdkQueryGeneration = 8;
    f.projects.set('target', f.target); f.restoreAccess();
    assert.equal((await read('issues', 'read', { ref: issue.ref })).revision, issue.revision);
  }
  issue = await success({ area: 'issues', action: 'update', ref: issue.ref, expectedRevision: issue.revision, status: 'resolved', resolutionSummary: 'Existing fixture commit verified by Git', commitSha: sha });
  assert.equal(issue.verifiedCommit.sha, sha); count++;
  issue = await success({ area: 'issues', action: 'update', ref: issue.ref, expectedRevision: issue.revision, status: 'open' });
  issue = await success({ area: 'issues', action: 'update', ref: issue.ref, expectedRevision: issue.revision, status: 'closed', closeReason: 'non_code_decision' });
  issue = await success({ area: 'issues', action: 'update', ref: issue.ref, expectedRevision: issue.revision, status: 'open' });
  var log = await success({ area: 'logs', action: 'create', title: 'Reviewable log', kind: 'decision', summary: 'Fixture decision summary', body: 'Original', tags: '["fixture"]' });
  assert.equal(log.createdBy.type, 'canonicalClay'); assert.equal(log.createdBy.sessionOriginId, f.sourceSession.sessionOriginId); assert.equal(log.createdBy.sourceProjectSlug, 'clay-source'); assert.deepEqual(log.tags, ['fixture']); count++;
  log = await success({ area: 'logs', action: 'update', ref: log.ref, expectedRevision: log.revisions, body: 'Revision two' });
  log = await success({ area: 'logs', action: 'link', ref: log.ref, expectedRevision: log.revisions, links: JSON.stringify([{ ref: issue.ref, label: 'Related issue' }]) });
  assert.equal((await read('logs', 'search', { query: 'Reviewable' })).results.length, 1); count++;
  assert.equal((await read('logs', 'revision', { ref: log.ref, revision: 1 })).snapshot.body, 'Original'); count++;
  assert.equal((await read('logs', 'history', { ref: log.ref })).total, 3); count++;
  log = await success({ area: 'logs', action: 'comment', ref: log.ref, expectedRevision: log.revisions, body: 'Human proposal remains reviewable' });
  feedback = await read('logs', 'feedback'); var comment = feedback.feedback[0]; assert.ok(comment); count++;
  log = await success({ area: 'logs', action: 'review', ref: log.ref, expectedRevision: log.revisions, commentId: comment.commentId, reviewAction: 'incorporate', body: 'Incorporated' });
  assert.equal(log.revisions, 4); assert.equal((await read('logs', 'feedback')).total, 0); count++;
  p = await propose({ area: 'logs', action: 'review', ref: log.ref, expectedRevision: log.revisions, commentId: comment.commentId, reviewAction: 'decline', response: 'Already reviewed' }); f.answer(p); result = await p.promise; assert.equal(result.status, 'failed'); assert.match(result.error, /already.*reviewed/); count++;
  log = await success({ area: 'logs', action: 'revert', ref: log.ref, expectedRevision: log.revisions, revision: 1, reason: 'Restore original decision' }); assert.equal(log.body, 'Original'); count++;
  p = await propose({ area: 'logs', action: 'update', ref: log.ref, expectedRevision: log.revisions, body: 'Stale after comment' });
  log = logDriver.commentLog({ ref: log.ref, body: 'Concurrent feedback' }); assert.equal(f.answer(p), false); cancel(p); await p.promise; count++;
  for (var mode of ['foreignInput', 'stop', 'query', 'sourceDeleted', 'targetDeleted', 'revoked']) {
    p = await propose({ area: 'logs', action: 'create', title: 'Guarded ' + mode, kind: 'decision', summary: 'Fixture decision summary' });
    var source = f.projects.get('clay-source'), target = f.projects.get('target');
    if (mode === 'foreignInput') f.sourceSession._mcpForeignInput = true;
    if (mode === 'stop') f.sourceSession.taskStopRequested = true;
    if (mode === 'query') f.sourceSession._sdkQueryGeneration++;
    if (mode === 'sourceDeleted') f.projects.delete('clay-source');
    if (mode === 'targetDeleted') f.projects.delete('target');
    if (mode === 'revoked') f.revoke();
    assert.equal(f.answer(p), false, mode); cancel(p); await p.promise;
    assert.equal((await call('control_project_records', p.args)).status, 'failed', mode); count++;
    f.sourceSession._mcpForeignInput = false; f.sourceSession.taskStopRequested = false; f.sourceSession._sdkQueryGeneration = 8;
    f.projects.set('clay-source', source); f.projects.set('target', target); f.restoreAccess();
  }
  p = await propose({ area: 'logs', action: 'update', ref: log.ref, expectedRevision: log.revisions, title: 'Cancelled' }); f.answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); count++;
  var originalAppend = fs.openSync;
  p = await propose({ area: 'logs', action: 'create', title: 'Failed save', kind: 'decision', summary: 'Fixture decision summary' });
  fs.openSync = function (file, flags) { if (flags === 'a' && String(file).includes('records')) throw new Error('Fixture record save failure'); return originalAppend.apply(fs, arguments); };
  try { f.answer(p); result = await p.promise; } finally { fs.openSync = originalAppend; }
  assert.equal(result.status, 'failed', JSON.stringify(result)); assert.match(result.error, /save failure/); count++;
  assert.equal((await read('logs', 'list')).entries.some(function (entry) { return entry.title === 'Failed save'; }), false); count++;
  var originalWrite = fs.writeSync, savedWrites = 0;
  p = await propose({ area: 'logs', action: 'create', title: 'Uncertain saved log', kind: 'decision', summary: 'A saved append may fail after writing' });
  fs.writeSync = function (fd, buffer) {
    var result = originalWrite.apply(fs, arguments);
    if (Buffer.isBuffer(buffer) && buffer.toString().includes('Uncertain saved log')) { savedWrites++; throw new Error('Fixture error after actual append'); }
    return result;
  };
  try { f.answer(p); result = await p.promise; } finally { fs.writeSync = originalWrite; }
  assert.equal(result.status, 'failed'); assert.equal(result.persisted, 'unknown'); assert.equal(result.retrySafe, false);
  assert.deepEqual(await call('control_project_records', p.args), result); assert.equal(savedWrites, 1);
  assert.equal((await read('logs', 'list')).entries.filter(function (entry) { return entry.title === 'Uncertain saved log'; }).length, 1); count++;
  var worktree = f.make('worktree'), statusForWorktree = worktree.getStatus;
  worktree.getStatus = function () { return Object.assign({}, statusForWorktree(), { isWorktree: true, parentSlug: 'target', changeSetId: 'cs_records_change', branch: 'fixture-change' }); };
  var workLog = await success({ area: 'logs', action: 'create', title: 'Worktree record', kind: 'decision', summary: 'Worktree context is retained' }, 'worktree');
  assert.equal(workLog.context.changeSetId, 'cs_records_change');
  assert.equal((await read('logs', 'list', { contextMode: 'project' })).entries.some(function (entry) { return entry.ref === workLog.ref; }), false);
  assert.equal((await read('logs', 'list', { contextMode: 'all' })).entries.some(function (entry) { return entry.ref === workLog.ref; }), true); count++;
  var workIssue = await success({ area: 'issues', action: 'create', title: 'Worktree issue' }, 'worktree');
  assert.equal(workIssue.context.changeSetId, 'cs_records_change'); assert.equal(driver.readIssue({ ref: workIssue.ref }).title, 'Worktree issue'); count++;
  p = await propose({ area: 'logs', action: 'update', ref: workLog.ref, expectedRevision: workLog.revisions, body: 'Stale context' }, 'worktree');
  worktree.getStatus = function () { return Object.assign({}, statusForWorktree(), { isWorktree: true, parentSlug: 'target', changeSetId: 'cs_changed_context' }); };
  assert.equal(f.answer(p), false); cancel(p); await p.promise; count++;
  log = await success({ area: 'logs', action: 'delete', ref: log.ref, expectedRevision: log.revisions }); assert.equal(log.deleted, true); count++;
  assert.equal((await read('logs', 'read', { ref: log.ref })).status, 'failed'); count++;
  issue = await success({ area: 'issues', action: 'delete', ref: issue.ref, expectedRevision: issue.revision }); assert.equal(issue.deleted, true); count++;
  assert.equal((await read('issues', 'read', { ref: issue.ref })).status, 'failed'); count++;
  var readOnly = f.services.logs.bindMate(sourceArgs);
  assert.ok(readOnly); assert.ok(readOnly.listLogs({ projectSlug: 'target' }));
  f.sourceSession._mcpForeignInput = true; assert.throws(function () { readOnly.listLogs({ projectSlug: 'target' }); }, /private|Foreign/);
  f.sourceSession._mcpForeignInput = false; f.sourceSession._sdkQueryGeneration++;
  assert.throws(function () { readOnly.listLogs({ projectSlug: 'target' }); }, /no longer valid/);
  var next = f.controls.bind(sourceArgs); assert.ok(next);
  assert.throws(function () { next.actProjectRecords(p.args); }, /Inspect/);
  f.sourceSession._sdkQueryGeneration = 8; count++;
  console.log(count + ' production project record scenarios passed');
}
module.exports = { run: run };
