// Shared ordinary-project mutations. Persistence precedes runtime publication.
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var access = require('./daemon-project-access');
var ownership = require('./project-ownership');
var configModule = require('./config');
function attachProjectLifecycle(ctx) {
  var pending = new Map();
  var operations = require('./project-lifecycle-operations').attachLifecycleOperations({ config: config, find: find, snapshot: snapshot, save: save, record: record,
    storageDir: configModule.CONFIG_DIR, directory: identity, relay: relay, publish: publish, publishRuntime: publishRuntime });
  function config() { return ctx.getConfig(); }
  function relay() { return ctx.getRelay(); }
  function find(slug) { return (config().projects || []).find(function (p) { return p.slug === slug; }); }
  function ordinary(project) {
    if (!project || ownership.isPersonal(project) || access.parentSlugFor(project.slug)) throw new Error('Choose a registered ordinary parent project. Clay, Mates and worktrees are excluded.');
    if (project.lifecycleState) throw new Error('Project removal is still pending; inspect its receipt before another action.');
    return project;
  }
  function save(next) { ctx.saveConfig(next); ctx.setConfig(next); }
  function publish() {
    try { configModule.syncClayrc(config().projects); } catch (error) {}
    relay().broadcastAll({ type: 'projects_updated', projects: relay().getProjects(), projectCount: config().projects.length });
  }
  function identity(candidate) {
    var canonical = fs.realpathSync(candidate), stat = fs.statSync(canonical);
    if (!stat.isDirectory()) throw new Error('Choose an existing directory.');
    return { path: canonical, dev: stat.dev, ino: stat.ino, uid: stat.uid };
  }
  function existing(candidate, user) {
    var target = identity(candidate), found = (config().projects || []).find(function (project) { return require('./project-directory-claim').canonical(project.path) === target.path; });
    if (!found) return null;
    var users = require('./users');
    if (users.isMultiUser() ? !user || !users.canAccessProject(user.id, access.getProjectAccess(config(), found.slug, config().osUsers)) : !!found.ownerId && found.ownerId !== (user && user.id || null)) throw new Error('Directory access is not permitted.');
    ordinary(found);
    return found;
  }
  function registration(candidate, user) {
    var target = identity(candidate);
    var dataRoot = require('./project-directory-claim').canonical(configModule.CONFIG_DIR);
    var relative = path.relative(dataRoot, target.path), inverse = path.relative(target.path, dataRoot);
    if (relative !== '..' && relative.indexOf('..' + path.sep) !== 0 && !path.isAbsolute(relative) || inverse !== '..' && inverse.indexOf('..' + path.sep) !== 0 && !path.isAbsolute(inverse)) throw new Error('Clay private storage cannot be registered as an ordinary project.');
    (config().projects || []).forEach(function (p) {
      var root = identity(p.path).path;
      function inside(a, b) { var rel = path.relative(a, b); return rel !== '..' && rel.indexOf('..' + path.sep) !== 0 && !path.isAbsolute(rel); }
      if (inside(target.path, root) || inside(root, target.path) && p.ownerId !== (user && user.id)) throw new Error('Directory intersects a registered project.');
    });
    return target;
  }
  function assertSupported(action) {
    if (config().osUsers && ['visibility', 'allowed_users', 'owner'].indexOf(action) >= 0) throw new Error('OS filesystem sharing and ownership changes are unavailable through canonical Clay; the OS sharing/ownership transaction has no completion acknowledgement.');
  }
  function creationPlan(name) {
    var current = config(), base = current.osUsers ? '/var/clay/projects' : current.projectsDir || path.join(configModule.REAL_HOME, 'clay-projects');
    var canonical = require('./project-directory-claim').canonical;
    var slug = configModule.generateSlug(path.join(base, name), current.projects.map(function (p) { return p.slug; }));
    return { base: base, path: path.join(canonical(base), slug), slug: slug };
  }
  function creationRevision(anchor) {
    var plan = creationPlan('inspection');
    var canonical = require('./project-directory-claim').canonical;
    if (!anchor) {
      anchor = plan.base;
      while (!fs.existsSync(anchor)) { var parent = path.dirname(anchor); if (parent === anchor) break; anchor = parent; }
    }
    return JSON.stringify({ base: plan.base, canonicalBase: canonical(plan.base), anchor: anchor, directory: identity(anchor), osUsers: config().osUsers, projects: config().projects });
  }
  function inspect(slug) {
    var project = ordinary(find(slug));
    return { project: JSON.parse(JSON.stringify(project)), directory: identity(project.path) };
  }
  function stamp(slug) { return JSON.stringify(inspect(slug)); }
  function receipt(key, fingerprint, userId) {
    var item = key && (config().projectControlReceipts || {})[key];
    if (!item) return null;
    if (item.fingerprint !== fingerprint || item.ownerId !== (userId || null)) throw new Error('requestId already names another exact project action.');
    var live = item.slug && find(item.slug);
    if (!live && item.result.filesDeleted !== false && item.result.outcome !== 'removal_reserved_runtime_pending') throw new Error('The receipt target registration was deleted. No action was repeated.');
    if (live && (live.projectKnowledgeId !== item.projectKnowledgeId || live.ownerId !== item.ownerId && !(item.action === 'owner' && item.result.status === 'completed'))) throw new Error('The receipt target was replaced or transferred.');
    return item.result;
  }
  function record(next, correlation, result, project, action) {
    if (!correlation) return;
    var receipts = Object.assign({}, next.projectControlReceipts || {});
    if (!receipts[correlation.key] && Object.keys(receipts).length >= 5000) throw new Error('Project control receipt capacity reached.');
    receipts[correlation.key] = { action: action || correlation.action, sourceKey: correlation.sourceKey || null, fingerprint: correlation.fingerprint, ownerId: correlation.ownerId || null, slug: project && project.slug, projectKnowledgeId: project && project.projectKnowledgeId, result: result };
    next.projectControlReceipts = receipts;
  }
  function runtime(slug) { var found; relay().forEachProject(function (project, candidate) { if (candidate === slug) found = project; }); return found; }
  function publishRuntime(project, action) {
    if (config().osUsers && (action === 'register' || action === 'create')) require('./project-linux-access').verify(project.path, ctx.findUser(project.ownerId), ctx.resolveIdentity);
    var current = runtime(project.slug), status = current && current.getStatus();
    if (status && (status.path !== project.path || status.projectKnowledgeId !== project.projectKnowledgeId)) throw new Error('A replacement runtime occupies the saved registration.');
    if (!current && relay().addProject(project.path, project.slug, project.title || null, project.icon || null, project.ownerId || null, null, { projectKnowledgeId: project.projectKnowledgeId }) === false) throw new Error('Saved project runtime publication was not acknowledged.');
    relay().setProjectTitle(project.slug, project.title || null);
    relay().forEachProject(function (target, slug) {
      if (slug === project.slug || access.parentSlugFor(slug) === project.slug) {
        target.setProjectOwner(project.ownerId || null);
        if ((action === 'environment' || action === 'recovered') && target.refreshEnvironmentRuntime) target.refreshEnvironmentRuntime();
      }
    });
    if (action === 'owner' || action === 'visibility' || action === 'allowed_users' || action === 'recovered') relay().refreshProjectAccess();
    if ((action === 'create' || action === 'register') && ctx.registerWorktrees) ctx.registerWorktrees(project, project.ownerId && ctx.findUser(project.ownerId));
  }
  function publication(next, project, action, result, correlation) {
    var op = operations.begin(next, project, action, result, correlation);
    save(next);
    try {
      publishRuntime(project, action);
      if (correlation && correlation.authorize) correlation.authorize();
      operations.exact(op);
      var completed = snapshot(); operations.complete(completed, op, project); save(completed);
      try { publish(); } catch (error) { result.notificationPending = true; }
      return Object.assign({}, result, { operationId: op.id });
    } catch (error) { error.lifecycleResult = Object.assign({}, error.lifecycleResult || {}, operations.partial(op, error.message)); throw error; }
  }
  function receiptPreview(fingerprint, sourceKey, ownerId) {
    return Object.values(config().projectControlReceipts || {}).find(function (item) {
      return item.action === 'owner' && item.result.status === 'completed' && item.fingerprint === fingerprint && item.sourceKey === sourceKey && item.ownerId === ownerId;
    });
  }
  function snapshot() { var lastConfig = config(); return Object.assign({}, lastConfig, JSON.parse(JSON.stringify(lastConfig))); }
  function creatingAccount(user, existingOnly) {
    var users = require('./users');
    if (!users.isMultiUser()) return null;
    var live = user && ctx.findUser(user.id);
    if (!live || !existingOnly && !users.getEffectivePermissions(live, config().osUsers).createProject) throw new Error('Live project creation permission is required.');
    return live;
  }
  function create(name, user, correlation, validate) {
    user = creatingAccount(user);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name) || (/^mate-/i.test(name) || name.indexOf('--') >= 0)) throw new Error('Invalid ordinary project name.');
    if (validate) validate();
    var current = config(), base = current.osUsers ? '/var/clay/projects' : current.projectsDir || path.join(configModule.REAL_HOME, 'clay-projects');
    var creatingIdentity = JSON.stringify([user && user.id, user && user.linuxUser]);
    var osIdentity = null;
    if (current.osUsers) {
      if (!user || !user.linuxUser) throw new Error('A provisioned Linux account is required.');
      osIdentity = ctx.resolveIdentity(user.linuxUser);
      if (!Number.isInteger(osIdentity.uid) || !Number.isInteger(osIdentity.gid)) throw new Error('Linux identity unavailable.');
    }
    var slug = configModule.generateSlug(path.join(base, name), current.projects.map(function (p) { return p.slug; }));
    var claim = require('./project-directory-claim').claim({ baseDir: base, slug: slug, projects: current.projects, userId: user && user.id });
    var persisted = false;
    try {
      claim.assertOwned();
      var options = { cwd: claim.path, stdio: 'pipe' };
      if (osIdentity) {
        fs.chownSync(claim.path, osIdentity.uid, osIdentity.gid);
        options = Object.assign({}, options, { uid: osIdentity.uid, gid: osIdentity.gid, env: { HOME: osIdentity.home, USER: user.linuxUser, PATH: '/usr/local/bin:/usr/bin:/bin' } });
        var wrapped = require('./os-users').wrapSpawnAsUser('git', ['init'], options);
        cp.execFileSync(wrapped.command, wrapped.args, wrapped.options);
      } else cp.execFileSync('git', ['init'], options);
      claim.assertOwned();
      user = creatingAccount(user);
      if (JSON.stringify([user && user.id, user && user.linuxUser]) !== creatingIdentity) throw new Error('Creating OS account identity changed.');
      if (osIdentity && JSON.stringify(ctx.resolveIdentity(user.linuxUser)) !== JSON.stringify(osIdentity)) throw new Error('Resolved OS identity changed during creation.');
      if (osIdentity) { fs.chmodSync(claim.path, 0o700); require('./project-linux-access').verify(claim.path, user, ctx.resolveIdentity); }
      if (validate) validate();
      var next = snapshot(), project = { slug: slug, path: claim.path, ownerId: user && user.id || null, visibility: 'private', addedAt: Date.now(), projectKnowledgeId: require('./project-log-context').createProjectKnowledgeId() };
      next.projects.push(project);
      var result = { ok: true, slug: slug, status: 'completed' };
      return publication(next, project, 'create', result, correlation);
    } catch (error) {
      persisted = !!(error.lifecycleResult && error.lifecycleResult.persisted);
      if (!persisted) { try { if (!claim.cleanup()) error.message += '; claimed directory was replaced; cleanup skipped'; } catch (cleanupError) { error.message += '; directory cleanup failed: ' + cleanupError.message; } }
      else error.message += '; registration persisted; inspect operationId and explicitly reconcile rather than creating again';
      throw error;
    }
  }
  function register(candidate, user, correlation, validate) {
    user = creatingAccount(user, true);
    if (validate) validate();
    var registered = existing(candidate, user);
    if (registered) {
      if (config().osUsers) require('./project-linux-access').verify(registered.path, user, ctx.resolveIdentity);
      if (!runtime(registered.slug)) {
        var pendingOperation = Object.values(config().projectLifecycleOperations || {}).reverse().find(function (item) { return item.slug === registered.slug && item.phase === 'pending'; });
        if (pendingOperation) return operations.partial(pendingOperation);
        throw new Error('The registration exists but its runtime is unavailable.');
      }
      return { ok: true, status: 'completed', slug: registered.slug, existing: true };
    }
    user = creatingAccount(user);
    var target = registration(candidate, user), next = snapshot();
    if (config().osUsers) require('./project-linux-access').verify(candidate, user, ctx.resolveIdentity);
    var slug = configModule.generateSlug(target.path, next.projects.map(function (p) { return p.slug; }));
    if (/^mate-/.test(slug) || access.parentSlugFor(slug)) throw new Error('Reserved private project identity.');
    var removed = (next.removedProjects || []).find(function (p) { return p.path === target.path && (p.userId || null) === (user && user.id || null); });
    var project = { slug: slug, path: target.path, ownerId: user && user.id || null, visibility: 'private', addedAt: Date.now(), projectKnowledgeId: removed && removed.projectKnowledgeId || require('./project-log-context').createProjectKnowledgeId() };
    next.projects.push(project); next.removedProjects = (next.removedProjects || []).filter(function (p) { return p.path !== target.path; });
    if (validate) validate();
    var result = { ok: true, status: 'completed', slug: slug };
    return publication(next, project, 'register', result, correlation);
  }
  function update(slug, action, value, correlation, validate) {
    if (validate) validate();
    ordinary(find(slug));
    var next = snapshot(), project = next.projects.find(function (p) { return p.slug === slug; });
    if (action === 'rename') {
      if (value !== null && (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value))) throw new Error('Invalid project title.');
      project.title = value;
    } else if (action === 'environment') {
      if (typeof value !== 'string' || value.length > 100000 || /\u0000/.test(value)) throw new Error('Invalid project environment.');
      var envError = require('./runtime-env').validateEnvString(value);
      if (envError) throw new Error(envError);
      project.envrc = value;
    } else if (action === 'visibility') {
      if (next.osUsers) throw new Error('OS filesystem sharing changes are unavailable through this service.');
      if (value !== 'public' && value !== 'private') throw new Error('Invalid visibility.'); project.visibility = value;
    } else if (action === 'allowed_users') {
      if (next.osUsers) throw new Error('OS filesystem sharing changes are unavailable through this service.');
      if (!Array.isArray(value) || value.length > 100 || value.some(function (id, i) { return !ctx.findUser(id) || value.indexOf(id) !== i; })) throw new Error('Choose existing unique accounts.');
      project.allowedUsers = value;
    } else if (action === 'owner') {
      if (next.osUsers) throw new Error('OS ownership transfers are unavailable through this service.');
      if (typeof value !== 'string' || !ctx.findUser(value)) throw new Error('Choose an existing owner account.');
      project.ownerId = value;
    } else if (action === 'session_visibility') {
      var changed = access.setSessionVisibilityDefault(next, slug, value); if (!changed.ok) throw new Error(changed.error);
    } else throw new Error('Unsupported project mutation.');
    var result = { ok: true, status: 'completed', slug: slug };
    if (action === 'environment') result.runtimeRefreshed = true;
    if (action === 'environment') result.timing = 'Applies to newly created coding-agent processes. Active processes keep their current environment.';
    return publication(next, project, action, result, correlation);
  }
  async function remove(slug, userId, correlation, validate) {
    if (validate) validate();
    var project = ordinary(find(slug)), next = snapshot();
    var savedProject = next.projects.find(function (item) { return item.slug === slug; });
    var result = { ok: true, status: 'completed', slug: slug, filesDeleted: false, semantics: 'Removed the Clay registration and stopped project runtimes. Project files and stored history remain on disk.' };
    var targets = relay().getProjectLifecycleTargets(slug);
    var op = operations.begin(next, savedProject, 'remove', result, correlation, targets); save(next);
    return operations.reconcile(slug, op.id, { userId: userId || null }, correlation && correlation.authorize || function () {}, null);
  }
  function execute(args, user, correlation, validate) {
    var old = correlation && receipt(correlation.key, correlation.fingerprint, correlation.ownerId);
    if (old) return pending.get(correlation.key) || old;
    if (args.action === 'reconcile' || args.action === 'recover_registration') return operations.reconcile(args.projectSlug, args.value, { userId: user && user.id || null }, correlation.authorize, validate, args.action === 'recover_registration');
    if (args.action === 'create') return create(args.name, user, correlation, validate);
    if (args.action === 'register') return register(args.path, user, correlation, validate);
    if (args.action !== 'remove') return update(args.projectSlug, args.action, args.value, correlation, validate);
    var promise = remove(args.projectSlug, user && user.id, correlation, validate).catch(function (error) {
      var current = find(args.projectSlug);
      if (current && current.lifecycleState === 'removing' && !error.lifecycleResult) error.lifecycleResult = { outcome: 'removal_reserved_runtime_pending', persisted: true, retrySafe: false, slug: args.projectSlug, operationId: current.lifecycleOperationId, recoveryAction: 'reconcile' };
      throw error;
    });
    if (correlation) { pending.set(correlation.key, promise); promise.finally(function () { pending.delete(correlation.key); }).catch(function () {}); }
    return promise;
  }
  function resumeRecovered(slug, userId) {
    var project = ordinary(find(slug));
    var pendingOperation = access.pendingLifecycleOperation(config(), project);
    if (pendingOperation) throw new Error('Review and reconcile pending project operation ' + pendingOperation.id + ' before resuming execution.');
    if (!project.lifecycleExecutionPaused) return true;
    if (project.ownerId !== userId || !ctx.findUser(userId)) throw new Error('Only the current owner can explicitly resume recovered project execution.');
    var next = snapshot(); delete next.projects.find(function (item) { return item.slug === slug; }).lifecycleExecutionPaused; save(next); return true;
  }
  function canRestore(project) { return !project.lifecycleState; }
  return { resumeRecovered: resumeRecovered, inspectRecovery: operations.inspect, receiptPreview: receiptPreview, canRestore: canRestore, assertSupported: assertSupported, creationPlan: creationPlan, creationRevision: creationRevision, inspect: inspect, stamp: stamp, registration: registration, receipt: receipt, execute: execute, create: create, register: register, update: update, remove: remove };
}
module.exports = { attachProjectLifecycle: attachProjectLifecycle };
