var crypto = require('crypto');
var path = require('path');
var refs = require('./workspace-query-service');
var z = require('zod');
var targetSchema = z.object({ mateId: z.string().min(1).max(100), sessionRef: z.string().regex(/^session:[\w-]{24}$/) }).strict();
var operationSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('send'), text: z.string().trim().min(1).max(1200) }).strict(), z.object({ action: z.enum(['model', 'vendor', 'effort']), value: z.string().min(1).max(200) }).strict(), z.object({ action: z.literal('stop') }).strict()]);
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function revision(s) { return hash([s.ownerId, s.sessionOriginId, s.cliSessionId, s.vendor, s.model, s.effort, s.title, s.isProcessing, s._queryStarting, s._sdkQueryGeneration, s.taskStopRequested, s._pendingMessageDrainPaused, s.history, s.pendingPush, Object.keys(s.pendingAskUser || {}), Object.keys(s.pendingPermissions || {})]); }
function attachClayMateChat(ctx) {
  var state = ctx.state, receipts = require('./clay-mate-chat-receipts').attachReceipts(ctx);
  function authorize() {
    var principal = ctx.authorize(), identity = ctx.sourceIdentity();
    if (ctx.session._pendingMessageDrainPaused) throw new Error('The canonical source is stopped; explicit owner resumption is required.');
    if (state.sourceIdentity !== undefined && state.sourceIdentity !== identity) throw new Error('The canonical source OS identity changed.');
    state.sourceIdentity = identity;
    return principal;
  }
  function resolve(selector, expected) {
    var principal = authorize(), owner = principal.userId || principal.singleUserOwnerId || 'default';
    var mate = ctx.resolveMate(owner, selector.mateId);
    if (!mate || mate.lifecycleDeletion || ctx.multiUser() && mate.createdBy !== owner) throw new Error('The Mate is deleted, pending deletion or belongs to another owner.');
    var project, slug;
    ctx.getProjects().forEach(function (candidate, key) { var status = candidate.getStatus(); if (status.isMate && status.mateId === mate.id) { if (project) throw new Error('The Mate runtime is ambiguous.'); project = candidate; slug = key; } });
    var status = project && project.getStatus();
    if (!status || status.projectOwnerId !== owner || path.resolve(status.path) !== path.resolve(ctx.getMateDir(owner, mate.id))) throw new Error('The registered private Mate runtime is unavailable or replaced.');
    var service = project.getMateChatControl && project.getMateChatControl(), session;
    project.getSessionManager().sessions.forEach(function (candidate) { if (refs.sessionRef(slug, candidate) === selector.sessionRef) session = candidate; });
    if (!session && expected && project === expected.project && project.getSessionManager().sessions.get(expected.session.localId) === expected.session) session = expected.session;
    if (!service || !session || session === ctx.session || session.hidden || session.destroying || session.sessionVisibility !== 'private' || (session.ownerId || null) !== (principal.userId || null) || session.spawn || require('./session-provenance').isWorker(session) || session.delegated || session._delegatedBy || session._pairDelegation || session.mateCreationMode || session.homeDebatePlanning || session.debateSetupMode || session.homeDebatePhase || session.loop || session.terminalId != null || session.runtimeTerminalId != null || (session.runtimeMode || session.mode || 'gui') !== 'gui') throw new Error('Select an existing private owner Mate conversation, separate from this query, without orchestration or terminal runtime.');
    var identity = service.validate(session);
    return { mate: mate, project: project, slug: slug, session: session, service: service, identity: identity };
  }
  function check(target, exact) {
    var live = resolve(target.selector, target.live);
    if (live.project !== target.live.project || live.session !== target.live.session || live.identity !== target.live.identity || hash(live.mate) !== target.registry) throw new Error('The exact Mate runtime, OS identity or registry changed. Inspect again.');
    if (exact && (Date.now() - target.created > 300000 || revision(live.session) !== target.revision)) throw new Error('The inspected conversation changed or expired. Inspect again.');
    return live;
  }
  function read(args) {
    var parsed = z.object({ target: targetSchema, requestId: z.string().optional() }).strict().parse(args), live = resolve(parsed.target), s = live.session, sm = live.project.getSessionManager();
    if (parsed.requestId) { var receipt = receipts.read(parsed.requestId); if (!receipt || receipt.targetKey !== hash([parsed.target.mateId, live.session.sessionOriginId])) throw new Error('No receipt exists for this exact conversation.'); return receipt; }
    return { target: parsed.target, title: s.title || 'New conversation', processing: !!s.isProcessing, starting: !!s._queryStarting, stopped: !!(s.taskStopRequested || s._pendingMessageDrainPaused || s.abortController && s.abortController.signal.aborted), vendor: s.vendor || sm.defaultVendor, model: s.model || null, effort: s.effort || null, models: (sm.modelsByVendor || {})[s.vendor || sm.defaultVendor] || [], vendors: sm.availableVendors || [], capabilities: (sm.capabilitiesByVendor || {})[s.vendor || sm.defaultVendor] || {}, routing: 'Exact existing conversation only. No implicit creation or resume.', actions: ['send', 'stop', 'model', 'vendor', 'effort'] };
  }
  function inspect(args) {
    var parsed = z.object({ target: targetSchema, operation: operationSchema }).strict().parse(args), live = resolve(parsed.target);
    if (JSON.stringify(parsed).length > 1400) throw new Error('The exact intent must fit the existing owner review.');
    var token = 'mate-chat:' + crypto.randomUUID();
    if (state.targets.size >= 100) state.targets.delete(state.targets.keys().next().value);
    state.targets.set(token, { selector: parsed.target, op: parsed.operation, live: live, registry: hash(live.mate), revision: revision(live.session), created: Date.now() });
    return { targetToken: token, target: parsed.target, operation: parsed.operation, expiresInSeconds: 300 };
  }
  function act(args) {
    authorize();
    args = z.object({ targetToken: z.string(), requestId: z.string().max(128), why: z.string().trim().min(1).max(300) }).strict().parse(args);
    var target = state.targets.get(args.targetToken);
    if (!target) throw new Error('Inspect the exact Mate conversation intent first.');
    var key = hash([target.selector.mateId, target.live.session.sessionOriginId, target.op, args.why]), previous = state.requests.get(args.requestId), durable = receipts.read(args.requestId, key);
    if (previous) { if (previous.key !== key) throw new Error('requestId names another intent.'); return previous.promise.then(function (result) { check(target, false); return result; }); }
    if (durable) { check(target, false); return durable.status === 'applying' ? { status: 'failed', persisted: 'unknown', retrySafe: false, error: 'An interrupted attempt requires inspection; it will not be executed again.' } : durable.result; }
    if (state.requests.size >= 100) throw new Error('Too many Mate chat requests in this query.');
    var attempted = false;
    var promise = Promise.resolve().then(async function () {
      var live = check(target, true);
      if (target.op.action !== 'stop') {
        var question = 'Apply this exact Mate conversation change:\n' + JSON.stringify({ target: target.selector, operation: target.op }) + '\nWhy: ' + args.why;
        if (question.length > 2000) throw new Error('The exact intent must fit the existing owner review.');
        var response = await ctx.review(question, function () { check(target, true); });
        if (response.status !== 'submitted' || !response.answers.control || response.answers.control.length !== 1 || response.answers.control[0] !== 'Apply exact change') return { status: 'cancelled', persisted: false };
        live = check(target, true);
      }
      if (target.op.action !== 'stop') receipts.save({ id: args.requestId, key: key, targetKey: hash([target.selector.mateId, target.live.session.sessionOriginId]), status: 'applying' });
      check(target, true);
      attempted = true;
      var result = await live.service.apply(live.session, target.op, function () { check(target, target.op.action !== 'send'); }, ctx.actor());
      result = Object.assign({ status: 'completed', action: target.op.action }, result);
      try { receipts.save({ id: args.requestId, key: key, targetKey: hash([target.selector.mateId, target.live.session.sessionOriginId]), status: 'finished', result: result }); }
      catch (error) {
        if (target.op.action === 'stop') return Object.assign({}, result, { receiptSaved: false, detail: 'Stop applied; its retry receipt could not be saved.' });
        error.productControlResult = Object.assign({}, result, { status: 'failed', receiptSaved: false, retrySafe: false, error: 'The target outcome could not be saved to the source receipt. ' + error.message }); throw error;
      }
      return result;
    }).catch(function (error) { return Object.assign({ status: 'failed', retrySafe: false, persisted: attempted ? 'unknown' : false, error: error.message }, error.productControlResult || {}); });
    state.requests.set(args.requestId, { key: key, promise: promise }); return promise;
  }
  return { readMateChat: read, inspectMateChat: inspect, actMateChat: act };
}
module.exports = { attachClayMateChat: attachClayMateChat, targetSchema: targetSchema, operationSchema: operationSchema };
