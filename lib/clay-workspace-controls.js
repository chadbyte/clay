var crypto = require('crypto'), path = require('path');
var input = require('./clay-workspace-input');
var z = require('zod');
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function attachWorkspaceControls(ctx) {
  var state = ctx.state, receipts = require('./clay-workspace-receipts').attachReceipts(ctx);
  function authorize() {
    var principal = ctx.authorize();
    if (ctx.session._pendingMessageDrainPaused) throw new Error('Canonical Clay is stopped; explicit owner resumption is required.');
    var identity = ctx.sourceIdentity();
    if (state.sourceIdentity !== undefined && state.sourceIdentity !== identity) throw new Error('The source OS identity changed.');
    state.sourceIdentity = identity; return principal;
  }
  function resolve(slug, domain) {
    var principal = authorize(), project = ctx.getProjects().get(slug), status = project && project.getStatus();
    if (!status || status.isMate) throw new Error('Select an owned ordinary project.');
    ctx.authorizeProject(principal, status);
    var service = project.getWorkspaceProductOperations && project.getWorkspaceProductOperations();
    if (!service) throw new Error('Project workspace controls are unavailable.');
    return { project: project, status: status, service: service, principal: principal, identity: service.rootIdentity(principal, domain) };
  }
  function check(target, exact) {
    var live = resolve(target.slug, target.op.domain);
    if (live.project !== target.live.project || live.service !== target.live.service || live.identity !== target.live.identity || path.resolve(live.status.path) !== path.resolve(target.live.status.path)) throw new Error('The selected project, directory or OS identity was replaced.');
    if (exact && (Date.now() - target.created > 300000 || hash(live.service.snapshot(live.principal, target.op)) !== target.revision)) throw new Error('The exact file, repository or terminal revision changed. Inspect again.');
    return live;
  }
  function read(args) {
    args = z.object({ projectSlug: z.string().min(1).max(200), operation: input.readSchema }).strict().parse(args);
    var live = resolve(args.projectSlug, args.operation.domain), result = live.service.read(live.principal, args.operation);
    var again = resolve(args.projectSlug, args.operation.domain);
    if (live.project !== again.project || live.identity !== again.identity) throw new Error('Project access changed during the read.');
    return result;
  }
  function receipt(args) {
    authorize();
    args = z.object({ projectSlug: z.string(), domain: input.domain, requestId: z.string() }).strict().parse(args);
    resolve(args.projectSlug, args.domain);
    var record = receipts.read(args.requestId);
    if (!record || record.targetKey !== hash([args.projectSlug, args.domain])) throw new Error('No receipt exists for this selected project and domain.');
    return record;
  }
  function inspect(args) {
    args = z.object({ projectSlug: z.string().min(1).max(200), operation: input.writeSchema }).strict().parse(args);
    if (JSON.stringify(args).length > 1400) throw new Error('The complete exact change must fit 1400 characters in the existing owner review.');
    var live = resolve(args.projectSlug, args.operation.domain), snapshot = live.service.snapshot(live.principal, args.operation);
    var token = 'workspace-control:' + crypto.randomUUID();
    if (state.targets.size >= 100) state.targets.delete(state.targets.keys().next().value);
    var target = { slug: args.projectSlug, op: args.operation, live: live, snapshot: snapshot, revision: hash(snapshot), created: Date.now() };
    target.presentationValid = function () { check(target, true); }; state.targets.set(token, target);
    return { targetToken: token, projectSlug: args.projectSlug, operation: args.operation, expiresInSeconds: 300 };
  }
  function act(args) {
    authorize();
    args = z.object({ targetToken: z.string(), requestId: z.string().max(128), why: z.string().trim().min(1).max(300) }).strict().parse(args);
    var target = state.targets.get(args.targetToken);
    if (!target) throw new Error('Inspect the exact project workspace change first.');
    var key = hash([target.slug, target.live.identity, target.op, args.why]), previous = state.requests.get(args.requestId), durable = receipts.read(args.requestId, key);
    if (previous) { if (previous.key !== key) throw new Error('requestId names another intent.'); return previous.promise.then(function (result) { check(target, false); return result; }); }
    if (durable) { check(target, false); return durable.status === 'applying' ? { status: 'failed', persisted: 'unknown', retrySafe: false, error: 'The saved attempt is interrupted or uncertain. Inspect its effects; it will never replay automatically.' } : durable.result; }
    if (state.requests.size >= 100) throw new Error('Too many workspace requests in this query.');
    var promise = Promise.resolve().then(async function () {
      check(target, true);
      var question = 'Apply this exact selected-project workspace change:\n' + JSON.stringify({ projectSlug: target.slug, operation: target.op }) + '\nWhy: ' + args.why;
      if (target.op.domain === 'terminal' && target.op.id) question += '\nExact terminal: ' + target.snapshot.title + ' (' + target.snapshot.identity + ')';
      if (question.length > 2000) throw new Error('The exact change does not fit the owner review.');
      var answer = await ctx.review(question, function () { check(target, true); });
      if (answer.status !== 'submitted' || !answer.answers.control || answer.answers.control.length !== 1 || answer.answers.control[0] !== 'Apply exact change') return { status: 'cancelled' };
      var live = check(target, true);
      receipts.save({ id: args.requestId, key: key, targetKey: hash([target.slug, target.op.domain]), status: 'applying' });
      live = check(target, true);
      var result;
      try {
        result = Object.assign({ status: 'completed', domain: target.op.domain, action: target.op.action }, await live.service.apply(live.principal, target.op, target.snapshot, function () { check(target, false); }));
      } catch (error) { result = Object.assign({ status: 'failed', domain: target.op.domain, action: target.op.action, error: error.message, retrySafe: false }, error.productControlResult || {}); }
      try { receipts.save({ id: args.requestId, key: key, targetKey: hash([target.slug, target.op.domain]), status: 'finished', result: result }); }
      catch (error) { return Object.assign({}, result, { status: 'failed', receiptSaved: false, retrySafe: false, error: 'The target outcome could not be retained in the source receipt. ' + error.message }); }
      return result;
    }).catch(function (error) { return Object.assign({ status: 'failed', retrySafe: false, error: error.message }, error.productControlResult || {}); });
    state.requests.set(args.requestId, { key: key, promise: promise }); return promise;
  }
  return { readWorkspaceControl: read, readWorkspaceReceipt: receipt, inspectWorkspaceChange: inspect, actWorkspace: act };
}
module.exports = { attachWorkspaceControls: attachWorkspaceControls };
