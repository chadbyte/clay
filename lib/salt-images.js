// Resolve explicit raster images only. SVG output contains embedded bytes, never remote URLs.
var https = require('node:https');
var dns = require('node:dns').promises;
var net = require('node:net');
var MAX_BYTES = 1024 * 1024;
function failure(message) { return Object.assign(new Error(message), { status: 422 }); }
function bounded(promise, signal) {
  return new Promise(function (resolve, reject) {
    function aborted() { reject(failure('Wireframe image loading cancelled or timed out.')); }
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(function () { signal.removeEventListener('abort', aborted); });
  });
}
function publicAddress(address) {
  if (net.isIP(address) !== 4) return false;
  var p = address.split('.').map(Number);
  return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] === 169 && p[1] === 254 ||
    p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && (p[1] === 168 || p[1] === 0 || p[1] === 2) ||
    p[0] === 198 && (p[1] === 18 || p[1] === 19 || p[1] === 51 && p[2] === 100) || p[0] === 203 && p[1] === 0 && p[2] === 113);
}
function decode(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES || bytes.length < 33 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw failure('Wireframe images must be PNG files of at most 1 MB.');
  var width = bytes.readUInt32BE(16); var height = bytes.readUInt32BE(20);
  if (!width || !height || width > 2048 || height > 2048) throw failure('Wireframe images must be at most 2048 by 2048 pixels.');
  return { width: width, height: height, data: 'data:image/png;base64,' + bytes.toString('base64') };
}
async function download(value, signal) {
  var url;
  try { url = new URL(value); } catch (e) { throw failure('Invalid wireframe image URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw failure('Wireframe images require a public HTTPS URL on port 443.');
  var addresses = await bounded(dns.lookup(url.hostname, { all: true, family: 4 }), signal);
  if (!addresses.length || addresses.some(function (entry) { return !publicAddress(entry.address); })) throw failure('Wireframe images cannot access private or reserved network addresses.');
  if (signal.aborted) throw failure('Wireframe image loading cancelled or timed out.');
  return new Promise(function (resolve, reject) {
    var request = https.get(url, { signal: signal, agent: false, headers: { Accept: 'image/png' },
      lookup: function (_, options, callback) { callback(null, options.all ? [addresses[0]] : addresses[0].address, 4); }
    }, function (response) {
      if (response.statusCode !== 200) { response.resume(); reject(failure('Wireframe image server returned HTTP ' + response.statusCode + '. Redirects are not followed.')); return; }
      var chunks = []; var size = 0;
      response.on('data', function (chunk) {
        size += chunk.length;
        if (size > MAX_BYTES) { var error = failure('Wireframe image exceeds 1 MB.'); reject(error); request.destroy(error); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', function () { try { resolve(decode(Buffer.concat(chunks))); } catch (e) { reject(e); } });
    });
    request.on('error', function (error) { reject(failure('Unable to load wireframe image: ' + error.message)); });
  });
}
async function resolveImages(root, options) {
  var runs = [];
  function label(node) { if (node) (node.runs || []).forEach(function (run) { if (run.imageUrl) runs.push(run); }); }
  function visit(node) {
    label(node); label(node.titleData);
    (node.options || []).forEach(label);
    (node.rows || []).forEach(function (row) { row.forEach(visit); });
    (node.popups || []).forEach(function (row) { row.forEach(visit); });
  }
  // The root's display options differ from a dropdown's option labels.
  (root.rows || []).forEach(function (row) { row.forEach(visit); }); label(root.titleData);
  (root.popups || []).forEach(function (row) { row.forEach(visit); });
  Object.values(root.options.labels).forEach(function (labels) { labels.forEach(label); });
  var urls = Array.from(new Set(runs.map(function (run) { return run.imageUrl; })));
  if (urls.length > 4) throw failure('Wireframes support at most four distinct images.');
  if (!urls.length) return;
  var controller = new AbortController();
  var signal = controller.signal;
  function cancel() { controller.abort(); }
  if (options.signal) {
    if (options.signal.aborted) cancel();
    else options.signal.addEventListener('abort', cancel, { once: true });
  }
  var timer = setTimeout(cancel, 10000);
  var embeddedBytes = 0;
  try { for (var url of urls) {
    var resource;
    try { resource = options.imageLoader ? decode(await bounded(Promise.resolve(options.imageLoader(url, signal)), signal)) : await download(url, signal); }
    catch (error) { throw Object.assign(failure(error.message), { status: options.signal && options.signal.aborted ? 499 : 422 }); }
    runs.forEach(function (run) { if (run.imageUrl === url) { run.image = resource; embeddedBytes += resource.data.length; } });
    if (embeddedBytes > 6 * 1024 * 1024) throw failure('Embedded wireframe images exceed the 6 MB output budget.');
  } } finally { clearTimeout(timer); if (options.signal) options.signal.removeEventListener('abort', cancel); }
}
module.exports = { resolveImages: resolveImages, publicAddress: publicAddress, decode: decode };
