var crypto = require("crypto");
var serverPin = require('./users-server-pin');

function attachAuth(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var findAdmin = deps.findAdmin;

  // --- Multi-user mode ---

  function isMultiUser() {
    var data = loadUsers();
    return !!data.multiUser;
  }

  function enableMultiUser() {
    var data = loadUsers();
    if (data.multiUser) {
      // Already enabled -- check if admin exists
      var admin = findAdmin(data);
      if (admin) {
        return { alreadyEnabled: true, hasAdmin: true, setupCode: null };
      }
      // Multi-user enabled but no admin -- regenerate setup code
      var code = generateSetupCode();
      data.setupCode = code;
      saveUsers(data);
      return { alreadyEnabled: true, hasAdmin: false, setupCode: code };
    }
    var code = generateSetupCode();
    data.multiUser = true;
    data.setupCode = code;
    saveUsers(data);
    return { alreadyEnabled: false, hasAdmin: false, setupCode: code };
  }

  function disableMultiUser() {
    var data = loadUsers();
    data.multiUser = false;
    data.setupCode = null;
    saveUsers(data);
  }

  // --- Setup code ---

  function generateSetupCode() {
    var chars = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars
    var code = "";
    var bytes = crypto.randomBytes(6);
    for (var i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  function getSetupCode() {
    var data = loadUsers();
    if (data.setupCode) return data.setupCode;
    // Defensive: if multi-user is on, no admin, and no code, auto-generate one
    if (data.multiUser && !findAdmin(data)) {
      var code = generateSetupCode();
      data.setupCode = code;
      saveUsers(data);
      return code;
    }
    return null;
  }

  function clearSetupCode() {
    var data = loadUsers();
    data.setupCode = null;
    saveUsers(data);
  }

  function validateSetupCode(code) {
    var data = loadUsers();
    if (!data.setupCode) return false;
    return data.setupCode === code;
  }

  // --- Pin hashing ---

  function hashPin(pin) {
    var salt = crypto.randomBytes(16).toString("hex");
    var hash = crypto.scryptSync("clay-user:" + pin, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
    return "scrypt-v1:" + salt + ":" + hash;
  }

  function verifyPin(pin, storedHash, user) {
    // Older JSON clients could submit a numeric PIN; preserve that spelling.
    if (typeof pin === "number" && Number.isSafeInteger(pin) && pin >= 0) pin = String(pin);
    if (typeof pin !== "string" || typeof storedHash !== "string") return false;
    var migratedHash = serverPin.resolve(storedHash, user, deps.loadConfig);
    if (migratedHash) return serverPin.verify(pin, migratedHash);
    var expected;
    var actual;
    if (/^[a-f0-9]{64}$/.test(storedHash)) {
      expected = Buffer.from(storedHash, "hex");
      actual = crypto.createHash("sha256").update("clay-user:" + pin).digest();
    } else {
      var parts = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(storedHash);
      if (!parts) return false;
      expected = Buffer.from(parts[2], "hex");
      actual = crypto.scryptSync("clay-user:" + pin, parts[1], 64, { N: 16384, r: 8, p: 1 });
    }
    return crypto.timingSafeEqual(actual, expected);
  }

  // Generate a random 6-digit PIN
  function generatePin() {
    var digits = "";
    var bytes = crypto.randomBytes(6);
    for (var i = 0; i < 6; i++) {
      digits += (bytes[i] % 10).toString();
    }
    return digits;
  }

  // --- Authentication ---

  function authenticateUser(username, pin) {
    if (typeof username !== "string") return null;
    var data = loadUsers();
    var user = null;
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].username.toLowerCase() === username.toLowerCase()) {
        user = data.users[i];
        break;
      }
    }
    if (!user) return null;
    if (!verifyPin(pin, user.pinHash, user)) return null;
    if (user.pinHash.indexOf('scrypt-v1:') !== 0) {
      var previousHash = user.pinHash;
      try {
        user.pinHash = hashPin(pin);
        saveUsers(data);
      } catch (e) {
        // A best-effort upgrade must never reject a verified existing PIN.
        user.pinHash = previousHash;
        console.error("[users] PIN hash upgrade could not be saved; it will be retried on login.");
      }
    }
    return user;
  }

  // --- Auth tokens ---

  function generateUserAuthToken(userId) {
    var token = crypto.randomBytes(32).toString("hex");
    return userId + ":" + token;
  }

  function parseAuthCookie(cookieValue) {
    if (!cookieValue) return null;
    var idx = cookieValue.indexOf(":");
    if (idx < 0) return null;
    return {
      userId: cookieValue.substring(0, idx),
      token: cookieValue.substring(idx + 1),
    };
  }

  return {
    isMultiUser: isMultiUser,
    enableMultiUser: enableMultiUser,
    disableMultiUser: disableMultiUser,
    generateSetupCode: generateSetupCode,
    getSetupCode: getSetupCode,
    clearSetupCode: clearSetupCode,
    validateSetupCode: validateSetupCode,
    hashPin: hashPin,
    verifyPin: verifyPin,
    generatePin: generatePin,
    authenticateUser: authenticateUser,
    generateUserAuthToken: generateUserAuthToken,
    parseAuthCookie: parseAuthCookie,
  };
}

module.exports = { attachAuth: attachAuth };
