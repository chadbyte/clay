// Shared authoritative worktree display/removal service. Reviews expire after five minutes.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var access = require('./daemon-project-access');
var prefs = require('./worktree-preferences');
var identities = require('./worktree-identity');
var branches = require('./worktree-branch');
var operationsModule = require('./project-lifecycle-operations');
function attachWorktreeControls(ctx) {
  var locks = new Set(), reviews = new Map();
  function config() { return ctx.getConfig(); }
  function relay() { return ctx.getRelay(); }
  function copy() { return JSON.parse(JSON.stringify(config())); }
  function save(next) { ctx.saveConfig(next); ctx.setConfig(next); }
  function parent(slug) { return (config().projects || []).find(function (item) { return item.slug === access.parentSlugFor(slug); }); }
  function runtime(slug) { var found; relay().forEachProject(function (item, key) { if (key === slug) found = item; }); return found; }
  function publish() { relay().broadcastAll({ type: 'projects_updated', projects: relay().getProjects(), projectCount: config().projects.length }); }
  // Context-bound identities come from the server, including contexts retained during shutdown.
  function getAccess(slug, runtimeIdentity) {
    var live = runtimeIdentity ? null : runtime(slug);
    return access.getProjectAccess(config(), slug, config().osUsers, runtimeIdentity || live && live.getStatus());
  }
  function authorize(slug, userId, removal) {
    var project = parent(slug) || (config().projects || []).find(function (item) { return item.slug === slug; });
    if (!project || project.lifecycleState || project.ownershipRecovery || project.lifecycleExecutionPaused || access.pendingLifecycleOperation(config(), project)) throw new Error('Project registration is unavailable or paused.');
    var user = userId && ctx.findUser(userId);
    if (ctx.users.isMultiUser()) {
      if (!user || !ctx.users.getEffectivePermissions(user, config().osUsers)[removal ? 'deleteProject' : 'projectSettings']) throw new Error(access.parentSlugFor(slug) ? 'Only the project owner with the required permission may change this worktree.' : 'The required project permission is unavailable.');
      if (access.parentSlugFor(slug)) {
        if (user.id !== project.ownerId) throw new Error('Only the project owner with the required permission may change this worktree.');
      } else if (!ctx.users.canAccessProject(user.id, getAccess(slug))) throw new Error('Project access is not permitted.');
    } else if (access.parentSlugFor(slug) && project.ownerId && project.ownerId !== userId) throw new Error('Project owner does not match.');
    return project;
  }
  function record(next, slug, status) {
    var project = next.projects.find(function (item) { return item.slug === access.parentSlugFor(slug); });
    if (!project.worktreePreferences) project.worktreePreferences = {};
    var old = project.worktreePreferences[slug];
    if (!prefs.matches(old, status.path, status.changeSetId)) old = {};
    project.worktreePreferences[slug] = Object.assign({}, old, { slug: slug, path: status.path, changeSetId: status.changeSetId, projectKnowledgeId: status.projectKnowledgeId, ownerId: project.ownerId || null });
    return project.worktreePreferences[slug];
  }
  function setIcon(slug, icon, userId) {
    var persisted = false;
    try {
      var project = authorize(slug, userId, false);
      if (locks.has(project.slug) || prefs.pendingRemoval(config(), project.slug)) throw new Error('Worktree removal is in progress.');
      if (icon !== null && (typeof icon !== 'string' || icon.length > 64 || /[\u0000-\u001f\u007f]/.test(icon))) throw new Error('Invalid project icon.');
      var live = runtime(slug); if (!live) throw new Error('Project runtime is unavailable.');
      var next = copy();
      if (access.parentSlugFor(slug)) {
        var status = live.getStatus(), git = identities.inspect(project.path, status.path, ctx.osIdentity(project), false);
        verifyMarker(git, status);
        var old = prefs.entry(config(), project.slug, slug);
        if (prefs.matches(old, status.path, status.changeSetId) && old.lifecycleState) throw new Error('Worktree removal is pending.');
        record(next, slug, status).icon = icon;
      }
      else next.projects.find(function (item) { return item.slug === slug; }).icon = icon;
      save(next); persisted = true;
      if (!access.parentSlugFor(slug) && ctx.syncRecent) { try { ctx.syncRecent(next.projects); } catch (error) {} }
      if (relay().setProjectIcon(slug, icon) !== true) throw new Error('The icon was saved, but runtime publication was not acknowledged.');
      publish();
      return { ok: true, persisted: true };
    } catch (error) { return { ok: false, persisted: persisted, error: error.message }; }
  }
  function verifyMarker(git, status) {
    var marker = JSON.parse(fs.readFileSync(path.join(git.git.path, 'clay-change-set.json'), 'utf8'));
    if (marker.changeSetId !== status.changeSetId || marker.projectKnowledgeId !== status.projectKnowledgeId) throw new Error('The worktree change-set identity changed.');
  }
  function binding(slug, userId, action, status) {
    var project = authorize(slug, userId, true), os = ctx.osIdentity(project);
    if (!access.parentSlugFor(slug) || project.slug.indexOf('mate-') === 0) throw new Error('Choose an ordinary registered worktree.');
    if (locks.has(project.slug)) throw new Error('Another worktree operation is in progress.');
    if (!status || !status.isWorktree || status.slug !== slug || !status.changeSetId) throw new Error('Exact worktree registration is unavailable.');
    var expected = project.slug + '--' + path.basename(status.path);
    if (slug !== expected) throw new Error('Worktree registration does not match its directory.');
    (config().projects || []).forEach(function (other) {
      if (other.slug === project.slug) return;
      var root; try { root = fs.realpathSync(other.path); } catch (error) { root = path.resolve(other.path); }
      if (root === status.path || require('./worktree').isPathInside(status.path, root) || require('./worktree').isPathInside(root, status.path)) throw new Error('Worktree directory intersects another registered project.');
    });
    relay().forEachProject(function (other, otherSlug) {
      if (otherSlug === slug || otherSlug === project.slug) return;
      var root = other.getStatus().path;
      if (root === status.path || require('./worktree').isPathInside(status.path, root)) throw new Error('Another registered runtime is inside this worktree.');
    });
    var git = identities.inspect(project.path, status.path, os, action === 'delete');
    verifyMarker(git, status);
    if (config().osUsers && (!os || git.parent.uid !== os.uid || git.target.uid !== os.uid)) throw new Error('Mapped OS ownership does not match the worktree.');
    var base = Object.assign({}, project); delete base.worktreePreferences;
    return { parent: base, status: { slug: slug, path: status.path, isWorktree: true, changeSetId: status.changeSetId, projectKnowledgeId: status.projectKnowledgeId }, os: os, git: git };
  }
  function preview(slug, action, userId, connection, deleteBranch) {
    if (deleteBranch !== undefined && typeof deleteBranch !== 'boolean') throw new Error('Invalid local branch choice.');
    if (deleteBranch && action !== 'delete') throw new Error('Exclude always keeps the local branch.');
    if (action !== 'delete' && action !== 'exclude') throw new Error('Choose Exclude or Delete worktree.');
    reviews.forEach(function (item, key) { if (item.expires < Date.now()) reviews.delete(key); });
    if (reviews.size >= 128) throw new Error('Too many pending worktree reviews.');
    var live = runtime(slug), status = live && live.getStatus();
    var bound = binding(slug, userId, action, status);
    var existing = prefs.entry(config(), bound.parent.slug, slug);
    if (prefs.matches(existing, status.path, status.changeSetId) && existing.lifecycleState) throw new Error('Worktree removal is pending. Inspect operation ' + existing.lifecycleOperationId + ' before recovery.');
    var branch = deleteBranch ? branches.inspect(bound.git, bound.os, false) : null;
    var token = crypto.randomUUID();
    reviews.set(token, { slug: slug, action: action, userId: userId, connection: connection, bound: bound, branch: branch, deleteBranch: deleteBranch === true, live: live, expires: Date.now() + 300000 });
    return { ok: true, token: token, slug: slug, action: action, path: bound.git.target.path, branch: bound.git.branch, deleteBranch: deleteBranch === true, localBranch: /^refs\/heads\//.test(bound.git.branch), expiresInSeconds: 300 };
  }
  function find(slug) { var project = parent(slug); return project && prefs.entry(config(), project.slug, slug); }
  var operations = operationsModule.attachLifecycleOperations({ config: config, find: find, directory: function (value) { return identities.identity(value, true); }, storageDir: ctx.storageDir,
    record: function () {}, snapshot: copy, save: save, relay: relay, publish: publish });
  async function execute(token, userId, connection, validate, deleteBranch) {
    if (validate) validate();
    var review = reviews.get(token); reviews.delete(token);
    if (!review || review.expires < Date.now() || review.userId !== userId || review.connection !== connection) throw new Error('Worktree confirmation expired or belongs to another connection. Review again.');
    if (deleteBranch !== undefined && deleteBranch !== review.deleteBranch) throw new Error('The local branch choice does not match the reviewed confirmation.');
    var slug = review.slug, bound = binding(slug, userId, review.action, review.bound.status);
    if (JSON.stringify(bound) !== JSON.stringify(review.bound) || runtime(slug) !== review.live) throw new Error('The reviewed worktree changed. Review it again.');
    if (review.branch) branches.exact(bound.git, review.branch, bound.os, false);
    var parentSlug = bound.parent.slug, op, reserved = false, diskRemoved = false, branchRemoved = false;
    var contextState = require('./project-log-context').isMerged(bound.parent.path, bound.status.path, bound.os) ? 'merged' : 'archived';
    var archive = relay().captureWorktreeLogContext ? relay().captureWorktreeLogContext(slug) : null;
    locks.add(parentSlug);
    try {
      var next = copy(), registration = record(next, slug, review.bound.status);
      var targets = relay().getProjectLifecycleTargets(slug);
      if (targets.length !== 1 || targets[0].slug !== slug || targets[0].path !== bound.status.path) throw new Error('Exact runtime closure scope is unavailable.');
      var result = { ok: true, status: 'completed', slug: slug, action: review.action, filesDeleted: review.action === 'delete', branchDeleted: false, deleteBranch: review.deleteBranch, branch: bound.git.branch };
      op = operations.begin(next, registration, 'remove', result, null, targets);
      op.worktreeReview = { git: bound.git, branch: review.branch, deleteBranch: review.deleteBranch };
      save(next); reserved = true;
      await relay().closeProjectLifecycle(targets, false);
      if (relay().getProjectLifecycleTargets(slug).length) throw new Error('A runtime appeared during worktree shutdown.');
      operations.confirmClosed(op); operations.exact(op);
      if (validate) validate();
      locks.delete(parentSlug);
      var current = binding(slug, userId, review.action, bound.status);
      locks.add(parentSlug);
      if (JSON.stringify(current) !== JSON.stringify(bound)) throw new Error('Worktree identity or authorization changed during shutdown.');
      if (review.branch) branches.exact(bound.git, review.branch, bound.os, false);
      if (review.action === 'delete') { identities.remove(bound.git, bound.os); diskRemoved = true; }
      if (review.branch) { await branches.remove(bound.git, review.branch, bound.os, function () {
        if (validate) validate();
        if (relay().getProjectLifecycleTargets(slug).length) throw new Error('A runtime appeared during local branch deletion.');
        var project = authorize(slug, userId, true), base = Object.assign({}, project); delete base.worktreePreferences;
        if (JSON.stringify(base) !== JSON.stringify(bound.parent) || JSON.stringify(ctx.osIdentity(project)) !== JSON.stringify(bound.os)) throw new Error('Worktree authorization or mapped OS identity changed during branch deletion.');
        if (JSON.stringify(find(slug)) !== op.expected) throw new Error('The exact saved worktree registration changed.');
      }); branchRemoved = true; result.branchDeleted = true; }
      if (archive) archive(contextState);
      // Record the observed disk effect even if subsequent persistence/publication fails.
      next = copy(); var saved = next.projects.find(function (item) { return item.slug === parentSlug; }).worktreePreferences[slug];
      delete saved.lifecycleState; delete saved.lifecycleOperationId; saved.excluded = true;
      access.clearWorktreeGrant(next, slug);
      operations.complete(next, op, saved); save(next);
      ctx.unregister(parentSlug, slug);
      publish();
      return Object.assign(result, { operationId: op.id, runtimeClosed: true });
    } catch (error) {
      if (reserved) error.lifecycleResult = Object.assign(operations.partial(op, error.message), { filesDeleted: diskRemoved, branchDeleted: branchRemoved, deleteBranch: review.deleteBranch, branch: bound.git.branch, recoveryAction: 'inspect_worktree_removal', directoryAbsent: !fs.existsSync(bound.git.target.path), runtimeClosureConfirmed: operations.closed(op) });
      if (reserved) {
        try { var partialConfig = copy(); partialConfig.projectLifecycleOperations[op.id].observed = error.lifecycleResult; save(partialConfig); } catch (saveError) {}
      }
      throw error;
    } finally { locks.delete(parentSlug); }
  }
  function busy(parentSlug) {
    return locks.has(parentSlug) || prefs.pendingRemoval(config(), parentSlug);
  }
  return { getAccess: getAccess, setIcon: setIcon, preview: preview, execute: execute, busy: busy };
}
module.exports = { attachWorktreeControls: attachWorktreeControls };
