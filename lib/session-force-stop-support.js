var provenance = require('./session-provenance');
var termination = require('./yoke/force-termination');
function targets(sm, session) {
  return [session].concat(provenance.isWorker(session) ? [] : provenance.ownedWorkersByDriver(Array.from(sm.sessions.values()))[session.localId] || []);
}
function one(sm, session) {
  if (session._queryStarting) return { supported: false, reason: 'Force termination is unavailable while this runtime is starting' };
  return typeof sm.getForceStopSupport === 'function' ? sm.getForceStopSupport(session) : termination.support(session.vendor || sm.defaultVendor, session.queryInstance);
}
function describe(sm, session) {
  var scope = targets(sm, session), unavailable = scope.find(function (target) { return !one(sm, target).supported; });
  if (unavailable) return { supported: false, reason: one(sm, unavailable).reason + (unavailable === session ? '' : ' (owned Worker)') };
  return { supported: true, scope: 'query-runtime', externalEffects: 'unconfirmed' };
}
module.exports = { targets: targets, one: one, describe: describe };
