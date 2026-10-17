var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var WINDOW = 15 * 60000;
function attachThrottle(ctx) {
  function key(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
  function load() {
    try {
      var data = JSON.parse(fs.readFileSync(ctx.file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(function (entry) { return !entry || !Number.isFinite(entry.count) || !Number.isFinite(entry.until); })) throw new Error('Invalid limiter data.');
      return data;
    }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Sign-in protection is unavailable. Please retry later.'); }
  }
  function save(data) {
    try {
      fs.mkdirSync(path.dirname(ctx.file), { recursive: true });
      fs.writeFileSync(ctx.file + '.tmp', JSON.stringify(data), { mode: 0o600 }); fs.renameSync(ctx.file + '.tmp', ctx.file);
    } catch (error) { throw new Error('Could not save sign-in protection. Please retry later.'); }
  }
  function prune(data) { Object.keys(data).forEach(function (id) { if (data[id].until <= Date.now()) delete data[id]; }); }
  function consumeKeys(keys) {
    var data = load(); prune(data);
    if (Object.keys(data).length >= 10000) throw new Error('Sign-in is busy. Please retry later.');
    keys.forEach(function (value) {
      var id = key(value.name); var entry = data[id] || { count: 0, until: Date.now() + WINDOW };
      if (entry.count >= value.max) { var error = new Error('Too many attempts. Retry in 15 minutes.'); error.status = 429; throw error; }
      entry.count++; data[id] = entry;
    });
    save(data);
  }
  function consume(req, username) {
    var keys = [{ name: 'ip:' + ctx.clientAddress(req), max: 100 }];
    if (username) keys.push({ name: 'account:' + String(username).toLowerCase().slice(0, 100), max: 10 });
    consumeKeys(keys);
  }
  function success(req, username) {
    // Successful logins must not erase the IP budget for attacks against other accounts.
    if (!username) return;
    var data = load(); delete data[key('account:' + String(username).toLowerCase().slice(0, 100))]; prune(data); save(data);
  }
  return { consume: consume, success: success };
}
module.exports = { attachThrottle: attachThrottle };
