// File-only adapters. Discovery never loads vendor code, plugins, or OAuth stores.
var path = require('path');
var toml = require('@iarna/toml');
var jsonc = require('jsonc-parser');
var yaml = require('yaml');
var network = require('./mcp-network');
var crypto = require('crypto');
var ADAPTERS = {
  claude: { user: ['.claude.json'], project: ['.mcp.json'], key: 'mcpServers' },
  codex: { user: ['.codex/config.toml'], project: ['.codex/config.toml'], key: 'mcp_servers' },
  kiro: { user: ['.kiro/settings/mcp.json', '.kiro/mcp.json'], project: ['.kiro/settings/mcp.json', '.kiro/mcp.json'], key: 'mcpServers', agents: '.kiro/agents' },
  opencode: { user: ['.config/opencode/opencode.json', '.config/opencode/opencode.jsonc'], project: ['opencode.json', 'opencode.jsonc'], key: 'mcp' },
  kimi: { user: ['.kimi-code/mcp.json', '.kimi/mcp.json'], project: ['.kimi-code/mcp.json'], key: 'mcpServers' },
  copilot: { user: ['.copilot/mcp-config.json'], project: ['.mcp.json', '.github/mcp.json'], key: 'mcpServers' },
  qwen: { user: ['.qwen/settings.json'], project: ['.qwen/settings.json'], key: 'mcpServers' },
  junie: { user: ['.junie/mcp/mcp.json'], project: ['.junie/mcp/mcp.json'], key: 'mcpServers' },
  grok: { user: ['.grok/config.toml'], project: ['.grok/config.toml'], key: 'mcp_servers' },
  antigravity: { user: ['.gemini/config/mcp_config.json', '.gemini/antigravity-cli/mcp_config.json'], project: ['.agents/mcp_config.json'], key: 'mcpServers', plugins: '.gemini/antigravity-cli/plugins' },
  acp: { user: [], project: [], key: 'mcpServers' },
};
function parse(file, content) {
  if (file.endsWith('.md')) {
    var match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match) throw new Error('Agent profile requires YAML frontmatter.');
    var document = yaml.parseDocument(match[1]);
    if (document.errors.length) throw new Error('Invalid agent frontmatter.');
    return document.toJS({ maxAliasCount: 50 });
  }
  if (file.endsWith('.toml')) return toml.parse(content);
  var errors = [], value = jsonc.parse(content, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP source format.');
  return value;
}
function stringMap(value) {
  if (!value) return {};
  if (Array.isArray(value)) {
    var map = {}; value.forEach(function (entry) { if (!entry || typeof entry.name !== 'string' || typeof entry.value !== 'string') throw new Error('Invalid name/value field.'); map[entry.name] = entry.value; });
    return map;
  }
  if (typeof value !== 'object') throw new Error('Invalid environment or headers.');
  Object.keys(value).forEach(function (name) { if (typeof value[name] !== 'string') throw new Error('Invalid environment or headers.'); });
  return Object.assign({}, value);
}
function normalize(vendor, name, value, source) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid server definition.');
  ['enabled', 'disabled'].forEach(function (key) { if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('Invalid source enablement: ' + key); });
  if (value.oauth !== undefined && value.oauth !== true) throw new Error('Vendor OAuth policy requires reviewed Clay-owned authentication setup.');
  var command = value.command, args = value.args || [];
  if (vendor === 'opencode' && Array.isArray(command)) { args = command.slice(1); command = command[0]; }
  var url = value.url || value.httpUrl || value.serverUrl;
  if (command && url) throw new Error('Conflicting stdio and remote transport definitions.');
  var type = value.type || value.transport || (url ? vendor === 'qwen' && !value.httpUrl ? 'sse' : 'http' : 'stdio');
  if (type === 'local') type = 'stdio'; if (type === 'remote' || type === 'streamable-http') type = 'http';
  if (['stdio', 'http', 'sse'].indexOf(type) < 0) throw new Error('Unsupported transport. Clay supports stdio, HTTP and SSE.');
  if (value.headersHelper || value.oauth && (value.oauth.clientSecret || value.oauth.clientId)) throw new Error('Vendor authentication helper requires Clay-owned credential setup.');
  var policy = require('./mcp-tool-policy').normalize(vendor, value);
  var config = { transport: type, enabled: false, label: name, source: type === 'stdio' ? 'local' : 'url',
    provenance: source, sourceEnabled: value.enabled === false || value.disabled === true ? false : source.scope.indexOf('plugin') === 0 ? null : true };
  if (type === 'stdio') {
    if (typeof command !== 'string' || !command || command.includes('\0') || !Array.isArray(args) || args.some(function (arg) { return typeof arg !== 'string' || arg.includes('\0'); })) throw new Error('Invalid stdio command or arguments.');
    config.command = command; config.args = args; config.env = stringMap(value.env || value.environment); config.cwd = value.cwd || source.cwd;
    if (typeof config.cwd !== 'string' || !path.isAbsolute(config.cwd)) throw new Error('Stdio working directory must be absolute.');
  } else {
    // Do not expand credential references during inspection.
    config.url = network.remoteUrl(url).href; config.headers = stringMap(value.headers || value.http_headers);
    config.envHeaders = stringMap(value.env_http_headers);
    var bearer = value.bearer_token_env_var || value.bearerTokenEnvVar;
    if (bearer) { config.bearerTokenEnv = bearer; config.envHeaders.Authorization = bearer; }
  }
  config.environmentNames = (value.env_vars || []).concat(Object.keys(config.env || {}));
  if (value.env_vars !== undefined && !Array.isArray(value.env_vars)) throw new Error('Invalid environment allowlist.');
  Object.assign(config, policy);
  if (source.sourceEnabled !== undefined) config.sourceEnabled = config.sourceEnabled === false || source.sourceEnabled === false ? false : source.sourceEnabled;
  var references = JSON.stringify([config.command, config.args, config.env, config.headers, config.url]).match(/\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}|\$[A-Z_][A-Z0-9_]*|\{env:[^}]+\}|\{file:[^}]+\}|\{\{[^}]+\}\}/g) || [];
  config.references = Array.from(new Set(references.concat(Object.values(config.envHeaders || {})).concat(value.env_vars || [])));
  // Plugins may reference their own installed directory without reading any credential file.
  if (source.pluginRoot) {
    function pluginValue(value) {
      if (typeof value === 'string') return value.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, function () { return source.pluginRoot; }).replace(/\$\{CLAUDE_PROJECT_DIR\}/g, function () { return source.cwd; });
      if (Array.isArray(value)) return value.map(pluginValue);
      if (value && typeof value === 'object') { var next = {}; Object.keys(value).forEach(function (key) { next[key] = pluginValue(value[key]); }); return next; }
      return value;
    }
    config = pluginValue(config); config.references = config.references.filter(function (ref) { return ref !== source.pluginRoot && ref !== source.cwd; });
  }
  return config;
}
function signature(config) {
  return crypto.createHash('sha256').update(JSON.stringify([config.transport, config.url, config.command, config.args, config.env, config.headers, config.envHeaders, config.cwd, config.disabledTools, config.enabledTools, config.toolPatterns, config.toolPrefix, config.references])).digest('hex');
}
module.exports = { adapters: ADAPTERS, parse: parse, normalize: normalize, signature: signature };
