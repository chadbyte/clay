var fs = require('fs'), path = require('path'), crypto = require('crypto');
var git = require('./git-cli');
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex'); }
function inode(file) { var s = fs.statSync(file); return [s.dev, s.ino, s.mode, s.uid, s.gid]; }
function attachWorkspaceOperations(ctx) {
  var busy = false;
  function authorize(principal, domain) {
    var record = ctx.getAccess(), user = principal.userId && ctx.users.findUserById(principal.userId);
    if (ctx.isMate || !record || record.lifecycleExecutionPaused || ctx.users.isMultiUser() && (!user || record.ownerId !== user.id || !ctx.users.canAccessProject(user.id, record))) throw new Error('Live selected-project ownership or access is unavailable.');
    if (!ctx.users.isMultiUser() && record.ownerId && record.ownerId !== principal.singleUserOwnerId) throw new Error('Selected-project ownership changed.');
    if (user && ctx.users.getEffectivePermissions(user, ctx.osUsers)[domain === 'terminal' ? 'terminal' : 'fileBrowser'] !== true) throw new Error('The account does not have permission for this product operation.');
    var identity = null;
    if (ctx.osUsers) {
      if (!user || !user.linuxUser) throw new Error('A live mapped OS identity is required.');
      identity = require('./os-users').resolveOsUserInfo(user.linuxUser);
      if (!identity || !Number.isInteger(identity.uid) || identity.uid < 0 || !Number.isInteger(identity.gid) || identity.gid < 0 || identity.user !== user.linuxUser) throw new Error('The mapped OS identity is unavailable.');
    }
    return { identity: identity, projectBound: true, ownerId: user ? user.id : null };
  }
  function rootIdentity(principal, domain) {
    var scope = authorize(principal, domain), root = fs.realpathSync(ctx.cwd);
    return digest([root, inode(root), scope.ownerId, scope.identity && [scope.identity.user, scope.identity.uid, scope.identity.gid, scope.identity.home]]);
  }
  function bounded(requested, missing) {
    if (typeof requested !== 'string' || !requested || path.isAbsolute(requested) || /[\u0000-\u001f\u007f]/.test(requested) || requested.split(/[\\/]/).some(function (part) { return part === '..' || ['.git', '.clay', '.claude', '.codex', '.envrc'].indexOf(part) >= 0; })) throw new Error('Use an in-project relative path outside managed settings and Git metadata.');
    var root = fs.realpathSync(ctx.cwd), resolved = root;
    var parts = requested.split('/').filter(function (part) { return part && part !== '.'; });
    for (var i = 0; i < parts.length; i++) {
      resolved = path.join(resolved, parts[i]);
      var stat;
      try { stat = fs.lstatSync(resolved); } catch (error) { if (missing && error.code === 'ENOENT' && i === parts.length - 1) return resolved; throw error; }
      if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw new Error('Symlinks and multiply linked files are unavailable in canonical project controls.');
    }
    if (path.relative(root, resolved).split(path.sep).indexOf('..') >= 0) throw new Error('The canonical project boundary changed.');
    return resolved;
  }
  function repository(scope) {
    var marker = fs.lstatSync(path.join(ctx.cwd, '.git'));
    if (!marker.isDirectory() || marker.isSymbolicLink()) throw new Error('Canonical Git controls require a direct local .git directory; linked metadata and submodules are unavailable.');
    var status = git.getStatus(ctx.cwd, scope.identity);
    if (!status.isRepository || fs.realpathSync(status.root) !== fs.realpathSync(ctx.cwd)) throw new Error('Select the exact registered repository root, rather than a repository subdirectory.');
    if (fs.realpathSync(status.gitDir) !== fs.realpathSync(path.join(ctx.cwd, '.git'))) throw new Error('The Git metadata directory escaped the selected project.');
    return status;
  }
  function gitProjection(status) { return { isRepository: true, branch: status.branch, oid: status.oid, upstream: status.upstream, ahead: status.ahead, behind: status.behind, detached: status.detached, files: status.files.slice(0, 200), truncated: status.files.length > 200, dirty: status.dirty }; }
  function terminal(scope, id) {
    var item = ctx.tm.inspect(id);
    var identity = scope.identity ? JSON.stringify([scope.identity.user, scope.identity.uid, scope.identity.gid, scope.identity.home]) : null;
    if (!item || item.kind !== 'shell' || item.ownerId !== scope.ownerId || item.osIdentity !== identity) throw new Error('Select an exact same-owner shell terminal. Coding-agent, login and foreign terminals are excluded.');
    return item;
  }
  function read(principal, op) {
    var scope = authorize(principal, op.domain), before = rootIdentity(principal, op.domain), result;
    if (op.domain === 'files') {
      bounded(op.path || '.');
      if (op.action === 'list') { var entries = ctx.files().list(scope, op.path || '.'); result = { entries: entries.slice(0, 200), truncated: entries.length > 200 }; }
      else { result = ctx.files().read(scope, op.path); if (result.content && result.content.length > 65536) result = { error: 'Canonical text reads are limited to 64 KB.', size: result.size }; }
    } else if (op.domain === 'git') {
      var status = repository(scope);
      if (op.action === 'status') result = gitProjection(status);
      else { var working = bounded(op.path, true); if (fs.existsSync(working)) ctx.files().read(scope, op.path); result = git.getFileDiff(ctx.cwd, op.path, scope.identity); if ((result.oldContent.length + result.newContent.length) > 65536) throw new Error('Canonical diff reads are limited to 64 KB.'); }
    } else if (op.action === 'list') result = { terminals: ctx.tm.list().filter(function (item) { try { terminal(scope, item.id); return true; } catch (error) { return false; } }).map(function (item) { return ctx.tm.inspect(item.id); }) };
    else { var item = terminal(scope, op.id); result = Object.assign({}, item, ctx.tm.getScrollback(item.id)); }
    if (rootIdentity(principal, op.domain) !== before) throw new Error('Project or OS identity changed during the read.');
    return result;
  }
  function snapshot(principal, op) {
    var scope = authorize(principal, op.domain);
    if (op.domain === 'files') { bounded(op.path); return ctx.files().snapshot(scope, op.path); }
    if (op.domain === 'git') {
      var status = repository(scope);
      if (!op.paths.length || !op.paths.every(function (name) { return status.files.some(function (item) { return item.path === name; }); })) throw new Error('Select exact currently changed Git paths.');
      var entries = op.paths.map(function (name) {
        var working = bounded(name, true);
        if (fs.existsSync(working) && !fs.lstatSync(working).isFile()) throw new Error('Canonical staging requires individual regular file paths; recursive directory staging is unavailable.');
        if (fs.existsSync(working)) ctx.files().read(scope, name);
        var item = status.files.find(function (file) { return file.path === name; });
        if (item.originalPath) bounded(item.originalPath, true);
        var diff = git.getFileDiff(ctx.cwd, name, scope.identity);
        if (diff.binary) throw new Error('Canonical staging of binary files is unavailable.');
        return digest(diff);
      });
      var index = path.join(status.gitDir, 'index');
      return { status: gitProjection(status), gitDirectory: [fs.realpathSync(status.gitDir), inode(status.gitDir)], index: fs.existsSync(index) ? digest(fs.readFileSync(index)) : null, files: entries,
        configuration: digest(git.runGitSync(ctx.cwd, ['config', '--null', '--list', '--show-origin'], null, scope.identity)),
        attributes: digest(git.runGitSync(ctx.cwd, ['check-attr', '-z', '--all', '--'].concat(op.paths), null, scope.identity)) };
    }
    return op.action === 'create' ? ctx.tm.list().map(function (item) { return ctx.tm.inspect(item.id); }) : terminal(scope, op.id);
  }
  async function apply(principal, op, expected, revalidate) {
    if (busy) throw new Error('Another project file, Git or terminal change is applying. Inspect again after it settles.');
    busy = true;
    var attempted = false, result;
    try {
      var scope = authorize(principal, op.domain);
      revalidate();
      if (digest(snapshot(principal, op)) !== digest(expected)) throw new Error('The exact product revision changed.');
      if (op.domain === 'files') return ctx.files().write(scope, op.path, op.content, { expected: expected, revalidate: function () { revalidate(); bounded(op.path); } });
      attempted = true;
      if (op.domain === 'git') {
        await git.runAction(ctx.cwd, { action: op.action, paths: op.paths }, scope.identity);
        result = { status: 'completed', runtimeEffect: 'index_updated', persisted: true };
      } else if (op.action === 'create') {
        var created = ctx.tm.create(op.cols, op.rows, scope.identity, null, { kind: 'shell', ownerId: scope.ownerId });
        if (!created) throw new Error('The terminal transport is unavailable or its limit was reached.');
        result = { status: 'completed', runtimeEffect: 'shell_created', terminalId: created.id, terminalIdentity: created.identity, commandSent: false, persisted: false };
      } else if (op.action === 'rename') {
        ctx.tm.rename(op.id, op.title); result = { status: 'completed', runtimeEffect: 'renamed', terminalId: op.id, terminalIdentity: expected.identity, persisted: false };
      } else if (op.action === 'resize') {
        ctx.tm.resizeExact(op.id, op.cols, op.rows, expected.identity, revalidate);
        result = { status: 'completed', runtimeEffect: 'resized', terminalId: op.id, terminalIdentity: expected.identity, persisted: false };
      } else {
        await ctx.tm.closeAndWait(op.id, { identity: expected.identity, revalidate: function () { revalidate(); var live = terminal(authorize(principal, 'terminal'), op.id); if (live.identity !== expected.identity) throw new Error('Terminal identity changed during closure.'); } });
        result = { status: 'completed', runtimeEffect: 'closed', terminalId: op.id, terminalIdentity: expected.identity, exitAcknowledged: true, persisted: false };
      }
      revalidate();
      if (op.domain === 'terminal') ctx.publishTerminals();
      return result;
    } catch (error) {
      error.productControlResult = Object.assign({ persisted: attempted ? 'unknown' : false, runtimeEffect: attempted ? 'unknown' : 'none', retrySafe: false }, result, error.productControlResult || {}, { status: 'failed', error: error.message });
      throw error;
    } finally { busy = false; }
  }
  return { rootIdentity: rootIdentity, read: read, snapshot: snapshot, apply: apply };
}
module.exports = { attachWorkspaceOperations: attachWorkspaceOperations };
