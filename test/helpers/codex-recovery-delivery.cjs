var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var fixtures = require('./codex-recovery-fixture.cjs');

function fixture(t, override, options) {
  var kit = fixtures.fixture(t, override, options);
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-codex-delivery-'));
  t.after(async function() {
    await Promise.all(Array.from(sm.sessions.values()).map(function(session) { return session.streamPromise; }));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  var sm = require('../../lib/sessions').createSessionManager({
    cwd: directory, sessionsBase: path.join(directory, 'sessions'), cliSessionsDir: path.join(directory, 'cli'), send: function() {},
  });
  var driver = sm.createSessionRaw({ vendor: 'codex', cliSessionId: 'saved-thread' });
  driver.title = 'Fixture Driver';
  driver.titleManuallySet = true;
  var worker = sm.createSessionRaw({ vendor: 'codex' });
  worker._pairGeneration = 13;
  sm.saveSessionFile(driver);
  sm.saveSessionFile(worker);
  var group = { id: 'pair', members: [driver.localId, worker.localId], pair: { driverId: driver.localId, workerId: worker.localId } };
  var store = { groupForMember: function() { return group; } };
  var turnControl = require('../../lib/session-pair-turn-control').attachPairTurnControl({ sm: sm, splitStore: store });
  var outbox = require('../../lib/project-pair-result-outbox').attachPairResultOutbox({ filePath: path.join(directory, 'outbox.json') });
  var sdk = require('../../lib/sdk-bridge').createSDKBridge({ cwd: process.cwd(), adapter: kit.adapter,
    adapters: { codex: kit.adapter }, sessionManager: sm, send: function() {},
    getSessionToolDefs: function() { return [{ name: 'create_issue', description: 'Fixture tool', inputSchema: { type: 'object' }, handler: function() { return {}; } }]; },
  });
  var pipeline = require('../../lib/project-pair-result-pipeline').attachPairResultPipeline({
    sm: sm, store: store, resultOutbox: outbox,
    getSdk: function() { return sdk; }, getLinuxUserForSession: function() { return null; }, acceptanceTimeoutMs: 30,
    blockedReason: turnControl.blockedReason,
    finishDelegation: function(currentGroup, caller, partner) { delete partner._pairDelegation; }, drain: function() {},
  });
  var token = { groupId: group.id, taskId: 'task-13', generation: 13, workerSessionId: worker.localId,
    startIndex: 0, message: 'Verify the replacement Worker result', response: 'Verified Worker evidence', from: driver.localId };
  worker._pairDelegation = token;
  var begun = pipeline.capture.begin(driver, worker, token, token.message, 'fixture');
  if (!begun.ok) throw new Error(begun.error);
  return Object.assign(kit, { sdk: sdk, sm: sm, driver: driver, worker: worker, token: token, pipeline: pipeline, outbox: outbox,
    stop: function() { turnControl.markHumanStop(driver); driver.taskStopRequested = true; },
    complete: function() { return pipeline.capture.capture(driver, worker, token, { status: 'completed', response: token.response }); },
    record: function() { return outbox.get(token.outboxKey); },
  });
}
module.exports = { fixture: fixture };
