var crypto = require('crypto');
var passwords = require('./account-passwords');
var attachPolicy = require('./account-auth-policy').attachPolicy;

function attachAccountPasswords(ctx) {
  var users = ctx.users;
  var policy = attachPolicy(users);
  var pending = new Map();

  var cookieName = ctx.devMode ? 'clay_password_transition_dev' : 'clay_password_transition';
  function reply(res, code, data, cookies) {
    var headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (cookies) headers['Set-Cookie'] = cookies;
    res.writeHead(code, headers); res.end(JSON.stringify(data));
  }
  function transitionCookie(token, req) {
    return cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (token ? '600' : '0') + (ctx.tlsOptions || req && ctx.transport.info(req).secure ? '; Secure' : '');
  }
  function read(req, res, action, maxBytes) {
    if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') { reply(res, 415, { error: 'JSON required.' }); return; }
    var body = ''; var oversized = false;
    req.on('data', function (chunk) { if (oversized) return; body += chunk; if (Buffer.byteLength(body) > (maxBytes || 4096)) { oversized = true; reply(res, 413, { error: 'Request too large.' }); } });
    req.on('end', function () {
      if (oversized) return;
      var data; try { data = JSON.parse(body); } catch (error) { reply(res, 400, { error: 'Invalid request.' }); return; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) { reply(res, 400, { error: 'Invalid request.' }); return; }
      Promise.resolve().then(function () { return action(data); }).catch(function (error) { reply(res, error.status || 400, { error: error.message || 'Could not complete sign-in.' }); });
    });
  }
  function throttle(req, username) { ctx.throttle.consume(req, username); }
  function clearAttempts(req, username) { ctx.throttle.success(req, username); }
  function grant(user, res, req) {
    var session = ctx.createSession(user.id, user.passwordHash, null, ctx.transport.info(req).secure, req);
    reply(res, 200, { ok: true }, [session.cookie, transitionCookie('', req)]);
  }
  function startTransition(user, res, req) {
    var now = Date.now();
    pending.forEach(function (entry, key) { if (entry.until <= now) pending.delete(key); });
    if (pending.size >= 1000) throw new Error('Sign-in is busy. Please retry shortly.');
    var token = crypto.randomBytes(32).toString('hex');
    pending.set(token, { userId: user.id, pinHash: user.pinHash, until: now + 600000, busy: false });
    reply(res, 200, { ok: true, passwordRequired: true }, transitionCookie(token, req));
  }
  function handleRequest(req, res, url) {
    if (req.method === 'POST' && url === '/auth/logout') pending.delete(ctx.parseCookies(req)[cookieName]);
    if (url === '/api/account-auth-policy') {
      var admin = ctx.getUser(req);
      if (!admin || admin.role !== 'admin') { reply(res, 403, { error: 'Administrator access required.' }); return true; }
      if (req.method === 'GET') { reply(res, 200, { method: policy.enabled() ? 'password' : 'pin', available: policy.available() }); return true; }
      if (req.method !== 'PUT') { reply(res, 405, { error: 'Method not allowed.' }); return true; }
      read(req, res, function (data) {
        if (data.method !== 'password') throw new Error('Only the password transition is supported.');
        policy.activate();
        reply(res, 200, { ok: true, method: 'password' });
        if (ctx.onPolicyChanged) ctx.onPolicyChanged();
      });
      return true;
    }
    if (!policy.enabled()) return false;
    if (req.method === 'GET' && url === '/account/password') {
      var signedIn = ctx.getUser(req);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(require('./account-password-page').render(!!signedIn));
      return true;
    }
    if (req.method === 'POST' && url === '/auth/password-change') {
      read(req, res, async function (data) {
        var user = ctx.getUser(req);
        if (!user) throw new Error('Sign in again to change your password.');
        throttle(req, user.username);
        if (!await passwords.verify(data.currentPassword, user.passwordHash)) throw new Error('Current password is incorrect.');
        if (data.password !== data.confirmPassword) throw new Error('Passwords do not match.');
        var hash = await passwords.hash(data.password);
        var state = users.loadUsers();
        var current = state.users.find(function (entry) { return entry.id === user.id; });
        if (!current || current.passwordHash !== user.passwordHash || current.mustChangePin) throw new Error('Credentials changed. Sign in again.');
        current.passwordHash = hash; users.saveUsers(state);
        ctx.revokeSessions(user.id); clearAttempts(req, user.username); grant(current, res, req);
      });
      return true;
    }
    if (url === '/api/user/pin') {
      reply(res, 409, { error: 'This server uses account passwords. Contact an administrator for credential recovery.' });
      return true;
    }
    if (req.method === 'POST' && url === '/auth/login') {
      read(req, res, async function (data) {
        throttle(req, data.username);
        var user = typeof data.username === 'string' ? users.findUserByUsername(data.username) : null;
        if (data.pin !== undefined) {
          if (!user || user.passwordHash && !user.mustChangePin || typeof data.pin !== 'string' || !/^\d{6}$/.test(data.pin) || !users.verifyPin(data.pin, user.pinHash, user)) throw new Error('Invalid username or account PIN.');
          clearAttempts(req, user.username); startTransition(user, res, req); return;
        }
        var originalHash = user && user.passwordHash;
        if (!await passwords.verify(data.password, originalHash)) throw new Error('Invalid username or password.');
        user = users.findUserById(user.id);
        if (!user || user.passwordHash !== originalHash || user.mustChangePin) throw new Error('Account credentials changed. Please sign in again.');
        clearAttempts(req, user.username); grant(user, res, req);
      });
      return true;
    }
    if (req.method === 'POST' && url === '/auth/password-transition') {
      read(req, res, async function (data) {
        var token = ctx.parseCookies(req)[cookieName];
        var proof = pending.get(token);
        if (!proof || proof.until <= Date.now() || proof.busy) throw new Error('Verify your account PIN again.');
        proof.busy = true;
        try {
          if (data.password !== data.confirmPassword) throw new Error('Passwords do not match.');
          var hash = await passwords.hash(data.password);
          var state = users.loadUsers();
          var user = state.users.find(function (entry) { return entry.id === proof.userId; });
          if (!user || user.pinHash !== proof.pinHash || user.passwordHash && !user.mustChangePin || proof.until <= Date.now()) throw new Error('Account credentials changed. Verify your PIN again.');
          user.passwordHash = hash; user.pinHash = null; user.mustChangePin = false;
          users.saveUsers(state);
          pending.delete(token);
          ctx.revokeSessions(user.id);
          grant(user, res, req);
        } finally { proof.busy = false; }
      });
      return true;
    }
    return false;
  }
  return { handleRequest: handleRequest, policy: policy, http: { read: read, reply: reply, throttle: throttle, clearAttempts: clearAttempts } };
}
module.exports = { attachAccountPasswords: attachAccountPasswords };
