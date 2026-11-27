var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var createRequire = require('node:module').createRequire;
var events = require('node:events');
var stream = require('node:stream');

test('the browser sends the latest viewing state after a large startup write drains', async function (t) {
  var filename = path.resolve(__dirname, '../lib/shared-browser-runtime.js');
  var nativeRequire = createRequire(filename);
  var child = new events.EventEmitter();
  var writes = [], finishWrite;
  child.stdout = new stream.PassThrough();
  child.stdin = new stream.Writable({
    write: function (chunk, encoding, done) {
      var msg = JSON.parse(chunk.toString());
      writes.push(msg.type === 'viewing' ? msg.value : msg.type);
      if (msg.type === 'start') finishWrite = done;
      else done();
    },
  });
  t.after(function () { child.stdin.destroy(); child.stdout.destroy(); });
  var mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: mod, __dirname: path.dirname(filename), process: process,
    require: function (id) { return id === 'child_process' ? { spawn: function () { return child; } } : nativeRequire(id); },
  }, { filename: filename });
  var runtime = mod.exports.createRuntime({
    storage: { read: function () { return { data: 'x'.repeat(300 * 1024) }; } },
    onEvent: function () {},
  });
  assert.ok(child.stdin.writableLength > 256 * 1024);
  runtime.viewing(false);
  runtime.viewing(true);
  assert.deepEqual(writes, ['start']);
  var drained = events.once(child.stdin, 'drain');
  finishWrite();
  await drained;
  assert.deepEqual(writes, ['start', true]);
  runtime.viewing(false);
  assert.deepEqual(writes, ['start', true, false]);
});
