var crypto = require('crypto');
var catalog = require('./mate-avatar-catalog');
var colors = require('./mate-workspace-color');
function string(value, max) { return typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function revision(mate) { var copy = Object.assign({}, mate); delete copy.lifecycleDeletion; return JSON.stringify(copy); }
function runtime(project, sessionsOnly) {
  if (!project) return null;
  var status = project.getStatus();
  return JSON.stringify([status.mateId, status.projectOwnerId, !sessionsOnly && project.inspectMateLifecycleRuntime && project.inspectMateLifecycleRuntime(), Array.from(project.getSessionManager().sessions.values()).map(function (s) { return [s.localId, s.ownerId, s.sessionVisibility, s.title, s.isProcessing, s._queryStarting, s._sdkQueryGeneration, s.history && s.history.length, s.terminalId, s.runtimeTerminalId]; })]);
}
function profileChanges(mate, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(function (key) { return ['name', 'bio', 'workspaceColor', 'avatarCatalogId'].indexOf(key) < 0; })) throw new Error('Use only name, bio, workspaceColor or avatarCatalogId.');
  if (mate.lifecycleDeletion) throw new Error('Mate deletion is pending.');
  var changes = {}, profile = Object.assign({}, mate.profile);
  if (patch.name !== undefined) {
    if (mate.primary || !string(patch.name, 100)) throw new Error('This Mate name cannot be changed to that value.');
    changes.name = patch.name.trim(); profile.displayName = changes.name;
  }
  if (patch.bio !== undefined) {
    if (mate.primary || typeof patch.bio !== 'string' || patch.bio.length > 600 || /[\u0000-\u001f\u007f]/.test(patch.bio)) throw new Error('Use an introduction of at most 600 characters for an editable Mate.');
    changes.bio = patch.bio.trim();
  }
  if (patch.workspaceColor !== undefined) {
    if (mate.primary || mate.builtinKey === 'clay' || !colors.valid(patch.workspaceColor)) throw new Error('This workspace color is unavailable.');
    changes.workspaceColor = patch.workspaceColor;
  }
  if (patch.avatarCatalogId !== undefined) {
    if (profile.avatarLocked || !catalog.valid(patch.avatarCatalogId)) throw new Error('Choose an editable catalog avatar.');
    profile.avatarCatalogId = patch.avatarCatalogId; profile.avatarCustom = '';
  }
  if (patch.name !== undefined || patch.avatarCatalogId !== undefined) changes.profile = profile;
  return changes;
}
function attachClayMateLifecycle(ctx) {
  var state = ctx.state;
  function service() { var value = ctx.getService && ctx.getService(); if (!value) throw new Error('Mate lifecycle controls are unavailable.'); return value; }
  function owner() { var p = ctx.authorize(); return p.userId || p.singleUserOwnerId || 'default'; }
  function projection(m) { return { mateId: m.id, name: (m.profile || {}).displayName || m.name || 'New Mate', bio: m.bio || '', profile: m.profile || {}, workspaceColor: m.workspaceColor || null, primary: !!m.primary, canonicalClay: m.builtinKey === 'clay', deletionPending: !!m.lifecycleDeletion }; }
  function list(args) {
    if (args && Object.keys(args).length) throw new Error('Mate listing accepts no arguments.');
    return { mates: service().list(owner()).map(projection) };
  }
  function inspect(args) {
    if (!args || !string(args.mateId, 100) || Object.keys(args).some(function (k) { return k !== 'mateId'; })) throw new Error('An exact mateId is required.');
    var mate = service().read(owner(), args.mateId), project = ctx.getProjects().get('mate-' + mate.id);
    if (project) {
      var status = project.getStatus();
      if (!status.isMate || status.mateId !== mate.id || status.projectOwnerId !== owner()) throw new Error('Mate runtime ownership changed.');
      project.getSessionManager().sessions.forEach(function (s) { if (s.sessionVisibility === 'shared' || s.ownerId && s.ownerId !== owner()) throw new Error('Mate runtime is not private to this owner.'); });
    }
    if (state.targets.size >= 100) state.targets.delete(state.targets.keys().next().value);
    var token = 'mate-control:' + crypto.randomUUID();
    state.targets.set(token, { mate: mate, revision: revision(mate), deletion: JSON.stringify(mate.lifecycleDeletion), project: project, runtime: runtime(project), cleanupRuntime: runtime(project, true), created: Date.now() });
    return Object.assign(projection(mate), { targetToken: token, expiresInSeconds: 300, actions: mate.primary || mate.builtinKey === 'clay' ? ['profile'] : ['profile', 'delete'], profileFields: ['name', 'bio', 'workspaceColor', 'avatarCatalogId'] });
  }
  function check(target, cleanup) {
    var mate = service().read(owner(), target.mate.id), project = ctx.getProjects().get('mate-' + mate.id);
    if (Date.now() - target.created > 300000 || revision(mate) !== target.revision || !cleanup && JSON.stringify(mate.lifecycleDeletion) !== target.deletion) throw new Error('The exact Mate revision changed. Inspect again.');
    if (!cleanup && (project !== target.project || runtime(project) !== target.runtime)) throw new Error('Mate runtime changed. Inspect again.');
    if (cleanup && runtime(target.project, true) !== target.cleanupRuntime) throw new Error('Mate sessions changed during cleanup. Inspect again.');
    if (cleanup && project && project !== target.project) throw new Error('Mate runtime was replaced during cleanup.');
    return mate;
  }
  function act(args) {
    owner();
    if (!args || Object.keys(args).some(function (key) { return ['targetToken', 'action', 'patch', 'why', 'requestId'].indexOf(key) < 0; }) || ['profile', 'delete'].indexOf(args.action) < 0 || !string(args.why, 600) || !string(args.requestId, 128) || !string(args.targetToken, 100) || args.action === 'delete' && args.patch !== undefined) throw new Error('Use an exact Mate target, profile or delete action, why and requestId.');
    args = JSON.parse(JSON.stringify(args));
    var target = state.targets.get(args.targetToken), key = JSON.stringify(args), previous = state.requests.get(args.requestId);
    if (!target) throw new Error('Inspect the exact Mate first.');
    if (previous) {
      if (previous.key !== key) throw new Error('requestId already names a different exact Mate action.');
      return previous.promise.then(function (result) {
        service().validateReceipt(owner(), target.mate.id, result.status === 'completed' && args.action === 'delete');
        return result;
      });
    }
    if (state.requests.size >= 100) throw new Error('Too many Mate requests in this query.');
    var promise = Promise.resolve().then(async function () {
      var mate = check(target), changes;
      if (args.action === 'profile') changes = profileChanges(mate, args.patch);
      if (args.action === 'delete' && (mate.primary || mate.builtinKey === 'clay')) throw new Error('Canonical Clay and primary Mates cannot be deleted.');
      var question = (args.action === 'delete' ? 'Permanently delete this Mate and its private directory after runtime cleanup. Stored transcripts and external provider history are retained.' : 'Edit this Mate profile: ' + JSON.stringify(args.patch)) + '\nMate: ' + ((mate.profile || {}).displayName || mate.name || 'New Mate') + ' (' + mate.id + ')\nWhy: ' + args.why;
      if (question.length > 2000) throw new Error('The exact change must fit the owner review.');
      var answer = await ctx.review(question, function () { check(target); });
      if (answer.status !== 'submitted' || !answer.answers.control || answer.answers.control.length !== 1 || answer.answers.control[0] !== 'Apply exact change') return { status: 'cancelled' };
      check(target);
      if (args.action === 'profile') { service().update(owner(), mate.id, changes); return { status: 'completed', persisted: true, mateId: mate.id }; }
      return Object.assign({ status: 'completed', mateId: mate.id }, await service().remove(owner(), mate.id, function (cleanup) { check(target, cleanup); }));
    }).catch(function (error) { return Object.assign({ status: 'failed', error: error.message }, error.productControlResult || {}); });
    state.requests.set(args.requestId, { key: key, promise: promise });
    return promise;
  }
  return { listMates: list, inspectMate: inspect, actMate: act };
}
module.exports = { attachClayMateLifecycle: attachClayMateLifecycle };
