var crypto = require('node:crypto');
var cbor = require('@simplewebauthn/server/helpers').isoCBOR;
function hash(value) { return crypto.createHash('sha256').update(value).digest(); }
function createAuthenticator() {
  var pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  var publicKey = pair.publicKey.export({ format: 'jwk' });
  var id = crypto.randomBytes(32);
  var handle;
  var cose = Buffer.from(cbor.encode(new Map([[1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(publicKey.x, 'base64url')], [-3, Buffer.from(publicKey.y, 'base64url')]])));
  function client(type, options, origin, overrides) {
    return Buffer.from(JSON.stringify(Object.assign({ type: type, challenge: options.challenge, origin: origin, crossOrigin: false }, overrides)));
  }
  function authenticatorData(rpID, flags, count) {
    var counter = Buffer.alloc(4); counter.writeUInt32BE(count);
    return Buffer.concat([hash(rpID), Buffer.from([flags]), counter]);
  }
  function register(options, origin, overrides) {
    overrides = overrides || {}; handle = options.user.id;
    var length = Buffer.alloc(2); length.writeUInt16BE(id.length);
    var authData = Buffer.concat([authenticatorData(overrides.rpID || options.rp.id, overrides.flags === undefined ? 0x45 : overrides.flags, 0), Buffer.alloc(16), length, id, cose]);
    return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key', clientExtensionResults: {}, response: {
      clientDataJSON: client('webauthn.create', options, origin, overrides.client).toString('base64url'),
      attestationObject: Buffer.from(cbor.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))).toString('base64url'), transports: ['internal'],
    } };
  }
  function authenticate(options, origin, overrides) {
    overrides = overrides || {};
    var data = client('webauthn.get', options, origin, overrides.client);
    var authData = authenticatorData(overrides.rpID || options.rpId, overrides.flags === undefined ? 5 : overrides.flags, overrides.counter === undefined ? 1 : overrides.counter);
    var signature = crypto.sign('sha256', Buffer.concat([authData, hash(data)]), pair.privateKey);
    if (overrides.badSignature) signature[signature.length - 1] ^= 1;
    return { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key', clientExtensionResults: {}, response: {
      clientDataJSON: data.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url'),
      userHandle: overrides.handle === undefined ? handle : overrides.handle,
    } };
  }
  return { register: register, authenticate: authenticate, id: id.toString('base64url') };
}
module.exports = { createAuthenticator: createAuthenticator };
