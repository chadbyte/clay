// Bounded, content-free process identities for closure reconciliation after host exit.
var cp = require('child_process');
function table() {
  var output = cp.execFileSync('ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, env: Object.assign({}, process.env, { LC_ALL: 'C', TZ: 'UTC' }) });
  var rows = new Map();
  output.split('\n').forEach(function (line) {
    var match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) rows.set(Number(match[1]), { pid: Number(match[1]), parent: Number(match[2]), start: match[3] });
  });
  if (!rows.has(process.pid)) throw new Error("The process identity census was incomplete.");
  return rows;
}
function capture() {
  try {
    var rows = table(), host = rows.get(process.pid), children = [], parents = new Set([process.pid]);
    if (!host) return null;
    for (var pass = 0; pass < rows.size; pass++) {
      var changed = false;
      rows.forEach(function (row) { if (parents.has(row.parent) && !parents.has(row.pid)) { parents.add(row.pid); children.push(row); changed = true; } });
      if (!changed) break;
    }
    return { host: host, children: children };
  } catch (error) { return null; }
}
function confirmsExit(witness) {
  if (!witness || !witness.host || !Array.isArray(witness.children)) return false;
  var rows = table();
  return [witness.host].concat(witness.children).every(function (previous) {
    var current = rows.get(previous.pid); return !current || current.start !== previous.start;
  });
}
module.exports = { capture: capture, confirmsExit: confirmsExit };
