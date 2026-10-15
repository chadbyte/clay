var path = require('path');
var SECURITY = /permission|policy|security|sandbox|registry|disabledMcp|restrict|approval|allowed|denied|managedMcp|strictPlugin|includeTools|excludeTools/i;
function inspect(ctx) {
  var blocked = {}, files = [];
  function add(vendor, file, exclusive) { files.push({ vendor: vendor, file: file, exclusive: exclusive }); }
  var claudeManaged = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode') : '/etc/claude-code';
  ['managed-mcp.json', 'managed-settings.json'].forEach(function (file) { add('claude', path.join(claudeManaged, file), true); });
  add('claude', path.join(claudeManaged, 'managed-settings.d'), true);
  if (process.platform === 'darwin') {
    add('claude', '/Library/Managed Preferences/com.anthropic.claudecode.plist', true);
    if (ctx.username) add('claude', path.join('/Library/Managed Preferences', ctx.username, 'com.anthropic.claudecode.plist'), true);
  }
  [path.join(ctx.roots.claude, 'settings.json'), path.join(ctx.cwd, '.claude/settings.json'), path.join(ctx.cwd, '.claude/settings.local.json')].forEach(function (file) { add('claude', file); });
  [path.join(ctx.roots.codex, 'requirements.toml'), '/etc/codex/requirements.toml', '/etc/codex/managed_config.toml', path.join(ctx.roots.codex, 'managed_config.toml')].forEach(function (file) { add('codex', file, true); });
  var openCodeManaged = process.platform === 'darwin' ? '/Library/Application Support/opencode' : process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'opencode') : '/etc/opencode';
  ['opencode.json', 'opencode.jsonc'].forEach(function (file) { add('opencode', path.join(openCodeManaged, file), true); });
  if (process.platform === 'darwin') {
    add('opencode', '/Library/Managed Preferences/ai.opencode.managed.plist', true);
    if (ctx.username) add('opencode', path.join('/Library/Managed Preferences', ctx.username, 'ai.opencode.managed.plist'), true);
  }
  ['settings.json', 'permissions-config.json'].forEach(function (file) { add('copilot', path.join(ctx.roots.copilot, file)); });
  ['settings.json', 'settings.local.json'].forEach(function (file) { add('copilot', path.join(ctx.cwd, '.github/copilot', file)); });
  var copilotManaged = process.platform === 'darwin' ? '/Library/Application Support/GitHubCopilot/managed-settings.json' : process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHubCopilot/managed-settings.json') : '/etc/github-copilot/managed-settings.json';
  add('copilot', copilotManaged, true);
  if (process.platform === 'darwin') {
    add('copilot', '/Library/Managed Preferences/com.github.copilot.plist', true);
    if (ctx.username) add('copilot', path.join('/Library/Managed Preferences', ctx.username, 'com.github.copilot.plist'), true);
  }
  add('kimi', path.join(ctx.roots.kimi, 'config.toml'));
  var qwenSystem = process.platform === 'darwin' ? '/Library/Application Support/QwenCode' : process.platform === 'win32' ? 'C:\\ProgramData\\qwen-code' : '/etc/qwen-code';
  add('qwen', ctx.policyPaths.qwenSettings || path.join(qwenSystem, 'settings.json'), true);
  add('qwen', ctx.policyPaths.qwenDefaults || path.join(qwenSystem, 'system-defaults.json'), true);
  add('grok', '/etc/grok/requirements.toml', true);
  add('grok', '/etc/grok/managed_config.toml', true);
  add('grok', path.join(ctx.roots.grok, 'requirements.toml'), true);
  add('grok', path.join(ctx.roots.grok, 'managed_config.toml'), true);
  files.forEach(function (entry) {
    try {
      var value = ctx.load(entry.file);
      if (entry.exclusive || path.basename(entry.file) === 'permissions-config.json' && Object.keys(value).length || Object.keys(value).some(function (key) { return SECURITY.test(key); })) blocked[entry.vendor] = 'Local vendor security or managed policy is present. Clay cannot resolve its effective restrictions. Review that policy and configure an explicitly authorized Clay connection; vendor import is blocked.';
    } catch (error) {
      if (error.code !== 'ENOENT' && !/ENOENT|no such file/i.test(error.message)) blocked[entry.vendor] = 'Could not resolve a local vendor policy source. Check permissions and format before importing.';
    }
  });
  return blocked;
}
module.exports = { inspect: inspect, securityKey: function (key) { return SECURITY.test(key); } };
