var crypto = require('crypto');

function attachChallenges(ctx) {
  var entries = new Map();
  var name = ctx.devMode ? 'clay_passkey_dev' : 'clay_passkey';
  function cookie(token, origin) {
    return name + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (token ? '300' : '0') +
      (origin.indexOf('https:') === 0 ? '; Secure' : '');
  }
  function clear(req) { entries.delete(ctx.parseCookies(req)[name]); }
  function issue(req, policy, proof) {
    var now = Date.now();
    entries.forEach(function (entry, token) { if (entry.until <= now) entries.delete(token); });
    clear(req);
    if (entries.size >= 1000) throw new Error('Passkey sign-in is busy. Please retry shortly.');
    var token = crypto.randomBytes(32).toString('hex');
    entries.set(token, Object.assign({}, proof, policy, { until: now + 300000 }));
    return cookie(token, policy.origin);
  }
  function take(req, policy, purpose) {
    var token = ctx.parseCookies(req)[name];
    var proof = entries.get(token);
    entries.delete(token);
    if (!proof || proof.until <= Date.now() || proof.purpose !== purpose || proof.origin !== policy.origin || proof.rpID !== policy.rpID) {
      throw new Error('This passkey request expired or was already used. Please try again.');
    }
    return proof;
  }
  return { issue: issue, take: take, clear: clear, cookie: cookie };
}
module.exports = { attachChallenges: attachChallenges };
