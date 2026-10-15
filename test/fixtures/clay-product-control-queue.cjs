var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
var refs = require('../../lib/workspace-query-service');
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
async function run(group, f) {
  var target = f.target, counter = 0, cases = 0;
  function bridge() { return f.source.getMcpBridgeHandler(f.sourceSession.localId, true, Number(f.sourceSession._sdkQueryGeneration || 0)); }
  async function call(name, args) { return f.decode(await bridge().callTool('clay-workspace', name, args || {})); }
  async function inspect(item) { return call('inspect_session_control', { projectSlug: 'target', sessionRef: refs.sessionRef('target', item) }); }
  async function propose(action, fields, item, requestId) {
    var state = await inspect(item), args = Object.assign({ targetToken: state.targetToken, action: action, why: 'Apply the exact reviewed Driver operation', requestId: requestId || 'queue-' + (++counter) }, fields);
    var promise = call('control_project_session', args); await tick();
    var ids = Object.keys(f.sourceSession.pendingAskUser || {});
    return { args: args, promise: promise, id: ids[ids.length - 1] };
  }
  async function approved(action, fields, item, requestId) { var p = await propose(action, fields, item, requestId); assert.equal(f.answer(p), true); return { result: await p.promise, proposal: p }; }
  function fresh(busy) { var item = target.sm.createSessionRaw({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' }); item.isProcessing = !!busy; assert.equal(target.sm.saveSessionFile(item), true); return item; }
  function blockedDirectory(directory) {
    var existed = fs.existsSync(directory), saved = directory + '.queue-held';
    if (existed) fs.renameSync(directory, saved);
    fs.writeFileSync(directory, 'Actual storage failure');
    return function () { fs.unlinkSync(directory); if (existed) fs.renameSync(saved, directory); };
  }
  if (group === 'queue-lifecycle') {
    var item = fresh(true), p = await propose('queue_add', { text: 'First task\nUse the existing Driver.' }, item);
    assert.equal((await inspect(item)).queue.items.length, 0); f.answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); cases++;
    var first = await approved('queue_add', { text: 'First task\nUse the existing Driver.' }, item, 'durable-first');
    var second = await approved('queue_add', { text: 'Second task' }, item);
    assert.equal(first.result.status, 'queued'); assert.equal(first.result.persisted, true); assert.equal(item.history.length, 0);
    assert.equal(second.result.queue.items.filter(function (entry) { return entry.state === 'pending'; }).length, 2); cases++;
    assert.deepEqual(await call('control_project_session', first.proposal.args), first.result); assert.equal((await inspect(item)).queue.items.length, 2); cases++;
    var edited = await approved('queue_edit', { messageId: first.result.messageId, text: 'Edited first task' }, item);
    assert.equal(edited.result.status, 'completed'); assert.equal(edited.result.queue.items[0].text, 'Edited first task'); cases++;
    var reordered = await approved('queue_reorder', { ids: [second.result.messageId, first.result.messageId] }, item);
    assert.equal(reordered.result.status, 'completed'); assert.equal(reordered.result.queue.items[0].id, second.result.messageId); cases++;
    var cancelled = await approved('queue_cancel', { messageId: second.result.messageId }, item);
    assert.equal(cancelled.result.status, 'completed'); assert.equal(cancelled.result.queue.items[0].state, 'cancelled'); cases++;
    var events = [], viewer = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: item.localId, send: function (data) { events.push(JSON.parse(data)); } }; target.clients.add(viewer);
    target.handleMessage(viewer, { type: 'pending_message_get', projectSlug: 'target', sessionId: item.localId, requestId: 'reconnect' });
    var hydrated = events.find(function (event) { return event.type === 'pending_message_result'; }).result;
    assert.equal(hydrated.items.find(function (entry) { return entry.id === first.result.messageId; }).message.text, 'Edited first task'); cases++;
    // Recreate the real target project to test actual queue/session disk reload.
    target.destroy(); target = f.make('target');
    item = Array.from(target.sm.sessions.values()).find(function (entry) { return entry.sessionOriginId === item.sessionOriginId; }); assert.ok(item); item.isProcessing = true;
    assert.equal((await inspect(item)).queue.items.find(function (entry) { return entry.id === first.result.messageId; }).text, 'Edited first task'); cases++;
    f.sourceSession._sdkQueryGeneration = 9;
    var retried = await approved('queue_add', { text: 'First task\nUse the existing Driver.' }, item, 'durable-first');
    assert.equal(retried.result.messageId, first.result.messageId); assert.equal(retried.result.queue.items.find(function (entry) { return entry.id === first.result.messageId; }).text, 'Edited first task'); cases++;
    f.sourceSession._sdkQueryGeneration = 10;
    var conflict = await approved('queue_add', { text: 'Different original payload' }, item, 'durable-first');
    assert.equal(conflict.result.status, 'failed'); assert.match(conflict.result.error, /different durable/); cases++;
    var third = await approved('queue_add', { text: 'Third task' }, item, 'resume-dedup');
    f.sourceSession._sdkQueryGeneration = 11;
    var repeat = await approved('queue_add', { text: 'Third task' }, item, 'resume-dedup'); assert.equal(repeat.result.messageId, third.result.messageId); cases++;
    var stopState = await inspect(item), stopped = await call('control_project_session', { targetToken: stopState.targetToken, action: 'stop', why: 'Stop the queued Driver', requestId: 'stop-queue' });
    assert.equal(stopped.status, 'queued'); item.isProcessing = false;
    var afterStop = await approved('queue_add', { text: 'Remain queued after Stop' }, item); await tick();
    assert.equal(afterStop.result.status, 'queued'); assert.equal(afterStop.result.queue.paused, true); assert.equal(item.taskStopRequested, true); assert.equal(item._pendingMessageDrainPaused, true); assert.equal(item.history.length, 0); cases++;
    var stoppedOrigin = item.sessionOriginId; target.destroy(); target = f.make('target');
    item = Array.from(target.sm.sessions.values()).find(function (entry) { return entry.sessionOriginId === stoppedOrigin; });
    assert.equal((await inspect(item)).queue.paused, true);
    item.cliSessionId = 'stopped-restored-provider';
    assert.throws(function () { target.inspectDelegatedFollowUp({ userId: 'owner' }, refs.sessionRef('target', item)); }, /stopped|Stop/i); cases++;
    var afterStopCancel = await approved('queue_cancel', { messageId: afterStop.result.messageId }, item); assert.equal(afterStopCancel.result.status, 'completed'); assert.equal(afterStopCancel.result.queue.paused, true); cases++;
    var emptyStopped = fresh(false), emptyState = await inspect(emptyStopped);
    await call('control_project_session', { targetToken: emptyState.targetToken, action: 'stop', why: 'Stop an empty Driver', requestId: 'stop-empty' });
    var emptyAdded = await approved('queue_add', { text: 'Keep durable Stop on first admission' }, emptyStopped); assert.equal(emptyAdded.result.queue.paused, true);
    var emptyOrigin = emptyStopped.sessionOriginId; target.destroy(); target = f.make('target');
    emptyStopped = Array.from(target.sm.sessions.values()).find(function (entry) { return entry.sessionOriginId === emptyOrigin; });
    assert.equal((await inspect(emptyStopped)).queue.paused, true); cases++;
    var stoppedVendor = await approved('vendor', { value: 'claude' }, emptyStopped); assert.equal(stoppedVendor.result.status, 'failed'); assert.equal(emptyStopped.vendor, 'codex'); cases++;
    // Delivery goes through the production queue consumer and SDK push path.
    var delivery = fresh(false), sent = []; delivery.cliSessionId = 'delivery-fixture'; delivery.queryInstance = { pushMessage: function (text) { sent.push(text); return true; } };
    var queued = await approved('queue_add', { text: 'Execute through this Driver' }, delivery); await tick(); await tick();
    assert.equal(queued.result.status, 'queued'); assert.equal(sent.length, 1); assert.ok(sent[0].includes('Execute through this Driver'));
    assert.equal((await inspect(delivery)).queue.items.find(function (entry) { return entry.id === queued.result.messageId; }).state, 'consumed'); cases++;
    f.sourceSession._sdkQueryGeneration = 12;
    var deliveredRetry = await approved('queue_add', { text: 'Execute through this Driver' }, delivery, queued.proposal.args.requestId);
    assert.equal(deliveredRetry.result.status, 'completed'); assert.equal(deliveredRetry.result.deliveryState, 'consumed'); assert.equal(sent.length, 1); cases++;
    var broken = fresh(false); broken.cliSessionId = 'broken-provider'; broken.queryInstance = { pushMessage: function () { throw new Error('Fixture provider delivery failed'); } };
    var brokenResult = await approved('queue_add', { text: 'Provider cannot accept this task' }, broken); await tick(); await tick();
    assert.equal(brokenResult.result.status, 'queued');
    var brokenItem = (await inspect(broken)).queue.items.find(function (entry) { return entry.id === brokenResult.result.messageId; });
    assert.equal(brokenItem.state, 'failed'); assert.ok(brokenItem.failure); cases++;

  }
  if (group === 'queue-safety') {
    var item = fresh(true), first = await approved('queue_add', { text: 'Owned task' }, item);
    for (var transition of ['revision', 'replace', 'revoke', 'foreign-source']) {
      var p = await propose('queue_edit', { messageId: first.result.messageId, text: 'Must not apply stale change' }, item);
      if (transition === 'revision') await approved('queue_add', { text: 'Concurrent queue change' }, item);
      if (transition === 'replace') target.sm.sessions.set(item.localId, Object.assign({}, item));
      if (transition === 'revoke') f.revoke();
      if (transition === 'foreign-source') f.sourceSession._mcpForeignInput = true;
      assert.equal(f.answer(p), false);
      f.sourceSession.pendingAskUser[p.id].respond.cancel('Exact review became stale'); await p.promise;
      target.sm.sessions.set(item.localId, item); f.restoreAccess(); delete f.sourceSession._mcpForeignInput;
      assert.equal((await inspect(item)).queue.items[0].text, 'Owned task'); cases++;
    }
    var p = await propose('queue_add', { text: 'No commit after approval race' }, item); f.answer(p); f.revoke(); assert.equal((await p.promise).status, 'failed'); f.restoreAccess(); cases++;
    var p = await propose('queue_add', { text: 'No commit to a replaced session' }, item); f.answer(p); target.sm.sessions.set(item.localId, Object.assign({}, item)); assert.equal((await p.promise).status, 'failed'); target.sm.sessions.set(item.localId, item); cases++;
    var queueDir = path.join(require('../../lib/config').CONFIG_DIR, 'pending-message-queues'), before = await inspect(item);
    var p = await propose('queue_add', { text: 'This save must fail' }, item), restore = blockedDirectory(queueDir);
    try { f.answer(p); var failed = await p.promise; assert.equal(failed.status, 'failed'); assert.equal(failed.persisted, false); assert.equal(failed.queue.revision, before.queue.revision); } finally { restore(); } cases++;
    for (var operation of [['queue_edit', { messageId: first.result.messageId, text: 'Must not save' }], ['queue_cancel', { messageId: first.result.messageId }], ['queue_reorder', { ids: (await inspect(item)).queue.items.filter(function (entry) { return entry.state === 'pending'; }).map(function (entry) { return entry.id; }).reverse() }]]) {
      var before = await inspect(item), p = await propose(operation[0], operation[1], item), restore = blockedDirectory(queueDir);
      try { f.answer(p); var failed = await p.promise; assert.equal(failed.status, 'failed'); assert.equal(failed.persisted, false); assert.deepEqual(failed.queue, before.queue); } finally { restore(); } cases++;
    }
    var p = await propose('queue_add', { text: 'Saved despite failed publication' }, item);
    var brokenSocket = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: item.localId, send: function () { throw new Error('Fixture queue publication failed'); } };
    target.clients.add(brokenSocket);
    try { f.answer(p); var partial = await p.promise; assert.equal(partial.status, 'failed'); assert.equal(partial.outcome, 'partial'); assert.equal(partial.persisted, true); assert.ok(partial.queue.items.some(function (entry) { return entry.text === 'Saved despite failed publication'; })); } finally { target.clients.delete(brokenSocket); } cases++;
    var stale = await inspect(item);
    assert.equal((await call('control_project_session', { targetToken: stale.targetToken, action: 'queue_add', text: 'No arbitrary fields', value: 'worker', why: 'Refuse', requestId: 'extra-fields' })).status, 'failed'); cases++;
    f.grantForeign(); item.sessionVisibility = 'shared';
    var foreign = { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: item.localId, send: function () {} }; target.clients.add(foreign);
    target.handleMessage(foreign, { type: 'message', text: 'FOREIGN_QUEUE_SECRET', clientMessageId: 'foreign-item' }); await tick();
    var state = await inspect(item); assert.equal(JSON.stringify(state.queue).includes('FOREIGN_QUEUE_SECRET'), false); cases++;
    var data = JSON.parse(fs.readFileSync(path.join(queueDir, fs.readdirSync(queueDir).find(function (name) { return name.endsWith('.json'); })), 'utf8'));
    var foreignItem = data.items.find(function (entry) { return entry.actorId === 'foreign'; }); assert.ok(foreignItem);
    var refused = await approved('queue_cancel', { messageId: foreignItem.id }, item); assert.equal(refused.result.status, 'failed'); cases++;
    var refusedOrder = await approved('queue_reorder', { ids: [foreignItem.id, first.result.messageId] }, item); assert.equal(refusedOrder.result.status, 'failed'); cases++;
  }
  if (group === 'vendor') {
    var item = fresh(false), p = await propose('vendor', { value: 'claude' }, item); f.answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); assert.equal(item.vendor, 'codex'); cases++;
    var chosen = await approved('vendor', { value: 'claude' }, item); assert.equal(chosen.result.status, 'completed'); assert.equal(chosen.result.runtimeEffect, 'none'); assert.equal(item.vendor, 'claude'); cases++;
    var unsupported = await approved('vendor', { value: 'not-installed' }, item); assert.equal(unsupported.result.status, 'failed'); assert.equal(item.vendor, 'claude'); cases++;
    item.cliSessionId = 'bound-provider'; var bound = await approved('vendor', { value: 'codex' }, item); assert.equal(bound.result.status, 'failed'); item.cliSessionId = null; cases++;
    item.isProcessing = true; var busy = await approved('vendor', { value: 'codex' }, item); assert.equal(busy.result.status, 'failed'); item.isProcessing = false; cases++;
    var p = await propose('vendor', { value: 'codex' }, item); f.answer(p); target.sm.sessions.set(item.localId, Object.assign({}, item)); assert.equal((await p.promise).status, 'failed'); target.sm.sessions.set(item.localId, item); cases++;
    var p = await propose('vendor', { value: 'codex' }, item); f.answer(p); f.revoke(); assert.equal((await p.promise).status, 'failed'); f.restoreAccess(); cases++;
    var p = await propose('vendor', { value: 'codex' }, item), restore = blockedDirectory(target.sm.sessionsDir);
    try { f.answer(p); assert.equal((await p.promise).status, 'failed'); assert.equal(item.vendor, 'claude'); } finally { restore(); } cases++;
    var logs = [], viewer = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: item.localId, send: function (data) { logs.push(JSON.parse(data)); } }; target.clients.add(viewer);
    target.handleMessage(viewer, { type: 'set_vendor', vendor: 'codex' }); assert.equal(item.vendor, 'codex'); assert.ok(logs.some(function (event) { return event.type === 'model_info' && event.vendor === 'codex'; })); cases++;
    var publishViewer = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: item.localId, send: function () { throw new Error('Fixture WebSocket publication failed'); } };
    var p = await propose('vendor', { value: 'claude' }, item); target.clients.add(publishViewer);
    try { f.answer(p); var partial = await p.promise; assert.equal(partial.status, 'failed'); assert.equal(partial.outcome, 'partial'); assert.equal(partial.persisted, true); assert.equal(item.vendor, 'claude'); } finally { target.clients.delete(publishViewer); } cases++;
    item._pendingMessageDrainPaused = true; var stopped = await approved('vendor', { value: 'claude' }, item); assert.equal(stopped.result.status, 'failed'); assert.equal(item._pendingMessageDrainPaused, true); cases++;
  }
  console.log(group + ': ' + cases + ' production milestone 1b checks passed');
}
module.exports = { run: run };
