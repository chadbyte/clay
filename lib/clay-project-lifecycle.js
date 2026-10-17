// Query-bound review of typed project intents; no transport impersonation.
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var ACTIONS = ['create', 'register', 'rename', 'remove', 'visibility', 'allowed_users', 'session_visibility', 'environment', 'owner', 'reconcile', 'recover_registration'];
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function attachClayProjectLifecycle(ctx) {
  var targets = ctx.state.targets, requests = ctx.state.requests;
  var service = ctx.service;
  function principal() {
    var actor = ctx.authorize();
    if (!service) throw new Error('Project lifecycle is unavailable in this runtime.');
    return actor;
  }
  function user() { var actor = principal(); return actor.userId ? ctx.findUser(actor.userId) : null; }
  function permission(action) {
    var account = user();
    if (account) {
      var perms = ctx.permissions(account);
      if (action === 'environment' && !perms.projectSettings) throw new Error('Project settings access is not permitted.');
      if ((action === 'create' || action === 'register') && !perms.createProject || action === 'remove' && !perms.deleteProject) throw new Error('Your project lifecycle permission is no longer available.');
    }
    return account;
  }
  function owned(slug) {
    var actor = principal(), runtime = ctx.getProjects().get(slug), status = runtime && runtime.getStatus();
    var record = ctx.getAccess(slug);
    if (!status || status.isMate || /^mate-/.test(slug) || slug.indexOf('--') >= 0 || !record || record.error || record.isMate || record.ownershipRecovery || (actor.userId ? record.ownerId !== actor.userId : !!record.ownerId && record.ownerId !== actor.singleUserOwnerId)) throw new Error('Project controls require live ownership of an ordinary parent project.');
    return runtime;
  }
  function validate(args) {
    if (!args || Object.keys(args).some(function (key) { return ['action', 'projectSlug', 'name', 'path', 'value'].indexOf(key) < 0; }) || ACTIONS.indexOf(args.action) < 0) throw new Error('Choose a typed project lifecycle action.');
    var allowed = ['action'];
    if (args.action === 'create') {
      allowed.push('name'); if (typeof args.name !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(args.name)) throw new Error('Provide a valid project name.');
    } else if (args.action === 'register') {
      allowed.push('path'); if (typeof args.path !== 'string' || args.path.length > 4096 || !path.isAbsolute(args.path) || /[\u0000-\u001f]/.test(args.path)) throw new Error('Provide an absolute existing directory path.');
    } else {
      allowed.push('projectSlug'); if (typeof args.projectSlug !== 'string' || !args.projectSlug || args.projectSlug.length > 200) throw new Error('Provide an exact projectSlug.');
      if (args.action !== 'remove') allowed.push('value');
    }
    if (Object.keys(args).some(function (key) { return allowed.indexOf(key) < 0; })) throw new Error('Fields do not match the project action.');
    if (args.action === 'allowed_users') {
      if (!Array.isArray(args.value) || args.value.length > 100 || args.value.some(function (id, i) { return typeof id !== 'string' || !ctx.findUser(id) || args.value.indexOf(id) !== i; })) throw new Error('Choose unique existing account IDs.');
    } else if (args.action !== 'create' && args.action !== 'register' && args.action !== 'remove' && args.action !== 'reconcile' && args.action !== 'recover_registration') {
      if (typeof args.value !== 'string' || args.value.length > (args.action === 'environment' ? 10000 : 100) || /\u0000/.test(args.value)) throw new Error('Provide a bounded exact value.');
      if (args.action === 'environment') { var error = require('./runtime-env').validateEnvString(args.value); if (error) throw new Error(error); }
    }
  }
  function runtimeScope(slug) {
    var scope = [];
    ctx.getProjects().forEach(function (project, key) {
      if (key !== slug && key.indexOf(slug + '--') !== 0) return;
      var sessions = [];
      project.getSessionManager().sessions.forEach(function (session) {
        sessions.push([session, JSON.stringify([session.localId, session.sessionOriginId, session.ownerId, session.title, session.vendor, session.model, session.effort, session.permissionMode, session.sessionVisibility, session.isProcessing, session._queryStarting, session.taskStopRequested, session._sdkQueryGeneration, session.history && session.history.length, session.messageUUIDs, Object.keys(session.pendingPermissions || {}), Object.keys(session.pendingAskUser || {})])]);
      });
      scope.push({ slug: key, project: project, sessions: sessions });
    });
    return scope;
  }
  function sameScope(previous, current) {
    return previous.length === current.length && previous.every(function (entry, i) {
      var other = current[i]; return entry.slug === other.slug && entry.project === other.project && entry.sessions.length === other.sessions.length && entry.sessions.every(function (session, j) { return session[0] === other.sessions[j][0] && session[1] === other.sessions[j][1]; });
    });
  }
  function inspect(args) {
    validate(args);
    args = JSON.parse(JSON.stringify({ action: args.action, projectSlug: args.projectSlug, name: args.name, path: args.path, value: args.value }));
    var account = permission(args.action), runtime = null, revision = null;
    service.assertSupported(args.action);
    var recovery = null, receiptOnly = false;
    if (args.action === 'reconcile' || args.action === 'recover_registration') {
      recovery = service.inspectRecovery(args.projectSlug, args.value, principal()); permission(args.action === 'recover_registration' ? 'rename' : recovery.action); args.value = recovery.operationId; revision = recovery.revision;
    } else if (args.action === 'owner' && service.receiptPreview(hash(args), ctx.sourceKey, account && account.id || null)) {
      receiptOnly = true;
    } else if (args.action === 'register') {
      if (!ctx.canUsePath(account && account.id, args.path)) throw new Error('Directory access is not permitted.');
      revision = JSON.stringify(service.registration(args.path, account));
      args.path = fs.realpathSync(args.path);
    } else if (args.action !== 'create') {
      if (ctx.getProjects().has(args.projectSlug)) { runtime = owned(args.projectSlug); revision = service.stamp(args.projectSlug); }
      else if (args.action !== 'remove') throw new Error('Project is unavailable.');
    } else revision = ctx.creationRevision();
    if (targets.size >= 100) targets.delete(targets.keys().next().value);
    var token = 'project-control:' + crypto.randomUUID();
    targets.set(token, { receiptOnly: receiptOnly, recovery: recovery, creationPlan: args.action === 'create' ? service.creationPlan(args.name) : null, scope: ['remove', 'reconcile', 'recover_registration'].indexOf(args.action) >= 0 ? runtimeScope(args.projectSlug) : null, accountIdentity: JSON.stringify([account && account.id, account && account.linuxUser]), intent: args, revision: revision, runtime: runtime, created: Date.now() });
    var current = runtime && service.inspect(args.projectSlug).project;
    return { recovery: recovery ? { operationId: recovery.operationId, action: recovery.action, phase: recovery.phase, conflict: recovery.conflict, runtimeClosureConfirmed: recovery.runtimeClosureConfirmed } : undefined, receiptOnly: receiptOnly, current: current ? { title: current.title || args.projectSlug, ownerId: current.ownerId, visibility: current.visibility || 'public', allowedUsers: current.allowedUsers || [], sessionVisibilityDefault: current.sessionVisibilityDefault || 'private', envrc: args.action === 'environment' ? current.envrc || '' : undefined } : undefined,
      targetToken: token, action: args.action, projectSlug: args.projectSlug, name: args.name, path: args.path || (args.action === 'create' ? service.creationPlan(args.name).path : undefined), expiresInSeconds: 300,
      details: args.action === 'remove' ? 'Removes the Clay registration and stops its runtimes. Files and stored history remain on disk. Worktree runtimes are also stopped.' : args.action === 'environment' ? 'Only newly created agent processes receive this project environment. Active processes keep their current environment.' : 'The authenticated owner must review the exact change before it is saved.' };
  }
  function check(target) {
    var args = target.intent, account = permission(args.action);
    if (target.receiptOnly) throw new Error('This token only reads the existing exact transfer receipt. Reuse its original requestId.');
    if (args.action === 'reconcile' || args.action === 'recover_registration') {
      if (!sameScope(target.scope, runtimeScope(args.projectSlug))) throw new Error('Recovery runtime scope changed. Inspect again.');
      permission(args.action === 'recover_registration' ? 'rename' : target.recovery.action);
      if (service.inspectRecovery(args.projectSlug, args.value, principal()).revision !== target.revision) throw new Error('The recovery operation changed. Inspect again.');
      if (Date.now() - target.created > 300000) throw new Error('Recovery inspection expired.');
      return account;
    }
    if (args.action === 'remove' && !sameScope(target.scope, runtimeScope(args.projectSlug))) throw new Error('Project or worktree session revisions changed. Inspect removal again.');
    if (JSON.stringify([account && account.id, account && account.linuxUser]) !== target.accountIdentity) throw new Error('The operating account identity changed.');
    if (Date.now() - target.created > 300000) throw new Error('Project inspection expired.');
    if (args.action === 'register') {
      if (!ctx.canUsePath(account && account.id, args.path) || JSON.stringify(service.registration(args.path, account)) !== target.revision) throw new Error('Registration path or access changed.');
    } else if (args.action === 'create') {
      if (ctx.creationRevision(JSON.parse(target.revision).anchor) !== target.revision) throw new Error('Project creation destination or registry changed. Inspect again.');
    } else if (!target.runtime || owned(args.projectSlug) !== target.runtime || service.stamp(args.projectSlug) !== target.revision) throw new Error('The exact project revision was deleted, replaced or changed. Inspect again.');
    return account;
  }
  function correlation(target, requestId) {
    var actor = principal();
    return { sourceKey: ctx.sourceKey, action: target.intent.action, authorize: ctx.authorize, key: hash([actor.userId || actor.singleUserOwnerId, ctx.sourceKey, requestId]), fingerprint: hash(target.intent), ownerId: actor.userId || null };
  }
  async function run(target, args, receipt) {
    check(target);
    var intent = target.intent;
    var labels = { recover_registration: 'Cancel this pending removal and restore the current registration after acknowledged runtime closure. Queued and scheduled execution stays paused until the owner explicitly sends a new message', reconcile: 'Reconcile the exact persisted lifecycle operation. Runtime closure must be acknowledged before removal completes. No stopped work is resumed', owner: 'Transfer this ordinary project to the selected account; session owners stay unchanged', create: 'Create a private project', register: 'Register an existing directory as a private project', rename: 'Rename this project', remove: 'Remove this project registration', visibility: 'Change project visibility', allowed_users: 'Replace project sharing grants', session_visibility: 'Change the default visibility for new sessions', environment: 'Replace this project environment' };
    var heading = target.recovery && intent.action === 'reconcile' && target.recovery.action === 'remove' ? 'Finish removing this Clay registration after confirming runtime closure. Files and stored history stay on disk.' : intent.action === 'recover_registration' ? 'Cancel the pending removal and restore the current registration. Execution stays paused until the owner sends a new message.' : labels[intent.action];
    var question = heading + '\nTarget: ' + (intent.projectSlug || intent.name || intent.path) + '\n';
    if (target.recovery) question += 'Original change: ' + target.recovery.action + '. Runtime closure: ' + (target.recovery.runtimeClosureConfirmed ? 'confirmed' : 'must be confirmed by the service') + '.\n' + (target.recovery.registrationTitle ? 'Current project: ' + target.recovery.registrationTitle + '\n' : '') + (target.recovery.conflict ? 'The registration changed. Removal finalization cannot overwrite it; restoring retains the current registration with execution paused.\n' : 'The saved registration revision must still match exactly.\n');
    if (target.creationPlan) question += 'Directory: ' + target.creationPlan.path + '\nRegistration: ' + target.creationPlan.slug + '\n';
    if (intent.value !== undefined) question += 'Exact value:\n' + (Array.isArray(intent.value) ? intent.value.join(', ') : intent.value) + '\n';
    if (intent.action === 'remove') question += 'Runtime count: ' + target.scope.length + '. Conversation count: ' + target.scope.reduce(function (sum, entry) { return sum + entry.sessions.length; }, 0) + '.\nProject files and stored history remain on disk. All project and worktree runtimes will be stopped.\n';
    if (intent.action === 'environment') question += 'Applies to new agent processes only; active processes keep their environment.\n';
    question += 'Why: ' + args.why;
    if (question.length > 2000) throw new Error('The exact project review exceeds 2000 characters. Shorten the value or reason; no change was applied.');
    var answer = await ctx.review(question, function () { check(target); });
    if (answer.status !== 'submitted' || !answer.answers.control || answer.answers.control.length !== 1 || answer.answers.control[0] !== 'Apply exact change') return { status: 'cancelled', action: intent.action };
    var account = check(target);
    return service.execute(intent, account, receipt, function () { check(target); });
  }
  function act(args) {
    principal();
    if (!args || Object.keys(args).some(function (key) { return ['targetToken', 'requestId', 'why'].indexOf(key) < 0; }) || typeof args.requestId !== 'string' || !/^[\w-]{1,128}$/.test(args.requestId) || typeof args.why !== 'string' || !args.why.trim() || args.why.length > 1000) throw new Error('Use an inspected targetToken, requestId and why. Model confirmation cannot authorize project changes.');
    var target = targets.get(args.targetToken); if (!target) throw new Error('Inspect this exact project intent first.');
    permission(target.intent.action);
    var receipt = correlation(target, args.requestId);
    var saved = service.receipt(receipt.key, receipt.fingerprint, receipt.ownerId);
    if (saved && ['completed', 'superseded'].indexOf(saved.status) >= 0) return saved;
    if (target.intent.action !== 'reconcile' && target.intent.action !== 'recover_registration' && !target.receiptOnly && ctx.getProjects().has(target.intent.projectSlug)) owned(target.intent.projectSlug);
    var old = requests.get(receipt.key);
    if (old) { if (old.fingerprint !== receipt.fingerprint) throw new Error('requestId already names another project action.'); return old.promise; }
    if (saved) return saved;
    if (requests.size >= 100) throw new Error('Too many project control requests in this query.');
    var promise = run(target, args, receipt).catch(function (error) { return Object.assign({ status: 'failed', error: error.message }, error.lifecycleResult || {}); });
    requests.set(receipt.key, { fingerprint: receipt.fingerprint, promise: promise });
    return promise;
  }
  return { inspectProject: inspect, actProject: act };
}
module.exports = { attachClayProjectLifecycle: attachClayProjectLifecycle, ACTIONS: ACTIONS };
