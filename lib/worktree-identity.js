// Exact Git and filesystem identities for reviewed linked-worktree removal.
var fs = require('fs');
var path = require('path');
var git = require('./git-cli').runGitSync;
function identity(value, directory) {
  var resolved = path.resolve(value), real = fs.realpathSync(resolved), stat = fs.lstatSync(resolved);
  if (resolved !== real || stat.isSymbolicLink() || (directory && !stat.isDirectory())) throw new Error('Worktree paths must be real directories without symlink aliases.');
  return { path: real, dev: stat.dev, ino: stat.ino, uid: stat.uid };
}
function inspect(parentPath, targetPath, osUserInfo, clean) {
  var parent = identity(parentPath, true), target = identity(targetPath, true);
  function run(root, args) { return git(root, args, null, osUserInfo).trim(); }
  if (parent.path === target.path) throw new Error('The main repository cannot be deleted as a worktree.');
  var common = identity(path.resolve(parent.path, run(parent.path, ['rev-parse', '--git-common-dir'])), true);
  var parentGit = identity(run(parent.path, ['rev-parse', '--absolute-git-dir']), true);
  if (JSON.stringify(common) !== JSON.stringify(parentGit)) throw new Error('Choose the main repository as the parent.');
  if (run(parent.path, ['rev-parse', '--show-toplevel']) !== parent.path || run(target.path, ['rev-parse', '--show-toplevel']) !== target.path) throw new Error('The registered path is not an exact repository root.');
  var targetCommon = identity(path.resolve(target.path, run(target.path, ['rev-parse', '--git-common-dir'])), true);
  var targetGit = identity(run(target.path, ['rev-parse', '--absolute-git-dir']), true);
  if (JSON.stringify(common) !== JSON.stringify(targetCommon) || targetGit.path === common.path || path.dirname(targetGit.path) !== path.join(common.path, 'worktrees')) throw new Error('The target is not a linked worktree of this parent.');
  var marker = identity(path.join(target.path, '.git'), false);
  if (!fs.lstatSync(marker.path).isFile() || fs.readFileSync(marker.path, 'utf8').trim() !== 'gitdir: ' + targetGit.path) throw new Error('Worktree Git binding is invalid.');
  if (fs.readFileSync(path.join(targetGit.path, 'gitdir'), 'utf8').trim() !== marker.path) throw new Error('Worktree Git backlink changed.');
  var records = git(parent.path, ['worktree', 'list', '--porcelain', '-z'], null, osUserInfo).split('\0\0').filter(Boolean);
  var matches = records.filter(function (block) { return block.split('\0')[0] === 'worktree ' + target.path; });
  if (matches.length !== 1) throw new Error('Exact Git worktree membership is unavailable.');
  var fields = matches[0].split('\0');
  if (fields.some(function (field) { return /^prunable(?: |$)|^bare$/.test(field) || clean && /^locked(?: |$)/.test(field); })) throw new Error('The worktree is locked, prunable or unavailable.');
  if (clean && git(target.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'], null, osUserInfo)) throw new Error('Worktree contains changed, untracked or ignored files. Save or remove them before deleting.');
  return { parent: parent, target: target, common: common, git: targetGit, marker: marker, membership: matches[0], branch: (fields.find(function (field) { return field.indexOf('branch ') === 0; }) || 'branch (detached)').slice(7) };
}
function remove(snapshot, osUserInfo) {
  var current = inspect(snapshot.parent.path, snapshot.target.path, osUserInfo, true);
  if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw new Error('Worktree identity changed after review.');
  git(snapshot.parent.path, ['worktree', 'remove', '--', snapshot.target.path], { timeout: 15000 }, osUserInfo);
  if (fs.existsSync(snapshot.target.path) || fs.existsSync(snapshot.git.path)) throw new Error('Git returned without confirming removal. Inspect the worktree before another attempt.');
  return true;
}
module.exports = { identity: identity, inspect: inspect, remove: remove };
