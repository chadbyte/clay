var crypto = require('crypto');
var provenance = require('./session-provenance');

function active(worker) {
  return !!(worker.isProcessing || worker._queryStarting || worker._responseRecoveryStopPending);
}

// Human socket endpoint only. Receipts expire after one minute and are never replayed.
function attachWorkerRemoval(ctx) {
  var receipts = new WeakMap();
  function exact(ws, msg) {
    if (ctx.isMate || !ctx.clients.has(ws) || ws.readyState !== 1 || ws._clayPaneActivation || msg.projectSlug !== ctx.slug) throw new Error('The project connection changed.');
    var user = ws._clayUser && ctx.usersModule.findUserById(ws._clayUser.id);
    if (ctx.usersModule.isMultiUser() && (!user || !ctx.usersModule.canAccessProject(user.id, ctx.getProjectAccess()))) throw new Error('Project access is unavailable.');
    var owner = user && user.id || null;
    if (msg.ownerId !== owner || !ctx.sessionDelete.hasDeletePermission(ws)) throw new Error('Worker removal is not permitted.');
    var driver = ctx.sm.sessions.get(msg.driverId), worker = ctx.sm.sessions.get(msg.workerId);
    if (!driver || !worker || driver === worker || driver.destroying || worker.destroying || driver.hidden || worker.hidden || provenance.isWorker(driver) ||
        driver.sessionOriginId !== msg.driverOriginId || worker.sessionOriginId !== msg.workerOriginId ||
        !msg.driverOriginId || !msg.workerOriginId || (driver.ownerId || null) !== owner || (worker.ownerId || null) !== owner) throw new Error('The exact Driver or Worker changed.');
    var matches = 0;
    ctx.sm.sessions.forEach(function (session) { if (session.sessionOriginId === msg.driverOriginId || session.sessionOriginId === msg.workerOriginId) matches++; });
    var record = worker.sessionProvenance;
    if (matches !== 2 || !record || record.kind !== 'worker' || record.parentSessionOriginId !== driver.sessionOriginId ||
        !Number.isInteger(msg.generation) || msg.generation < 1 || record.generation !== msg.generation ||
        worker._pairGeneration && worker._pairGeneration !== msg.generation) throw new Error('The Worker generation changed.');
    if (ctx.osUsers) {
      var linux = user && user.linuxUser;
      if (!linux || !ctx.getOsUserInfoForWs(ws) || ctx.getLinuxUserForSession(driver) !== linux || ctx.getLinuxUserForSession(worker) !== linux) throw new Error('The OS identity changed.');
    }
    if (user && (!ctx.usersModule.getEffectivePermissions(user, ctx.osUsers).sessionDelete ||
        !ctx.usersModule.canAccessSession(user.id, driver, ctx.getProjectAccess()))) throw new Error('Driver access or removal permission changed.');
    var plan = ctx.sessionDelete.planDeletion(ws, [worker], ctx.getProjectAccess());
    if (!plan.ok || plan.ids.length !== 1 || plan.ids[0] !== worker.localId) throw new Error(plan.error || 'The exact removal scope changed.');
    return { driver: driver, worker: worker, plan: plan };
  }
  function respond(ws, msg, status, error, token) {
    ctx.sendTo(ws, { type: 'split_worker_remove_result', requestId: msg.requestId, projectSlug: ctx.slug,
      workerOriginId: msg.workerOriginId, generation: msg.generation, status: status, error: error || null, token: token || null });
  }
  async function perform(ws, msg, receipt) {
    try {
      var pair = exact(ws, msg), worker = pair.worker, driver = pair.driver;
      if (receipt.driver && (receipt.driver !== driver || receipt.worker !== worker)) throw new Error('The reviewed sessions were replaced.');
      if (receipt.confirmed && (receipt.query !== worker.queryInstance || receipt.delegation !== worker._pairDelegation ||
          receipt.stopRevision !== worker._humanStopRevision || receipt.driverStopRevision !== driver._humanStopRevision)) throw new Error('The reviewed Worker execution changed.');
      var sourceSession = ws._clayActiveSession;
      if (receipt.sourceSession !== sourceSession) throw new Error('The source conversation changed.');
      if (active(worker)) {
        if (!receipt.confirmed) {
          receipt.driver = driver; receipt.worker = worker; receipt.query = worker.queryInstance; receipt.delegation = worker._pairDelegation;
          receipt.stopRevision = worker._humanStopRevision; receipt.driverStopRevision = driver._humanStopRevision;
          receipt.token = crypto.randomUUID(); receipt.status = 'confirmation_required';
          respond(ws, msg, receipt.status, null, receipt.token); return;
        }
        var runtime = worker.queryInstance, process = worker.worker;
        ctx.actions.stop(worker, ws._clayUser || null);
        var stopRevision = worker._humanStopRevision, driverRevision = driver._humanStopRevision;
        var deadline = Date.now() + (ctx.stopTimeoutMs || 5000);
        while (active(worker)) {
          if (Date.now() >= deadline) throw new Error('Stop completion is unknown. The Worker session was retained.');
          await new Promise(function (resolve) { setTimeout(resolve, 25); });
          var current = exact(ws, msg);
          if (receipt.cancelled || current.worker !== worker || current.driver !== driver || ws._clayActiveSession !== sourceSession ||
              worker._humanStopRevision !== stopRevision || driver._humanStopRevision !== driverRevision ||
              worker.queryInstance && worker.queryInstance !== runtime || worker.worker && worker.worker !== process) throw new Error('Removal interrupted by a changed execution or source. The session was retained.');
        }
      }
      var finalPair = exact(ws, msg);
      if (receipt.cancelled || finalPair.worker !== worker || finalPair.driver !== driver || ws._clayActiveSession !== sourceSession) throw new Error('Removal was cancelled or its target changed.');
      ctx.sessionDelete.executeOwnedDeletion(finalPair.plan, { requireDurableRemoval: true });
      if (ctx.sm.sessions.has(worker.localId)) throw new Error('Worker removal was not observed.');
      receipt.status = 'removed'; respond(ws, msg, 'removed');
    } catch (error) { receipt.status = 'failed'; respond(ws, msg, 'failed', error.message || String(error)); }
  }
  function handleMessage(ws, msg) {
    if (!msg || msg.type !== 'split_worker_remove') return false;
    if (typeof msg.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(msg.requestId)) return true;
    var records = receipts.get(ws);
    if (!records) { records = new Map(); receipts.set(ws, records); }
    records.forEach(function (value, key) { if (value.expires < Date.now() && value.status !== 'removing') records.delete(key); });
    var receipt = records.get(msg.requestId);
    var fingerprint = JSON.stringify([msg.projectSlug, msg.ownerId, msg.driverId, msg.driverOriginId, msg.workerId, msg.workerOriginId, msg.generation]);
    if (msg.action === 'cancel') { if (receipt && receipt.fingerprint === fingerprint) receipt.cancelled = true; return true; }
    if (receipt) {
      if (receipt.status === 'removing' && receipt.fingerprint === fingerprint) return true;
      if (msg.action !== 'confirm' || receipt.status !== 'confirmation_required' || receipt.expires < Date.now() || receipt.cancelled ||
          receipt.fingerprint !== fingerprint || receipt.token !== msg.token) { respond(ws, msg, 'failed', 'This removal request is stale or already used.'); return true; }
      receipt.confirmed = true;
    } else {
      if (msg.action !== 'request' || records.size >= 32) { respond(ws, msg, 'failed', 'Start a fresh removal request.'); return true; }
      receipt = { fingerprint: fingerprint, sourceSession: ws._clayActiveSession, expires: Date.now() + 60000, confirmed: false };
      records.set(msg.requestId, receipt);
    }
    receipt.status = 'removing';
    receipt.promise = perform(ws, msg, receipt);
    return true;
  }
  return { handleMessage: handleMessage, exact: exact };
}
module.exports = { attachWorkerRemoval: attachWorkerRemoval, active: active };
