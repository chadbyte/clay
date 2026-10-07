var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var EventEmitter = require('node:events');
var dns = require('node:dns').promises;
var https = require('node:https');
var renderer = require('../lib/plantuml-renderer');
var images = require('../lib/salt-images');
var png = fs.readFileSync(path.join(__dirname, 'fixtures/salt-official/logo3.png'));
function source(url) { return '@startsalt\n{ <img:' + url + '> }\n@endsalt'; }

test('image output embeds PNG bytes and never exposes the remote URL', async function () {
  var calls = 0;
  var svg = await renderer.renderPlantUml(source('https://example.com/image.png'), { imageLoader: function () { calls++; return png; } });
  assert.equal(calls, 1);
  assert.match(svg, /<image[^>]*width="151"[^>]*height="151"[^>]*href="data:image\/png;base64,/);
  assert.doesNotMatch(svg, /example\.com/);
});
test('images cannot request loopback, private, reserved, credentials, other protocols or ports', async function () {
  var blocked = ['0.1.2.3', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '198.18.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1'];
  blocked.forEach(function (address) { assert.equal(images.publicAddress(address), false, address); });
  ['8.8.8.8', '1.1.1.1'].forEach(function (address) { assert.equal(images.publicAddress(address), true); });
  for (var url of ['https://127.0.0.1/x', 'https://169.254.169.254/x', 'https://user:pass@example.com/x', 'https://example.com:444/x', 'http://example.com/x', 'file:///etc/passwd', 'data:image/png;base64,abc']) {
    await assert.rejects(renderer.renderPlantUml(source(url)), function (error) { return error.status === 422; }, url);
  }
});
test('DNS is validated once and the HTTPS connection uses the pinned public address', async function (t) {
  var lookups = 0;
  t.mock.method(dns, 'lookup', async function () { lookups++; return [{ address: '1.1.1.1', family: 4 }]; });
  t.mock.method(https, 'get', function (url, options, callback) {
    assert.equal(url.hostname, 'example.com');
    assert.equal(options.agent, false);
    options.lookup(url.hostname, { all: true }, function (error, addresses) {
      assert.ifError(error); assert.deepEqual(addresses, [{ address: '1.1.1.1', family: 4 }]);
    });
    var request = new EventEmitter();
    process.nextTick(function () {
      var response = new EventEmitter(); response.statusCode = 200;
      callback(response); response.emit('data', png); response.emit('end');
    });
    return request;
  });
  assert.match(await renderer.renderPlantUml(source('https://example.com/x')), /data:image\/png/);
  assert.equal(lookups, 1);
});
test('mixed public/private DNS and HTTPS redirects are rejected', async function (t) {
  var networkCalls = 0;
  var lookup = t.mock.method(dns, 'lookup', async function () { return [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }]; });
  t.mock.method(https, 'get', function (_, options, callback) {
    networkCalls++; var request = new EventEmitter();
    process.nextTick(function () { callback({ statusCode: 302, headers: { location: 'https://127.0.0.1/' }, resume: function () {} }); });
    return request;
  });
  await assert.rejects(renderer.renderPlantUml(source('https://example.com/x')), /private or reserved/);
  assert.equal(networkCalls, 0);
  lookup.mock.mockImplementation(async function () { return [{ address: '1.1.1.1', family: 4 }]; });
  await assert.rejects(renderer.renderPlantUml(source('https://example.com/x')), /Redirects are not followed/);
  assert.equal(networkCalls, 1);
});
test('image format, dimensions, source count and embedded output are bounded', async function () {
  assert.throws(function () { images.decode(Buffer.from('<svg/>')); }, /PNG/);
  assert.throws(function () { images.decode(Buffer.alloc(1024 * 1024 + 1)); }, /1 MB/);
  var oversized = Buffer.from(png); oversized.writeUInt32BE(100000, 16);
  assert.throws(function () { images.decode(oversized); }, /2048/);
  var five = '@startsalt\n{\n' + Array.from({ length: 5 }, function (_, i) { return '<img:https://example.com/' + i + '.png>'; }).join('\n') + '\n}\n@endsalt';
  await assert.rejects(renderer.renderPlantUml(five, { imageLoader: function () { assert.fail('must reject before fetching'); } }), /four distinct/);
  var repeated = '@startsalt\n{\n' + Array(1400).fill('<img:https://example.com/x.png>').join('\n') + '\n}\n@endsalt';
  await assert.rejects(renderer.renderPlantUml(repeated, { imageLoader: function () { return png; } }), /output budget/);
});
test('cancellation stops pending resource resolution', async function () {
  var controller = new AbortController();
  var loading = renderer.renderPlantUml(source('https://example.com/x'), { signal: controller.signal, imageLoader: function () {
    process.nextTick(function () { controller.abort(); });
    return new Promise(function () {});
  } });
  await assert.rejects(loading, /cancelled/);
});
