var path = require('path');
function discover(ctx) {
  var load = ctx.load, source = ctx.source, list = ctx.list, roots = ctx.roots;
  function optional(file) { try { return load(file); } catch (error) { return {}; } }
  var enabled = {};
  var settingsFiles = [path.join(roots.claude, 'settings.json'), path.join(ctx.cwd, '.claude/settings.json'), path.join(ctx.cwd, '.claude/settings.local.json')];
  settingsFiles.forEach(function (file) { Object.assign(enabled, optional(file).enabledPlugins || {}); });
  var installed = optional(path.join(roots.claude, 'plugins/installed_plugins.json'));
  Object.keys(installed.plugins || {}).slice(0, 100).forEach(function (name) {
    var entries = (installed.plugins[name] || []).filter(function (entry) { return entry.installPath && (!entry.projectPath || path.resolve(entry.projectPath) === path.resolve(ctx.cwd)); });
    var scoped = entries.filter(function (entry) { return entry.scope === 'local' || entry.scope === 'project'; });
    if (scoped.length) entries = scoped;
    var local = entries.filter(function (entry) { return entry.scope === 'local'; }); if (local.length) entries = local;
    // The registry is authoritative only when it selects one installation.
    entries.forEach(function (entry) {
      var extra = { pluginName: name, pluginVersion: entry.version || null, sourceEnabled: enabled[name] === true ? true : enabled[name] === false ? false : null,
        blocked: entries.length > 1 ? 'Claude registry selects multiple installations. Resolve the active plugin installation before importing.' : typeof enabled[name] !== 'boolean' ? 'Claude plugin enablement is unknown. Enable or disable it explicitly in vendor settings and scan again.' : null };
      var root = entry.installPath;
      source('claude', path.join(root, '.mcp.json'), 'plugin', root, extra);
      var manifest = optional(path.join(root, '.claude-plugin/plugin.json'));
      var definitions = Array.isArray(manifest.mcpServers) ? manifest.mcpServers : [manifest.mcpServers];
      definitions.forEach(function (definition) {
        if (typeof definition === 'string' && definition.endsWith('.json') && !definition.includes('://')) source('claude', path.resolve(root, definition), 'plugin', root, extra);
        else if (definition && typeof definition === 'object') source('claude', path.join(root, '.claude-plugin/plugin.json'), 'plugin-inline', root, extra);
        else if (definition) ctx.diagnostics.push({ vendor: 'claude', scope: 'plugin', message: 'Remote plugin bundles are not downloaded. Install and resolve the local plugin before scanning.' });
      });
    });
  });
  var codex = {};
  [path.join(roots.codex, 'config.toml'), path.join(ctx.cwd, '.codex/config.toml')].forEach(function (file) {
    var plugins = optional(file).plugins || {};
    Object.keys(plugins).forEach(function (name) {
      var previous = codex[name] || {}, next = plugins[name] || {};
      codex[name] = Object.assign({}, previous, next, { mcp_servers: Object.assign({}, previous.mcp_servers || {}, next.mcp_servers || {}) });
    });
  });
  var cache = path.join(roots.codex, 'plugins/cache');
  list(cache).slice(0, 50).forEach(function (market) {
    if (!market.isDir) return;
    list(path.join(cache, market.name)).slice(0, 50).forEach(function (plugin) {
      if (!plugin.isDir) return;
      var name = plugin.name + '@' + market.name, configured = codex[name] || {};
      var versions = list(path.join(cache, market.name, plugin.name)).filter(function (entry) { return entry.isDir; });
      // Codex core-plugin-common/installed.rs selects local first, otherwise the greatest installed version.
      versions = versions.filter(function (entry) { return /^[A-Za-z0-9._+-]+$/.test(entry.name); }).sort(function (left, right) {
        var semver = require('semver');
        return semver.valid(left.name) && semver.valid(right.name) ? semver.compareBuild(left.name, right.name) : left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
      });
      var active = versions.find(function (entry) { return entry.name === 'local'; }) || versions[versions.length - 1];
      versions = active ? [active] : [];
      versions.slice(0, 50).forEach(function (version) {
        var root = path.join(cache, market.name, plugin.name, version.name);
        var extra = { pluginName: name, pluginVersion: version.name, overrides: configured.mcp_servers,
          sourceEnabled: Object.prototype.hasOwnProperty.call(codex, name) ? configured.enabled !== false : false,
          blocked: configured.enabled !== undefined && typeof configured.enabled !== 'boolean' ? 'Invalid Codex plugin enabled state. Review its vendor configuration before importing.' : null };
        var portable = optional(path.join(root, 'plugin.json'));
        var manifest = portable.extensions && portable.extensions['com.openai'] || optional(path.join(root, '.codex-plugin/plugin.json'));
        if (portable.name) source('codex', path.join(root, 'mcp.json'), 'plugin', root, extra);
        else {
          source('codex', path.join(root, '.mcp.json'), 'plugin', root, extra);
          source('codex', path.join(root, 'mcp.json'), 'plugin', root, extra);
        }
        if (typeof manifest.mcpServers === 'string' && !manifest.mcpServers.includes('://')) source('codex', path.resolve(root, manifest.mcpServers), 'plugin', root, extra);
      });
    });
  });
}
module.exports = { discover: discover };
