var crypto = require("crypto");
var serverPin = require("./users-server-pin");

function attachCreation(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var generateUserId = deps.generateUserId;
  var ensureUserBuiltinMates = deps.ensureUserBuiltinMates;
  var auth = deps.auth;

  function createUser(opts) {
    var data = loadUsers();
    // Check username uniqueness
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].username.toLowerCase() === opts.username.toLowerCase()) {
        return { error: "This username is already taken" };
      }
    }
    // Check email uniqueness (when provided)
    if (opts.email) {
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].email && data.users[i].email.toLowerCase() === opts.email.toLowerCase()) {
          return { error: "This email is already registered" };
        }
      }
    }
    var user = {
      id: generateUserId(),
      username: opts.username,
      email: opts.email || null,
      displayName: opts.displayName || opts.username,
      pinHash: auth.hashPin(opts.pin),
      role: opts.role || "user",
      mustChangePin: !!opts.mustChangePin,
      createdAt: Date.now(),
      linuxUser: opts.linuxUser || null,
      profile: opts.profile || {
        name: opts.displayName || opts.username,
        lang: "en-US",
        avatarColor: "#5857fc",
        avatarStyle: "imprint",
        avatarSeed: crypto.randomBytes(4).toString("hex"),
      },
    };
    data.users.push(user);
    saveUsers(data);

    // Seed immediately for ordinary multi-user storage. OS-user provisioning
    // calls this again after the Linux mapping exists, targeting its final home.
    ensureUserBuiltinMates(user.id);

    return { ok: true, user: user };
  }

  function createUserWithoutPin(opts, migration) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].username.toLowerCase() === opts.username.toLowerCase()) {
        return { error: "This username is already taken" };
      }
    }
    if (opts.email) {
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].email && data.users[i].email.toLowerCase() === opts.email.toLowerCase()) {
          return { error: "This email is already registered" };
        }
      }
    }
    var user = {
      id: generateUserId(),
      username: opts.username,
      email: opts.email || null,
      displayName: opts.displayName || opts.username,
      pinHash: migration && migration.pinHash ? serverPin.tag(migration.pinHash) : null,
      role: opts.role || "user",
      createdAt: Date.now(),
      profile: opts.profile || {
        name: opts.displayName || opts.username,
        lang: "en-US",
        avatarColor: "#5857fc",
        avatarStyle: "imprint",
        avatarSeed: crypto.randomBytes(4).toString("hex"),
      },
    };
    data.users.push(user);
    if (migration) { data.multiUser = true; data.setupCode = null; }
    saveUsers(data);

    ensureUserBuiltinMates(user.id);

    return { ok: true, user: user };
  }

  return { createUser: createUser, createUserWithoutPin: createUserWithoutPin };
}

module.exports = { attachCreation: attachCreation };
