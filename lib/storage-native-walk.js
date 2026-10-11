var spawn = require('node:child_process').spawn;
var execFile = require('node:child_process').execFile;
var availability = null;
var command = process.platform === 'linux' ? 'find' : 'gfind';

function available() {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return Promise.resolve(false);
  if (!availability) availability = new Promise(function (resolve) {
    execFile(command, ['--version'], { timeout: 3000, maxBuffer: 4096 }, function (error, output) {
      resolve(!error && output.indexOf('GNU findutils') !== -1);
    });
  });
  return availability;
}

function literalPattern(value) {
  return value.replace(/[\\*?\[\]]/g, '\\$&');
}

// NUL-delimited records keep tabs/newlines in filenames out of metadata parsing.
function parseRecord(record) {
  var fields = [];
  var start = 0;
  for (var i = 0; i < 6; i++) {
    var end = record.indexOf('\t', start);
    if (end < 0) throw new Error('Invalid native storage metadata');
    fields.push(record.slice(start, end));
    start = end + 1;
  }
  if (!fields.slice(0, 5).every(function (value) { return /^\d+$/.test(value); }) || !/^[a-z?]$/.test(fields[5])) {
    throw new Error('Invalid native storage metadata');
  }
  return { path: record.slice(start), stat: {
    dev: Number(fields[0]), ino: Number(fields[1]), uid: Number(fields[2]), blocks: Number(fields[3]), nlink: Number(fields[4]),
    isDirectory: function () { return fields[5] === 'd'; },
    isFile: function () { return fields[5] === 'f'; },
    isSymbolicLink: function () { return fields[5] === 'l'; }
  } };
}

function walk(root, excluded, onEntry, maxMs) {
  return new Promise(function (resolve) {
    var args = ['-P', root, '-xdev'];
    if (excluded.length) {
      args.push('(');
      excluded.forEach(function (entry, index) {
        if (index) args.push('-o');
        args.push('-path', literalPattern(entry));
      });
      args.push(')', '-prune', '-o');
    }
    args.push('-printf', '%D\t%i\t%U\t%b\t%n\t%y\t%p\\0');
    var child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { LC_ALL: 'C' }) });
    var buffer = '';
    var stopped = false;
    var errors = 0;
    var timer = null;
    function stop() { stopped = true; child.kill('SIGKILL'); }
    if (Number.isFinite(maxMs)) timer = setTimeout(stop, Math.max(1, maxMs));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', function (chunk) {
      if (stopped) return;
      buffer += chunk;
      var end;
      while (!stopped && (end = buffer.indexOf('\0')) !== -1) {
        var record = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          var entry = parseRecord(record);
          if (onEntry(entry.path, entry.stat) === false) stop();
        } catch (error) { errors++; stop(); }
      }
      if (buffer.length > 1024 * 1024) { errors++; stop(); }
    });
    child.stderr.on('data', function () { errors = Math.max(1, errors); });
    child.on('error', function () { errors++; });
    child.on('close', function (code) {
      clearTimeout(timer);
      if (!stopped && (code !== 0 || buffer.length)) errors++;
      resolve({ errors: errors, stopped: stopped });
    });
  });
}

module.exports = { available: available, walk: walk, parseRecord: parseRecord };
