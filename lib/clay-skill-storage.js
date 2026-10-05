var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

function isClaySkill(name) { return /^clay-[a-z0-9_-]+$/i.test(name); }
function privateRoot(base) { return path.join(base, '.clay', 'skills'); }
function stat(file) { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function directory(dir) {
  var parent = path.dirname(dir);
  if (parent !== dir && (!stat(parent) || path.basename(parent) === ".clay")) directory(parent);
  var info = stat(dir);
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Clay skill directory must not be a symlink: ' + dir);
  if (!info) fs.mkdirSync(dir, { mode: 0o700 });
}
// Snapshot links before moving targets so aliases can be removed without losing their contents.
function migrate(roots) {
  var entries = [];
  roots.forEach(function (root) {
    var names;
    try { names = fs.readdirSync(root.path); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    names.filter(isClaySkill).forEach(function (name) {
      var source = path.join(root.path, name);
      var info = stat(source);
      if (!info || (!info.isDirectory() && !info.isSymbolicLink())) return;
      var resolved;
      try { resolved = fs.realpathSync(source); } catch (e) { return; }
      if (!fs.existsSync(path.join(resolved, 'SKILL.md'))) return;
      entries.push({ source: source, resolved: resolved, name: name, base: root.base, link: info.isSymbolicLink() });
    });
  });
  entries.reverse();
  // Copy everything successfully before removing any publicly discoverable entry.
  entries.forEach(function (entry) {
    var dest = path.join(privateRoot(entry.base), entry.name);
    directory(privateRoot(entry.base));
    if (stat(dest)) {
      var backup = path.join(entry.base, '.clay', 'skill-backups'); directory(backup);
      dest = path.join(backup, entry.name + '-' + crypto.randomBytes(8).toString('hex'));
    }
    fs.cpSync(entry.resolved, dest, { recursive: true, dereference: true, errorOnExist: true, force: false });
  });
  entries.forEach(function (entry) {
    if (entry.link) fs.unlinkSync(entry.source);
    else fs.rmSync(entry.source, { recursive: true });
  });
  return entries.length;
}
module.exports = { isClaySkill: isClaySkill, privateRoot: privateRoot, migrate: migrate, directory: directory };
if (require.main === module) migrate(JSON.parse(process.argv[2]));
