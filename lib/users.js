var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var { execSync } = require("child_process");
var { CONFIG_DIR } = require("./config");

var USERS_FILE = path.join(CONFIG_DIR, "users.json");

// --- Default data ---

function defaultData() {
  return {
    multiUser: false,
    setupCode: null,
    users: [],
    invites: [],
    smtp: null,
  };
}

// --- Load / Save ---

function loadUsers() {
  try {
    var raw = fs.readFileSync(USERS_FILE, "utf8");
    var data = JSON.parse(raw);
    // Ensure all required fields exist
    if (!data.users) data.users = [];
    if (!data.invites) data.invites = [];
    if (data.multiUser === undefined) data.multiUser = false;
    if (data.setupCode === undefined) data.setupCode = null;
    if (data.smtp === undefined) data.smtp = null;
    return data;
  } catch (e) {
    return defaultData();
  }
}

function saveUsers(data) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  var tmpPath = USERS_FILE + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, USERS_FILE);
}

// --- Multi-user mode ---

function isMultiUser() {
  var data = loadUsers();
  return !!data.multiUser;
}

function enableMultiUser() {
  var data = loadUsers();
  if (data.multiUser) {
    // Already enabled — check if admin exists
    var admin = findAdmin(data);
    if (admin) {
      return { alreadyEnabled: true, hasAdmin: true, setupCode: null };
    }
    // Multi-user enabled but no admin — regenerate setup code
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
  return data.setupCode || null;
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

// --- User CRUD ---

function generateUserId() {
  return crypto.randomUUID();
}

function hashPin(pin) {
  return crypto.createHash("sha256").update("clay-user:" + pin).digest("hex");
}

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
    pinHash: hashPin(opts.pin),
    role: opts.role || "user",
    mustChangePin: !!opts.mustChangePin,
    createdAt: Date.now(),
    linuxUser: opts.linuxUser || null,
    profile: opts.profile || {
      name: opts.displayName || opts.username,
      lang: "en-US",
      avatarColor: "#7c3aed",
      avatarStyle: "thumbs",
      avatarSeed: crypto.randomBytes(4).toString("hex"),
    },
  };
  data.users.push(user);
  saveUsers(data);
  return { ok: true, user: user };
}

function createAdmin(opts) {
  return createUser({
    username: opts.username,
    email: opts.email || null,
    displayName: opts.displayName,
    pin: opts.pin,
    role: "admin",
    profile: opts.profile,
  });
}

function findAdmin(data) {
  if (!data) data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].role === "admin") return data.users[i];
  }
  return null;
}

function hasAdmin() {
  return !!findAdmin();
}

function findUserById(id) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === id) return data.users[i];
  }
  return null;
}

function findUserByUsername(username) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].username.toLowerCase() === username.toLowerCase()) return data.users[i];
  }
  return null;
}

function findUserByEmail(email) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].email && data.users[i].email.toLowerCase() === email.toLowerCase()) return data.users[i];
  }
  return null;
}

function authenticateUser(username, pin) {
  var user = findUserByUsername(username);
  if (!user) return null;
  var pinH = hashPin(pin);
  if (user.pinHash !== pinH) return null;
  return user;
}

function getAllUsers() {
  var data = loadUsers();
  return data.users.map(function (u) {
    return {
      id: u.id,
      username: u.username,
      email: u.email || null,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt,
      profile: u.profile,
      linuxUser: u.linuxUser || null,
    };
  });
}

function getOtherUsers(excludeUserId) {
  return getAllUsers().filter(function (u) {
    return u.id !== excludeUserId;
  });
}

function removeUser(userId) {
  var data = loadUsers();
  var before = data.users.length;
  data.users = data.users.filter(function (u) { return u.id !== userId; });
  if (data.users.length === before) return { error: "User not found" };
  saveUsers(data);
  return { ok: true };
}

function updateUserProfile(userId, profile) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      data.users[i].profile = profile;
      saveUsers(data);
      return { ok: true, profile: profile };
    }
  }
  return { error: "User not found" };
}

function updateUserPin(userId, newPin) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      data.users[i].pinHash = hashPin(newPin);
      data.users[i].mustChangePin = false;
      saveUsers(data);
      return { ok: true };
    }
  }
  return { error: "User not found" };
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

// Admin creates a user with a temporary PIN (must be changed on first login)
function createUserByAdmin(opts) {
  var tempPin = generatePin();
  var result = createUser({
    username: opts.username,
    displayName: opts.displayName || opts.username,
    email: opts.email || null,
    pin: tempPin,
    role: opts.role || "user",
    mustChangePin: true,
  });
  if (result.error) return result;
  return { ok: true, user: result.user, tempPin: tempPin };
}

// --- Linux user mapping (OS-level multi-user) ---

function updateLinuxUser(userId, linuxUsername) {
  // Allow null/empty to unset
  if (!linuxUsername) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].linuxUser = null;
        saveUsers(data);
        return { ok: true };
      }
    }
    return { error: "User not found" };
  }

  // Validate username format
  if (!/^[a-z_][a-z0-9_-]*$/.test(linuxUsername)) {
    return { error: "Invalid Linux username format" };
  }

  // Validate Linux user exists
  try {
    execSync("id " + linuxUsername, { encoding: "utf8", timeout: 5000 });
  } catch (e) {
    return { error: "Linux user '" + linuxUsername + "' does not exist" };
  }

  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      data.users[i].linuxUser = linuxUsername;
      saveUsers(data);
      return { ok: true };
    }
  }
  return { error: "User not found" };
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

// --- Invite links ---

function createInvite(createdByUserId, targetEmail) {
  var data = loadUsers();
  var code = crypto.randomBytes(12).toString("hex");
  var invite = {
    code: code,
    createdBy: createdByUserId,
    createdAt: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    used: false,
  };
  if (targetEmail) invite.email = targetEmail;
  data.invites.push(invite);
  saveUsers(data);
  return invite;
}

function createUserWithoutPin(opts) {
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
    pinHash: null,
    role: opts.role || "user",
    createdAt: Date.now(),
    profile: opts.profile || {
      name: opts.displayName || opts.username,
      lang: "en-US",
      avatarColor: "#7c3aed",
      avatarStyle: "thumbs",
      avatarSeed: crypto.randomBytes(4).toString("hex"),
    },
  };
  data.users.push(user);
  saveUsers(data);
  return { ok: true, user: user };
}

function findInvite(code) {
  var data = loadUsers();
  for (var i = 0; i < data.invites.length; i++) {
    if (data.invites[i].code === code) return data.invites[i];
  }
  return null;
}

function validateInvite(code) {
  var invite = findInvite(code);
  if (!invite) return { valid: false, error: "Invite not found" };
  if (invite.used) return { valid: false, error: "Invite already used" };
  if (Date.now() > invite.expiresAt) return { valid: false, error: "Invite expired" };
  return { valid: true, invite: invite };
}

function markInviteUsed(code) {
  var data = loadUsers();
  for (var i = 0; i < data.invites.length; i++) {
    if (data.invites[i].code === code) {
      data.invites[i].used = true;
      saveUsers(data);
      return true;
    }
  }
  return false;
}

function getInvites() {
  var data = loadUsers();
  return data.invites;
}

function revokeInvite(code) {
  var data = loadUsers();
  var before = data.invites.length;
  data.invites = data.invites.filter(function (inv) {
    return inv.code !== code;
  });
  if (data.invites.length === before) return { error: "Invite not found" };
  saveUsers(data);
  return { ok: true };
}

function removeExpiredInvites() {
  var data = loadUsers();
  var now = Date.now();
  var before = data.invites.length;
  data.invites = data.invites.filter(function (inv) {
    return !inv.used && inv.expiresAt > now;
  });
  if (data.invites.length !== before) saveUsers(data);
}

// --- DM Favorites ---

function getDmFavorites(userId) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      return data.users[i].dmFavorites || [];
    }
  }
  return [];
}

function addDmFavorite(userId, targetUserId) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      if (!data.users[i].dmFavorites) data.users[i].dmFavorites = [];
      if (data.users[i].dmFavorites.indexOf(targetUserId) === -1) {
        data.users[i].dmFavorites.push(targetUserId);
        saveUsers(data);
      }
      return data.users[i].dmFavorites;
    }
  }
  return [];
}

function removeDmFavorite(userId, targetUserId) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      if (!data.users[i].dmFavorites) data.users[i].dmFavorites = [];
      data.users[i].dmFavorites = data.users[i].dmFavorites.filter(function (id) {
        return id !== targetUserId;
      });
      saveUsers(data);
      return data.users[i].dmFavorites;
    }
  }
  return [];
}

// --- DM Hidden (dismissed from strip) ---

function getDmHidden(userId) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      return data.users[i].dmHidden || [];
    }
  }
  return [];
}

function addDmHidden(userId, targetUserId) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      if (!data.users[i].dmHidden) data.users[i].dmHidden = [];
      if (data.users[i].dmHidden.indexOf(targetUserId) === -1) {
        data.users[i].dmHidden.push(targetUserId);
        saveUsers(data);
      }
      return data.users[i].dmHidden;
    }
  }
  return [];
}

function removeDmHidden(userId, targetUserId) {
  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      if (!data.users[i].dmHidden) data.users[i].dmHidden = [];
      data.users[i].dmHidden = data.users[i].dmHidden.filter(function (id) {
        return id !== targetUserId;
      });
      saveUsers(data);
      return data.users[i].dmHidden;
    }
  }
  return [];
}

// --- Project access helpers ---

function canAccessProject(userId, project) {
  if (!project) return false;
  // Public projects are accessible to all authenticated users
  if (!project.visibility || project.visibility === "public") return true;
  // Admin always has access
  var user = findUserById(userId);
  if (user && user.role === "admin") return true;
  // Owner always has access to their own project
  if (project.ownerId && project.ownerId === userId) return true;
  // Private project — check allowedUsers
  var allowed = project.allowedUsers || [];
  return allowed.indexOf(userId) >= 0;
}

function getAccessibleProjects(userId, projects) {
  if (!projects) return [];
  return projects.filter(function (p) {
    return canAccessProject(userId, p);
  });
}

// --- Session visibility helpers ---

function canAccessSession(userId, session, project) {
  // Must have project access first
  if (!canAccessProject(userId, project)) return false;
  // Sessions without ownerId are legacy — only admin can see them
  if (!session.ownerId) {
    var user = findUserById(userId);
    return !!(user && user.role === "admin");
  }
  // Owner can always see their own sessions
  if (session.ownerId === userId) return true;
  // Shared sessions are visible to all project members (default)
  if (!session.sessionVisibility || session.sessionVisibility === "shared") return true;
  // Private sessions are only visible to the owner
  return false;
}

module.exports = {
  USERS_FILE: USERS_FILE,
  loadUsers: loadUsers,
  saveUsers: saveUsers,
  isMultiUser: isMultiUser,
  enableMultiUser: enableMultiUser,
  disableMultiUser: disableMultiUser,
  getSetupCode: getSetupCode,
  clearSetupCode: clearSetupCode,
  validateSetupCode: validateSetupCode,
  generateUserId: generateUserId,
  hashPin: hashPin,
  createUser: createUser,
  createAdmin: createAdmin,
  findAdmin: findAdmin,
  hasAdmin: hasAdmin,
  findUserById: findUserById,
  findUserByUsername: findUserByUsername,
  findUserByEmail: findUserByEmail,
  authenticateUser: authenticateUser,
  getAllUsers: getAllUsers,
  removeUser: removeUser,
  updateUserProfile: updateUserProfile,
  updateUserPin: updateUserPin,
  generateUserAuthToken: generateUserAuthToken,
  parseAuthCookie: parseAuthCookie,
  createUserWithoutPin: createUserWithoutPin,
  createInvite: createInvite,
  findInvite: findInvite,
  validateInvite: validateInvite,
  markInviteUsed: markInviteUsed,
  revokeInvite: revokeInvite,
  getInvites: getInvites,
  removeExpiredInvites: removeExpiredInvites,
  canAccessProject: canAccessProject,
  getAccessibleProjects: getAccessibleProjects,
  canAccessSession: canAccessSession,
  getOtherUsers: getOtherUsers,
  updateLinuxUser: updateLinuxUser,
  generatePin: generatePin,
  createUserByAdmin: createUserByAdmin,
  getDmFavorites: getDmFavorites,
  addDmFavorite: addDmFavorite,
  removeDmFavorite: removeDmFavorite,
  getDmHidden: getDmHidden,
  addDmHidden: addDmHidden,
  removeDmHidden: removeDmHidden,
};
