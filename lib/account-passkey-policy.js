var net = require('net');
var normalizeOrigin = require('./network-origins').normalizeAllowedOrigins;

function parseOrigin(value) {
  var origin = normalizeOrigin([value])[0];
  var url = new URL(origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new Error('Use an HTTPS address, or http://localhost for local development.');
  }
  if (net.isIP(url.hostname) || url.hostname[0] === '[') throw new Error('Passkeys require a hostname, not an IP address.');
  return { origin: origin, rpID: url.hostname };
}

function configured(data) {
  if (data.accountAuthMethod !== 'password' || !data.passkeyPolicy) return null;
  try {
    var policy = parseOrigin(data.passkeyPolicy.origin);
    return policy.rpID === data.passkeyPolicy.rpID ? policy : null;
  } catch (error) { return null; }
}

function count(data) {
  return data.users.reduce(function (total, user) { return total + (user.passkeys || []).length; }, 0);
}

function save(users, origin) {
  var next = parseOrigin(origin);
  var data = users.loadUsers();
  if (data.accountAuthMethod !== 'password') throw new Error('Enable account passwords first.');
  var previous = configured(data);
  if (count(data) && (!previous || previous.origin !== next.origin)) {
    throw new Error('Remove existing passkeys before changing the sign-in address. Password sign-in remains available.');
  }
  data.passkeyPolicy = next;
  users.saveUsers(data);
  return next;
}

module.exports = { parseOrigin: parseOrigin, configured: configured, count: count, save: save };
