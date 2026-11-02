// One-time migration: fold a legacy single-user deploy into the multi-user
// model by auto-provisioning one "admin" user that inherits the single-user
// PIN, profile, and settings. After this, the app is always internally
// multi-user; a solo deploy is just a one-user multi-user deploy (with the
// solo auto-login safety net so there's no login wall when no PIN was set).
//
// Design goals:
//   - Seamless: existing users upgrade and keep working with no manual steps.
//     Had a PIN -> same PIN still logs in. Had none -> no login wall.
//   - Safe: backs up state first, tolerates partial failure (best-effort per
//     step), and is a no-op on fresh installs and already-multi-user deploys.
//   - Idempotent: a marker in daemon config prevents re-running.
//
// NOTE: this touches on-disk state (users.json, daemon.json, profile.json,
// mates/). It runs once at daemon boot, before the server starts listening.

var fs = require("fs");
var path = require("path");
var config = require("./config");
var users = require("./users");

var SETTING_KEYS = [
  "chatLayout",
  "autoContinueOnRateLimit",
  "matesEnabled",
  "capsulesEnabled",
  "agentBehavior",
  "terminalFont",
  "deletedBuiltinKeys",
  "mateOnboardingShown",
];

function backupFile(filePath, stamp) {
  try {
    if (!fs.existsSync(filePath)) return;
    var bak = filePath + ".pre-migrate-" + stamp + ".bak";
    if (fs.existsSync(bak)) return; // don't clobber an existing backup
    fs.copyFileSync(filePath, bak);
  } catch (e) {
    console.error("[migrate] backup failed for " + filePath + ": " + (e.message || e));
  }
}

// Move legacy flat mates (CONFIG_DIR/mates/*) under the per-user directory
// (CONFIG_DIR/mates/<userId>/). Best-effort; never fatal. Mates data is
// preserved on disk regardless.
function migrateMatesToUser(userId) {
  try {
    var matesRoot = path.join(config.CONFIG_DIR, "mates");
    if (!fs.existsSync(matesRoot)) return;
    var userDir = path.join(matesRoot, userId);
    fs.mkdirSync(userDir, { recursive: true });
    var entries = fs.readdirSync(matesRoot);
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i];
      // Skip per-user dirs (userId-shaped) and our target dir.
      if (name === userId) continue;
      // Only move legacy flat artifacts: mates.json and mate_* directories.
      var isLegacy = name === "mates.json" || name.indexOf("mate_") === 0;
      if (!isLegacy) continue;
      var src = path.join(matesRoot, name);
      var dst = path.join(userDir, name);
      if (fs.existsSync(dst)) continue; // don't clobber freshly-seeded builtins
      try { fs.renameSync(src, dst); }
      catch (e) { console.error("[migrate] mates move skipped for " + name + ": " + (e.message || e)); }
    }
  } catch (e) {
    console.error("[migrate] mates migration failed (non-fatal): " + (e.message || e));
  }
}

// Backfill ownerId onto legacy sessions (created before ownership existed) so
// they belong to the migrated user. Walks CONFIG_DIR/sessions/**/*.jsonl and
// patches the first "meta" line in place. Best-effort per file.
function backfillSessionOwners(userId) {
  var count = 0;
  try {
    var root = path.join(config.CONFIG_DIR, "sessions");
    if (!fs.existsSync(root)) return 0;
    var stack = [root];
    while (stack.length > 0) {
      var dir = stack.pop();
      var entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (var i = 0; i < entries.length; i++) {
        var ent = entries[i];
        var full = path.join(dir, ent.name);
        if (ent.isDirectory()) { stack.push(full); continue; }
        if (!ent.name.endsWith(".jsonl")) continue;
        try {
          var content = fs.readFileSync(full, "utf8");
          var nl = content.indexOf("\n");
          var firstLine = nl === -1 ? content : content.slice(0, nl);
          var rest = nl === -1 ? "" : content.slice(nl); // includes leading \n
          var meta;
          try { meta = JSON.parse(firstLine); } catch (e) { continue; }
          if (!meta || meta.type !== "meta") continue;
          if (meta.ownerId) continue; // already owned
          meta.ownerId = userId;
          var tmp = full + ".tmp." + Date.now();
          fs.writeFileSync(tmp, JSON.stringify(meta) + rest);
          fs.renameSync(tmp, full);
          count++;
        } catch (e) { /* skip this file */ }
      }
    }
  } catch (e) {
    console.error("[migrate] session ownerId backfill failed (non-fatal): " + (e.message || e));
  }
  return count;
}

function readProfile() {
  try {
    var p = path.join(config.CONFIG_DIR, "profile.json");
    if (!fs.existsSync(p)) return null;
    var raw = fs.readFileSync(p, "utf8");
    var obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : null;
  } catch (e) { return null; }
}

// Returns { migrated: true, userId } on success, or { skipped: <reason> }.
function migrateSingleUserToMulti() {
  try {
    // Guard 1: already multi-user -> nothing to do.
    if (users.isMultiUser()) return { skipped: "already-multi-user" };

    // Guard 2: users already exist (partial prior run) -> don't double-create.
    var existing = users.getAllUsers();
    if (existing && existing.length > 0) return { skipped: "users-exist" };

    var cfg = config.loadConfig() || {};

    // Guard 3: idempotency marker.
    if (cfg.singleUserMigratedAt) return { skipped: "already-migrated" };

    // Guard 4: only migrate deploys that show prior single-user use. A pristine
    // fresh install (no PIN, no settings, no profile) is left for the later
    // default-flip phase, so this migration is strictly an upgrade path.
    var profile = readProfile();
    var hasSettings = SETTING_KEYS.some(function (k) { return cfg[k] !== undefined; });
    var hasPin = !!cfg.pinHash;
    if (!profile && !hasSettings && !hasPin) return { skipped: "fresh-install" };

    var stamp = String(Date.now());
    console.log("[migrate] Legacy single-user deploy detected; migrating to multi-user (stamp=" + stamp + ")");

    // --- Backup before touching anything ---
    backupFile(config.configPath(), stamp);
    // users.json / auth-tokens live in CONFIG_DIR; back them up if present.
    backupFile(path.join(config.CONFIG_DIR, "users.json"), stamp);
    backupFile(path.join(config.CONFIG_DIR, "profile.json"), stamp);

    // Persist the owner credential and account mode in the same atomic write.
    var displayName = (profile && profile.name) ? String(profile.name) : "Admin";
    var created = users.createUserWithoutPin({
      username: "admin",
      displayName: displayName,
      role: "admin",
      profile: profile || undefined,
    }, { pinHash: cfg.pinHash || null });
    if (!created || !created.user) {
      console.error("[migrate] Failed to create admin user: " + (created && created.error));
      return { skipped: "create-failed" };
    }
    var userId = created.user.id;

    // --- Carry over settings ---
    try {
      if (cfg.chatLayout !== undefined && users.setChatLayout) users.setChatLayout(userId, cfg.chatLayout);
      if (cfg.autoContinueOnRateLimit !== undefined && users.setAutoContinue) users.setAutoContinue(userId, cfg.autoContinueOnRateLimit);
      if (cfg.matesEnabled !== undefined && users.setMatesEnabled) users.setMatesEnabled(userId, cfg.matesEnabled);
      if (cfg.capsulesEnabled !== undefined && users.setCapsulesEnabled) users.setCapsulesEnabled(userId, cfg.capsulesEnabled);
      if (cfg.agentBehavior && users.updateAgentBehavior) users.updateAgentBehavior(userId, require("./agent-behavior-schema").normalize(cfg.agentBehavior));
      if (cfg.terminalFont && users.setTerminalFont) {
        users.setTerminalFont(userId, cfg.terminalFont.family, cfg.terminalFont.size);
      }
      // Fields without a dedicated setter: write directly.
      if (cfg.deletedBuiltinKeys !== undefined || cfg.mateOnboardingShown !== undefined) {
        var d2 = users.loadUsers();
        for (var j = 0; j < d2.users.length; j++) {
          if (d2.users[j].id === userId) {
            if (cfg.deletedBuiltinKeys !== undefined) d2.users[j].deletedBuiltinKeys = cfg.deletedBuiltinKeys;
            if (cfg.mateOnboardingShown !== undefined) d2.users[j].mateOnboardingShown = cfg.mateOnboardingShown;
            break;
          }
        }
        users.saveUsers(d2);
      }
    } catch (e) {
      console.error("[migrate] settings carry-over failed (non-fatal): " + (e.message || e));
    }

    // --- Move legacy flat mates under the new user ---
    migrateMatesToUser(userId);

    // --- Backfill session ownership so legacy sessions belong to the user ---
    var backfilled = backfillSessionOwners(userId);
    if (backfilled > 0) console.log("[migrate] Backfilled ownerId on " + backfilled + " legacy session(s)");

    // --- Mark done (keep the old daemon-config keys for now; a later phase
    // removes the dual settings path). ---
    try {
      var freshCfg = config.loadConfig() || {};
      freshCfg.singleUserMigratedAt = Date.now();
      freshCfg.singleUserMigratedUserId = userId;
      config.saveConfig(freshCfg);
    } catch (e) {
      console.error("[migrate] Failed to write migration marker: " + (e.message || e));
    }

    console.log("[migrate] Single-user -> multi-user migration complete. admin userId=" + userId + (hasPin ? " (PIN preserved)" : " (no PIN; solo auto-login)"));
    return { migrated: true, userId: userId };
  } catch (e) {
    console.error("[migrate] Single-user migration aborted (non-fatal): " + (e.message || e));
    return { skipped: "error", error: e.message || String(e) };
  }
}

// Guarantee the app is in the multi-user model with at least one user, so the
// single-user runtime never exists. Called at daemon boot:
//   - already multi-user with users -> nothing to do
//   - legacy single-user with data   -> migrate it (preserves PIN/settings)
//   - fresh/empty                    -> provision one no-PIN "admin"
//                                       (solo auto-login: no login wall)
// OS-user isolation stays an orthogonal, settings/flag-driven toggle.
function ensureMultiUser() {
  try {
    if (users.isMultiUser()) {
      var have = users.getAllUsers();
      if (have && have.length > 0) return { skipped: "ready" };
    }

    // Try the legacy single-user migration first (handles PIN/settings/mates/
    // session carry-over for existing deploys).
    var mig = migrateSingleUserToMulti();
    if (mig && (mig.migrated || mig.skipped === "error" || mig.skipped === "create-failed")) return mig;

    // Fresh or empty deploy: provision a default admin so we're multi-user with
    // one user. No PIN -> the phase-1 solo auto-login skips the login wall.
    var existing = users.getAllUsers();
    if (!existing || existing.length === 0) {
      if (!users.isMultiUser()) users.enableMultiUser();
      var created = users.createUserWithoutPin({
        username: "admin",
        displayName: "Admin",
        role: "admin",
      });
      if (!created || !created.user) {
        console.error("[migrate] Failed to provision default admin: " + (created && created.error));
        return { skipped: "provision-failed" };
      }
      console.log("[migrate] Provisioned default admin (no PIN; solo auto-login). userId=" + created.user.id);
      return { provisioned: true, userId: created.user.id };
    }

    // Users exist but flag wasn't set (shouldn't normally happen) -> flip it.
    if (!users.isMultiUser()) users.enableMultiUser();
    return { skipped: "flag-fixed" };
  } catch (e) {
    console.error("[migrate] ensureMultiUser failed (non-fatal): " + (e.message || e));
    return { skipped: "error", error: e.message || String(e) };
  }
}

module.exports = {
  migrateSingleUserToMulti: migrateSingleUserToMulti,
  ensureMultiUser: ensureMultiUser,
};
