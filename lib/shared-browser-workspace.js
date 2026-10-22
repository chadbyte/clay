// Human workbench scope follows the live pair registry, never model-supplied IDs.
var roles = require('./session-split-group-roles');
var provenance = require('./session-provenance');

function sourceStamp(session) {
  var source = session && session.sessionProvenance;
  return JSON.stringify([session && session.sessionOriginId || null, source && source.kind || null,
    source && source.parentSessionOriginId || null, source && source.generation || null, session && session._pairGeneration || null]);
}
function linkedWorker(ctx, driver, worker) {
  if (ctx.isMate || !driver || !worker || driver === worker || provenance.isWorker(driver) ||
      !driver.sessionOriginId || !worker.sessionOriginId || !provenance.isWorker(worker) ||
      !ctx.getWorkerGroup || (driver.ownerId || null) !== (worker.ownerId || null)) return false;
  var live = roles.resolveLiveRoles(ctx.sm, ctx.getWorkerGroup(driver.localId));
  if (!live || live.driver !== driver || live.workers.indexOf(worker) < 0) return false;
  var hierarchy = provenance.hierarchyFor(Array.from(ctx.sm.sessions.values())), entry = hierarchy[worker.localId];
  return !!entry && entry.parentAvailable && entry.parentSessionId === driver.localId &&
    Number.isSafeInteger(entry.generation) && entry.generation > 0 &&
    (worker._pairGeneration == null || entry.generation === worker._pairGeneration);
}
function describe(record) {
  var session = record.session;
  return { sourceSessionId: session.localId, sourceSessionOriginId: session.sessionOriginId || null,
    sourceRole: provenance.isWorker(session) ? 'worker' : 'driver',
    sourceTitle: String(session.title || '').slice(0, 200), sourceVendor: session.vendor || '',
    sourceGeneration: provenance.isWorker(session) ? session.sessionProvenance.generation : null };
}
module.exports = { sourceStamp: sourceStamp, linkedWorker: linkedWorker, describe: describe };
