var crypto = require('crypto');
var PREFIX = 'server-pin-v1:';

function isServerHash(hash) {
  return typeof hash === 'string' && (/^[a-f0-9]{64}$/.test(hash) || /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash));
}

function tag(hash) {
  if (!isServerHash(hash)) throw new Error('Invalid legacy server PIN hash');
  return PREFIX + hash;
}

function resolve(hash, user, loadConfig) {
  if (typeof hash !== 'string') return null;
  if (hash.indexOf(PREFIX) === 0) {
    var original = hash.slice(PREFIX.length);
    return isServerHash(original) ? original : null;
  }
  if (!user || !isServerHash(hash) || typeof loadConfig !== 'function') return null;
  // Only the recorded migrated owner may use an untagged server credential.
  var config;
  try { config = loadConfig(); } catch (e) { return null; }
  if (config && config.singleUserMigratedAt && config.singleUserMigratedUserId === user.id && config.pinHash === hash) return hash;
  return null;
}

function verify(pin, hash) {
  if (!isServerHash(hash)) return false;
  var parts = hash.split(':');
  var expected = Buffer.from(parts.length === 2 ? parts[1] : hash, 'hex');
  var actual = parts.length === 2
    ? crypto.scryptSync('clay:' + pin, parts[0], 64)
    : crypto.createHash('sha256').update('clay:' + pin).digest();
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { tag: tag, resolve: resolve, verify: verify };
