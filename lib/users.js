var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;
var { CONFIG_DIR } = require("./config");
var { attachAuth } = require("./users-auth");
var { DEFAULT_PERMISSIONS, ALL_PERMISSIONS, attachPermissions } = require("./users-permissions");
var { attachPreferences } = require("./users-preferences");
var { attachHomeDockPreferences } = require("./users-home-dock-preferences");
var { attachHomeSurfacePreferences } = require("./users-home-surface-preferences");
var { attachExperimentalPreferences } = require("./users-experimental-preferences");
var { attachScheduledTaskPreferences } = require("./users-scheduled-task-preferences");
var { attachDefaultAiPreferences } = require("./users-default-ai-preferences");
var { attachDefaultVendorPreferences } = require("./users-default-vendor-preferences");
var { attachContextViewPreferences } = require("./users-context-view-preferences");

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

// --- User CRUD ---

function generateUserId() {
  return crypto.randomUUID();
}

function ensureUserBuiltinMates(userId) {
  try {
    var mates = require("./mates");
    var mateCtx = mates.buildMateCtx(userId);
    mates.ensureBuiltinMates(mateCtx);
  } catch (e) {
    console.error("[users] Failed to seed built-in mates for user " + userId + ":", e.message);
  }
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
      permissions: u.permissions || null,
    };
  });
}

// Solo frictionless access: exactly one user with no PIN. Returns the full
// user record (callers read id/role/etc.) or null. Used to skip the login wall
// so an absorbed single-user deploy stays zero-friction; auto-disables the
// moment a PIN is set or a second user is added.
function getSoloNoPinUser() {
  if (!isMultiUser()) return null;
  var data = loadUsers();
  if (!data.users || data.users.length !== 1) return null;
  var u = data.users[0];
  if (u.pinHash) return null;
  return u;
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
      data.users[i].pinHash = auth.hashPin(newPin);
      data.users[i].mustChangePin = false;
      saveUsers(data);
      return { ok: true };
    }
  }
  return { error: "User not found" };
}

// Admin creates a user with a temporary PIN (must be changed on first login)
function createUserByAdmin(opts) {
  var tempPin = auth.generatePin();
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
        ensureUserBuiltinMates(userId);
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
    execFileSync("id", [linuxUsername], { encoding: "utf8", timeout: 5000, stdio: "pipe" });
  } catch (e) {
    return { error: "Linux user '" + linuxUsername + "' does not exist" };
  }

  var data = loadUsers();
  for (var i = 0; i < data.users.length; i++) {
    if (data.users[i].id === userId) {
      data.users[i].linuxUser = linuxUsername;
      saveUsers(data);
      ensureUserBuiltinMates(userId);
      return { ok: true };
    }
  }
  return { error: "User not found" };
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
      avatarColor: "#5857fc",
      avatarStyle: "imprint",
      avatarSeed: crypto.randomBytes(4).toString("hex"),
    },
  };
  data.users.push(user);
  saveUsers(data);

  ensureUserBuiltinMates(user.id);

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

// --- Wire extracted modules ---

var auth = attachAuth({ loadUsers: loadUsers, saveUsers: saveUsers, findAdmin: findAdmin });
var permissions = attachPermissions({ loadUsers: loadUsers, saveUsers: saveUsers, findUserById: findUserById });
var preferences = attachPreferences({ loadUsers: loadUsers, saveUsers: saveUsers });
var homeDockPreferences = attachHomeDockPreferences({ loadUsers: loadUsers, saveUsers: saveUsers });
var homeSurfacePreferences = attachHomeSurfacePreferences({ loadUsers: loadUsers, saveUsers: saveUsers });
var experimentalPreferences = attachExperimentalPreferences({ loadUsers: loadUsers, saveUsers: saveUsers });
var scheduledTaskPreferences = attachScheduledTaskPreferences({ loadUsers: loadUsers, saveUsers: saveUsers });
var defaultAiPreferences = attachDefaultAiPreferences({ loadUsers: loadUsers, saveUsers: saveUsers, isMultiUser: auth.isMultiUser });
var defaultVendorPreferences = attachDefaultVendorPreferences({ loadUsers: loadUsers, saveUsers: saveUsers, isMultiUser: auth.isMultiUser });
var contextViewPreferences = attachContextViewPreferences({ loadUsers: loadUsers, saveUsers: saveUsers, isMultiUser: auth.isMultiUser });

// Alias auth functions
var isMultiUser = auth.isMultiUser;
var enableMultiUser = auth.enableMultiUser;
var disableMultiUser = auth.disableMultiUser;
var getSetupCode = auth.getSetupCode;
var clearSetupCode = auth.clearSetupCode;
var validateSetupCode = auth.validateSetupCode;
var hashPin = auth.hashPin;
var generatePin = auth.generatePin;
var authenticateUser = auth.authenticateUser;
var generateUserAuthToken = auth.generateUserAuthToken;
var parseAuthCookie = auth.parseAuthCookie;

// Alias permissions functions
var getEffectivePermissions = permissions.getEffectivePermissions;
var updateUserPermissions = permissions.updateUserPermissions;
var canAccessProject = permissions.canAccessProject;
var getAccessibleProjects = permissions.getAccessibleProjects;
var canAccessSession = permissions.canAccessSession;

// Alias preferences functions
var getDmFavorites = preferences.getDmFavorites;
var addDmFavorite = preferences.addDmFavorite;
var removeDmFavorite = preferences.removeDmFavorite;
var getDmHidden = preferences.getDmHidden;
var addDmHidden = preferences.addDmHidden;
var removeDmHidden = preferences.removeDmHidden;
var getDeletedBuiltinKeys = preferences.getDeletedBuiltinKeys;
var addDeletedBuiltinKey = preferences.addDeletedBuiltinKey;
var removeDeletedBuiltinKey = preferences.removeDeletedBuiltinKey;
var getChatLayout = preferences.getChatLayout;
var setChatLayout = preferences.setChatLayout;
var getAutoContinue = preferences.getAutoContinue;
var setAutoContinue = preferences.setAutoContinue;
var getClaudeOpenMode = preferences.getClaudeOpenMode;
var setClaudeOpenMode = preferences.setClaudeOpenMode;
var getCursorSharing = preferences.getCursorSharing;
var setCursorSharing = preferences.setCursorSharing;
var getClaudeUserAllowList = preferences.getClaudeUserAllowList;
var setClaudeUserAllowList = preferences.setClaudeUserAllowList;
var getMatesEnabled = preferences.getMatesEnabled;
var setMatesEnabled = preferences.setMatesEnabled;
var getToolPalettes = preferences.getToolPalettes;
var setToolPalette = preferences.setToolPalette;
var getWhatsNewSeenIds = preferences.getWhatsNewSeenIds;
var markWhatsNewSeen = preferences.markWhatsNewSeen;
var getTerminalFont = preferences.getTerminalFont;
var setTerminalFont = preferences.setTerminalFont;
var setMateOnboarded = preferences.setMateOnboarded;
var getCapsulesEnabled = experimentalPreferences.getCapsulesEnabled;
var setCapsulesEnabled = experimentalPreferences.setCapsulesEnabled;
var getHomeDockPreference = homeDockPreferences.getHomeDockPreference;
var setHomeDockPreference = homeDockPreferences.setHomeDockPreference;
var getHomeSurfacePreference = homeSurfacePreferences.getHomeSurfacePreference;
var setHomeSurfacePreference = homeSurfacePreferences.setHomeSurfacePreference;
var getScheduledTaskInterviewEngine = scheduledTaskPreferences.get;
var setScheduledTaskInterviewEngine = scheduledTaskPreferences.set;
var getDefaultAiPreference = defaultAiPreferences.getDefaultAiPreference;
var setDefaultAiPreference = defaultAiPreferences.setDefaultAiPreference;
var getDefaultVendorPreference = defaultVendorPreferences.getDefaultVendor;
var setDefaultVendorPreference = defaultVendorPreferences.setDefaultVendor;
var getContextViewPreference = contextViewPreferences.get;
var setContextViewPreference = contextViewPreferences.set;

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
  getSoloNoPinUser: getSoloNoPinUser,
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
  DEFAULT_PERMISSIONS: DEFAULT_PERMISSIONS,
  getEffectivePermissions: getEffectivePermissions,
  updateUserPermissions: updateUserPermissions,
  getDmFavorites: getDmFavorites,
  addDmFavorite: addDmFavorite,
  removeDmFavorite: removeDmFavorite,
  getDmHidden: getDmHidden,
  addDmHidden: addDmHidden,
  removeDmHidden: removeDmHidden,
  getChatLayout: getChatLayout,
  setChatLayout: setChatLayout,
  setMateOnboarded: setMateOnboarded,
  getAutoContinue: getAutoContinue,
  setAutoContinue: setAutoContinue,
  getClaudeOpenMode: getClaudeOpenMode,
  setClaudeOpenMode: setClaudeOpenMode,
  getCursorSharing: getCursorSharing,
  setCursorSharing: setCursorSharing,
  getClaudeUserAllowList: getClaudeUserAllowList,
  setClaudeUserAllowList: setClaudeUserAllowList,
  getMatesEnabled: getMatesEnabled,
  setMatesEnabled: setMatesEnabled,
  getCapsulesEnabled: getCapsulesEnabled,
  setCapsulesEnabled: setCapsulesEnabled,
  getToolPalettes: getToolPalettes,
  setToolPalette: setToolPalette,
  getWhatsNewSeenIds: getWhatsNewSeenIds,
  markWhatsNewSeen: markWhatsNewSeen,
  getTerminalFont: getTerminalFont,
  setTerminalFont: setTerminalFont,
  getHomeDockPreference: getHomeDockPreference,
  setHomeDockPreference: setHomeDockPreference,
  getHomeSurfacePreference: getHomeSurfacePreference,
  setHomeSurfacePreference: setHomeSurfacePreference,
  getScheduledTaskInterviewEngine: getScheduledTaskInterviewEngine,
  setScheduledTaskInterviewEngine: setScheduledTaskInterviewEngine,
  getDefaultAiPreference: getDefaultAiPreference,
  setDefaultAiPreference: setDefaultAiPreference,
  getDefaultVendorPreference: getDefaultVendorPreference,
  setDefaultVendorPreference: setDefaultVendorPreference,
  getContextViewPreference: getContextViewPreference,
  setContextViewPreference: setContextViewPreference,
  getDeletedBuiltinKeys: getDeletedBuiltinKeys,
  addDeletedBuiltinKey: addDeletedBuiltinKey,
  removeDeletedBuiltinKey: removeDeletedBuiltinKey,
};
