var crypto = require('crypto');
var authority = require('./canonical-clay-record-authority');
var input = require('./clay-project-record-input');
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function text(value, max) { return typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function attachClayProjectRecords(ctx) {
  var state = ctx.state;
  // This closure is created only after the canonical source query authorizes.
  // Every service call rechecks it, including after commit-verification awaits.
  var token = authority.issue(function (slug) {
    var live = ctx.resolve(slug);
    return Object.assign({}, live, { actor: ctx.actor() });
  });
  function resolve(slug, area) {
    var live = authority.resolve(token, slug), services = ctx.services();
    var service = services && services[area];
    var bound = service && service.bindCanonicalClay({ projectSlug: slug, authority: token });
    if (!bound) throw new Error('Selected project record service is unavailable.');
    return { project: live.project, status: live.status, bound: bound };
  }
  function parse(args, write) {
    ctx.authorize();
    if (!args || Object.keys(args).some(function (key) { return key !== 'projectSlug' && key !== 'operation'; }) || !text(args.projectSlug, 200)) throw new Error('Choose an exact ordinary project and typed record operation.');
    return JSON.parse(JSON.stringify((write ? input.writeSchema : input.readSchema).parse(args.operation)));
  }
  function snapshot(live, op) {
    return op.ref ? live.bound[op.area === 'issues' ? 'readIssue' : 'readLog']({ ref: op.ref }) : null;
  }
  function check(target, exact) {
    var live = resolve(target.slug, target.op.area);
    if (live.project !== target.project || fingerprint([live.status.path, live.status.projectKnowledgeId, live.status.changeSetId, live.status.parentSlug, live.status.branch, live.status.baseCommit, live.status.headCommit]) !== target.context) throw new Error('Selected project records context changed.');
    if (exact) {
      if (Date.now() - target.created > 300000) throw new Error('Record inspection expired.');
      if (fingerprint(snapshot(live, target.op)) !== target.snapshot) throw new Error('Record or comment revision changed. Inspect and review again.');
    }
    return live;
  }
  async function read(args) {
    var op = parse(args, false), live = resolve(args.projectSlug, op.area);
    var result = await live.bound[input.READS[op.area + ':' + op.action]](input.parameters(op));
    var after = resolve(args.projectSlug, op.area);
    if (after.project !== live.project || fingerprint(after.status) !== fingerprint(live.status)) throw new Error('Selected project changed during read.');
    return result;
  }
  function inspect(args) {
    var op = parse(args, true), live = resolve(args.projectSlug, op.area), entry = snapshot(live, op);
    if (entry && (op.area === 'issues' ? entry.revision : entry.revisions) !== op.expectedRevision) throw new Error('Record revision conflict.');
    if (entry && entry.scheduledResult) throw new Error('Scheduled results are server-owned records.');
    if (JSON.stringify(op).length > 1400) throw new Error('The exact record change must fit the existing owner review; use a smaller change.');
    if (state.targets.size >= 100) state.targets.delete(state.targets.keys().next().value);
    var id = 'records-control:' + crypto.randomUUID();
    var target = { slug: args.projectSlug, op: op, project: live.project, context: fingerprint([live.status.path, live.status.projectKnowledgeId, live.status.changeSetId, live.status.parentSlug, live.status.branch, live.status.baseCommit, live.status.headCommit]), snapshot: fingerprint(entry), created: Date.now() };
    target.presentationValid = function () { check(target, true); }; state.targets.set(id, target);
    return { targetToken: id, projectSlug: args.projectSlug, operation: op, expiresInSeconds: 300 };
  }
  function act(args) {
    ctx.authorize();
    if (!args || Object.keys(args).some(function (key) { return ['targetToken', 'requestId', 'why'].indexOf(key) < 0; }) || !text(args.targetToken, 100) || !text(args.requestId, 128) || !text(args.why, 300)) throw new Error('Use an exact record token, requestId and reason.');
    args = Object.assign({}, args);
    var target = state.targets.get(args.targetToken), key = fingerprint(args), previous = state.requests.get(args.requestId);
    if (!target) throw new Error('Inspect the exact record change first.');
    if (previous) { if (previous.key !== key) throw new Error('requestId already names another record change.'); return previous.promise.then(function (result) { check(target, false); return result; }); }
    if (state.requests.size >= 100) throw new Error('Too many record requests in this query.');
    var persisted = false;
    var promise = Promise.resolve().then(async function () {
      check(target, true);
      var question = 'Apply this exact project record change:\n' + JSON.stringify(target.op) + '\nProject: ' + target.slug + '\nWhy: ' + args.why;
      if (question.length > 2000) throw new Error('The exact change must fit the existing owner review.');
      var response = await ctx.review(question, function () { check(target, true); });
      if (response.status !== 'submitted' || !response.answers.control || response.answers.control.length !== 1 || response.answers.control[0] !== 'Apply exact change') return { status: 'cancelled', persisted: false };
      var live = check(target, true);
      persisted = 'unknown';
      var result = await live.bound[input.WRITES[target.op.area + ':' + target.op.action]](input.parameters(target.op));
      persisted = true; check(target, false);
      if (target.op.area === 'issues' && live.project.notifyIssueUpdate) live.project.notifyIssueUpdate(result, target.op.action === 'delete' ? 'issue_deleted' : undefined);
      if (target.op.area === 'logs' && live.project.notifyLogUpdate) live.project.notifyLogUpdate(result, target.op.action === 'review' ? target.op.reviewAction : target.op.action);
      return { status: 'completed', persisted: true, result: result };
    }).catch(function (error) { return { status: 'failed', persisted: persisted, retrySafe: false, error: error.message }; });
    state.requests.set(args.requestId, { key: key, promise: promise });
    return promise;
  }
  return { readProjectRecords: read, inspectProjectRecordChange: inspect, actProjectRecords: act };
}
module.exports = { attachClayProjectRecords: attachClayProjectRecords };
