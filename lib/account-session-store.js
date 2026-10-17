var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var DAY = 86400000;
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function attachSessionStore(ctx) {
  var records = {};
  function save(next) {
    fs.mkdirSync(path.dirname(ctx.file), { recursive: true });
    fs.writeFileSync(ctx.file + '.tmp', JSON.stringify({ version: 2, sessions: next }), { mode: 0o600 });
    fs.renameSync(ctx.file + '.tmp', ctx.file);
    records = next;
  }
  function metadata(userId, managed, req) {
    var now = Date.now();
    return { id: crypto.randomBytes(16).toString('hex'), userId: userId, createdAt: now, lastSeenAt: now,
      expiresAt: managed ? now + 30 * DAY : null, idleMs: managed ? 7 * DAY : null,
      userAgent: req && String(req.headers['user-agent'] || '').slice(0, 256) || '',
      address: req ? ctx.clientAddress(req) : '', observedAt: req ? now : null };
  }
  try {
    var data = JSON.parse(fs.readFileSync(ctx.file, 'utf8'));
    if (data.version === 2 && data.sessions && typeof data.sessions === 'object') records = data.sessions;
    else if (data && typeof data === 'object' && !Array.isArray(data)) {
      var migrated = {};
      Object.keys(data).forEach(function (token) {
        var old = data[token]; var userId = typeof old === 'string' ? old : old && old.userId;
        if (!userId) return;
        var entry = metadata(userId, ctx.managed()); entry.migrated = true;
        if (old.credential) entry.credentialVersion = digest(old.credential);
        if (old.passkeyId) entry.passkeyId = old.passkeyId;
        migrated[digest(token)] = entry;
      });
      save(migrated);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not load or migrate account sessions. Existing session data was not replaced.');
  }
  function live(entry) {
    return !!entry && (!entry.expiresAt || Date.now() < entry.expiresAt) && (!entry.idleMs || Date.now() < entry.lastSeenAt + entry.idleMs);
  }
  function create(userId, credential, passkeyId, req, previousToken) {
    var token = crypto.randomBytes(32).toString('hex');
    var entry = metadata(userId, ctx.managed(), req);
    if (credential) entry.credentialVersion = digest(credential);
    if (passkeyId) entry.passkeyId = passkeyId;
    var next = {};
    var previousKey = previousToken ? digest(previousToken) : '';
    Object.keys(records).forEach(function (key) {
      if (live(records[key]) && !(key === previousKey && records[key].userId === userId)) next[key] = records[key];
    });
    next[digest(token)] = entry; save(next);
    return { token: token, entry: entry };
  }
  function get(token, touch, req) {
    if (typeof token !== 'string' || token.length > 256) return null;
    var key = digest(token); var entry = records[key];
    if (!live(entry)) return null;
    if (touch && (!entry.observedAt || Date.now() - entry.lastSeenAt >= 60000)) {
      var next = Object.assign({}, records); next[key] = Object.assign({}, entry, { lastSeenAt: Date.now() });
      if (req) {
        next[key].observedAt = Date.now();
        next[key].userAgent = String(req.headers['user-agent'] || '').slice(0, 256);
        next[key].address = ctx.clientAddress(req);
      }
      try { save(next); entry = next[key]; } catch (error) { /* Keep the earlier durable idle deadline on write failure. */ }
    }
    return entry;
  }
  function remove(test) {
    var next = {}; var changed = false;
    Object.keys(records).forEach(function (key) { if (test(records[key], key)) changed = true; else next[key] = records[key]; });
    if (changed) save(next);
  }
  function list(userId) { return Object.values(records).filter(function (entry) { return entry.userId === userId && live(entry); }); }
  return { create: create, get: get, list: list,
    revokeUser: function (id) { remove(function (entry) { return entry.userId === id; }); },
    revokeToken: function (token) { if (token) remove(function (entry, key) { return key === digest(token); }); },
    revoke: function (userId, id, except) { remove(function (entry) { return entry.userId === userId && (id === 'others' ? entry.id !== except : entry.id === id); }); },
  };
}
module.exports = { attachSessionStore: attachSessionStore, digest: digest };
