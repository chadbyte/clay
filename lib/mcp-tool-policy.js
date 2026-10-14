// Restrictive policies are intersected; an empty allowlist means no tools.
var ALLOW = ['enabled_tools', 'enabledTools', 'includeTools'];
var DENY = ['disabled_tools', 'disabledTools', 'excludeTools'];
function list(value, key) {
  if (!Array.isArray(value) || value.some(function (item) { return typeof item !== 'string' || !item || item.indexOf('\0') >= 0; })) throw new Error('Invalid tool policy: ' + key + '. Review the vendor configuration before importing.');
  return Array.from(new Set(value));
}
function normalize(vendor, value) {
  var allow = null, deny = [], keys = ALLOW.slice();
  if (vendor === 'copilot') keys.push('tools');
  keys.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return;
    var next = list(value[key], key);
    if (vendor === 'copilot' && key === 'tools' && next.indexOf('*') >= 0) next = null;
    if (next !== null) allow = allow === null ? next : allow.filter(function (name) { return next.indexOf(name) >= 0; });
  });
  DENY.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(value, key)) deny = deny.concat(list(value[key], key)); });
  var unsupported = Object.keys(value).filter(function (key) {
    if (ALLOW.concat(DENY, vendor === 'copilot' ? ['tools'] : [], ['autoApprove', 'trust', 'oauth', 'oauthScopes']).indexOf(key) >= 0) return false;
    return /tool|permission|policy|security|authProvider|allowed|denied|restrict|approval/i.test(key) && ['tool_timeout_sec'].indexOf(key) < 0;
  });
  if (unsupported.length) throw new Error('Unsupported restriction or security configuration: ' + unsupported.join(', ') + '. Configure and review a direct Clay connection instead.');
  if (value.autoApprove !== undefined && (!Array.isArray(value.autoApprove) || value.autoApprove.some(function (item) { return typeof item !== 'string'; }))) throw new Error('Invalid autoApprove policy.');
  if (value.trust !== undefined && typeof value.trust !== 'boolean') throw new Error('Invalid trust policy.');
  return { enabledTools: allow, disabledTools: Array.from(new Set(deny)) };
}
function matches(pattern, name) {
  return new RegExp('^' + pattern.split('').map(function (letter) { return letter === '*' ? '.*' : letter === '?' ? '.' : letter.replace(/[\\^$+.[\]{}()|]/g, '\\$&'); }).join('') + '$').test(name);
}
function permits(row, name) {
  if ((row.disabledTools || []).indexOf(name) >= 0 || row.enabledTools && row.enabledTools.indexOf(name) < 0) return false;
  return !(row.toolPatterns || []).some(function (pattern) { return matches(pattern, row.toolPrefix ? row.toolPrefix + name : name); });
}
module.exports = { normalize: normalize, permits: permits, matches: matches };
