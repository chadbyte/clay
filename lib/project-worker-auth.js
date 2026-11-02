// Live owner-only authentication receipts. Never reconstructed from history.
var crypto = require('crypto');
var provenance = require('./session-provenance');
var LIFETIME = 5 * 60 * 1000;
function attach(ctx) {
  var receipts = new WeakMap();
  function identity(ws) {
    return ctx.osUsers ? ctx.getOsUserInfoForWs(ws) : null;
  }
  function visible(ws, pair) {
    return ws && ws.readyState === 1 && ctx.clients.has(ws) && !ws._clayPaneActivation &&
      (ws._clayActiveSession === pair.driver.localId || ws._clayActiveSession === pair.worker.localId);
  }
  function valid(ws, receipt) {
    if (!receipt || receipt.expires <= Date.now()) return false;
    var pair = ctx.currentPair(ws, receipt.target);
    return !!(pair && visible(ws, pair) && pair.driver === receipt.driver && pair.worker === receipt.worker &&
      JSON.stringify([pair.group.id, pair.group.members, pair.group.pair]) === receipt.group &&
      !pair.worker.hidden && !pair.driver.hidden && pair.worker.vendor === receipt.vendor && pair.linuxUser === receipt.linuxUser && !pair.worker.taskStopRequested &&
      !pair.driver.taskStopRequested && !(pair.driver._pairTurnControl && pair.driver._pairTurnControl.humanStopped) &&
      (pair.driver._forceStopRevision || 0) === receipt.driverStop &&
      (pair.worker._forceStopRevision || 0) === receipt.stop &&
      (pair.worker._queryGeneration || 0) === receipt.query &&
      ctx.requestAccess.hasPermission(ws, 'terminal') &&
      JSON.stringify(identity(ws)) === receipt.identity);
  }
  function emit(worker, message) {
    if (!provenance.isWorker(worker)) return false;
    if (ctx.sm.sessions.get(worker.localId) !== worker) return true;
    worker._workerAuthRequired = true;
    if (worker._workerAuthFailureQuery !== worker._queryGeneration || !worker._workerAuthFailureRecorded) {
      worker._workerAuthFailureQuery = worker._queryGeneration;
      worker._workerAuthFailureRecorded = true;
      ctx.sm.sendAndRecord(worker, { type: 'error', text: 'The Worker needs provider sign-in. Complete sign-in, then explicitly retry the delegated task. No task was replayed.' });
    }
    var target = { parentSessionOriginId: worker.sessionProvenance.parentSessionOriginId,
      workerSessionOriginId: worker.sessionOriginId, generation: worker.sessionProvenance.generation };
    ctx.clients.forEach(function (ws) {
      var pair = ctx.currentPair(ws, target);
      if (!pair || pair.worker !== worker || !visible(ws, pair) || worker.hidden || worker.taskStopRequested) return;
      var entries = receipts.get(ws) || new Map();
      entries.forEach(function (entry, id) { if (!valid(ws, entry)) entries.delete(id); });
      var receipt;
      entries.forEach(function (entry) { if (entry.worker === worker) receipt = entry; });
      if (!receipt) {
        receipt = { id: crypto.randomUUID(), target: target, driver: pair.driver, worker: worker,
          group: JSON.stringify([pair.group.id, pair.group.members, pair.group.pair]), vendor: worker.vendor,
          identity: JSON.stringify(identity(ws)), linuxUser: pair.linuxUser, query: worker._queryGeneration || 0,
          stop: worker._forceStopRevision || 0, driverStop: pair.driver._forceStopRevision || 0, expires: Date.now() + LIFETIME };
        if (entries.size >= 16) entries.delete(entries.keys().next().value);
        entries.set(receipt.id, receipt); receipts.set(ws, entries);
      }
      if (!valid(ws, receipt)) return;
      ctx.sendTo(ws, { type: 'worker_auth_required', slug: ctx.slug, vendor: worker.vendor,
        sessionId: worker.localId, workerAuthRequestId: receipt.id, text: message.text,
        canAutoLogin: message.canAutoLogin, loginCommand: message.loginCommand });
    });
    // Worker events use this owner flow even when no eligible connection exists.
    return true;
  }
  function resolve(ws, msg) {
    var entries = receipts.get(ws), receipt = entries && entries.get(msg.workerAuthRequestId);
    if (!valid(ws, receipt) || msg.vendor !== receipt.vendor || msg.sessionId !== receipt.worker.localId) {
      throw new Error('This Worker sign-in request expired or its context changed. Retry the Worker explicitly to request sign-in again.');
    }
    return { identity: { linuxUser: receipt.linuxUser || null, osUserInfo: JSON.parse(receipt.identity) },
      validate: function (peer) { return peer === ws && valid(ws, receipt); } };
  }
  return { emit: emit, resolve: resolve };
}
module.exports = { attach: attach };
