function requiredNames(row) {
  var names = (row.environmentNames || []).filter(function (name) { return !Object.prototype.hasOwnProperty.call(row.env || {}, name); });
  (row.references || []).forEach(function (reference) {
    var match = /^(?:\$\{?|\{env:)([A-Za-z_][A-Za-z0-9_]*)/.exec(reference);
    var name = match ? match[1] : /^[A-Za-z_][A-Za-z0-9_]*$/.test(reference) ? reference : 'Unsupported reference';
    names.push(name);
  });
  return Array.from(new Set(names));
}
function applyCredentials(row, values) {
  var names = requiredNames(row);
  if (names.indexOf('Unsupported reference') >= 0) throw new Error('This source requires a vendor-specific helper or file reference. Configure a direct Clay connection instead.');
  names.forEach(function (name) {
    if (!Object.prototype.hasOwnProperty.call(values, name) || typeof values[name] !== 'string' || !values[name] || values[name].length > 8192 || /[\r\n\0]/.test(values[name])) throw new Error('Enter each required credential value.');
  });
  function expand(value) {
    if (typeof value === 'string') return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)|\{env:([^}]+)\}/g, function (all, first, second, third) {
      var name = first || second || third; return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : all;
    });
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === 'object') { var next = {}; Object.keys(value).forEach(function (key) { next[key] = expand(value[key]); }); return next; }
    return value;
  }
  var next = {};
  ['command', 'args', 'env', 'headers', 'url'].forEach(function (field) { if (row[field] !== undefined) next[field] = expand(row[field]); });
  next.headers = next.headers || {}; next.env = next.env || {};
  Object.keys(row.envHeaders || {}).forEach(function (name) { next.headers[name] = (name === 'Authorization' && row.bearerTokenEnv === row.envHeaders[name] ? 'Bearer ' : '') + values[row.envHeaders[name]]; });
  (row.environmentNames || []).forEach(function (name) { if (values[name] !== undefined) next.env[name] = values[name]; });
  next.envHeaders = {}; next.references = []; return next;
}
module.exports = { requiredNames: requiredNames, applyCredentials: applyCredentials };
