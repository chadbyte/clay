var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var catalog = require('./speech-catalog');

function attachSpeechStore(root) {
  var directory = path.join(root, 'speech');
  function prepare() { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  function filename(owner) {
    if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Error('Invalid owner');
    return path.join(directory, owner + '.json');
  }
  function read(owner) {
    try { return JSON.parse(fs.readFileSync(filename(owner), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { selected: 'browser', keys: {} }; throw error; }
  }
  function masterKey() {
    prepare();
    var file = path.join(directory, '.key');
    try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return fs.readFileSync(file);
  }
  function encrypt(owner, provider, text) {
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
    cipher.setAAD(Buffer.from(owner + ':' + provider));
    var data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(function (part) { return part.toString('base64'); }).join('.');
  }
  function key(owner, provider) {
    var value = (read(owner).keys || {})[provider];
    if (!value) return null;
    var parts = value.split('.').map(function (part) { return Buffer.from(part, 'base64'); });
    var cipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), parts[0]);
    cipher.setAAD(Buffer.from(owner + ':' + provider)); cipher.setAuthTag(parts[1]);
    return Buffer.concat([cipher.update(parts[2]), cipher.final()]).toString('utf8');
  }
  function view(owner) {
    var data = read(owner);
    return { selected: data.selected || 'browser', language: data.language || 'en-US', configured: Object.keys(data.keys || {}), models: catalog.models, providers: catalog.providers };
  }
  function update(owner, change) {
    var data = read(owner); data.keys = data.keys || {};
    if (change.provider !== undefined) {
      if (!catalog.findProvider(change.provider)) throw new Error('Unknown speech provider');
      if (change.key === null) delete data.keys[change.provider];
      else {
        if (typeof change.key !== 'string' || !change.key.trim() || change.key.length > 4096 || /[\r\n]/.test(change.key)) throw new Error('Enter a valid API key');
        data.keys[change.provider] = encrypt(owner, change.provider, change.key.trim());
      }
    }
    if (change.language !== undefined) {
      if (typeof change.language !== 'string' || !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/.test(change.language)) throw new Error('Invalid speech language');
      data.language = change.language;
    }
    if (change.selected !== undefined) {
      var model = catalog.findModel(change.selected);
      if (!model || (model.provider !== 'browser' && !data.keys[model.provider])) throw new Error('Connect the provider before selecting this model');
      data.selected = model.id;
    }
    // Keep selection after key removal so there is no silent provider fallback.
    prepare();
    var file = filename(owner); var temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    return view(owner);
  }
  return { view: view, update: update, key: key };
}
module.exports = { attachSpeechStore: attachSpeechStore };
