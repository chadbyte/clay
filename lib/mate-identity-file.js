// Resolve the canonical Mate identity without overwriting either document.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

function regularFile(file) {
  try {
    var stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error('Mate identity must be a regular file: ' + file);
    return stat;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveMateIdentityFile(directory) {
  var canonical = path.join(directory, 'AGENTS.md');
  var legacy = path.join(directory, 'CLAUDE.md');
  var current = regularFile(canonical);
  if (!regularFile(legacy)) return canonical;
  if (!current) {
    // Exclusive linking preserves owner, mode and bytes and never replaces a
    // concurrently created canonical file. Unlink only after publication.
    try { fs.linkSync(legacy, canonical); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return resolveMateIdentityFile(directory);
    }
  } else if (fs.statSync(canonical).ino !== fs.statSync(legacy).ino) {
    // Preserve a conflicting legacy document outside instruction discovery.
    var backup = path.join(directory, '.identity-legacy-' + crypto.randomBytes(12).toString('hex') + '.md');
    fs.linkSync(legacy, backup);
  }
  fs.unlinkSync(legacy);
  return canonical;
}

module.exports = {resolveMateIdentityFile: resolveMateIdentityFile};
