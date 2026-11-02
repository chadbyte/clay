// Optional local-ref removal, bound to a reviewed tip and retained parent HEAD.
var identities = require('./worktree-identity');
var git = require('./git-cli').runGitSync;
var refTransaction = require('./worktree-ref-transaction');
function run(snapshot, args, os, options) { return git(snapshot.parent.path, args, options || null, os).trim(); }
function symbolic(snapshot, ref, os) {
  try { return run(snapshot, ['symbolic-ref', '--quiet', ref], os); }
  catch (error) { if (error.status === 1) return null; throw error; }
}
function inputFor(snapshot, branch, os, deleting) {
  var input = 'start\noption no-deref\n';
  // Git cannot verify HEAD's symref and its referent in one transaction.
  if (symbolic(snapshot, 'HEAD', os) !== branch.parentRef) throw new Error('The retained parent HEAD/ref changed.');
  input += 'verify ' + (branch.parentRef || 'HEAD') + ' ' + branch.parentHead + '\n';
  input += 'option no-deref\n' + (deleting ? 'delete ' : 'verify ') + branch.ref + ' ' + branch.tip + '\nprepare\n';
  // No dereferencing: a replacement symbolic ref must never delete its target.
  return input;
}
function inspect(snapshot, os, removed, locked) {
  if (!/^refs\/heads\//.test(snapshot.branch)) throw new Error('Detached HEAD has no local branch to delete.');
  if (JSON.stringify(identities.identity(snapshot.parent.path, true)) !== JSON.stringify(snapshot.parent) ||
      JSON.stringify(identities.identity(snapshot.common.path, true)) !== JSON.stringify(snapshot.common)) throw new Error('The retained repository identity changed.');
  var ref = snapshot.branch;
  run(snapshot, ['check-ref-format', ref], os);
  if (symbolic(snapshot, ref, os)) throw new Error('The local branch was replaced by a symbolic ref.');
  var tip = run(snapshot, ['show-ref', '--verify', '--hash', ref], os);
  var parentRef = symbolic(snapshot, 'HEAD', os);
  var parentHead = run(snapshot, ['rev-parse', '--verify', 'HEAD'], os);
  if (parentRef === ref) throw new Error('The local branch is the current parent branch.');
  if (parentRef && symbolic(snapshot, parentRef, os)) throw new Error('The retained parent branch is a symbolic ref.');
  var blocks = run(snapshot, ['worktree', 'list', '--porcelain', '-z'], os).split('\0\0').filter(Boolean);
  blocks.forEach(function (block) {
    var fields = block.split('\0');
    if (fields.indexOf('branch ' + ref) >= 0 && (removed || fields[0] !== 'worktree ' + snapshot.target.path)) throw new Error('The local branch is checked out by another worktree.');
  });
  try { run(snapshot, ['merge-base', '--is-ancestor', tip, parentHead], os); }
  catch (error) { throw new Error('The local branch is not merged into the retained parent HEAD. Keep the branch or merge it first.'); }
  var branch = { ref: ref, tip: tip, parentRef: parentRef, parentHead: parentHead };
  // Probe the fixed transaction syntax before runtime or directory effects.
  if (!locked) run(snapshot, ['update-ref', '--stdin'], os, { input: inputFor(snapshot, branch, os, false) + 'commit\n' });
  return branch;
}
function exact(snapshot, branch, os, removed, locked) {
  if (JSON.stringify(inspect(snapshot, os, removed, locked)) !== JSON.stringify(branch)) throw new Error('The reviewed local branch tip or retained parent HEAD/ref changed. Review again.');
}
async function remove(snapshot, branch, os, validate) {
  exact(snapshot, branch, os, true);
  await refTransaction.remove(snapshot.parent.path, inputFor(snapshot, branch, os, true), os, function () {
    if (validate) validate();
    // CAS alone permits same-tip symbolic replacements. Inspect under the prepared locks.
    exact(snapshot, branch, os, true, true);
  });
  var refs = run(snapshot, ['for-each-ref', '--format=%(refname)', branch.ref], os).split('\n');
  if (refs.indexOf(branch.ref) >= 0) throw new Error('Local branch absence was not confirmed. Inspect it before recovery.');
  return true;
}
module.exports = { inspect: inspect, exact: exact, remove: remove };
