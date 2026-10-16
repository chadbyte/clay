var crypto = require('crypto');
var path = require('path');
var authority = require('./canonical-clay-scheduling-authority');
var input = require('./clay-scheduling-input');
var mateInput = require('./mate-schedule-input');
var refs = require('./workspace-query-service');
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function text(value, max) { return typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function attachClayScheduling(ctx) {
  var state = ctx.state;
  var receipts = require('./clay-scheduling-receipts').attachReceipts(ctx);
  function resolve(selector) {
    var principal = ctx.authorize(), slug, mate;
    if (selector.kind === 'mate') {
      var owner = principal.userId || principal.singleUserOwnerId || 'default';
      mate = ctx.resolveMate(owner, selector.mateId);
      if (!mate || mate.lifecycleDeletion || ctx.multiUser() && mate.createdBy !== owner) throw new Error('Scheduled Mate is unavailable for this owner.');
      slug = ctx.mateSlug(selector.mateId);
    } else slug = selector.projectSlug;
    var project = ctx.getProjects().get(slug), status = project && project.getStatus();
    if (!status || !!status.isMate !== (selector.kind === 'mate')) throw new Error('Scheduled target runtime is unavailable.');
    if (mate) {
      if (status.mateId !== mate.id || status.projectOwnerId !== owner || path.resolve(status.path) !== path.resolve(ctx.getMateDir(owner, mate.id))) throw new Error('Scheduled Mate ownership or directory changed.');
    } else ctx.authorizeProject(principal, status);
    var session;
    project.getSessionManager().sessions.forEach(function (candidate) { if (refs.sessionRef(slug, candidate) === selector.sessionRef) session = candidate; });
    if (!session || session.destroying || session.hidden || session.spawn || require('./session-provenance').isWorker(session) || session.delegated || session._delegatedBy || session._pairDelegation || session.mateCreationMode || session.homeDebatePlanning || session.debateSetupMode || session.taskStopRequested || session.abortController && session.abortController.signal.aborted || session._mcpForeignInput || session.sessionVisibility === 'shared' || (session.ownerId || null) !== (principal.userId || null)) throw new Error('Scheduling requires the exact live private owner session; stopped sessions need explicit owner resumption.');
    if (ctx.multiUser() && !require('./mcp-session-access').canUsePersonalConnections(session, project.getSessionManager().sessions)) throw new Error('Foreign input cannot authorize schedules.');
    if (!ctx.multiUser() && (session.history || []).some(function (entry) { return entry.type === 'user_message' && entry.from && entry.from !== 'default'; })) throw new Error('Foreign input cannot authorize schedules.');
    var service = selector.kind === 'mate' ? project.getMateScheduleControl() : project.getScheduledTaskControl();
    if (!service) throw new Error('Scheduling service is unavailable.');
    return { slug: slug, project: project, status: status, session: session, service: service, registry: mate || null };
  }
  function identity(live) { return hash([live.status.path, live.status.projectKnowledgeId, live.status.parentSlug, live.status.changeSetId, live.registry, live.session.sessionOriginId, live.session.ownerId, live.session.vendor, live.session.model, live.session.mode, live.session.runtimeMode, live.session._sdkQueryGeneration]); }
  function serviceTarget(selector) {
    var initial = resolve(selector), fingerprint = identity(initial);
    var token = authority.issue(function (slug, session) {
      var live = resolve(selector);
      if (live.project !== initial.project || live.session !== initial.session || live.service !== initial.service || slug !== initial.slug || session !== initial.session || identity(live) !== fingerprint) throw new Error('The exact scheduling runtime changed. Inspect and review again.');
      return ctx.actor();
    });
    if (selector.kind === 'mate') initial.service.list(initial.session, token); else initial.service.authorize(initial.session, token);
    return { selector: selector, initial: initial, token: token, fingerprint: fingerprint };
  }
  function check(target, exact) {
    var live = resolve(target.selector);
    authority.validate(target.token, live.slug, live.session);
    if (exact) {
      if (Date.now() - target.created > 300000) throw new Error('Scheduling inspection expired.');
      if (hash(snapshot(target)) !== target.snapshot) throw new Error('The exact schedule or draft revision changed. Inspect and review again.');
    }
    return live;
  }
  function snapshot(target) {
    var live = target.initial, op = target.op;
    return target.selector.kind === 'mate' ? op.id ? live.service.read(live.session, op, target.token) : null : live.service.snapshot(live.session, op, target.token);
  }
  function read(args) {
    ctx.authorize(); var parsed = input.readSchema.parse(args), target = serviceTarget(parsed.target), live = target.initial;
    if (parsed.operation.action === 'receipt') { var receipt = receipts.read(parsed.operation.requestId); if (!receipt || receipt.targetKey !== hash(parsed.target)) throw new Error('Scheduling receipt is unavailable for this target.'); return { receipt: true, status: receipt.status, result: receipt.result || null, guidance: receipt.status === 'applying' ? 'Persistence is unknown; inspect the target before any new approved intent.' : 'Historical scheduling acknowledgement, not task completion.' }; }
    return parsed.target.kind === 'mate' ? { schedules: parsed.operation.action === 'list' ? live.service.list(live.session, target.token) : [live.service.read(live.session, parsed.operation, target.token)], timezone: mateInput.timezone() } : live.service.read(live.session, parsed.operation, target.token);
  }
  function begin(args) {
    ctx.authorize(); var selector = input.targetSchema.parse(args.target); serviceTarget(selector);
    state.interview = true;
    return { status: 'interview_started', timezone: mateInput.timezone(), guidance: 'Ask exactly one structured question at a time. Clarify message/task, local date/time, explicitly requested repetition, and project task Driver/Worker runtimes. Inspect the complete intent, then request owner review. A project task still requires final Create task in its existing workbench.' };
  }
  function inspect(args) {
    ctx.authorize(); var parsed = JSON.parse(JSON.stringify(input.inspectSchema.parse(args))), target = serviceTarget(parsed.target), op = parsed.operation;
    var mate = parsed.target.kind === 'mate';
    if (mate !== /_mate$/.test(op.action)) throw new Error('This operation does not match the selected scheduling domain.');
    target.op = op; target.created = Date.now();
    var entry = snapshot(target);
    if (op.id && (mate ? entry.revision : entry.revision) !== op.revision) throw new Error('Schedule revision conflict.');
    if (mate && op.data) mateInput.normalize(op.data, entry);
    if (JSON.stringify(parsed).length > 1400) throw new Error('The exact scheduling intent must fit the existing owner review.');
    target.snapshot = hash(entry);
    if (state.targets.size >= 100) state.targets.delete(state.targets.keys().next().value);
    var token = 'scheduling:' + crypto.randomUUID(); target.presentationValid = function () { check(target, true); }; state.targets.set(token, target);
    return { targetToken: token, target: parsed.target, operation: op, timezone: mateInput.timezone(), expiresInSeconds: 300 };
  }
  function act(args) {
    ctx.authorize();
    if (!args || Object.keys(args).some(function (key) { return ['targetToken', 'requestId', 'why'].indexOf(key) < 0; }) || !text(args.targetToken, 100) || !text(args.requestId, 128) || !text(args.why, 300)) throw new Error('Use the inspected scheduling target, dated requestId and reason.');
    args = Object.assign({}, args);
    var target = state.targets.get(args.targetToken);
    if (!target) throw new Error('Inspect the exact scheduling intent first.');
    var key = hash([target.selector, target.op, args.why]), previous = state.requests.get(args.requestId), durable = receipts.read(args.requestId, key);
    if (previous) { if (previous.key !== key) throw new Error('requestId names another scheduling intent.'); return previous.promise.then(function (result) { check(target, false); return result; }); }
    if (durable) { check(target, false); return durable.status === 'applying' ? { status: 'failed', persisted: 'unknown', retrySafe: false, error: 'This saved scheduling attempt needs inspection; it will not execute again automatically.' } : durable.result; }
    if (state.requests.size >= 100) throw new Error('Too many scheduling requests in this query.');
    var persisted = false;
    var promise = Promise.resolve().then(async function () {
      var live = check(target, true);
      var question = 'Apply this exact scheduling intent (' + mateInput.timezone() + '):\n' + JSON.stringify({ target: target.selector, operation: target.op }) + '\nWhy: ' + args.why;
      if (question.length > 2000) throw new Error('This exact change is too large for the owner review.');
      var response = await ctx.review(question, function () { check(target, true); });
      if (response.status !== 'submitted' || !response.answers.control || response.answers.control.length !== 1 || response.answers.control[0] !== 'Apply exact change') return { status: 'cancelled', persisted: false };
      live = check(target, true);
      receipts.save({ id: args.requestId, key: key, targetKey: hash(target.selector), status: 'applying' });
      live = check(target, true); persisted = 'unknown';
      var result;
      if (target.selector.kind === 'mate') {
        var op = target.op, record;
        if (op.action === 'create_mate') record = live.service.create(live.session, mateInput.normalize(op.data), 'clay_' + hash([ctx.sourceKey, args.requestId]).slice(0, 32), target.token);
        else if (op.action === 'update_mate') record = live.service.update(live.session, op, mateInput.normalize(op.data, live.service.read(live.session, op, target.token)), target.token);
        else record = live.service.cancel(live.session, op, target.token);
        result = { status: 'completed', persisted: true, schedule: record, delivery: record.state === 'active' ? 'queued' : record.state };
      } else result = live.service.apply(live.session, target.op, target.token, args.requestId);
      persisted = result.persisted; check(target, false);
      receipts.save({ id: args.requestId, key: key, targetKey: hash(target.selector), status: 'finished', result: result });
      return result;
    }).catch(function (error) { return { status: 'failed', persisted: persisted, retrySafe: false, error: error.message }; });
    state.requests.set(args.requestId, { key: key, promise: promise }); return promise;
  }
  return { beginSchedulingInterview: begin, readSchedules: read, inspectScheduleChange: inspect, actSchedules: act,
    schedulingQuestionLimit: function () { try { ctx.authorize(); return state.interview ? 1 : null; } catch (error) { return null; } } };
}
module.exports = { attachClayScheduling: attachClayScheduling };
