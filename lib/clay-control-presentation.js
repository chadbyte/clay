var crypto = require('crypto');
var AsyncLocalStorage = require('async_hooks').AsyncLocalStorage;
var z = require('zod');
var slug = z.string().min(1).max(200).refine(function (value) { return !/[\u0000-\u001f\u007f]/.test(value); });
var activitySchema = z.object({
  version: z.literal(1), id: z.string().regex(/^activity:[\w-]{36}$/), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  phase: z.enum(['review', 'running', 'proposed', 'persisted', 'completed', 'queued', 'delivered', 'acknowledged', 'rendered', 'render_unknown', 'cancelled', 'failed', 'partial', 'unknown']),
  terminal: z.boolean(),
  domain: z.enum(['session', 'project', 'mate', 'knowledge', 'records', 'schedule', 'conversation', 'workspace', 'screen', 'assignment', 'studio']),
  action: z.string().regex(/^[a-z_]{1,60}$/),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('surface'), sourceSlug: slug, sourceSessionId: z.number().int().positive(), sourceSessionOriginId: slug, runtimeId: slug, surface: z.enum(['document', 'sketch', 'browser']), key: z.string().min(1).max(400), revision: slug }).strict(),
    z.object({ kind: z.literal('notifications'), items: z.array(z.object({ id: slug, revision: slug }).strict()).min(1).max(50) }).strict(),
    z.object({ kind: z.literal('knowledge'), projectSlug: slug, runtimeId: slug, object: z.enum(['document', 'database', 'record']), objectId: slug.nullable(), revision: z.string().max(200), databaseId: slug.nullable(), databaseRevision: z.string().max(200).nullable(), name: z.string().max(300).nullable() }).strict(),
    z.object({ kind: z.literal('git-set'), projectSlug: slug, runtimeId: slug, repository: slug, files: z.array(z.object({ path: z.string().min(1).max(300), revision: slug }).strict()).min(1).max(30) }).strict(),
    z.object({ kind: z.literal('session'), projectSlug: slug, sessionId: z.number().int().positive(), sessionOriginId: z.string().min(1).max(128) }).strict(),
    z.object({ kind: z.literal('project'), projectSlug: slug, runtimeId: slug }).strict(),
    z.object({ kind: z.literal('mate'), mateId: slug, mateStamp: z.string().max(1000) }).strict(),
    z.object({ kind: z.literal('record'), projectSlug: slug, runtimeId: slug, area: z.enum(['issues', 'logs']), ref: slug, revision: slug }).strict(),
    z.object({ kind: z.literal('file'), projectSlug: slug, runtimeId: slug, path: z.string().min(1).max(300), revision: slug }).strict(),
    z.object({ kind: z.literal('git'), projectSlug: slug, runtimeId: slug, path: z.string().min(1).max(300), repository: slug, revision: slug }).strict(),
    z.object({ kind: z.literal('terminal'), projectSlug: slug, runtimeId: slug, id: z.number().int().positive(), identity: slug, revision: slug }).strict(),
    z.object({ kind: z.literal('schedule'), projectSlug: slug, runtimeId: slug, id: slug, revision: slug, sessionId: z.number().int().positive(), sessionOriginId: slug }).strict()
  ]).nullable()
}).strict();

// Presentation observes typed service calls; it cannot approve or dispatch effects.
function attachControlPresentation(ctx) {
  var local = new AsyncLocalStorage();
  function current() { return local.getStore(); }
  function wrap(fn, describe) {
    return function (args) {
      var description;
      try { description = describe(args || {}); } catch (error) { return fn(args); }
      if (!description) return fn(args);
      var receiptViewer, activity, stopped = false, started = false, seq = 0, timer, expiry, abort, signal, reviewCheck;
      var id = 'activity:' + crypto.randomUUID();
      function close() {
        clearInterval(timer);
        clearTimeout(expiry);
        if (abort && signal) signal.removeEventListener('abort', abort);
      }
      function emit(phase, terminal) {
        if (stopped) return;
        try {
          ctx.authorize();
          if (description.validSource) description.validSource();
          if (terminal) { if (description.validTerminal) description.validTerminal(description.removesTarget && ['completed', 'persisted', 'partial'].indexOf(phase) >= 0); }
          else if (description.valid) description.valid();
          if (!activity) activity = ctx.open(description);
          var event = activitySchema.parse({ version: 1, id: id, sequence: ++seq, phase: phase,
            terminal: !!terminal, domain: description.domain, action: description.action, target: terminal && phase !== 'rendered' ? null : description.target || null });
          if (activity) activity.send(event, receiptViewer);
        } catch (error) { cancel(); }
      }
      function cancel() {
        if (stopped) return;
        // A withdrawal carries no target or result and is safe after revocation.
        if (activity) activity.clear(id, ++seq);
        stopped = true; close();
      }
      var observer = {
        id: id,
        start: function (phase, validateReview) {
          reviewCheck = phase === 'review' ? validateReview : null;
          if (!started) {
            started = true;
            abort = cancel;
            signal = ctx.session.abortController && ctx.session.abortController.signal;
            if (signal) signal.addEventListener('abort', abort, { once: true });
            expiry = setTimeout(function () { emit('unknown'); stopped = true; close(); }, 300000);
            expiry.unref();
            timer = setInterval(function () {
              try { ctx.authorize(); if (reviewCheck) reviewCheck(); if (description.valid) description.valid(); }
              catch (error) { cancel(); }
            }, 250);
            timer.unref();
          }
          emit(phase || 'running');
        },
        focus: function (viewer) { receiptViewer = viewer; },
        update: function (phase) { if (!stopped) emit(phase); },
        navigation: function (phase) { if (!stopped) emit(phase, true); },
        cancel: cancel
      };
      return local.run(observer, function () {
        function finish(result) {
          if (started && !stopped) {
            var phase = outcome(result);
            emit(phase, true);
          }
          close(); return result;
        }
        // Retain synchronous authorization failures and original return semantics.
        try {
          var result = fn(args);
          if (!result || typeof result.then !== 'function') return finish(result);
          return result.then(finish, function (error) { if (started) emit('unknown'); close(); throw error; });
        } catch (error) { close(); throw error; }
      });
    };
  }
  async function review(fn, question, check, presentation) {
    check();
    var observer = current();
    if (observer) observer.start('review', check);
    var result = await fn(question, check, presentation);
    if (result.status === 'submitted' && result.answers && result.answers.control && result.answers.control.length === 1 && result.answers.control[0] === 'Apply exact change') {
      check();
      if (observer) observer.start('running');
    }
    return result;
  }
  return { wrap: wrap, review: review, current: current };
}
function outcome(result) {
  if (!result || result.persisted === 'unknown' || result.applied === 'unknown' || result.runtimeEffect === 'unknown' || result.outcome === 'uncertain') return 'unknown';
  if (result.status === 'rendered' || result.status === 'render_unknown') return result.status;
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'failed') return result.persisted === true || result.runtimeEffect === 'applied' ? 'partial' : 'failed';
  if (result.status === 'delivered') return 'delivered';
  if (result.status === 'proposed') return 'proposed';
  if (result.status === 'queued' || result.delivery === 'queued') return 'queued';
  if (result.persisted === true) return 'persisted';
  if (result.status === 'completed') return 'completed';
  return 'unknown';
}
module.exports = { attachControlPresentation: attachControlPresentation, outcome: outcome };
