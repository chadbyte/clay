var path = require('path');
var crypto = require('crypto');
var adapters = require('./mcp-source-adapters').adapters;
var KEYS = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT', 'XDG_CONFIG_HOME', 'KIMI_CODE_HOME', 'COPILOT_HOME', 'GROK_HOME', 'QWEN_HOME', 'QWEN_CODE_SYSTEM_SETTINGS_PATH', 'QWEN_CODE_SYSTEM_DEFAULTS_PATH'];
function resolve(ctx, owner, ws, home, identity) {
  // Only the production runtime resolver may supply mapped-user overrides.
  var env = ctx.runtimeEnv ? ctx.runtimeEnv(owner, ws) : identity ? {} : ctx.home ? {} : process.env;
  var selected = {};
  KEYS.forEach(function (key) { if (env[key] !== undefined) selected[key] = env[key]; });
  function qwenRoot(value) { if (!value) return path.join(home, '.qwen'); return path.resolve(ctx.cwd, value.replace(/^~(?=\/|$)/, home)); }
  var roots = { copilot: path.resolve(home, env.COPILOT_HOME || '.copilot'), grok: path.resolve(home, env.GROK_HOME || '.grok'), qwen: qwenRoot(env.QWEN_HOME), codex: path.resolve(home, env.CODEX_HOME || '.codex'), claude: path.resolve(home, env.CLAUDE_CONFIG_DIR || '.claude'),
    opencode: path.resolve(home, env.XDG_CONFIG_HOME || '.config', 'opencode'), kimi: path.resolve(home, env.KIMI_CODE_HOME || '.kimi-code') };
  var sources = [];
  function add(vendor, file, scope, extra) { sources.push(Object.assign({ vendor: vendor, file: file, scope: scope, cwd: ctx.cwd }, extra)); }
  Object.keys(adapters).forEach(function (vendor) {
    var files = adapters[vendor].user;
    if (vendor === 'codex') files = [path.join(roots.codex, 'config.toml')];
    if (vendor === 'claude') files = [env.CLAUDE_CONFIG_DIR ? path.join(roots.claude, '.claude.json') : path.join(home, '.claude.json')];
    if (vendor === 'opencode') files = ['opencode.json', 'opencode.jsonc'].map(function (file) { return path.join(roots.opencode, file); });
    if (vendor === 'copilot') files = [path.join(roots.copilot, 'mcp-config.json')];
    if (vendor === 'grok') files = [path.join(roots.grok, 'config.toml')];
    if (vendor === 'qwen') files = [path.join(roots.qwen, 'settings.json')];
    if (vendor === 'kimi' && env.KIMI_CODE_HOME) files = [path.join(roots.kimi, 'mcp.json')];
    files.forEach(function (file) { add(vendor, path.resolve(home, file), 'user'); });
    adapters[vendor].project.forEach(function (file) { add(vendor, path.join(ctx.cwd, file), 'project'); });
  });
  ['opencode.json', 'opencode.jsonc'].forEach(function (file) { add('opencode', path.join(ctx.cwd, '.opencode', file), 'runtime', { configDirectory: true }); });
  if (env.OPENCODE_CONFIG) add('opencode', path.resolve(ctx.cwd, env.OPENCODE_CONFIG), 'runtime');
  if (env.OPENCODE_CONFIG_DIR) ['opencode.json', 'opencode.jsonc'].forEach(function (file) { add('opencode', path.resolve(ctx.cwd, env.OPENCODE_CONFIG_DIR, file), 'runtime', { configDirectory: true }); });
  if (env.OPENCODE_CONFIG_CONTENT) add('opencode', 'runtime:OPENCODE_CONFIG_CONTENT', 'runtime-inline', { inline: env.OPENCODE_CONFIG_CONTENT });
  return { roots: roots, policyPaths: { qwenSettings: env.QWEN_CODE_SYSTEM_SETTINGS_PATH && path.resolve(ctx.cwd, env.QWEN_CODE_SYSTEM_SETTINGS_PATH), qwenDefaults: env.QWEN_CODE_SYSTEM_DEFAULTS_PATH && path.resolve(ctx.cwd, env.QWEN_CODE_SYSTEM_DEFAULTS_PATH) }, sources: sources, fingerprint: crypto.createHash('sha256').update(JSON.stringify(selected)).digest('hex') };
}
function priority(source) {
  if (source.scope === 'runtime-inline') return 80;
  if (source.scope === 'configured') return 70;
  if (source.scope === 'runtime') return source.configDirectory ? 65 : 30;
  if (source.scope === 'local') return 60;
  if (source.scope === 'project') return 50 + (source.vendor === 'copilot' && path.basename(source.file) === '.mcp.json' ? 1 : 0);
  if (source.scope === 'project-ancestor') return 40 + source.file.split(path.sep).length * 0.01 + (path.basename(source.file) === '.mcp.json' ? 0.001 : 0);
  return source.scope.indexOf('plugin') === 0 ? 10 : 20;
}
module.exports = { resolve: resolve, priority: priority };
