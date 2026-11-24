var crypto = require('crypto');

function attachPinRecovery(ctx) {
  var pending = new Map();
  var cookieName = ctx.devMode ? 'clay_pin_transition_dev' : 'clay_pin_transition';
  function cookie(token, req) {
    return cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
      (token ? '600' : '0') + (ctx.transport.info(req).secure ? '; Secure' : '');
  }
  function start(user, req, res) {
    pending.forEach(function (proof, key) { if (proof.until <= Date.now()) pending.delete(key); });
    if (pending.size >= 1000) throw new Error('Sign-in is busy. Retry shortly.');
    var token = crypto.randomBytes(32).toString('hex');
    pending.set(token, { userId: user.id, pinHash: user.pinHash, until: Date.now() + 600000 });
    ctx.http.reply(res, 200, { ok: true, pinRequired: true }, cookie(token, req));
  }
  function handleRequest(req, res, url) {
    var token = ctx.parseCookies(req)[cookieName];
    if (url === '/auth/logout' && req.method === 'POST') pending.delete(token);
    if (url !== '/auth/pin-transition' || req.method !== 'POST') return false;
    ctx.http.read(req, res, function (data) {
      var proof = pending.get(token);
      var user = proof && ctx.users.findUserById(proof.userId);
      if (ctx.policy.enabled() || !proof || proof.until <= Date.now() || !user ||
        !user.mustChangePin || user.pinHash !== proof.pinHash) throw new Error('Verify your temporary PIN again.');
      ctx.http.throttle(req, user.username);
      if (typeof data.pin !== 'string' || !/^\d{6}$/.test(data.pin)) throw new Error('PIN must be exactly 6 digits.');
      if (data.pin !== data.confirmPin) throw new Error('PINs do not match.');
      if (ctx.users.verifyPin(data.pin, user.pinHash, user)) throw new Error('Choose a different PIN from your temporary PIN.');
      ctx.revokeSessions(user.id);
      var result = ctx.users.updateUserPin(user.id, data.pin);
      if (!result.ok) throw new Error(result.error || 'Could not save your PIN.');
      pending.delete(token);
      var session = ctx.createSession(user.id, null, null, ctx.transport.info(req).secure, req);
      ctx.http.reply(res, 200, { ok: true }, session.cookies.concat([cookie('', req)]));
    });
    return true;
  }
  return { start: start, handleRequest: handleRequest };
}
module.exports = { attachPinRecovery: attachPinRecovery };
