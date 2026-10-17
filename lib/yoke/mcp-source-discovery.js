var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var adapters = require('./mcp-source-adapters');
var sourceContext = require('./mcp-source-context');
var restrictions = require('./mcp-source-restrictions');
var fsAsUser = require('../os-users').fsAsUser;
function createDiscovery(ctx) {
  var scans = new Map(), publicScans = new Map();
  function read(file, identity) {
    if (identity) {
      var stat = fsAsUser('stat', { file: file }, identity);
      if (stat.size > 2 * 1024 * 1024 || stat.isDir) throw new Error('Source exceeds size limit.');
      return fsAsUser('read', { file: file, readContent: true }, identity).content;
    }
    var info = fs.statSync(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Source exceeds size limit.');
    return fs.readFileSync(file, 'utf8');
  }
  function list(directory, identity) {
    try { return identity ? fsAsUser('list', { dir: directory }, identity) : fs.readdirSync(directory, { withFileTypes: true }).map(function (entry) { return { name: entry.name, isDir: entry.isDirectory() }; }); }
    catch (error) { return []; }
  }
  function scan(owner, ws, explicit) {
    ctx.authorize(owner, ws);
    var identity = ctx.identity(ws), home = identity ? identity.home : ctx.home || os.homedir();
    var context = sourceContext.resolve(ctx, owner, ws, home, identity);
    var rows = [], diagnostics = [], sources = context.sources, files = new Map(), directories = new Map();
    function listing(directory) { var entries = list(directory, identity); directories.set(directory, JSON.stringify(entries.slice().sort(function (left, right) { return left.name.localeCompare(right.name); }))); return entries; }
    function source(vendor, file, scope, pluginRoot, extra) { sources.push(Object.assign({ vendor: vendor, file: file, scope: scope, cwd: ctx.cwd, pluginRoot: pluginRoot }, extra)); }
    Object.keys(adapters.adapters).forEach(function (vendor) {
      var adapter = adapters.adapters[vendor];
      if (adapter.agents) [home, ctx.cwd].forEach(function (base) {
        var directory = path.join(base, adapter.agents);
        listing(directory).slice(0, 100).forEach(function (entry) { if (!entry.isDir && /\.(json|md)$/.test(entry.name)) source(vendor, path.join(directory, entry.name), 'agent'); });
      });
      if (adapter.plugins) {
        var directory = path.join(home, adapter.plugins);
        listing(directory).slice(0, 100).forEach(function (entry) { if (entry.isDir) source(vendor, path.join(directory, entry.name, 'mcp_config.json'), 'plugin', path.join(directory, entry.name), { blocked: 'This plugin has no locally resolved activation registry. Review its active configuration before importing.' }); });
      }
    });
    // Copilot reads nearer project definitions before ancestors up to the Git root.
    var parents = [], repository = false;
    var currentDirectory = ctx.cwd;
    while (true) {
      try { if (identity) fsAsUser('stat', { file: path.join(currentDirectory, '.git') }, identity); else fs.statSync(path.join(currentDirectory, '.git')); repository = true; break; } catch (error) {}
      var parent = path.dirname(currentDirectory);
      if (parent === currentDirectory) break;
      parents.push(parent); currentDirectory = parent;
    }
    if (repository) parents.forEach(function (directory) {
      source('copilot', path.join(directory, '.mcp.json'), 'project-ancestor');
      source('copilot', path.join(directory, '.github/mcp.json'), 'project-ancestor');
    });
    diagnostics.push({ vendor: 'all', scope: 'plugins', message: 'Remote bundles are not downloaded. Unresolved installed plugin activation and local managed policies block import; credentials and vendor OAuth stores are never inspected.' });
    if (explicit) {
      if (!adapters.adapters[explicit.vendor] || typeof explicit.file !== 'string' || !path.isAbsolute(explicit.file)) throw new Error('Choose a supported format and an absolute source file path.');
      source(explicit.vendor, explicit.file, 'configured');
    }
    function load(file) {
      if (files.has(file)) { var cached = files.get(file); if (cached.error) throw cached.error; return cached.value; }
      try {
        var content = read(file, identity), value = adapters.parse(file, content);
        files.set(file, { value: value, digest: crypto.createHash('sha256').update(content).digest('hex') }); return value;
      } catch (error) { files.set(file, { error: error, digest: null }); throw error; }
    }
    require('./mcp-source-plugins').discover({ load: load, source: source, list: listing, roots: context.roots, cwd: ctx.cwd, diagnostics: diagnostics });
    var blockedVendors = restrictions.inspect({ load: load, roots: context.roots, policyPaths: context.policyPaths, cwd: ctx.cwd, home: home, username: identity ? identity.username : process.env.USER });
    var openCodeTools = {}, openCodeDefinitions = {};
    function collect(source, definitions, root) {
      if (!definitions || typeof definitions !== 'object') return;
      var names = Array.isArray(definitions) ? definitions.map(function (definition) { return definition.name; }) : Object.keys(definitions);
      names.slice(0, 100).forEach(function (name, index) {
        if (typeof name !== 'string' || !name || name.length > 100) return;
        try {
          var definition = Array.isArray(definitions) ? definitions[index] : definitions[name];
          if (source.vendor === 'opencode') {
            definition = Object.assign({}, openCodeDefinitions[name] || {}, definition);
            openCodeDefinitions[name] = definition;
          }
          if (source.overrides && source.overrides[name]) definition = Object.assign({}, definition, source.overrides[name]);
          var provenance = Object.assign({}, source); delete provenance.inline; delete provenance.overrides;
          var config = adapters.normalize(source.vendor, name, definition, provenance);
          var blocked = source.blocked || blockedVendors[source.vendor];
          if (root && Object.keys(root).some(function (key) { return restrictions.securityKey(key); })) blocked = 'This source contains runtime or agent restrictions Clay cannot resolve. Review its effective policy before importing.';
          if (root && root.tools !== undefined && source.vendor !== 'opencode') blocked = 'This source contains runtime tool restrictions Clay cannot resolve. Review its effective policy before importing.';
          var known = ['type', 'transport', 'command', 'args', 'env', 'environment', 'cwd', 'url', 'httpUrl', 'serverUrl', 'headers', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'bearerTokenEnvVar', 'includeTools', 'excludeTools', 'env_vars', 'enabled', 'disabled', 'autoApprove', 'disabledTools', 'disabled_tools', 'enabledTools', 'enabled_tools', 'timeout', 'startup_timeout_sec', 'tool_timeout_sec', 'oauth', 'oauthScopes', 'trust', 'name', 'description', 'tools', 'startupTimeoutMs'];
          var unknown = Object.keys(definition).filter(function (key) { return known.indexOf(key) < 0; });
          if (unknown.length) blocked = 'Unrecognized server fields require deliberate review in a direct Clay connection: ' + unknown.slice(0, 10).join(', ');
          if (unknown.length) diagnostics.push({ vendor: source.vendor, scope: source.scope, name: name, message: 'Unrecognized fields are not imported: ' + unknown.slice(0, 10).join(', ') });
          var hash = adapters.signature(config);
          rows.push({ id: crypto.randomUUID(), name: name, config: config, signature: hash, blocked: blocked });
        } catch (error) { diagnostics.push({ vendor: source.vendor, scope: source.scope, name: name, message: error.message }); }
      });
    }
    if (sources.length > 500) diagnostics.push({ vendor: 'all', scope: 'discovery', message: 'Source limit reached; inspect additional files individually.' });
    sources.sort(function (left, right) { return sourceContext.priority(left) - sourceContext.priority(right); });
    sources.slice(0, 500).forEach(function (source) {
      try {
        var value = source.inline ? adapters.parse('inline.json', source.inline) : load(source.file), adapter = adapters.adapters[source.vendor];
        if (Object.keys(value).some(function (key) { return restrictions.securityKey(key); })) blockedVendors[source.vendor] = 'A configuration layer contains unresolved security restrictions. Review the effective vendor policy before importing.';
        if (source.vendor === 'opencode' && value.agent && Object.keys(value.agent).some(function (name) { return Object.keys(value.agent[name] || {}).some(function (key) { return restrictions.securityKey(key) || key === 'tools'; }); })) blockedVendors.opencode = 'OpenCode agent-specific restrictions require review. Configure a direct Clay connection with the intended restrictions.';
        collect(source, source.scope === 'plugin-inline' ? value.mcpServers : value[adapter.key] || (source.vendor === 'codex' && !source.file.endsWith('.toml') ? value.mcpServers || value : source.vendor === 'copilot' || source.scope === 'plugin' ? value : null), value);
        if (source.vendor === 'opencode' && value.tools !== undefined) {
          if (!value.tools || typeof value.tools !== 'object' || Array.isArray(value.tools) || Object.values(value.tools).some(function (enabled) { return typeof enabled !== 'boolean'; })) blockedVendors.opencode = 'Invalid OpenCode tool policy. Review the runtime configuration before importing.';
          else Object.assign(openCodeTools, value.tools);
        }
        if (source.vendor === 'claude' && source.scope === 'user' && value.projects && value.projects[ctx.cwd]) collect(Object.assign({}, source, { scope: 'local' }), value.projects[ctx.cwd].mcpServers, value.projects[ctx.cwd]);
      } catch (error) {
        if (error.code !== 'ENOENT' && !(identity && /ENOENT|no such file/i.test(error.message))) diagnostics.push({ vendor: source.vendor, scope: source.scope, message: 'Could not read or parse source; check permissions and format.' });
      }
    });
    rows.forEach(function (row) {
      var source = row.config.provenance;
      row.blocked = row.blocked || blockedVendors[source.vendor];
      if (source.vendor === 'opencode') {
        row.config.toolPrefix = row.name + '_';
        row.config.toolPatterns = Object.keys(openCodeTools).filter(function (pattern) { return openCodeTools[pattern] === false; });
        row.signature = adapters.signature(row.config);
      }
      var effective = rows.filter(function (other) { return other.name === row.name && other.config.provenance.vendor === source.vendor && other.config.provenance.scope !== 'agent' && other.config.provenance.scope.indexOf('plugin') !== 0; }).pop();
      if (source.scope !== 'agent' && source.scope.indexOf('plugin') !== 0 && effective && effective !== row) row.blocked = 'Shadowed by the effective ' + effective.config.provenance.scope + ' source. Import that definition instead.';
    });
    var current = ctx.snapshot(owner);
    rows.forEach(function (row) {
      var same = rows.filter(function (other) { return other !== row && (other.name === row.name || row.config.url && other.config.url === row.config.url); });
      row.duplicate = rows.some(function (other) { return other !== row && other.signature === row.signature; });
      row.conflict = same.some(function (other) { return other.signature !== row.signature; });
      row.imported = current.records.some(function (saved) { return saved.importSignature === row.signature || row.config.url && saved.url === row.config.url; });
    });
    var scanId = crypto.randomUUID();
    scans.set(owner, { id: scanId, ws: ws, rows: rows, files: files, directories: directories, identity: identity, revision: current.revision, context: context.fingerprint, home: home, created: Date.now() });
    var publicScan = { scanId: scanId, candidates: rows.map(function (row) {
      return { id: row.id, name: row.name, vendor: row.config.provenance.vendor, scope: row.config.provenance.scope, file: row.config.provenance.file,
        blocked: row.blocked || null, pluginName: row.config.provenance.pluginName, pluginVersion: row.config.provenance.pluginVersion, transport: row.config.transport, dependency: row.config.command ? (/^[a-zA-Z0-9_./\\-]+$/.test(row.config.command) ? path.basename(row.config.command) : 'Configured executable') : new URL(row.config.url).hostname,
        references: require('../mcp-import-credentials').requiredNames(row.config), environmentNames: row.config.environmentNames, sourceEnabled: row.config.sourceEnabled,
        duplicate: row.duplicate, conflict: row.conflict, imported: row.imported };
    }), diagnostics: diagnostics };
    publicScans.set(owner, publicScan); return publicScan;
  }
  function selected(owner, ws, msg) {
    ctx.authorize(owner, ws);
    var scan = scans.get(owner);
    if (!scan || scan.ws !== ws || scan.id !== msg.scanId || Date.now() - scan.created > 10 * 60 * 1000) throw new Error('Discovery expired. Scan again.');
    if (JSON.stringify(ctx.identity(ws)) !== JSON.stringify(scan.identity)) throw new Error('OS identity changed. Scan again.');
    if (sourceContext.resolve(ctx, owner, ws, scan.home, scan.identity).fingerprint !== scan.context) throw new Error('Runtime configuration changed. Scan again.');
    scan.directories.forEach(function (state, directory) {
      var entries = list(directory, scan.identity).slice().sort(function (left, right) { return left.name.localeCompare(right.name); });
      if (JSON.stringify(entries) !== state) throw new Error('Installed source selection changed. Scan again.');
    });
    scan.files.forEach(function (state, file) {
      var hash = null;
      try { hash = crypto.createHash('sha256').update(read(file, scan.identity)).digest('hex'); } catch (error) {
        if (!state.error || (error.code || error.message) !== (state.error.code || state.error.message)) throw new Error('Vendor configuration changed. Scan again.');
      }
      if (hash !== state.digest) throw new Error('Vendor configuration changed. Scan again.');
    });
    var row = scan.rows.find(function (candidate) { return candidate.id === msg.candidateId; });
    if (row && row.blocked) throw new Error(row.blocked);
    if (!row || row.imported) throw new Error('Source is unavailable or already imported.');
    return { config: JSON.parse(JSON.stringify(row.config)), signature: row.signature, revision: scan.revision };
  }
  return { scan: scan, selected: selected, candidate: function (owner, subject, args) {
    selected(owner, subject, args);
    return publicScans.get(owner).candidates.find(function (row) { return row.id === args.candidateId; });
  }, destroy: function () { scans.clear(); publicScans.clear(); } };
}
module.exports = { createDiscovery: createDiscovery };
