var splitRoles = require("./session-split-group-roles");

function removeSelectedWorker(store, group, driver, worker, capability, hooks) {
  var normalized = splitRoles.normalizePair(group.pair, group.members);
  if (!normalized.ok || normalized.kind !== "versioned") {
    var ws = { _clayUser: driver.ownerId ? { id: driver.ownerId } : null };
    return store.dissolve(ws, { id: group.id }, hooks);
  }
  return store.removeWorker(driver.ownerId || null, {
    groupId: group.id,
    driverId: driver.localId,
    driverOriginId: driver.sessionOriginId || null,
    workerId: worker.localId,
    workerOriginId: worker.sessionOriginId || null,
    generation: worker._pairGeneration ||
      worker.sessionProvenance && worker.sessionProvenance.generation || null,
  }, capability, hooks);
}

module.exports = { removeSelectedWorker: removeSelectedWorker };
