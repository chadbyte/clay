var grants = new WeakMap();
function issue(check) { var token = Object.freeze({}); grants.set(token, check); return token; }
function validate(token, slug, session) {
  var check = token && grants.get(token);
  if (!check) throw new Error('Canonical Clay scheduling authority is required.');
  return check(slug, session);
}
function assertMate(ownerId, mateId, multiUser) {
  var mates = require('./mates');
  var mate = mates.getMate(mates.buildMateCtx(multiUser ? ownerId : null), mateId);
  if (!mate || mate.lifecycleDeletion || multiUser && mate.createdBy !== ownerId) throw new Error('Mate schedule runtime is unavailable.');
  return mate;
}
function assertHost(ownerId, mateId, multiUser) {
  var mate = assertMate(ownerId, mateId, multiUser);
  var definition = require('./builtin-mates').getBuiltinByKey(mate.builtinKey);
  if (mate.builtinKey !== 'clay' || !definition || !definition.hostAgent) throw new Error('Canonical Clay schedule runtime is unavailable.');
}
module.exports = { issue: issue, validate: validate, assertHost: assertHost, assertMate: assertMate };
