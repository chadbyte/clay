var normalize = require("./yoke/mcp-tool-policy-normalize").normalize;
function matches(pattern, name) {
  return new RegExp('^' + pattern.split('').map(function (letter) { return letter === '*' ? '.*' : letter === '?' ? '.' : letter.replace(/[\\^$+.[\]{}()|]/g, '\\$&'); }).join('') + '$').test(name);
}
function permits(row, name) {
  if ((row.disabledTools || []).indexOf(name) >= 0 || row.enabledTools && row.enabledTools.indexOf(name) < 0) return false;
  return !(row.toolPatterns || []).some(function (pattern) { return matches(pattern, row.toolPrefix ? row.toolPrefix + name : name); });
}
module.exports = { normalize: normalize, permits: permits, matches: matches };
