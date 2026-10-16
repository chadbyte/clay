var path = require('path');
var presentation = require('./clay-control-presentation');

function bindPresentation(ctx) {
  function stamp(mate) { return mate && JSON.stringify([mate.id, mate.createdBy || null, mate.createdAt || null, mate.builtinKey || null]); }
  var sourceRoot, sourceIdentity;
  var sourceOrigin = ctx.session.sessionOriginId, sourceGeneration = ctx.session._sdkQueryGeneration;
  var sourceStamp = stamp(ctx.resolveMate(ctx.ownerId, ctx.mateId));
  function sourceValid() {
    ctx.authorize();
    if (!sourceOrigin || ctx.session.sessionOriginId !== sourceOrigin || ctx.session._sdkQueryGeneration !== sourceGeneration || stamp(ctx.resolveMate(ctx.ownerId, ctx.mateId)) !== sourceStamp) throw new Error('The exact presentation source changed.');
    if (ctx.session._pendingMessageDrainPaused) throw new Error('The source was stopped.');
    var project = ctx.getProjects().get(ctx.sourceSlug), status = project.getStatus();
    if (ctx.getMateDir && path.resolve(status.path) !== path.resolve(ctx.getMateDir(ctx.ownerId || 'default', ctx.mateId))) throw new Error('Source directory changed.');
    var identity = project.getMateChatControl && project.getMateChatControl().validate(ctx.session);
    if (sourceRoot !== undefined && (sourceRoot !== status.path || sourceIdentity !== identity)) throw new Error('Source runtime identity changed.');
    sourceRoot = status.path; sourceIdentity = identity;
  }
  var source = { sourceSessionOriginId: sourceOrigin, sourceMateStamp: sourceStamp, sourceQueryGeneration: sourceGeneration || 0 };

  var engine = presentation.attachControlPresentation({ session: ctx.session, authorize: ctx.authorize,
    open: function (description) {
      var service = ctx.getOwnerUi && ctx.getOwnerUi();
      var principal = ctx.authorize();
      return service && service.activity && service.activity(principal.userId || null, ctx.sourceSlug, ctx.session.localId, ctx.mateId, description.viewer, source, sourceValid);
    }
  });
  function describe(domain, bucket, args) {
    var entry = bucket && bucket.targets.get(args.targetToken);
    if (!entry) return null;
    var op = entry.op || entry.intent || {}, live = entry.live || entry.initial || entry.snapshot && entry.snapshot.live || {};
    var project = entry.project || entry.runtime || live.project;
    var session = entry.session || live.session;
    var slug = entry.slug || live.slug || op.projectSlug || entry.intent && entry.intent.projectSlug;
    if (!slug && project) ctx.getProjects().forEach(function (item, key) { if (item === project) slug = key; });
    var initialStatus = project && project.getStatus(), root = initialStatus && initialStatus.path;
    var action = args.action || op.action;
    // These are fixed adapter identities, never selectors supplied by a tool.
    var target = session && slug && session.sessionOriginId ? { kind: 'session', projectSlug: slug, sessionId: session.localId, sessionOriginId: session.sessionOriginId }
      : slug ? { kind: 'project', projectSlug: slug } : null;
    return { domain: domain, action: action, target: target,
      viewer: domain === 'screen' && op.action === 'navigate' ? entry.snapshot.viewer : null,
      validSource: sourceValid,
      valid: function () {
        sourceValid();
        var principal = ctx.authorize();
        if (!project) return;
        if (ctx.getProjects().get(slug) !== project || project.getStatus().path !== root) throw new Error('Target runtime changed.');
        var current = project.getStatus();
        if (current.isMate) {
          var mate = ctx.resolveMate(ctx.ownerId, current.mateId);
          if (!mate || mate.lifecycleDeletion || current.projectOwnerId !== ctx.ownerId || ctx.multiUser() && mate.createdBy !== ctx.ownerId || ctx.getMateDir && path.resolve(current.path) !== path.resolve(ctx.getMateDir(ctx.ownerId || 'default', mate.id))) throw new Error('Target Mate revoked.');
        } else {
          var decision = ctx.access.evaluate(principal, current);
          if (!decision.owned || !decision.accessible || ctx.canUsePath && !ctx.canUsePath(principal.userId, current.path)) throw new Error('Target project access changed.');
          if (current.isWorktree) {
            var parent = ctx.getProjects().get(current.parentSlug), parentStatus = parent && parent.getStatus();
            if (!parentStatus || !ctx.access.evaluate(principal, parentStatus).owned || !ctx.access.evaluate(principal, parentStatus).accessible) throw new Error('Parent access changed.');
          }
        }
        if (session && (project.getSessionManager().sessions.get(session.localId) !== session || session.hidden || session.destroying || (session.ownerId || null) !== (principal.userId || null))) throw new Error('Target conversation changed.');
      }
    };
  }
  function decorate(api) {
    var methods = { act: ['session', null], actProject: ['project', 'lifecycle'], actMate: ['mate', 'mates'],
      actMateKnowledge: ['knowledge', 'knowledge'], actProjectRecords: ['records', 'records'],
      actSchedules: ['schedule', 'scheduling'], actMateChat: ['conversation', 'mateChat'],
      actWorkspace: ['workspace', 'workspace'], actScreen: ['screen', 'screen'] };
    Object.keys(methods).forEach(function (name) {
      if (!api[name]) return;
      var adapter = methods[name];
      api[name] = engine.wrap(api[name], function (args) { return describe(adapter[0], adapter[1] ? ctx.state[adapter[1]] : ctx.state, args); });
    });
    return api;
  }
  return { decorate: decorate, review: engine.review, current: engine.current };
}
module.exports = { bindPresentation: bindPresentation };
