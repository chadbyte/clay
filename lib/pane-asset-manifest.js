var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var MAX_BYTES = 512 * 1024;
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function safeName(name) {
  return typeof name === 'string' && name.length < 240 && /^[a-zA-Z0-9_./-]+$/.test(name) && name.split('/').every(function (part) { return part && part !== '.' && part !== '..'; });
}
function stamp(file) {
  var stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.size > 32n * 1024n * 1024n) throw new Error('Invalid asset');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function validate(manifest) {
  if (!manifest || manifest.version !== 1) throw new Error('Invalid manifest');
  ['inputs', 'outputs'].forEach(function (group) {
    var entries = manifest[group];
    if (!entries || Array.isArray(entries) || typeof entries !== 'object') throw new Error('Invalid entries');
    var names = Object.keys(entries);
    if (!names.length || names.length > (group === 'inputs' ? 1500 : 256)) throw new Error('Asset count exceeded');
    names.forEach(function (name) {
      if (!safeName(name) || !/^[a-f0-9]{64}$/.test(entries[name]) ||
          (group === 'outputs' && !/^pane-assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(name)) ||
          (group === 'inputs' && name.indexOf('pane-assets/') === 0)) throw new Error('Invalid asset path');
    });
  });
  if (!manifest.inputs['app.js'] || !manifest.inputs['style.css'] || !manifest.inputs['index.html'] ||
      !manifest.outputs[manifest.js] || !manifest.outputs[manifest.css] ||
      !/^pane-assets\/app-[\w-]+\.js$/.test(manifest.js) || !/^pane-assets\/style-[\w-]+\.css$/.test(manifest.css)) throw new Error('Invalid entry');
  return manifest;
}
// One fixed manifest per public root; metadata checks on every pane selection,
// hashes only on first use or changed metadata. ctime detects same-length edits
// even when an editor restores mtime. Deployment timestamps are not build dates.
function createPaneAssets(publicDir) {
  var manifestPath = path.join(publicDir, 'pane-assets/manifest.json');
  var previous = null, manifest = null, verified = Object.create(null);
  return function () {
    try {
      var current = stamp(manifestPath);
      if (current !== previous) {
        manifest = null; verified = Object.create(null);
        if (fs.statSync(manifestPath).size > MAX_BYTES) return null;
        manifest = validate(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
        previous = current;
      }
      if (!manifest) return null;
      var entries = Object.assign({}, manifest.inputs, manifest.outputs);
      var names = Object.keys(entries);
      for (var i = 0; i < names.length; i++) {
        var name = names[i], file = path.join(publicDir, name);
        if (fs.realpathSync(file) !== file) return null;
        var signature = stamp(file);
        if (verified[name] !== signature) {
          if (digest(fs.readFileSync(file)) !== entries[name]) return null;
          verified[name] = signature;
        }
      }
      return manifest;
    } catch (error) { return null; }
  };
}
module.exports = { createPaneAssets: createPaneAssets, digest: digest, validate: validate, maxBytes: MAX_BYTES };
