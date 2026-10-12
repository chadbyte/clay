var net = require('net');
var normalizeOrigin = require('./network-origins').normalizeAllowedOrigins;
function address(value) {
  var result = String(value || '').replace(/^::ffff:/, '');
  return net.isIP(result) ? result : '';
}
function loopback(value) { return value === '::1' || /^127\./.test(value); }
function attachTransport(ctx) {
  function settings() { return ctx.users.loadUsers().accountTransport || { origin: '', trustedProxies: [] }; }
  function info(req) {
    var config = settings(); var peer = address(req.socket && req.socket.remoteAddress);
    var proxy = !!peer && (config.trustedProxies || []).indexOf(peer) !== -1 && req.headers['x-forwarded-proto'] !== undefined;
    var secure = !!(ctx.tlsOptions || req.socket && req.socket.encrypted);
    if (proxy) secure = req.headers['x-forwarded-proto'] === 'https';
    var origin = '';
    try { origin = proxy ? config.origin : normalizeOrigin([(secure ? 'https://' : 'http://') + req.headers.host])[0]; } catch (error) { /* Invalid Host is not an authentication origin. */ }
    var local = false;
    try { var hostname = new URL(origin).hostname; local = !proxy && loopback(peer) && (hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname)); } catch (error) { /* Invalid origin remains denied. */ }
    var client = peer;
    if (proxy) {
      // The configured immediate proxy must overwrite this single-address header.
      client = address(req.headers['x-real-ip']) || peer;
    }
    return { origin: origin, secure: secure, local: local, clientAddress: client, proxy: proxy };
  }
  function allows(req, write) {
    var value = info(req);
    if (!value.origin || !value.secure && !value.local) return false;
    if (req.headers.origin && req.headers.origin !== value.origin) return false;
    if (!write) return true;
    if (req.headers['sec-fetch-site'] && ['same-origin', 'none'].indexOf(req.headers['sec-fetch-site']) === -1) return false;
    // Fetch writes send Origin; same-origin legacy clients may send Referer instead.
    if (req.headers.origin) return req.headers.origin === value.origin;
    if (req.headers.referer) { try { return new URL(req.headers.referer).origin === value.origin; } catch (error) { return false; } }
    return false;
  }
  function save(data) {
    var origin = data.origin ? normalizeOrigin([data.origin])[0] : '';
    if (origin && new URL(origin).protocol !== 'https:') throw new Error('The external account address must use HTTPS.');
    if (!Array.isArray(data.trustedProxies) || data.trustedProxies.length > 16) throw new Error('Enter up to 16 exact proxy IP addresses.');
    var proxies = data.trustedProxies.map(function (value) { var ip = address(value); if (!ip) throw new Error('Trusted proxies must be exact IP addresses.'); return ip; });
    if (proxies.length && !origin) throw new Error('An HTTPS address is required for a trusted proxy.');
    var state = ctx.users.loadUsers(); state.accountTransport = { origin: origin, trustedProxies: Array.from(new Set(proxies)) }; ctx.users.saveUsers(state);
    return state.accountTransport;
  }
  return { info: info, allows: allows, settings: settings, save: save, clientAddress: function (req) { return info(req).clientAddress; } };
}
module.exports = { attachTransport: attachTransport };
