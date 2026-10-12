var crypto = require('crypto');
var webauthn = require('@simplewebauthn/server');
var passwords = require('./account-passwords');
var policyStore = require('./account-passkey-policy');

function attachAccountPasskeys(ctx) {
  var users = ctx.users;
  var http = ctx.http;
  var challenges = require('./account-passkey-challenges').attachChallenges(ctx);
  function policy() { return policyStore.configured(users.loadUsers()); }
  function eligible(user) { return user && user.passwordHash && !user.mustChangePin; }
  function current(req, original) {
    var user = ctx.getUser(req);
    if (!eligible(user) || original && (user.id !== original.id || user.passwordHash !== original.passwordHash)) {
      throw new Error('Your account credentials changed. Sign in again.');
    }
    return user;
  }
  async function reauthenticate(req, data, admin) {
    var user = current(req);
    if (admin && user.role !== 'admin') throw new Error('Administrator access required.');
    http.throttle(req, user.username);
    if (!await passwords.verify(data.currentPassword, user.passwordHash)) throw new Error('Current password is incorrect.');
    user = current(req, user);
    if (admin && user.role !== 'admin') throw new Error('Administrator access required.');
    http.clearAttempts(req, user.username);
    return user;
  }
  function samePolicy(expected) {
    var now = policy();
    if (!now || now.origin !== expected.origin || now.rpID !== expected.rpID) throw new Error('Passkey settings changed. Please retry.');
  }
  function label(value) {
    if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 80) throw new Error('Give this passkey a name of 1–80 characters.');
    return value.trim();
  }
  function responseData(data) {
    var response = data.response;
    if (!response || typeof response.id !== 'string' || !response.response || typeof response.response.clientDataJSON !== 'string') throw new Error('Invalid passkey response.');
    var client = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'));
    if (client.crossOrigin || client.topOrigin) throw new Error('Open Clay directly to use a passkey.');
    return response;
  }
  function list(user) {
    return (user.passkeys || []).map(function (key) { return { id: key.id, name: key.name, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt || null }; });
  }
  async function registerOptions(req, res, data, config) {
    var user = await reauthenticate(req, data);
    var name = label(data.name);
    if ((user.passkeys || []).length >= 10) throw new Error('You can register up to 10 passkeys.');
    var handle = user.passkeyUserHandle || crypto.randomBytes(32).toString('base64url');
    var options = await webauthn.generateRegistrationOptions({
      rpName: 'Clay', rpID: config.rpID, userID: Buffer.from(handle, 'base64url'), userName: user.username,
      attestationType: 'none', timeout: 60000, supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: (user.passkeys || []).map(function (key) { return { id: key.id, transports: key.transports }; }),
    });
    current(req, user); samePolicy(config);
    var cookie = challenges.issue(req, config, { purpose: 'register', challenge: options.challenge, userId: user.id,
      passwordHash: user.passwordHash, session: ctx.sessionToken(req), handle: handle, name: name });
    http.reply(res, 200, { options: options }, cookie);
  }
  async function registerVerify(req, res, data, config) {
    var proof = challenges.take(req, config, 'register');
    var user = current(req, { id: proof.userId, passwordHash: proof.passwordHash });
    if (ctx.sessionToken(req) !== proof.session) throw new Error('Use the same signed-in session to register this passkey.');
    var response = responseData(data);
    var result;
    try {
      result = await webauthn.verifyRegistrationResponse({ response: response, expectedChallenge: proof.challenge,
        expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
    } catch (error) { throw new Error('Could not verify this passkey. Please try registering again.'); }
    if (!result.verified) throw new Error('Could not verify this passkey.');
    current(req, user); samePolicy(config);
    if (proof.until <= Date.now()) throw new Error('Registration expired. Please try again.');
    var state = users.loadUsers();
    user = state.users.find(function (entry) { return entry.id === user.id; });
    var info = result.registrationInfo; var key = info.credential;
    if (key.id !== response.id || state.users.some(function (entry) { return (entry.passkeys || []).some(function (saved) { return saved.id === key.id; }); })) {
      throw new Error('This passkey is already registered or has an invalid identifier.');
    }
    if ((user.passkeys || []).length >= 10 || user.passkeyUserHandle && user.passkeyUserHandle !== proof.handle) throw new Error('Passkeys changed. Please register again.');
    user.passkeyUserHandle = proof.handle;
    user.passkeys = (user.passkeys || []).concat([{ id: key.id, publicKey: Buffer.from(key.publicKey).toString('base64url'),
      counter: key.counter, transports: key.transports, name: proof.name, createdAt: new Date().toISOString(),
      deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp }]);
    users.saveUsers(state);
    http.reply(res, 200, { ok: true, passkeys: list(user) }, challenges.cookie('', config.origin));
  }
  async function loginOptions(req, res, config) {
    http.throttle(req, 'passkey:' + ctx.clientAddress(req));
    var options = await webauthn.generateAuthenticationOptions({ rpID: config.rpID, userVerification: 'required', timeout: 60000 });
    samePolicy(config);
    http.reply(res, 200, { options: options }, challenges.issue(req, config, { purpose: 'login', challenge: options.challenge }));
  }
  async function loginVerify(req, res, data, config) {
    var proof = challenges.take(req, config, 'login');
    var response = responseData(data);
    var state = users.loadUsers();
    var user = state.users.find(function (entry) { return (entry.passkeys || []).some(function (key) { return key.id === response.id; }); });
    if (!eligible(user) || response.response.userHandle !== user.passkeyUserHandle) throw new Error('Could not sign in with this passkey.');
    var key = user.passkeys.find(function (entry) { return entry.id === response.id; });
    var result;
    try {
      result = await webauthn.verifyAuthenticationResponse({ response: response, expectedChallenge: proof.challenge,
        expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true,
        credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')), counter: key.counter, transports: key.transports } });
    } catch (error) { throw new Error('Could not sign in with this passkey. Try again or use your password.'); }
    if (!result.verified || result.authenticationInfo.credentialDeviceType !== key.deviceType) throw new Error('Could not sign in with this passkey.');
    samePolicy(config);
    state = users.loadUsers();
    var latest = state.users.find(function (entry) { return entry.id === user.id; });
    var latestKey = latest && (latest.passkeys || []).find(function (entry) { return entry.id === key.id; });
    if (!eligible(latest) || latest.passwordHash !== user.passwordHash || !latestKey || latestKey.publicKey !== key.publicKey ||
      latestKey.counter !== key.counter || proof.until <= Date.now()) throw new Error('Account credentials changed. Please try again.');
    latestKey.counter = result.authenticationInfo.newCounter;
    latestKey.backedUp = result.authenticationInfo.credentialBackedUp;
    latestKey.lastUsedAt = new Date().toISOString();
    users.saveUsers(state);
    var session = ctx.createSession(latest.id, latest.passwordHash, key.id, config.origin.indexOf('https:') === 0, req);
    http.clearAttempts(req, 'passkey:' + ctx.clientAddress(req));
    http.reply(res, 200, { ok: true }, session.cookies.concat([challenges.cookie('', config.origin)]));
  }
  async function manage(req, res, data, config, remove) {
    var user = await reauthenticate(req, data);
    samePolicy(config);
    var state = users.loadUsers();
    user = state.users.find(function (entry) { return entry.id === user.id; });
    var key = (user.passkeys || []).find(function (entry) { return entry.id === data.id; });
    if (!key) throw new Error('Passkey not found.');
    if (remove) user.passkeys = user.passkeys.filter(function (entry) { return entry.id !== key.id; });
    else key.name = label(data.name);
    users.saveUsers(state);
    // Removing a passkey also invalidates its sessions through the live session gate.
    var cookie = remove ? ctx.createSession(user.id, user.passwordHash, null, config.origin.indexOf('https:') === 0, req).cookies : undefined;
    http.reply(res, 200, { ok: true, passkeys: list(user) }, cookie);
  }
  function handleRequest(req, res, url) {
    if (url === '/auth/passkey-browser.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(require('fs').readFileSync(require('path').join(__dirname, 'public/modules/passkey-browser.js'), 'utf8')); return true;
    }
    if (url === '/auth/logout' && req.method === 'POST') challenges.clear(req);
    if (url === '/account/passkeys' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "frame-ancestors 'none'" });
      res.end(eligible(ctx.getUser(req)) ? require('./account-passkey-page').render() : require('./account-password-page').render());
      return true;
    }
    if (url === '/auth/passkeys/status' && req.method === 'GET') { http.reply(res, 200, { origin: policy() && policy().origin }); return true; }
    if (url === '/api/passkey-policy') {
      var admin = ctx.getUser(req);
      if (!admin || admin.role !== 'admin') { http.reply(res, 403, { error: 'Administrator access required.' }); return true; }
      if (req.method === 'GET') {
        var state = users.loadUsers();
        http.reply(res, 200, { available: state.accountAuthMethod === 'password', origin: policy() && policy().origin, locked: policyStore.count(state) > 0 }); return true;
      }
      if (req.method !== 'PUT') { http.reply(res, 405, { error: 'Method not allowed.' }); return true; }
      http.read(req, res, async function (data) {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new Error('Open Clay directly to change passkey settings.');
        await reauthenticate(req, data, true);
        var saved = policyStore.save(users, data.origin);
        http.reply(res, 200, { ok: true, available: true, origin: saved.origin, locked: policyStore.count(users.loadUsers()) > 0 });
      }); return true;
    }
    if (url.indexOf('/api/passkeys') !== 0 && url.indexOf('/auth/passkeys/') !== 0) return false;
    var config = policy();
    if (!config) { http.reply(res, 409, { error: 'Your administrator needs to configure passkeys first.' }); return true; }
    if (url === '/api/passkeys' && req.method === 'GET') {
      var user = ctx.getUser(req);
      http.reply(res, eligible(user) ? 200 : 401, eligible(user) ? { origin: config.origin, passkeys: list(user) } : { error: 'Sign in to manage passkeys.' }); return true;
    }
    if (req.method !== 'POST') { http.reply(res, 405, { error: 'Method not allowed.' }); return true; }
    if (req.headers.origin !== config.origin || req.headers['sec-fetch-site'] === 'cross-site') { http.reply(res, 403, { error: 'Use the configured Clay address to use passkeys.' }); return true; }
    http.read(req, res, async function (data) {
      if (url === '/api/passkeys/register/options') return registerOptions(req, res, data, config);
      if (url === '/api/passkeys/register/verify') return registerVerify(req, res, data, config);
      if (url === '/auth/passkeys/login/options') return loginOptions(req, res, config);
      if (url === '/auth/passkeys/login/verify') return loginVerify(req, res, data, config);
      if (url === '/api/passkeys/remove' || url === '/api/passkeys/rename') return manage(req, res, data, config, url.endsWith('/remove'));
      http.reply(res, 404, { error: 'Passkey endpoint not found.' });
    }, 32768);
    return true;
  }
  return { handleRequest: handleRequest };
}
module.exports = { attachAccountPasskeys: attachAccountPasskeys };
