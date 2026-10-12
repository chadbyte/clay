// Test-only WebAuthn device: signs real assertions without touching a user's keychain.
var createAuthenticator = require('./passkey-authenticator').createAuthenticator;
function shim() {
  function encode(value) {
    var binary = ''; new Uint8Array(value).forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function decode(value) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), function (char) { return char.charCodeAt(0); }).buffer; }
  async function invoke(action, input) {
    var options = Object.assign({}, input.publicKey, { challenge: encode(input.publicKey.challenge) });
    if (options.user) options.user = Object.assign({}, options.user, { id: encode(options.user.id) });
    var res = await fetch('/fixture/webauthn/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options) });
    var credential = await res.json();
    if (!res.ok) throw new DOMException('No fixture passkey', 'NotAllowedError');
    credential.rawId = decode(credential.rawId);
    ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle'].forEach(function (field) {
      if (credential.response[field]) credential.response[field] = decode(credential.response[field]);
    });
    credential.response.getTransports = function () { return ['internal']; };
    credential.getClientExtensionResults = function () { return {}; };
    return credential;
  }
  Object.defineProperty(window, 'PublicKeyCredential', { value: function () {}, configurable: true });
  Object.defineProperty(navigator, 'credentials', { value: {
    create: function (input) { return invoke('create', input); },
    get: function (input) { return invoke('get', input); },
  }, configurable: true });
}
function attach() {
  var device = null; var counter = 0;
  function handle(req, res, url) {
    if (url === '/fixture/passkey-shim.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('(' + shim.toString() + ')();'); return true;
    }
    if (url !== '/fixture/webauthn/create' && url !== '/fixture/webauthn/get') return false;
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      try {
        var options = JSON.parse(body); var response;
        if (url.endsWith('/create')) { device = createAuthenticator(); counter = 0; response = device.register(options, req.headers.origin); }
        else { if (!device) throw new Error('No fixture passkey'); response = device.authenticate(options, req.headers.origin, { counter: ++counter }); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response));
      } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{}'); }
    });
    return true;
  }
  return { handle: handle };
}
module.exports = { attach: attach };
