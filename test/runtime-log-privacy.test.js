var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var createRequire = require('node:module').createRequire;
var EventEmitter = require('node:events');
var PassThrough = require('node:stream').PassThrough;

['codex-app-server', 'acp-process-manager'].forEach(function (name) {
  test(name + ' does not log credentials while preserving spawn arguments', async function () {
    var filename = path.resolve(__dirname, '../lib/yoke/' + name + '.js');
    var nativeRequire = createRequire(filename);
    var logs = [];
    var spawned;
    var child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    var logger = function () { logs.push(Array.from(arguments).join(' ')); };
    var mod = {exports:{}};
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module:mod, exports:mod.exports, __dirname:path.dirname(filename), process:process,
      console:{log:logger,warn:logger,error:logger}, setTimeout:setTimeout, clearTimeout:clearTimeout,
      require:function (id) {
        if (id === 'child_process') return {spawn:function (command, args, opts) { spawned = {args:args,opts:opts}; return child; }};
        return nativeRequire(id);
      }
    }, {filename:filename});
    var secret = 'sentinel-private-bridge-token';
    var options = name === 'codex-app-server'
      ? {config:{mcp_servers:{'clay-tools':{env:{CLAY_BRIDGE_TOKEN:secret}}}}}
      : {args:['--token',secret]};
    var Manager = mod.exports.CodexAppServer || mod.exports.AcpProcessManager;
    var server = new Manager('/fake/runtime', options);
    await server.start();
    assert.ok(spawned.args.join(' ').includes(secret), 'runtime still receives credential');
    child.stdout.write('invalid-json-private-prompt\n');
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.match(logs.join('\n'), /Spawning/);
    assert.match(logs.join('\n'), /content omitted/);
    assert.doesNotMatch(logs.join('\n'), /sentinel-private|invalid-json-private/);
    server.rl.close(); child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
  });
});

test('unknown Codex events preserve runtime delivery without logging private payloads', function () {
  var kit = require('../lib/yoke/adapters/codex').contractTestKit;
  var logs = [];
  var original = console.log;
  console.log = function () { logs.push(Array.from(arguments).join(' ')); };
  var params = {threadId:'test-thread', content:'private-user-message', delta:'private-command-output'};
  var result;
  try { result = kit.normalizeEvent({method:'future/event',params:params}, kit.createEventState('test-model')); }
  finally { console.log = original; }
  assert.match(logs.join('\n'), /future\/event/);
  assert.doesNotMatch(logs.join('\n'), /private-user|private-command/);
  assert.equal(result[0].raw, params);
});
