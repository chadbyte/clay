// Owner/project-scoped records with encrypted credentials; never sent to the UI.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
function createConnectionStore(root, project) {
  var directory = path.join(root, 'mcp-connections');
  function scope(owner) {
    if (typeof owner !== 'string' || !owner || owner.length > 160) throw new Error('MCP account owner is required.');
    return JSON.stringify([project, owner]);
  }
  function filename(owner) { return path.join(directory, crypto.createHash('sha256').update(scope(owner)).digest('hex') + '.json'); }
  function key() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    var file = path.join(directory, '.key');
    try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return fs.readFileSync(file);
  }
  function load(owner) {
    var data;
    try { data = JSON.parse(fs.readFileSync(filename(owner), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw new Error('Could not read MCP connections.'); }
    var parts = data.encrypted.split('.').map(function (part) { return Buffer.from(part, 'base64'); });
    var cipher = crypto.createDecipheriv('aes-256-gcm', key(), parts[0]);
    cipher.setAAD(Buffer.from(scope(owner))); cipher.setAuthTag(parts[1]);
    return JSON.parse(Buffer.concat([cipher.update(parts[2]), cipher.final()]).toString('utf8'));
  }
  function save(owner, records) {
    var iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(scope(owner)));
    var bytes = Buffer.concat([cipher.update(JSON.stringify(records), 'utf8'), cipher.final()]);
    var value = { encrypted: [iv, cipher.getAuthTag(), bytes].map(function (part) { return part.toString('base64'); }).join('.') };
    var file = filename(owner), temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file); }
    finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  return { load: load, save: save };
}
module.exports = { createConnectionStore: createConnectionStore };
