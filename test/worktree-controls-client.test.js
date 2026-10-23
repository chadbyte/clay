var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture() {
  var state = { currentSlug: 'repo' }, dialogs = [], messages = [], calls = [], fail = false, focused = false, held = [], hold = false, detached = false, nodes = {};
  function node() { return { children: [], classList: { add: function () {}, remove: function () {} }, focus: function () { focused = true; }, appendChild: function (child) { this.children.push(child); if (child.id) nodes[child.id] = child; }, addEventListener: function (event, fn) { this[event] = fn; }, remove: function () { delete nodes[this.id]; } }; }
  var store = { get: function (key) { return state[key]; }, set: function (values) { Object.assign(state, values); } };
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/worktree-controls.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export async function', 'async function');
  var sandbox = { store: store, showConfirm: function () { if (dialogs.length && state.worktreeRemoval && nodes['worktree-branch-option']) nodes['worktree-branch-option'].remove(); dialogs.push(Array.from(arguments)); }, showToast: function (text) { messages.push(text); },
    document: { createElement: node, getElementById: function (id) { if (id === 'worktree-branch-option') return nodes[id]; return nodes[id] || (nodes[id] = node()); } },
    window: { location: { assign: function () { throw new Error('Unexpected navigation'); } } },
    fetch: async function (url, options) { calls.push({ url: url, data: JSON.parse(options.body) }); if (fail) throw new Error('connection lost'); var data = JSON.parse(options.body); if (hold && url.endsWith('preview')) await new Promise(function (resolve) { held.push(resolve); }); return { json: async function () { return url.endsWith('preview') ? { ok: true, token: 'exact-token', branch: 'feature', path: '/repo/feature', deleteBranch: data.deleteBranch === true, localBranch: !detached } : { ok: true, filesDeleted: true }; } }; },
  };
  vm.runInNewContext(source, sandbox);
  return { review: sandbox.reviewWorktreeRemoval, state: state, dialogs: dialogs, messages: messages, calls: calls,
    nodes: nodes, held: held, hold: function () { hold = true; }, detached: function () { detached = true; }, failed: function () { fail = true; }, focused: function () { return focused; } };
}
test('human review shows exact branch/path and distinct consequences; Cancel never executes', async function () {
  var f = fixture(); await f.review('repo--feature', 'delete');
  assert.match(f.dialogs[0][0], /Branch: feature\nDirectory: \/repo\/feature/); assert.match(f.dialogs[0][0], /local branch is kept/);
  assert.equal(f.focused(), true); assert.equal(f.calls.length, 1);
  f.dialogs[0][4](); assert.equal(f.state.worktreeRemoval, null); assert.equal(f.calls.length, 1);
  await f.review('repo--feature', 'exclude'); assert.match(f.dialogs[1][0], /directory, Git branch and stored history are kept/);
});
test('network loss after confirmation stays explicit, persistent and is never automatically retried', async function () {
  var f = fixture(); await f.review('repo--feature', 'delete'); f.failed();
  await f.dialogs[0][1](); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].data.token, 'exact-token');
  assert.match(f.dialogs[1][0], /outcome is unknown/); assert.equal(f.dialogs[1][2], 'Close'); assert.equal(f.state.worktreeRemoval, null);
});
test('changing project context before confirmation prevents the effect', async function () {
  var f = fixture(); await f.review('repo--feature', 'delete'); f.state.currentSlug = 'other';
  await f.dialogs[0][1](); assert.equal(f.calls.length, 1); assert.equal(f.state.worktreeRemoval, null);
});

test('checked choice obtains a fresh review; obsolete async previews cannot enable confirmation or replace the choice', async function () {
  var f = fixture(); await f.review('repo--feature', 'delete'); f.hold();
  var checkbox = f.nodes['worktree-branch-option'].children[0]; assert.equal(checkbox.checked, false);
  checkbox.checked = true; var first = checkbox.change();
  checkbox.checked = false; var second = checkbox.change();
  assert.equal(f.nodes['confirm-ok'].disabled, true); assert.equal(f.state.worktreeRemoval.preview, null);
  f.held[0](); await first; assert.equal(f.nodes['confirm-ok'].disabled, true);
  f.held[1](); await second; assert.equal(f.nodes['confirm-ok'].disabled, false); assert.equal(f.state.worktreeRemoval.preview.deleteBranch, false);
  assert.deepEqual(f.calls.map(function (call) { return call.data.deleteBranch; }), [false, true, false]);
  f.dialogs[0][4](); assert.equal(f.nodes['worktree-branch-option'], undefined);
});
test('selected branch confirmation executes only the fresh token with the exact choice', async function () {
  var f = fixture(); await f.review('repo--feature', 'delete');
  var checkbox = f.nodes['worktree-branch-option'].children[0]; checkbox.checked = true; await checkbox.change();
  assert.match(f.nodes['confirm-text'].children[0].textContent, /Then delete the local branch feature/);
  await f.dialogs[0][1](); assert.equal(f.calls[2].data.deleteBranch, true); assert.equal(f.nodes['worktree-branch-option'], undefined);
});
test('detached deletion has no checkbox and explains the missing local branch; Exclude has no option', async function () {
  var f = fixture(); f.detached(); await f.review('repo--feature', 'delete');
  assert.equal(f.nodes['worktree-branch-option'], undefined); assert.match(f.dialogs[0][0], /Detached HEAD has no local branch/);
  f.dialogs[0][4](); await f.review('repo--feature', 'exclude'); assert.equal(f.nodes['worktree-branch-option'], undefined);
});
test('cancel during refreshed preview prevents late results from enabling another dialog', async function () {
  var f = fixture(); await f.review('repo--feature', 'delete'); f.hold();
  var checkbox = f.nodes['worktree-branch-option'].children[0]; checkbox.checked = true; var pending = checkbox.change();
  f.dialogs[0][4](); f.nodes['confirm-ok'].disabled = true;
  f.held[0](); await pending; assert.equal(f.nodes['confirm-ok'].disabled, true); assert.equal(f.calls.length, 2);
});
