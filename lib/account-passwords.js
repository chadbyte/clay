var crypto = require('crypto');
var active = 0;
var PREFIX = 'password-scrypt-v1:';

function validate(password) {
  if (typeof password !== 'string' || Array.from(password).length < 15 || Array.from(password).length > 128) {
    throw new Error('Use 15–128 characters. Spaces and passphrases are welcome.');
  }
}

function derive(password, salt) {
  if (active >= 2) return Promise.reject(new Error('Sign-in is busy. Please retry shortly.'));
  active++;
  return new Promise(function (resolve, reject) {
    crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, function (error, key) {
      active--;
      if (error) reject(error); else resolve(key);
    });
  });
}

async function hash(password) {
  validate(password);
  var salt = crypto.randomBytes(16).toString('hex');
  return PREFIX + salt + ':' + (await derive(password, salt)).toString('hex');
}

async function verify(password, stored) {
  if (typeof password !== 'string' || password.length > 512) return false;
  var parts = /^password-scrypt-v1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored || '');
  // Unknown accounts still perform the same bounded work.
  var key = await derive(password, parts ? parts[1] : '0'.repeat(32));
  return !!parts && crypto.timingSafeEqual(key, Buffer.from(parts[2], 'hex'));
}

module.exports = { hash: hash, verify: verify, validate: validate };
