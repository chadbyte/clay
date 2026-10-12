var passwords = require('./account-passwords');
function attachAccountSecurity(ctx) {
  function sessionList(req, user) {
    var current = ctx.sessions.get(ctx.sessionToken(req), false);
    return ctx.sessions.list(user.id).filter(function (entry) { return !!ctx.validSessionUser(entry); }).map(function (entry) {
      return { id: entry.id, current: !!current && entry.id === current.id, userAgent: entry.userAgent || '',
        address: entry.address, createdAt: entry.migrated ? null : entry.createdAt,
        lastSeenAt: entry.migrated ? entry.observedAt || null : entry.lastSeenAt,
        unknownDevice: !!entry.migrated && !entry.observedAt,
        expiresAt: entry.expiresAt, method: entry.passkeyId ? 'Passkey' : entry.credentialVersion ? 'Password' : 'Account sign-in', migrated: !!entry.migrated };
    }).sort(function (a, b) { return Number(b.current) - Number(a.current) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0); });
  }
  async function verify(req, data, original) {
    ctx.http.throttle(req, original.username);
    if (!original.passwordHash || !await passwords.verify(data.currentPassword, original.passwordHash)) throw new Error('Current password is incorrect.');
    var current = ctx.getUser(req);
    if (!current || current.id !== original.id || current.passwordHash !== original.passwordHash) throw new Error('Sign in again to continue.');
    ctx.http.clearAttempts(req, current.username); return current;
  }
  function handleRequest(req, res, url) {
    if (url !== '/api/account-sessions' && url !== '/api/account-transport' && url !== '/account/sessions') return false;
    var user = ctx.getUser(req);
    if (!user) { ctx.http.reply(res, 401, { error: 'Sign in again to manage your account.' }); return true; }
    if (url === '/account/sessions' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "frame-ancestors 'none'" });
      res.end(require('./account-session-page').render()); return true;
    }
    if (url === '/api/account-transport') {
      if (user.role !== 'admin') { ctx.http.reply(res, 403, { error: 'Administrator access required.' }); return true; }
      if (req.method === 'GET') { ctx.http.reply(res, 200, ctx.transport.settings()); return true; }
      if (req.method !== 'PUT') { ctx.http.reply(res, 405, { error: 'Method not allowed.' }); return true; }
      ctx.http.read(req, res, async function (data) {
        var admin = await verify(req, data, user);
        if (admin.role !== 'admin') throw new Error('Administrator access required.');
        var saved = ctx.transport.save(data); ctx.http.reply(res, 200, Object.assign({ ok: true }, saved));
      }); return true;
    }
    if (req.method === 'GET') { ctx.http.reply(res, 200, { sessions: sessionList(req, user), maximumDays: 30, idleDays: 7 }); return true; }
    if (req.method !== 'POST') { ctx.http.reply(res, 405, { error: 'Method not allowed.' }); return true; }
    ctx.http.read(req, res, function (data) {
      var active = ctx.getUser(req);
      if (!active || active.id !== user.id) throw new Error('Sign in again to manage sessions.');
      var current = ctx.sessions.get(ctx.sessionToken(req), false);
      if (!current || typeof data.id !== 'string') throw new Error('Invalid session.');
      if (data.id !== 'others' && !ctx.sessions.list(user.id).some(function (entry) { return entry.id === data.id; })) throw new Error('Session not found.');
      ctx.sessions.revoke(user.id, data.id, current.id);
      ctx.http.reply(res, 200, { ok: true, signedOut: data.id === current.id, sessions: sessionList(req, user) });
    });
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachAccountSecurity: attachAccountSecurity };
