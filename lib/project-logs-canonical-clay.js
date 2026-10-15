var authority = require('./canonical-clay-record-authority');
function bindCanonicalClay(source, createBound) {
  if (!source || !source.projectSlug) return null;
  var initial;
  function current() {
    var live = authority.resolve(source.authority, source.projectSlug);
    if (initial && (live.project !== initial.project || live.status.path !== initial.status.path || live.status.projectKnowledgeId !== initial.status.projectKnowledgeId || live.status.changeSetId !== initial.status.changeSetId)) throw new Error('Selected Project Logs context changed.');
    return live;
  }
  try { initial = current(); } catch (error) { return null; }
  function envelope() {
    var live = current();
    return { principal: Object.assign({}, live.principal, { kind: 'canonicalClay', projectSlug: source.projectSlug }), status: live.status, author: live.actor };
  }
  var bound = createBound(envelope(), envelope);
  ['updateLog', 'reviewLogComment', 'commentLog', 'revertLog', 'linkLog', 'removeLog'].forEach(function (method) {
    var original = bound[method];
    bound[method] = function (args) {
      current();
      var entry = bound.readLog(args);
      if (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== entry.revisions) throw new Error('Log revision conflict.');
      return original(args);
    };
  });
  return bound;
}
module.exports = { bindCanonicalClay: bindCanonicalClay };
