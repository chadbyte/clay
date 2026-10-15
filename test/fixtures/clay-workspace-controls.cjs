var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
var ptys = [], failCreate = false, failKill = false, holdExit = false, gitFailure = false, gitHold = null, beforeExactWrite = null;
function installTransport() {
  var sync = cp.execFileSync;
  cp.execFileSync = function (command, args) {
    if (command === 'setpriv') {
      if (args[0] === '--help') return Buffer.from('Fixture same-identity transport');
      assert.deepEqual(args.slice(0, 6), ['--reuid', String(process.getuid()), '--regid', String(process.getgid()), '--init-groups', '--']);
      command = args[6]; args = args.slice(7);
    }
    if (command === 'git' && ['commit', 'commit-tree', 'push', 'pull', 'fetch', 'tag'].indexOf(args[0]) >= 0) throw new Error('Fixture forbids commits and remote mutations.');
    if (command === process.execPath && args[0] === '-e' && args[1].indexOf('var expected =') >= 0 && beforeExactWrite) { var hook = beforeExactWrite; beforeExactWrite = null; hook(); }
    return sync(command, args, arguments[2]);
  };
  require('../../lib/terminal').createTerminal = function (cwd, cols, rows, identity, options) {
    if (failCreate) return null;
    var exit, data;
    var item = { cwd: cwd, options: options, identity: identity, writes: [], kills: 0,
      onData: function (fn) { data = fn; }, onExit: function (fn) { exit = fn; }, resize: function () {},
      write: function (value) { item.writes.push(value); }, kill: function () { item.kills++; if (failKill) throw new Error('Fixture PTY kill failed'); if (!holdExit) setImmediate(function () { exit({ exitCode: 0 }); }); },
      finish: function () { exit({ exitCode: 0 }); }, output: function (value) { data(value); } };
    ptys.push(item); return item;
  };
  var exec = cp.execFile;
  cp.execFile = function (command, args, options, callback) {
    if (command === 'setpriv') {
      assert.deepEqual(args.slice(0, 6), ['--reuid', String(process.getuid()), '--regid', String(process.getgid()), '--init-groups', '--']);
      command = args[6]; args = args.slice(7);
    }
    if (command === 'git' && ['commit', 'commit-tree', 'push', 'pull', 'fetch', 'tag'].indexOf(args[0]) >= 0) throw new Error('Fixture forbids commits and remote mutations.');
    if (command === 'git' && ['add', 'restore', 'rm'].indexOf(args[0]) >= 0) {
      if (gitFailure) return setImmediate(function () { callback(new Error('Fixture Git command failed'), '', 'Fixture Git command failed'); });
      return exec(command, args, options, function (error, stdout, stderr) {
        if (gitHold) gitHold(function () { callback(error, stdout, stderr); }); else callback(error, stdout, stderr);
      });
    }
    return exec(command, args, options, callback);
  };
}
async function settle() { for (var i = 0; i < 12; i++) await new Promise(function (resolve) { setImmediate(resolve); }); }
async function run(f) {
  var count = 0, sequence = 0, cwd = f.target.getStatus().path;
  var file = path.join(cwd, 'review.txt'); fs.writeFileSync(file, 'Original file\n');
  fs.mkdirSync(path.join(cwd, 'folder')); fs.writeFileSync(path.join(cwd, 'folder/nested.txt'), 'Nested');
  fs.mkdirSync(path.join(cwd, '.clay')); fs.writeFileSync(path.join(cwd, '.clay/settings.json'), 'Managed state');
  cp.execFileSync('git', ['init', '--initial-branch=fixture'], { cwd: cwd, stdio: 'pipe' });
  async function call(name, args) { try { var bridge = f.source.getMcpBridgeHandler(f.sourceSession.localId, true, Number(f.sourceSession._sdkQueryGeneration || 0)); return JSON.parse((await bridge.callTool('clay-workspace', name, args || {})).content[0].text); } catch (error) { return { status: 'failed', error: error.message }; } }
  function read(operation, slug) { return call('read_project_workspace', { projectSlug: slug || 'target', operation: operation }); }
  function inspect(operation, slug) { return call('inspect_workspace_change', { projectSlug: slug || 'target', operation: operation }); }
  async function propose(operation) {
    var inspected = await inspect(operation); assert.ok(inspected.targetToken, JSON.stringify(inspected));
    var args = { targetToken: inspected.targetToken, requestId: 'workspace_' + Date.now() + '_' + (++sequence), why: 'Apply the exact isolated workspace change' };
    var promise = call('control_project_workspace', args); await settle();
    var ids = Object.keys(f.sourceSession.pendingAskUser || {}); assert.ok(ids.length, JSON.stringify(await Promise.race([promise, Promise.resolve('pending')])));
    return { args: args, promise: promise, id: ids[ids.length - 1] };
  }
  function answer(p, actor, selection) { return f.source.handleHomeAskUserResponse({ toolId: p.id, answers: { 0: selection || 'Apply exact change' } }, f.sourceSession, actor || f.ws); }
  function cancel(p) { var pending = f.sourceSession.pendingAskUser[p.id]; if (pending) pending.respond.cancel('Fixture invalidation'); }
  async function success(operation) { var p = await propose(operation); assert.equal(answer(p), true); var result = await p.promise; assert.equal(result.status, 'completed', JSON.stringify(result)); count++; return { result: result, proposal: p }; }
  var write = { domain: 'files', action: 'write', path: 'review.txt', content: 'Reviewed content\n' };
  for (var vendor of ['claude', 'codex']) {
    f.sourceSession.vendor = vendor;
    for (var fresh of [true, false]) {
      var tools = await f.source.getMcpBridgeHandler(f.sourceSession.localId, fresh, 8).listTools();
      ['read_project_workspace', 'read_workspace_receipt', 'inspect_workspace_change', 'control_project_workspace'].forEach(function (name) { assert.ok(tools.some(function (tool) { return tool.name === name; })); }); count++;
    }
  }
  f.sourceSession.vendor = 'claude';
  var native = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: f.workspace, controlService: f.controls, sm: f.source.sm, projectSlug: 'clay-source', getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: f.clay.id }).createMcpServer({ createToolServer: function (definition) { return definition; } }, f.sourceSession);
  ['read_project_workspace', 'read_workspace_receipt', 'inspect_workspace_change', 'control_project_workspace'].forEach(function (name) { assert.ok(native.tools.some(function (tool) { return tool.name === name; })); }); count++;
  var ordinary = await f.target.getMcpBridgeHandler(f.session.localId, true, 0).listTools(); assert.equal(ordinary.some(function (tool) { return tool.name === 'control_project_workspace'; }), false); count++;
  assert.ok((await read({ domain: 'files', action: 'list', path: '.' })).entries.some(function (item) { return item.name === 'review.txt'; })); count++;
  assert.equal((await read({ domain: 'files', action: 'read', path: 'review.txt' })).content, 'Original file\n'); count++;
  var p = await propose(write), duplicate = call('control_project_workspace', p.args);
  assert.equal(fs.readFileSync(file, 'utf8'), 'Original file\n');
  assert.equal(answer(p, { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.sourceSession.localId }), false);
  assert.equal(answer(p), true); var first = await p.promise; assert.equal(first.status, 'completed', JSON.stringify(first)); assert.deepEqual(await duplicate, first);
  assert.equal(fs.readFileSync(file, 'utf8'), write.content); assert.equal(first.persisted, true); count++;
  assert.deepEqual(await call('control_project_workspace', p.args), first); assert.equal(answer(p), false); count++;
  assert.equal((await call('control_project_workspace', Object.assign({}, p.args, { why: 'Different intent' }))).status, 'failed'); count++;
  assert.equal((await call('read_workspace_receipt', { projectSlug: 'target', domain: 'files', requestId: p.args.requestId })).result.persisted, true); count++;
  p = await propose(Object.assign({}, write, { content: 'Cancelled' })); answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); assert.equal(fs.readFileSync(file, 'utf8'), write.content); count++;
  fs.symlinkSync(path.join(f.root, 'outside.txt'), path.join(cwd, 'outside-link')); fs.writeFileSync(path.join(f.root, 'outside.txt'), 'Outside');
  fs.symlinkSync(path.join(cwd, 'folder'), path.join(cwd, 'inside-link')); fs.linkSync(file, path.join(cwd, 'hardlink.txt'));
  for (var bad of ['../outside.txt', '/etc/passwd', 'folder/../../outside.txt', '.clay/settings.json', '.git/config', 'outside-link', 'inside-link/nested.txt', 'hardlink.txt']) {
    assert.equal((await read({ domain: 'files', action: 'read', path: bad })).status, 'failed', bad); count++;
  }
  fs.unlinkSync(path.join(cwd, 'hardlink.txt'));
  assert.equal((await inspect(Object.assign({}, write, { path: 'new.txt' }))).status, 'failed'); count++;
  assert.equal((await inspect({ domain: 'terminal', action: 'input', id: 1, data: 'arbitrary shell\n' })).status, 'failed'); count++;
  assert.equal((await inspect({ domain: 'git', action: 'push' })).status, 'failed'); count++;
  assert.equal((await inspect({ domain: 'git', action: 'commit', message: 'Forbidden even in fixtures' })).status, 'failed'); count++;
  for (var mode of ['foreignInput', 'sourceStop', 'sourcePause', 'generation', 'revoked', 'deleted', 'replaced', 'sourceDeleted', 'staleFile', 'symlinkSwap']) {
    p = await propose(write);
    var target = f.projects.get('target'), source = f.projects.get('clay-source');
    if (mode === 'foreignInput') f.sourceSession._mcpForeignInput = true;
    if (mode === 'sourceStop') f.sourceSession.taskStopRequested = true;
    if (mode === 'sourcePause') f.sourceSession._pendingMessageDrainPaused = true;
    if (mode === 'generation') f.sourceSession._sdkQueryGeneration++;
    if (mode === 'revoked') f.revoke();
    if (mode === 'deleted') f.projects.delete('target');
    if (mode === 'replaced') f.projects.set('target', Object.create(target));
    if (mode === 'sourceDeleted') f.projects.delete('clay-source');
    if (mode === 'staleFile') fs.writeFileSync(file, 'Concurrent edit');
    if (mode === 'symlinkSwap') { fs.renameSync(file, file + '.held'); fs.symlinkSync(path.join(f.root, 'outside.txt'), file); }
    assert.equal(answer(p), false, mode); cancel(p); await p.promise;
    if (mode === 'symlinkSwap') { fs.unlinkSync(file); fs.renameSync(file + '.held', file); }
    f.sourceSession._mcpForeignInput = false; f.sourceSession.taskStopRequested = false; f.sourceSession._pendingMessageDrainPaused = false; f.sourceSession._sdkQueryGeneration = 8;
    f.restoreAccess(); f.projects.set('target', target); f.projects.set('clay-source', source); fs.writeFileSync(file, write.content); count++;
  }
  var roster = f.users.loadUsers();
  f.users.saveUsers(Object.assign({}, roster, { users: roster.users.map(function (user) { return Object.assign({}, user, user.id === 'owner' ? { role: 'member', permissions: { fileBrowser: false, terminal: false } } : {}); }) }));
  assert.equal((await read({ domain: 'files', action: 'list', path: '.' })).status, 'failed'); assert.equal((await read({ domain: 'terminal', action: 'list' })).status, 'failed'); count++;
  f.users.saveUsers(roster);
  var status = await read({ domain: 'git', action: 'status' }); assert.equal(status.isRepository, true); assert.equal(status.oid, null); assert.equal(status.origin, undefined); count++;
  assert.equal((await read({ domain: 'git', action: 'diff', path: 'review.txt' })).newContent, write.content); count++;
  var gitDirectory = path.join(cwd, '.git'), heldGit = path.join(cwd, '.git-held');
  fs.renameSync(gitDirectory, heldGit); fs.symlinkSync(heldGit, gitDirectory);
  assert.equal((await read({ domain: 'git', action: 'status' })).status, 'failed'); fs.unlinkSync(gitDirectory); fs.renameSync(heldGit, gitDirectory); count++;
  assert.equal((await inspect({ domain: 'git', action: 'stage', paths: ['folder/'] })).status, 'failed'); count++;
  var staged = await success({ domain: 'git', action: 'stage', paths: ['review.txt'] });
  assert.equal((await read({ domain: 'git', action: 'status' })).files.find(function (item) { return item.path === 'review.txt'; }).staged, true); count++;
  await success({ domain: 'git', action: 'unstage', paths: ['review.txt'] }); assert.equal(fs.readFileSync(file, 'utf8'), write.content); count++;
  p = await propose({ domain: 'git', action: 'stage', paths: ['review.txt'] }); fs.writeFileSync(file, 'Changed after Git review'); assert.equal(answer(p), false); cancel(p); await p.promise; fs.writeFileSync(file, write.content); count++;
  p = await propose({ domain: 'git', action: 'stage', paths: ['review.txt'] }); gitFailure = true; answer(p); var gitFailed = await p.promise; gitFailure = false; assert.equal(gitFailed.status, 'failed'); assert.equal(gitFailed.retrySafe, false); count++;
  var releaseGit;
  gitHold = function (release) { releaseGit = release; };
  p = await propose({ domain: 'git', action: 'stage', paths: ['review.txt'] }); answer(p);
  for (var wait = 0; wait < 100 && !releaseGit; wait++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.ok(releaseGit); f.revoke(); releaseGit(); var revokedGit = await p.promise; assert.equal(revokedGit.status, 'failed'); assert.equal(revokedGit.runtimeEffect, 'index_updated'); assert.equal(revokedGit.persisted, true); gitHold = null; f.restoreAccess(); count++;
  await success({ domain: 'git', action: 'unstage', paths: ['review.txt'] });
  var terminal = await success({ domain: 'terminal', action: 'create', cols: 80, rows: 24 }), terminalId = terminal.result.terminalId, terminalIdentity = terminal.result.terminalIdentity;
  assert.equal(terminal.result.commandSent, false); assert.equal(ptys[ptys.length - 1].writes.length, 0); count++;
  assert.equal((await read({ domain: 'terminal', action: 'list' })).terminals[0].identity, terminalIdentity); count++;
  var createdCount = ptys.length; assert.deepEqual(await call('control_project_workspace', terminal.proposal.args), terminal.result); assert.equal(ptys.length, createdCount); count++;
  ptys[ptys.length - 1].output('Untrusted terminal output');
  assert.equal((await read({ domain: 'terminal', action: 'read', id: terminalId })).content, 'Untrusted terminal output'); count++;
  await success({ domain: 'terminal', action: 'rename', id: terminalId, title: 'Reviewed shell' });
  await success({ domain: 'terminal', action: 'resize', id: terminalId, cols: 100, rows: 30 });
  assert.equal((await read({ domain: 'terminal', action: 'read', id: terminalId })).cols, 100); count++;
  p = await propose({ domain: 'terminal', action: 'rename', id: terminalId, title: 'Stale shell' });
  ptys[ptys.length - 1].output('More output'); assert.equal(answer(p), false); cancel(p); await p.promise; count++;
  // Foreign and coding-agent terminals created through actual product handlers
  // remain outside the canonical same-owner generic shell surface.
  var messages = [], foreignWs = { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.session.localId, send: function (data) { messages.push(JSON.parse(data)); } };
  f.target.clients.add(foreignWs); f.grantForeign(); f.target.handleMessage(foreignWs, { type: 'term_create' }); f.restoreAccess();
  var foreignId = messages.find(function (event) { return event.type === 'term_created'; }).id;
  assert.equal((await read({ domain: 'terminal', action: 'read', id: foreignId })).status, 'failed'); count++;
  holdExit = true; p = await propose({ domain: 'terminal', action: 'close', id: terminalId }); answer(p); await settle();
  var settled = false; p.promise.then(function () { settled = true; }); await settle(); assert.equal(settled, false);
  assert.ok((await read({ domain: 'terminal', action: 'list' })).terminals.some(function (item) { return item.id === terminalId; }));
  ptys[ptys.length - 2].finish(); var closed = await p.promise; holdExit = false;
  assert.equal(closed.status, 'completed', JSON.stringify(closed)); assert.equal(closed.exitAcknowledged, true); count++;
  assert.equal((await read({ domain: 'terminal', action: 'read', id: terminalId })).status, 'failed'); count++;
  failCreate = true; p = await propose({ domain: 'terminal', action: 'create', cols: 80, rows: 24 }); answer(p); assert.equal((await p.promise).status, 'failed'); failCreate = false; count++;
  var killTarget = await success({ domain: 'terminal', action: 'create', cols: 80, rows: 24 });
  failKill = true; p = await propose({ domain: 'terminal', action: 'close', id: killTarget.result.terminalId }); answer(p); assert.equal((await p.promise).status, 'failed'); failKill = false; count++;
  holdExit = true; p = await propose({ domain: 'terminal', action: 'close', id: killTarget.result.terminalId }); answer(p); await settle();
  f.sourceSession.taskStopRequested = true; ptys[ptys.length - 1].finish(); var stoppedClose = await p.promise;
  assert.equal(stoppedClose.status, 'failed'); assert.equal(stoppedClose.runtimeEffect, 'exited'); f.sourceSession.taskStopRequested = false; holdExit = false; count++;
  var replacedTerminal = await success({ domain: 'terminal', action: 'create', cols: 80, rows: 24 }), replacedPty = ptys[ptys.length - 1];
  holdExit = true; p = await propose({ domain: 'terminal', action: 'close', id: replacedTerminal.result.terminalId }); answer(p); await settle();
  var ownerEvents = [], ownerWs = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: f.session.localId, send: function (data) { ownerEvents.push(JSON.parse(data)); } }; f.target.clients.add(ownerWs);
  f.target.handleMessage(ownerWs, { type: 'term_close', id: replacedTerminal.result.terminalId }); f.target.handleMessage(ownerWs, { type: 'term_create' });
  var replacementPty = ptys[ptys.length - 1]; replacedPty.finish(); var replacedClose = await p.promise; holdExit = false;
  assert.equal(replacedClose.status, 'failed'); assert.equal(replacedClose.runtimeEffect, 'exited'); assert.equal(replacedClose.replacementRetained, true); assert.equal(replacementPty.kills, 0); count++;
  // Storage failures retain truthful effects and never repeat a saved attempt.
  var writeSync = fs.writeSync; p = await propose(Object.assign({}, write, { content: 'Write failure' }));
  fs.writeSync = function () { throw new Error('Fixture file write failed'); };
  try { answer(p); var writeFailed = await p.promise; assert.equal(writeFailed.status, 'failed'); assert.equal(writeFailed.persisted, 'unknown'); } finally { fs.writeSync = writeSync; }
  assert.equal(fs.readFileSync(file, 'utf8'), ''); assert.deepEqual(await call('control_project_workspace', p.args), writeFailed); fs.writeFileSync(file, write.content); count++;
  var rename = fs.renameSync; p = await propose(write);
  fs.renameSync = function (from, to) { if (String(to).endsWith('/' + f.sourceSession._sessionRecordId + '.jsonl')) throw new Error('Fixture receipt save failed'); return rename.apply(fs, arguments); };
  try { answer(p); assert.equal((await p.promise).status, 'failed'); } finally { fs.renameSync = rename; } count++;
  var retained = await success(Object.assign({}, write, { content: 'Retained exact write' })), origin = f.sourceSession.sessionOriginId, request = retained.proposal.args.requestId;
  f.sourceSession._sdkQueryGeneration++;
  assert.equal((await call('read_workspace_receipt', { projectSlug: 'target', domain: 'files', requestId: request })).status, 'finished'); count++;
  await f.source.destroy(); f.source = f.make('clay-source', f.clay);
  f.sourceSession = Array.from(f.source.sm.sessions.values()).find(function (session) { return session.sessionOriginId === origin; });
  f.sourceSession._sdkQueryGeneration = 20; f.sourceSession.abortController = new AbortController(); f.ws._clayActiveSession = f.sourceSession.localId; f.source.clients.add(f.ws);
  var inspected = await inspect(Object.assign({}, write, { content: 'Retained exact write' }));
  var receiptResult = await call('control_project_workspace', { targetToken: inspected.targetToken, requestId: request, why: 'Apply the exact isolated workspace change' });
  assert.equal(receiptResult.status, 'completed'); assert.equal(fs.readFileSync(file, 'utf8'), 'Retained exact write'); count++;
  var originalStatus = f.target.getStatus;
  f.target.getStatus = function () { return Object.assign({}, originalStatus(), { isWorktree: true, parentSlug: 'missing-parent' }); };
  assert.equal((await read({ domain: 'files', action: 'read', path: 'review.txt' })).status, 'failed'); f.target.getStatus = originalStatus; count++;
  // Real OS file helpers run only as this test process's identity in its temp
  // directory; host identity lookup is replaced and registry storage stays here.
  var osUsers = require('../../lib/os-users'), oldResolve = osUsers.resolveOsUserInfo, oldCtx = f.mates.buildMateCtx;
  var actualUid = process.getuid(), uid = actualUid, actualGid = process.getgid();
  await f.target.destroy(); module.exports.osMode = true; f.target = f.make('target'); module.exports.osMode = false;
  assert.equal((await read({ domain: 'files', action: 'read', path: 'review.txt' })).status, 'failed'); count++;
  var osRoster = f.users.loadUsers();
  f.mates.buildMateCtx = function (owner) { return Object.assign({}, oldCtx(owner), { linuxUser: null }); };
  f.users.saveUsers(Object.assign({}, osRoster, { users: osRoster.users.map(function (user) { return Object.assign({}, user, user.id === 'owner' ? { linuxUser: 'fixture-owner-os' } : {}); }) }));
  osUsers.resolveOsUserInfo = function (username) { assert.equal(username, 'fixture-owner-os'); return { user: username, uid: uid, gid: actualGid, home: f.root, shell: '/bin/sh' }; };
  try {
    assert.equal((await read({ domain: 'files', action: 'read', path: 'review.txt' })).content, 'Retained exact write'); count++;
    await success(Object.assign({}, write, { content: 'OS helper exact write' }));
    assert.equal(fs.readFileSync(file, 'utf8'), 'OS helper exact write'); count++;
    await success({ domain: 'git', action: 'stage', paths: ['review.txt'] });
    await success({ domain: 'git', action: 'unstage', paths: ['review.txt'] });
    p = await propose({ domain: 'files', action: 'write', path: 'folder/nested.txt', content: 'Must not cross a late symlink' });
    var moved = path.join(f.root, 'moved-folder');
    beforeExactWrite = function () { fs.renameSync(path.join(cwd, 'folder'), moved); fs.symlinkSync(moved, path.join(cwd, 'folder')); };
    try { answer(p); var crossed = await p.promise; assert.equal(crossed.status, 'failed'); assert.equal(fs.readFileSync(path.join(moved, 'nested.txt'), 'utf8'), 'Nested'); }
    finally { beforeExactWrite = null; fs.unlinkSync(path.join(cwd, 'folder')); fs.renameSync(moved, path.join(cwd, 'folder')); } count++;
    p = await propose(write); uid++; assert.equal(answer(p), false); cancel(p); await p.promise; uid = actualUid; count++;
    var osTerminal = await success({ domain: 'terminal', action: 'create', cols: 80, rows: 24 });
    assert.equal(ptys[ptys.length - 1].identity.uid, actualUid); count++;
    await success({ domain: 'terminal', action: 'close', id: osTerminal.result.terminalId });
    // A source mapping change also invalidates the pending owner review.
    var sourceOrigin = f.sourceSession.sessionOriginId;
    await f.source.destroy(); module.exports.osMode = true; f.source = f.make('clay-source', f.clay); module.exports.osMode = false;
    f.sourceSession = Array.from(f.source.sm.sessions.values()).find(function (session) { return session.sessionOriginId === sourceOrigin; });
    f.sourceSession._sdkQueryGeneration = 30; f.sourceSession.abortController = new AbortController(); f.ws._clayActiveSession = f.sourceSession.localId; f.source.clients.add(f.ws);
    p = await propose(write); uid++; assert.equal(answer(p), false); cancel(p); await p.promise; uid = actualUid; count++;
  } finally { osUsers.resolveOsUserInfo = oldResolve; f.users.saveUsers(osRoster); f.mates.buildMateCtx = oldCtx; }
  assert.equal(ptys.every(function (pty) { return pty.writes.length === 0; }), true);
  console.log(count + ' production workspace scenarios passed');
}
module.exports = { installTransport: installTransport, run: run };
