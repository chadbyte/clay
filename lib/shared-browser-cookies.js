var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

function cookieKey(cookie) {
  return JSON.stringify([cookie.domain, cookie.path, cookie.name, cookie.partitionKey || '']);
}
function cookieMap(cookies) {
  if (!Array.isArray(cookies) || cookies.length > 10000 || JSON.stringify(cookies).length > 2 * 1024 * 1024) throw new Error('Browser cookies exceed the storage limit');
  var result = new Map();
  cookies.forEach(function (cookie) {
    if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || typeof cookie.domain !== 'string' || typeof cookie.path !== 'string') throw new Error('Invalid browser cookie');
    result.set(cookieKey(cookie), cookie);
  });
  return result;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Merge only a tab's changes, so an idle tab cannot overwrite another tab's login or logout.
function mergeCookies(saved, previous, current) {
  var merged = cookieMap(saved), before = cookieMap(previous), after = cookieMap(current);
  before.forEach(function (cookie, key) {
    if (!after.has(key) && same(merged.get(key), cookie)) merged.delete(key);
  });
  after.forEach(function (cookie, key) {
    if (!same(before.get(key), cookie)) merged.set(key, cookie);
  });
  return Array.from(merged.values()).filter(function (cookie) { return cookie.expires === -1 || cookie.expires > Date.now() / 1000; });
}

function attachEncryptedStore(root, name, empty) {
  var directory = path.join(root, name);
  function ownerKey(owner) {
    if (typeof owner !== 'string' || !owner || owner.length > 256) throw new Error('Browser data owner is required');
    return crypto.createHash('sha256').update(owner).digest('hex');
  }
  function masterKey() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    var file = path.join(directory, '.key');
    try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return fs.readFileSync(file);
  }
  function read(owner) {
    var id = ownerKey(owner), raw;
    try { raw = fs.readFileSync(path.join(directory, id + '.json'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return empty(); throw new Error('Could not read saved browser data'); }
    try {
      var parts = JSON.parse(raw).map(function (part) { return Buffer.from(part, 'base64'); });
      var cipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), parts[0]);
      cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(parts[1]);
      var cookies = JSON.parse(Buffer.concat([cipher.update(parts[2]), cipher.final()]).toString('utf8'));
      return cookies;
    } catch (error) { throw new Error('Could not decrypt saved browser data'); }
  }
  function write(owner, cookies) {
    var id = ownerKey(owner), iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
    cipher.setAAD(Buffer.from(id));
    var bytes = Buffer.concat([cipher.update(JSON.stringify(cookies), 'utf8'), cipher.final()]);
    var file = path.join(directory, id + '.json'), temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify([iv, cipher.getAuthTag(), bytes].map(function (part) { return part.toString('base64'); })), { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    return cookies;
  }
  return { read: read, write: write };
}
function attachCookieStore(root) {
  var disk = attachEncryptedStore(root, 'browser-cookies', function () { return []; });
  function read(owner) { return mergeCookies(disk.read(owner), [], []); }
  return { read: read, clear: function (owner) { disk.write(owner, []); }, exchange: function (owner, previous, current) {
    var saved = read(owner), merged = mergeCookies(saved, previous, current);
    if (!same(saved, merged)) disk.write(owner, merged);
    return merged;
  } };
}
module.exports = { attachEncryptedStore: attachEncryptedStore, attachCookieStore: attachCookieStore, mergeCookies: mergeCookies, cookieKey: cookieKey };
