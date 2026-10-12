function decode(value) {
  var base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), function (character) { return character.charCodeAt(0); });
}
function encode(value) {
  var bytes = new Uint8Array(value); var binary = '';
  bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function serialize(credential) {
  if (!credential) throw new Error('No passkey was selected.');
  var response = { clientDataJSON: encode(credential.response.clientDataJSON) };
  ['attestationObject', 'authenticatorData', 'signature', 'userHandle'].forEach(function (key) {
    if (credential.response[key]) response[key] = encode(credential.response[key]);
  });
  if (credential.response.getTransports) response.transports = credential.response.getTransports();
  return { id: credential.id, rawId: encode(credential.rawId), type: credential.type, response: response,
    clientExtensionResults: credential.getClientExtensionResults(), authenticatorAttachment: credential.authenticatorAttachment };
}
function prepare(options) {
  var publicKey = Object.assign({}, options, { challenge: decode(options.challenge) });
  ['allowCredentials', 'excludeCredentials'].forEach(function (field) {
    if (options[field]) publicKey[field] = options[field].map(function (key) { return Object.assign({}, key, { id: decode(key.id) }); });
  });
  if (options.user) publicKey.user = Object.assign({}, options.user, { id: decode(options.user.id) });
  return publicKey;
}
export function supported() { return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials); }
export function passkeyError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'AbortError') return 'Passkey request cancelled or timed out. You can try again or use your password.';
  if (error.name === 'InvalidStateError') return 'This passkey is already registered. Choose a different device or passkey.';
  return error.message || 'Could not use this passkey.';
}
export async function createPasskey(options) {
  if (!supported()) throw new Error('Passkeys need a supported browser and a secure connection.');
  return serialize(await navigator.credentials.create({ publicKey: prepare(options) }));
}
export async function getPasskey(options) {
  if (!supported()) throw new Error('Passkeys need a supported browser and a secure connection.');
  return serialize(await navigator.credentials.get({ publicKey: prepare(options) }));
}
export async function request(url, data) {
  var response = await fetch(url, data === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  var result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not complete this request.');
  return result;
}
export async function initPasskeyLogin() {
  var button = document.getElementById('passkey-login');
  if (!button || !supported()) return;
  try {
    var status = await request('/auth/passkeys/status');
    if (status.origin !== location.origin || document.getElementById('mode-row').hidden) return;
    button.hidden = false;
    button.onclick = async function () {
      button.disabled = true;
      var error = document.getElementById('error'); error.textContent = '';
      try {
        var options = await request('/auth/passkeys/login/options', {});
        var response = await getPasskey(options.options);
        await request('/auth/passkeys/login/verify', { response: response });
        location.href = '/';
      } catch (failure) { error.textContent = passkeyError(failure); }
      finally { button.disabled = false; }
    };
  } catch (failure) { /* Password sign-in remains available when passkeys cannot load. */ }
}
