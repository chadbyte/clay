// Remote MCP must not turn a shared Clay host into a private-network proxy.
var dns = require('dns').promises;
var ipaddr = require('ipaddr.js');
var undici = require('undici');

function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch (error) { return false; }
}
function remoteUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Enter a valid HTTPS MCP address.');
  var url;
  try { url = new URL(value.trim()); } catch (error) { throw new Error('Enter a valid HTTPS MCP address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use an HTTPS address without embedded credentials or a fragment.');
  var hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || (ipaddr.isValid(hostname) && !publicAddress(hostname))) {
    throw new Error('Remote connections require a public server. Use the extension for tools on your computer.');
  }
  return url;
}
async function publicLookup(hostname) {
  var records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(function (item) { return !publicAddress(item.address); })) throw new Error('The server address resolves to a private or reserved network.');
  return records;
}
async function assertPublicUrl(value) {
  var url = remoteUrl(String(value));
  await publicLookup(url.hostname.replace(/^\[|\]$/g, ''));
  return url;
}
function createRemoteFetch() {
  var agent = new undici.Agent({ connect: { timeout: 15000, lookup: function (host, options, callback) {
    publicLookup(host).then(function (records) {
      var matching = records.filter(function (item) { return !options.family || item.family === options.family; });
      if (!matching.length) return callback(new Error('No public address is available.'));
      if (options.all) callback(null, matching); else callback(null, matching[0].address, matching[0].family);
    }, callback);
  } } });
  async function request(input, init) {
    var url = await assertPublicUrl(typeof input === 'string' || input instanceof URL ? input : input.url);
    // No redirect may forward credentials to a different endpoint.
    return undici.fetch(url, Object.assign({}, init, { dispatcher: agent, redirect: 'error',
      signal: init && init.signal && typeof AbortSignal.any !== 'function' ? init.signal : (init && init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)) }));
  }
  return { fetch: request, close: function () { return agent.destroy(); } };
}
module.exports = { remoteUrl: remoteUrl, publicAddress: publicAddress, publicLookup: publicLookup, assertPublicUrl: assertPublicUrl, createRemoteFetch: createRemoteFetch };
