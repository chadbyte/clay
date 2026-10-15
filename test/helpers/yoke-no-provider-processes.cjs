// Preload for contract tests that must never launch a provider or Git mutation.
var cp = require('node:child_process');
var path = require('node:path');
['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'].forEach(function (name) {
  var original = cp[name];
  cp[name] = function (command, args) {
    var binary = path.basename(String(command));
    if (/^(claude|codex|kiro-cli|copilot|opencode|kimi|grok|qwen|qwen-code|junie|agy|npx|bunx|uvx)(?:\.exe)?$/.test(binary)
        || /(?:^|[\s/])(claude|codex|kiro-cli)(?:\s|$)/.test(String(command))) {
      throw new Error('Live provider processes are forbidden in isolated YOKE tests.');
    }
    if (/(?:claude-worker|sdk-worker|kiro-acp-server)\.js$/.test(String(command))) throw new Error('Live SDK provider entrypoints are forbidden in isolated YOKE tests.');
    if (Array.isArray(args) && args.some(function (arg) {
      return /(?:claude-worker|sdk-worker|kiro-acp-server)\.js$/.test(String(arg)) || /curl.*install\.sh/.test(String(arg)) || /@anthropic-ai[\/]claude-agent-sdk[\/]cli\.(js|mjs)$/.test(String(arg));
    })) throw new Error('Live SDK provider entrypoints are forbidden in isolated YOKE tests.');
    if (binary === 'git' && Array.isArray(args) && args.some(function (arg) {
      return ['commit', 'commit-tree', 'push', 'pull', 'fetch'].indexOf(arg) >= 0;
    })) throw new Error('Commits and remote Git mutations are forbidden in isolated YOKE tests.');
    return original.apply(cp, arguments);
  };
});
