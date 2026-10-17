// Controllable external transport and storage failures around the real services.
function attach(ctx) {
  var release, sequence = 0, stage = 'idle';
  var objects = require('./clay-control-object-preview.cjs').attach(ctx);
  var originalOrigin = ctx.sourceSession.sessionOriginId, originalRegistry = ctx.mates.loadMates(ctx.mateCtx);
  async function handle(url) {
    var pathname = url.pathname;
    if (pathname === '/fixture/activity-object') return objects.handle(url);
    if (pathname === '/fixture/activity-source-replace') {
      ctx.sourceSession.sessionOriginId = require('crypto').randomUUID();
      ctx.source.getSessionManager().saveSessionFile(ctx.sourceSession);
      return { origin: ctx.sourceSession.sessionOriginId, localId: ctx.sourceSession.localId };
    }
    if (pathname === '/fixture/activity-mate-replace') {
      var registry = ctx.mates.loadMates(ctx.mateCtx);
      ctx.mates.saveMates(ctx.mateCtx, Object.assign({}, registry, { mates: registry.mates.map(function (mate) { return mate.id === ctx.clay.id ? Object.assign({}, mate, { createdAt: 'replacement-stamp' }) : mate; }) }));
      return { replaced: ctx.clay.id };
    }
    if (pathname === '/fixture/activity-source-restore') {
      ctx.sourceSession.sessionOriginId = originalOrigin; ctx.mates.saveMates(ctx.mateCtx, originalRegistry);
      ctx.source.getSessionManager().saveSessionFile(ctx.sourceSession); return { restored: true };
    }
    if (pathname === '/fixture/activity-navigation') return ctx.call('read_owner_screen', { action: 'delivery', deliveryId: url.searchParams.get('deliveryId') });
    if (pathname === '/fixture/activity-state') return { stage: stage, waiting: !!release };
    if (pathname === '/fixture/activity-release') { var waiting = !!release; if (release) { stage = 'released'; release(); release = null; } return { released: waiting, stage: stage }; }
    if (pathname === '/fixture/activity-reset') {
      Object.keys(ctx.sourceSession.pendingAskUser || {}).forEach(function (id) { var pending = ctx.sourceSession.pendingAskUser[id]; if (pending.respond && pending.respond.cancel) pending.respond.cancel('Isolated fixture cleanup'); });
      ctx.sourceSession.taskStopRequested = false; ctx.sourceSession._pendingMessageDrainPaused = false;
      ctx.sourceSession.abortController = new AbortController(); return { resumedByFixture: true };
    }
    if (pathname !== '/fixture/activity') return null;
    var mode = url.searchParams.get('mode') || 'normal', action = mode === 'hold' || mode === 'unknown' ? 'model' : 'rename';
    var manager = ctx.target.getSessionManager(), session = ctx.session, originalSave = manager.saveSessionFile;
    var previousQuery = session.queryInstance, fixtureQuery;
    stage = 'review';
    if (mode === 'hold') session.queryInstance = { setModel: function () { stage = 'provider'; return new Promise(function (resolve) { release = resolve; }); } };
    if (mode === 'unknown') session.queryInstance = { setModel: async function () { throw new Error('Isolated uncertain provider response'); } };
    if (mode === 'hold' || mode === 'unknown') fixtureQuery = session.queryInstance;
    if (mode === 'fail') manager.saveSessionFile = function (item) { if (item === session) return false; return originalSave.apply(manager, arguments); };
    try {
      var inspected = await ctx.call('inspect_session_control', { projectSlug: 'alpha', sessionRef: require('../../lib/workspace-query-service').sessionRef('alpha', session) });
      if (!inspected.targetToken) throw new Error(JSON.stringify(inspected));
      return await ctx.call('control_project_session', { targetToken: inspected.targetToken, requestId: 'activity-preview-' + (++sequence),
        action: action, value: action === 'model' ? session.model === 'fixture-model' ? 'fixture-model-alternative' : 'fixture-model' : 'Reviewed activity ' + sequence,
        why: 'Make the isolated conversation easier to continue' });
    } finally {
      stage = 'settled'; manager.saveSessionFile = originalSave;
      if (fixtureQuery && session.queryInstance === fixtureQuery) { if (previousQuery === undefined) delete session.queryInstance; else session.queryInstance = previousQuery; }
    }
  }
  return { handle: handle };
}
module.exports = { attach: attach };
