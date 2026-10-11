var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

function attachLinearStore(root) {
  var directory = path.join(root, 'linear');
  function filename(owner) {
    if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Error('Invalid Linear account owner.');
    return path.join(directory, owner + '.json');
  }
  function read(owner) {
    try { return JSON.parse(fs.readFileSync(filename(owner), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Could not read Linear connection.'); }
  }
  function masterKey() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    var file = path.join(directory, '.key');
    try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return fs.readFileSync(file);
  }
  function record(owner, id) {
    var data = read(owner);
    return !id || id === "default" ? data : Object.hasOwn(data.connections || {}, id) ? data.connections[id] : {};
  }
  function key(owner, id) {
    var data = record(owner, id);
    if (!data.secret) return null;
    var parts = data.secret.split('.').map(function (part) { return Buffer.from(part, 'base64'); });
    var cipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), parts[0]);
    cipher.setAAD(Buffer.from(id && id !== 'default' ? owner + ':' + id : owner)); cipher.setAuthTag(parts[1]);
    return Buffer.concat([cipher.update(parts[2]), cipher.final()]).toString('utf8');
  }
  function view(owner, id) {
    var data = record(owner, id);
    return { connected: !!data.secret, workspace: data.workspace || null, revision: data.revision || null };
  }
  function save(owner, secret, workspace, id, name) {
    if (id && (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ['__proto__', 'constructor', 'prototype'].indexOf(id) >= 0)) throw new Error("Invalid connection.");
    var previous = read(owner);
    var file = filename(owner), data = { revision: crypto.randomBytes(16).toString('hex') };
    if (secret !== null) {
      if (typeof secret !== 'string' || !secret.trim() || secret.length > 4096 || /[\r\n]/.test(secret)) throw new Error('Enter a valid Linear API key.');
      var iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
      cipher.setAAD(Buffer.from(id && id !== 'default' ? owner + ':' + id : owner));
      var bytes = Buffer.concat([cipher.update(secret.trim(), 'utf8'), cipher.final()]);
      data.secret = [iv, cipher.getAuthTag(), bytes].map(function (part) { return part.toString('base64'); }).join('.');
      data.workspace = workspace;
    }
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Enter a connection name of up to 80 characters.');
      data.name = name.trim();
    } else data.name = record(owner, id).name;
    if (id && id !== 'default') {
      previous.connections = previous.connections || {};
      if (secret === null) delete previous.connections[id];
      else {
        if (!previous.connections[id] && Object.keys(previous.connections).length >= 30) throw new Error('Connection limit reached.');
        previous.connections[id] = data;
      }
      data = previous;
    } else data.connections = previous.connections;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    var temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(temp, file); }
    finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    return view(owner, id);
  }
  function list(owner) {
    var data = read(owner), entries = [];
    if (data.secret) entries.push(Object.assign({ id: 'default', name: data.name || 'Existing connection', legacy: true }, view(owner)));
    Object.keys(data.connections || {}).forEach(function (id) {
      entries.push(Object.assign({ id: id, name: data.connections[id].name || 'Linear', legacy: false }, view(owner, id)));
    });
    return entries;
  }
  return { key: key, view: view, save: save, list: list };
}
module.exports = { attachLinearStore: attachLinearStore };
