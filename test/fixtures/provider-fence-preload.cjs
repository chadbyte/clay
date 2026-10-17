// Preloaded with `node -r` before any product import: no vendor binary can be
// launched and no model catalogue or completion can reach a provider. Product
// modules are patched as they load, so the fixture's own HOME and CLAY_HOME
// (set after this file runs) are still what config reads.
var cp = require('node:child_process');
var path = require('node:path');
var Module = require('node:module');
['execFile', 'execFileSync', 'spawn', 'spawnSync', 'exec', 'execSync', 'fork'].forEach(function (name) {
  var original = cp[name];
  cp[name] = function (command) {
    if (/^(claude|codex|copilot|opencode|gemini|qwen|kiro|junie|kimi)(\.exe)?$/.test(path.basename(String(command)))) throw new Error('Provider execution is forbidden in this fixture: ' + command);
    return original.apply(cp, arguments);
  };
});
var load = Module._load;
Module._load = function (request, parent) {
  var exported = load.apply(this, arguments);
  var file; try { file = Module._resolveFilename(request, parent); } catch (error) { return exported; }
  var rel = path.relative(path.join(__dirname, '../../lib'), file).split(path.sep).join('/');
  if (rel === 'yoke/index.js' && !exported.__fenced) {
    exported.__fenced = true;
    exported.createAdapters = function () {
      var adapters = {};
      ['claude', 'codex'].forEach(function (vendor) {
        adapters[vendor] = { vendor: vendor,
          init: async function () { return { models: [{ value: 'fixture', displayName: 'Fixture' }], slashCommands: [], capabilities: {} }; },
          createToolServer: function (value) { return value; }, shutdown: function () {},
          createQuery: function () { throw new Error('Provider execution is forbidden'); } };
      });
      return { adapters: adapters, auth: { claude: true, codex: true } };
    };
    exported.completeOnce = function () { return Promise.reject(new Error('Live completion forbidden')); };
  }
  if (rel === 'updater.js' && !exported.__fenced) {
    exported.__fenced = true;
    exported.fetchVersion = function () { return Promise.resolve(null); };
    exported.fetchLatestVersion = function () { return Promise.resolve(null); };
  }
  return exported;
};
