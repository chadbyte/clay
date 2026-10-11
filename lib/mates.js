var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");
var workspaceColor = require("./mate-workspace-color");

var crisisSafety = require("./crisis-safety");
var matesPrompts = require("./mates-prompts");
var matesIdentity = require("./mates-identity");
var { attachKnowledge } = require("./mates-knowledge");

// --- Path resolution ---

function resolveMatesRoot(ctx) {
  // OS-users mode: per-linuxUser home directory
  if (ctx && ctx.linuxUser) {
    return path.join("/home", ctx.linuxUser, ".clay", "mates");
  }
  // Multi-user mode: per-userId subdirectory
  if (ctx && ctx.multiUser && ctx.userId) {
    return path.join(config.CONFIG_DIR, "mates", ctx.userId);
  }
  // Single-user mode: flat directory
  return path.join(config.CONFIG_DIR, "mates");
}

// --- Wiring: knowledge module needs resolveMatesRoot ---
var knowledge = attachKnowledge(resolveMatesRoot);
var loadCommonKnowledge = knowledge.loadCommonKnowledge;
var saveCommonKnowledge = knowledge.saveCommonKnowledge;
var promoteKnowledge = knowledge.promoteKnowledge;
var depromoteKnowledge = knowledge.depromoteKnowledge;
var getCommonKnowledgeForMate = knowledge.getCommonKnowledgeForMate;
var readCommonKnowledgeFile = knowledge.readCommonKnowledgeFile;
var isPromoted = knowledge.isPromoted;

// --- Aliases from extracted modules ---
var TEAM_MARKER = matesPrompts.TEAM_MARKER;
var TEAM_SECTION = matesPrompts.TEAM_SECTION;
var SESSION_MEMORY_MARKER = matesPrompts.SESSION_MEMORY_MARKER;
var SESSION_MEMORY_SECTION = matesPrompts.SESSION_MEMORY_SECTION;
var STICKY_NOTES_MARKER = matesPrompts.STICKY_NOTES_MARKER;
var STICKY_NOTES_SECTION = matesPrompts.STICKY_NOTES_SECTION;
var PROJECT_REGISTRY_MARKER = matesPrompts.PROJECT_REGISTRY_MARKER;
var DEBATE_AWARENESS_MARKER = matesPrompts.DEBATE_AWARENESS_MARKER;
var DEBATE_AWARENESS_SECTION = matesPrompts.DEBATE_AWARENESS_SECTION;
var ALL_SYSTEM_MARKERS = matesPrompts.ALL_SYSTEM_MARKERS;
var buildTeamSection = matesPrompts.buildTeamSection;
var enforceTeamAwareness = matesPrompts.enforceTeamAwareness;
var enforceProjectRegistry = matesPrompts.enforceProjectRegistry;
var buildProjectRegistrySection = matesPrompts.buildProjectRegistrySection;
var enforceSessionMemory = matesPrompts.enforceSessionMemory;
var enforceStickyNotes = matesPrompts.enforceStickyNotes;
var enforceDebateAwareness = matesPrompts.enforceDebateAwareness;
var PRIMARY_CAPABILITIES_MARKER = matesIdentity.PRIMARY_CAPABILITIES_MARKER;
var IDENTITY_MIN_LENGTH = matesIdentity.IDENTITY_MIN_LENGTH;
var buildPrimaryCapabilitiesSection = matesIdentity.buildPrimaryCapabilitiesSection;
var backupIdentity = matesIdentity.backupIdentity;
var loadIdentityBackup = matesIdentity.loadIdentityBackup;
var logIdentityChange = matesIdentity.logIdentityChange;
var extractIdentity = function (content) { return matesIdentity.extractIdentity(content, ALL_SYSTEM_MARKERS); };

function buildMateCtx(userId) {
  if (!userId) return { userId: null, multiUser: false, linuxUser: null };
  // Lazy require to avoid circular dependency
  var users = require("./users");
  var multiUser = users.isMultiUser();
  var linuxUser = null;
  if (multiUser && userId) {
    var user = users.findUserById(userId);
    if (user && user.linuxUser) {
      linuxUser = user.linuxUser;
    }
  }
  return { userId: userId, multiUser: multiUser, linuxUser: linuxUser };
}

function isMateIdFormat(id) {
  if (!id) return false;
  return typeof id === "string" && id.indexOf("mate_") === 0;
}

// --- Default data ---

function defaultData() {
  return { mates: [] };
}

// --- Load / Save ---

function matesFilePath(ctx) {
  return path.join(resolveMatesRoot(ctx), "mates.json");
}

function loadMates(ctx) {
  try {
    var raw = fs.readFileSync(matesFilePath(ctx), "utf8");
    var data = JSON.parse(raw);
    if (!data.mates) data.mates = [];
    return data;
  } catch (e) {
    return defaultData();
  }
}

function saveMates(ctx, data) {
  var filePath = matesFilePath(ctx);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  var tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

// --- CRUD ---

function generateMateId() {
  return "mate_" + crypto.randomUUID();
}

function createMate(ctx, seedData) {
  var data = loadMates(ctx);
  var id = generateMateId();
  var userId = ctx ? ctx.userId : null;

  var mate = {
    id: id,
    name: null,
    createdBy: userId,
    createdAt: Date.now(),
    seedData: seedData || {},
    vendor: (seedData && seedData.vendor) || "claude",
    model: (seedData && seedData.model) || null,
    profile: {
      displayName: null,
      avatarColor: "#5857fc",
      avatarStyle: "imprint",
      avatarSeed: crypto.randomBytes(4).toString("hex"),
    },
    bio: null,
    status: "interviewing",
    interviewProjectPath: null,
  };

  data.mates.push(mate);
  saveMates(ctx, data);

  // Create the mate's identity directory
  var mateDir = getMateDir(ctx, id);
  fs.mkdirSync(mateDir, { recursive: true });

  // Write initial mate.yaml
  var yaml = "# Mate metadata\n";
  yaml += "id: " + id + "\n";
  yaml += "name: null\n";
  yaml += "status: interviewing\n";
  yaml += "createdBy: " + userId + "\n";
  yaml += "createdAt: " + mate.createdAt + "\n";
  yaml += "relationship: " + (seedData.relationship || "assistant") + "\n";
  yaml += "activities: " + JSON.stringify(seedData.activity || []) + "\n";
  yaml += "vendor: " + (seedData.vendor || "claude") + "\n";
  yaml += "model: " + JSON.stringify(seedData.model || null) + "\n";
  fs.writeFileSync(path.join(mateDir, "mate.yaml"), yaml);

  // Write initial CLAUDE.md (will be replaced by interview)
  var claudeMd = "# Mate Identity\n\n";
  claudeMd += "This mate is currently being interviewed. Identity will be generated after the interview.\n\n";
  claudeMd += "## Seed Data\n\n";
  claudeMd += "- Relationship: " + (seedData.relationship || "assistant") + "\n";
  if (seedData.activity && seedData.activity.length > 0) {
    claudeMd += "- Activities: " + seedData.activity.join(", ") + "\n";
  }
  if (seedData.communicationStyle && seedData.communicationStyle.length > 0) {
    claudeMd += "- Communication: " + seedData.communicationStyle.join(", ") + "\n";
  }
  var initialIdentity = claudeMd.trimEnd();
  claudeMd += TEAM_SECTION;
  claudeMd += SESSION_MEMORY_SECTION;
  claudeMd += crisisSafety.getSection();
  fs.writeFileSync(path.join(mateDir, "CLAUDE.md"), claudeMd);

  // Log creation (identity is placeholder, will be replaced by interview)
  logIdentityChange(mateDir, "create_custom", initialIdentity, "");

  return mate;
}

function getMate(ctx, id) {
  var data = loadMates(ctx);
  for (var i = 0; i < data.mates.length; i++) {
    if (data.mates[i].id === id) return data.mates[i];
  }
  return null;
}

function updateMate(ctx, id, updates) {
  updates = Object.assign({}, updates);
  delete updates.id;
  delete updates.createdBy;
  delete updates.builtinKey;
  var data = loadMates(ctx);
  for (var i = 0; i < data.mates.length; i++) {
    if (data.mates[i].id === id) {
      if (Object.prototype.hasOwnProperty.call(updates, "workspaceColor")) {
        if (data.mates[i].primary || data.mates[i].builtinKey === "clay") delete updates.workspaceColor;
        else if (!workspaceColor.valid(updates.workspaceColor)) return { error: "Choose a supported workspace color." };
      }
      // Primary mates: protect name and core identity fields
      if (data.mates[i].primary) {
        delete updates.name;
        delete updates.bio;
        delete updates.primary;
        delete updates.globalSearch;
        delete updates.templateVersion;
        if (updates.profile) {
          delete updates.profile.displayName;
        }
      }
      // Locked built-in artwork is server-managed. Preserve it even when a
      // stale or crafted client submits a replacement profile object.
      if (data.mates[i].profile && data.mates[i].profile.avatarLocked && updates.profile) {
        updates.profile.avatarStyle = data.mates[i].profile.avatarStyle;
        updates.profile.avatarSeed = data.mates[i].profile.avatarSeed;
        updates.profile.avatarColor = data.mates[i].profile.avatarColor;
        updates.profile.avatarCustom = data.mates[i].profile.avatarCustom;
        updates.profile.avatarLocked = true;
      }
      var keys = Object.keys(updates);
      for (var j = 0; j < keys.length; j++) {
        data.mates[i][keys[j]] = updates[keys[j]];
      }
      saveMates(ctx, data);
      return data.mates[i];
    }
  }
  return null;
}

function deleteMate(ctx, id) {
  var data = loadMates(ctx);
  // Primary mates cannot be deleted (they are system infrastructure)
  for (var di = 0; di < data.mates.length; di++) {
    if (data.mates[di].id === id && data.mates[di].primary) {
      return { error: "Primary mates cannot be deleted. They are managed by the system." };
    }
  }
  var before = data.mates.length;
  data.mates = data.mates.filter(function (m) {
    return m.id !== id;
  });
  if (data.mates.length === before) return { error: "Mate not found" };
  saveMates(ctx, data);

  // Remove mate directory
  var mateDir = getMateDir(ctx, id);
  try {
    fs.rmSync(mateDir, { recursive: true, force: true });
  } catch (e) {
    // Directory may not exist
  }

  return { ok: true };
}

function getAllMates(ctx) {
  var data = loadMates(ctx);
  return data.mates;
}

function isMate(ctx, id) {
  if (!id) return false;
  if (typeof id === "string" && id.indexOf("mate_") === 0) {
    // Double check it exists in registry
    return !!getMate(ctx, id);
  }
  return false;
}

function getMateDir(ctx, id) {
  return path.join(resolveMatesRoot(ctx), id);
}

// --- Migration ---

function migrateLegacyMates() {
  var legacyFile = path.join(config.CONFIG_DIR, "mates.json");
  if (!fs.existsSync(legacyFile)) return;

  // Check if already migrated
  var migratedMarker = legacyFile + ".migrated";
  if (fs.existsSync(migratedMarker)) return;

  try {
    var raw = fs.readFileSync(legacyFile, "utf8");
    var data = JSON.parse(raw);
    if (!data.mates || data.mates.length === 0) {
      // Nothing to migrate, just mark as done
      fs.renameSync(legacyFile, migratedMarker);
      return;
    }

    // Group mates by createdBy
    var byUser = {};
    for (var i = 0; i < data.mates.length; i++) {
      var m = data.mates[i];
      var key = m.createdBy || "__null__";
      if (!byUser[key]) byUser[key] = [];
      byUser[key].push(m);
    }

    // Write each user's mates to their own storage path
    var keys = Object.keys(byUser);
    for (var k = 0; k < keys.length; k++) {
      var userId = keys[k] === "__null__" ? null : keys[k];
      var ctx = buildMateCtx(userId);
      var userData = { mates: byUser[keys[k]] };
      saveMates(ctx, userData);

      // Move mate identity directories to new location
      var legacyMatesDir = path.join(config.CONFIG_DIR, "mates");
      var newRoot = resolveMatesRoot(ctx);
      for (var mi = 0; mi < byUser[keys[k]].length; mi++) {
        var mateId = byUser[keys[k]][mi].id;
        var oldDir = path.join(legacyMatesDir, mateId);
        var newDir = path.join(newRoot, mateId);
        if (fs.existsSync(oldDir) && oldDir !== newDir) {
          fs.mkdirSync(path.dirname(newDir), { recursive: true });
          try {
            fs.renameSync(oldDir, newDir);
          } catch (e) {
            // Cross-device or other issue, copy instead
            fs.cpSync(oldDir, newDir, { recursive: true });
            fs.rmSync(oldDir, { recursive: true, force: true });
          }
        }
      }
    }

    // Mark legacy file as migrated
    fs.renameSync(legacyFile, migratedMarker);
    console.log("[mates] Migrated legacy mates.json to per-user storage");
  } catch (e) {
    console.error("[mates] Legacy migration failed:", e.message);
  }
}

/**
 * Strip all system sections from CLAUDE.md content, returning only identity.
 */
function stripAllSystemSections(content) {
  return extractIdentity(content);
}

// Tracks paths we've already warned about missing identity (avoids log spam)
var _warnedPaths = {};

/**
 * Atomic enforce: read CLAUDE.md once, enforce all system sections, write once.
 * Includes identity backup, validation, and change tracking.
 * Returns true if the file was modified, false if already correct.
 * @param {string} filePath - path to CLAUDE.md
 * @param {object} opts - optional { ctx, mateId } for dynamic team section
 */
function enforceAllSections(filePath, opts) {
  if (!fs.existsSync(filePath)) return false;
  opts = opts || {};

  var content = fs.readFileSync(filePath, "utf8");
  var mateDir = path.dirname(filePath);

  // 1. Extract current identity (everything before system markers)
  var identity = extractIdentity(content);
  var identityMissing = !identity || identity.length < IDENTITY_MIN_LENGTH;

  // 2. If identity is empty or suspiciously short, try to restore from backup
  if (identityMissing) {
    var backup = loadIdentityBackup(mateDir);
    if (backup) {
      console.log("[mates] Restoring identity from backup: " + filePath + " (" + backup.length + " chars)");
      identity = backup;
      logIdentityChange(mateDir, "restore_from_backup", identity, "");
      identityMissing = false;
    }
  }

  // 3. Backup identity if it's substantive
  backupIdentity(mateDir, identity);

  // 4. Rebuild the full file: identity + all system sections in order
  //    Use dynamic team section when ctx is available, static fallback otherwise
  var teamSection = (opts.ctx && opts.mateId) ? buildTeamSection(opts.ctx, opts.mateId, loadMates) : TEAM_SECTION;

  // Primary mate capabilities (dynamically injected from code)
  var capSection = "";
  if (opts.ctx && opts.mateId) {
    try {
      var mate = getMate(opts.ctx, opts.mateId);
      capSection = buildPrimaryCapabilitiesSection(mate);
    } catch (e) {}
  }

  // Project registry (dynamically injected when project list is available)
  var projSection = "";
  if (opts.projects) {
    projSection = buildProjectRegistrySection(opts.projects);
  }

  var rebuilt = (identity || "").trimEnd();
  rebuilt += teamSection;
  rebuilt += projSection;
  rebuilt += capSection;
  rebuilt += SESSION_MEMORY_SECTION;
  rebuilt += STICKY_NOTES_SECTION;
  rebuilt += DEBATE_AWARENESS_SECTION;
  rebuilt += crisisSafety.getSection();

  // 5. Only write if content actually changed
  if (rebuilt === content) return false;

  // 6. Warn about missing identity only once per path, and only when actually writing
  if (identityMissing && !_warnedPaths[filePath]) {
    _warnedPaths[filePath] = true;
    console.log("[mates] WARNING: Identity missing in " + filePath + " and no backup available");
  }

  // 7. Track identity changes (compare stripped versions)
  var prevIdentity = stripAllSystemSections(content);
  if (identity !== prevIdentity) {
    logIdentityChange(mateDir, "enforce", identity, prevIdentity);
  }

  fs.writeFileSync(filePath, rebuilt, "utf8");
  return true;
}

// Format seed data as a human-readable context string
function formatSeedContext(seedData) {
  if (!seedData) return "";
  var parts = [];

  if (seedData.relationship) {
    parts.push("The user wants a " + seedData.relationship + " relationship.");
  }

  if (seedData.activity && seedData.activity.length > 0) {
    parts.push("Primary activities: " + seedData.activity.join(", ") + ".");
  }

  if (seedData.communicationStyle && seedData.communicationStyle.length > 0) {
    var styleLabels = {
      direct_concise: "direct and concise",
      soft_detailed: "soft and detailed",
      witty: "witty",
      encouraging: "encouraging",
      formal: "formal",
      no_nonsense: "no-nonsense",
    };
    var styles = seedData.communicationStyle.map(function (s) { return styleLabels[s] || s.replace(/_/g, " "); });
    parts.push("Communication style: " + styles.join(", ") + ".");
  }

  if (seedData.autonomy) {
    var autonomyLabels = {
      always_ask: "Always ask before acting",
      minor_stuff_ok: "Handle minor stuff without asking",
      mostly_autonomous: "Mostly autonomous, ask for big decisions",
      fully_autonomous: "Fully autonomous",
    };
    parts.push("Autonomy: " + (autonomyLabels[seedData.autonomy] || seedData.autonomy) + ".");
  }

  return parts.join(" ");
}

// --- Built-in mates ---

function createBuiltinMate(ctx, builtinKey) {
  var builtinMates = require("./builtin-mates");
  var def = builtinMates.getBuiltinByKey(builtinKey);
  if (!def) throw new Error("Unknown built-in mate key: " + builtinKey);

  var data = loadMates(ctx);
  var id = generateMateId();
  var userId = ctx ? ctx.userId : null;

  var mate = {
    id: id,
    builtinKey: builtinKey,
    name: def.displayName,
    createdBy: userId,
    createdAt: Date.now(),
    seedData: def.seedData,
    profile: {
      displayName: def.displayName,
      avatarColor: def.avatarColor,
      avatarStyle: def.avatarStyle,
      avatarSeed: def.avatarCustom ? crypto.randomBytes(4).toString("hex") : def.displayName,
      avatarCustom: def.avatarCustom || "",
      avatarLocked: !!def.avatarLocked,
    },
    bio: def.bio,
    status: "ready",
    primary: !!def.primary,
    globalSearch: !!def.globalSearch,
    templateVersion: def.templateVersion || 0,
    interviewProjectPath: null,
  };

  data.mates.push(mate);
  saveMates(ctx, data);

  // Create the mate's identity directory
  var mateDir = getMateDir(ctx, id);
  fs.mkdirSync(mateDir, { recursive: true });

  // Create knowledge directory
  fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });

  // Write mate.yaml
  var seedData = def.seedData;
  var yaml = "# Mate metadata\n";
  yaml += "id: " + id + "\n";
  yaml += "name: " + def.displayName + "\n";
  yaml += "status: ready\n";
  yaml += "builtinKey: " + builtinKey + "\n";
  yaml += "createdBy: " + userId + "\n";
  yaml += "createdAt: " + mate.createdAt + "\n";
  yaml += "relationship: " + (seedData.relationship || "assistant") + "\n";
  yaml += "activities: " + JSON.stringify(seedData.activity || []) + "\n";
  yaml += "autonomy: " + (seedData.autonomy || "always_ask") + "\n";
  fs.writeFileSync(path.join(mateDir, "mate.yaml"), yaml);

  // Write CLAUDE.md with full template + system sections
  var claudeMd = def.getClaudeMd();
  var builtinIdentity = claudeMd.trimEnd();
  claudeMd += TEAM_SECTION;
  claudeMd += SESSION_MEMORY_SECTION;
  claudeMd += STICKY_NOTES_SECTION;
  claudeMd += DEBATE_AWARENESS_SECTION;
  claudeMd += crisisSafety.getSection();
  fs.writeFileSync(path.join(mateDir, "CLAUDE.md"), claudeMd);

  // Backup identity and log creation
  backupIdentity(mateDir, builtinIdentity);
  logIdentityChange(mateDir, "create_builtin", builtinIdentity, "");

  // Save base template for primary mates (used for 3-way sync comparison)
  if (def.primary) {
    try {
      fs.writeFileSync(path.join(mateDir, "knowledge", "base-template.md"), builtinIdentity, "utf8");
    } catch (e) {}
  }

  return mate;
}

function getInstalledBuiltinKeys(ctx) {
  var data = loadMates(ctx);
  var keys = [];
  for (var i = 0; i < data.mates.length; i++) {
    if (data.mates[i].builtinKey) {
      keys.push(data.mates[i].builtinKey);
    }
  }
  return keys;
}

function getMissingBuiltinKeys(ctx) {
  var builtinMates = require("./builtin-mates");
  var allKeys = builtinMates.getBuiltinKeys();
  var installed = getInstalledBuiltinKeys(ctx);
  var missing = [];
  for (var i = 0; i < allKeys.length; i++) {
    if (installed.indexOf(allKeys[i]) === -1) {
      missing.push(allKeys[i]);
    }
  }
  return missing;
}

function ensureBuiltinMates(ctx, deletedKeys) {
  var missing = getMissingBuiltinKeys(ctx);
  var excluded = deletedKeys || [];
  var created = [];
  for (var i = 0; i < missing.length; i++) {
    if (excluded.indexOf(missing[i]) === -1) {
      created.push(createBuiltinMate(ctx, missing[i]));
    }
  }
  // Demote any archived built-ins that the user already has installed:
  // strip primary/globalSearch flags and set archived=true on the mate
  // object so the active-list filter hides them. Conversation history is
  // untouched. This runs every startup so the transition lands even on
  // users who logged in once when Ally was primary.
  syncArchivedBuiltinMates(ctx);
  return created;
}

function syncArchivedBuiltinMates(ctx) {
  var builtinMates = require("./builtin-mates");
  var archivedKeys = builtinMates.getArchivedBuiltinKeys();
  if (archivedKeys.length === 0) return;
  var data = loadMates(ctx);
  var changed = false;
  for (var i = 0; i < data.mates.length; i++) {
    var m = data.mates[i];
    if (!m.builtinKey) continue;
    if (archivedKeys.indexOf(m.builtinKey) === -1) continue;
    if (!m.archived) { m.archived = true; changed = true; }
    if (m.primary) { m.primary = false; changed = true; }
    if (m.globalSearch) { m.globalSearch = false; changed = true; }
  }
  if (changed) saveMates(ctx, data);
}

/**
 * Sync primary mates with their latest code definition.
 *
 * Primary mates (def.primary === true) are system infrastructure, not just
 * pre-made mates. They are the only mates whose identity, metadata, and
 * capabilities are managed by code rather than by the user.
 *
 * What gets synced:
 * - Metadata: bio, name, profile, globalSearch, primary flag
 * - CLAUDE.md identity: re-applied when templateVersion changes
 * - templateVersion is stored on the mate object to track updates
 *
 * What is NOT synced (regular builtin mates):
 * - Arch, Rush, Ward, Pixel, Buzz are left as-is after creation
 *
 * Returns array of synced mate IDs.
 */
function syncPrimaryMates(ctx) {
  var builtinMates = require("./builtin-mates");
  var primaryDefs = builtinMates.getPrimaryMates();
  if (primaryDefs.length === 0) return [];

  var data = loadMates(ctx);
  var synced = [];

  for (var pi = 0; pi < primaryDefs.length; pi++) {
    var def = primaryDefs[pi];

    // Find the installed mate matching this primary definition
    var mate = null;
    for (var mi = 0; mi < data.mates.length; mi++) {
      if (data.mates[mi].builtinKey === def.key) { mate = data.mates[mi]; break; }
    }
    if (!mate) continue; // not installed yet (ensureBuiltinMates handles creation)

    var changed = false;

    // --- Sync metadata (always, every startup) ---
    if (mate.bio !== def.bio) { mate.bio = def.bio; changed = true; }
    if (mate.name !== def.displayName) { mate.name = def.displayName; changed = true; }
    if (!mate.primary) { mate.primary = true; changed = true; }
    if (!mate.globalSearch && def.globalSearch) { mate.globalSearch = true; changed = true; }
    if (mate.profile) {
      if (mate.profile.displayName !== def.displayName) {
        mate.profile.displayName = def.displayName; changed = true;
      }
      // Locked avatars are code-managed — refresh them from the def so a
      // built-in's avatar can be updated by changing the source file
      // (e.g. Clay flipping from a stale Ally asset to the app icon).
      if (def.avatarLocked) {
        if (def.avatarCustom != null && mate.profile.avatarCustom !== def.avatarCustom) {
          mate.profile.avatarCustom = def.avatarCustom; changed = true;
        }
        if (def.avatarColor && mate.profile.avatarColor !== def.avatarColor) {
          mate.profile.avatarColor = def.avatarColor; changed = true;
        }
      }
    }

    // --- Sync CLAUDE.md identity (only when templateVersion changes) ---
    // Uses 3-way comparison to preserve user/Ally modifications:
    // - base-template.md = the template that was last synced (what code wrote)
    // - current identity = what's in CLAUDE.md now (may have been modified)
    // - new template = latest code definition
    //
    // If current identity === old base → user didn't touch it → safe to replace
    // If current identity !== old base → user/Ally modified it → preserve, skip identity sync
    var currentVersion = mate.templateVersion || 0;
    var latestVersion = def.templateVersion || 0;

    if (latestVersion > currentVersion) {
      var mateDir = getMateDir(ctx, mate.id);
      var claudePath = path.join(mateDir, "CLAUDE.md");
      var basePath = path.join(mateDir, "knowledge", "base-template.md");
      var latestIdentity = def.getClaudeMd().trimEnd();

      try {
        var currentIdentity = "";
        if (fs.existsSync(claudePath)) {
          currentIdentity = extractIdentity(fs.readFileSync(claudePath, "utf8"));
        }

        // Load the base template from last sync
        var oldBase = "";
        try { oldBase = fs.readFileSync(basePath, "utf8").trimEnd(); } catch (e) {}

        var shouldUpdateIdentity = false;
        if (!currentIdentity || currentIdentity.length < IDENTITY_MIN_LENGTH) {
          // No identity at all, always apply
          shouldUpdateIdentity = true;
        } else if (!oldBase || currentIdentity === oldBase) {
          // Identity unchanged from last sync (user didn't modify) → safe to update
          shouldUpdateIdentity = true;
        } else {
          // User/Ally modified the identity since last sync → preserve their changes
          console.log("[mates] Primary mate " + mate.name + ": identity modified by user/Ally, preserving (v" + currentVersion + " -> v" + latestVersion + " metadata only)");
        }

        if (shouldUpdateIdentity) {
          // Write just the identity, then let enforceAllSections rebuild system sections
          // (including dynamic capabilities section)
          fs.writeFileSync(claudePath, latestIdentity, "utf8");
          backupIdentity(mateDir, latestIdentity);
          logIdentityChange(mateDir, "sync_primary_v" + latestVersion, latestIdentity, currentIdentity);
          console.log("[mates] Primary mate identity updated: " + mate.name + " (v" + currentVersion + " -> v" + latestVersion + ")");
        } else {
          console.log("[mates] Primary mate metadata updated: " + mate.name + " (v" + currentVersion + " -> v" + latestVersion + ", identity preserved)");
        }

        // Re-run enforceAllSections to inject latest dynamic sections (capabilities, team, etc.)
        enforceAllSections(claudePath, { ctx: ctx, mateId: mate.id });

        // Save the latest template as base for future 3-way comparison
        try {
          fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });
          fs.writeFileSync(basePath, latestIdentity, "utf8");
        } catch (e) {}

      } catch (e) {
        console.error("[mates] Failed to sync primary mate " + mate.id + ":", e.message);
      }

      mate.templateVersion = latestVersion;
      changed = true;
    }

    if (changed) synced.push(mate.id);
  }

  if (synced.length > 0) saveMates(ctx, data);
  return synced;
}

module.exports = {
  resolveMatesRoot: resolveMatesRoot,
  buildMateCtx: buildMateCtx,
  isMateIdFormat: isMateIdFormat,
  loadMates: loadMates,
  saveMates: saveMates,
  createMate: createMate,
  getMate: getMate,
  updateMate: updateMate,
  deleteMate: deleteMate,
  getAllMates: getAllMates,
  isMate: isMate,
  getMateDir: getMateDir,
  migrateLegacyMates: migrateLegacyMates,
  formatSeedContext: formatSeedContext,
  enforceTeamAwareness: enforceTeamAwareness,
  TEAM_MARKER: TEAM_MARKER,
  TEAM_SECTION: TEAM_SECTION,
  enforceSessionMemory: enforceSessionMemory,
  SESSION_MEMORY_MARKER: SESSION_MEMORY_MARKER,
  SESSION_MEMORY_SECTION: SESSION_MEMORY_SECTION,
  loadCommonKnowledge: loadCommonKnowledge,
  promoteKnowledge: promoteKnowledge,
  depromoteKnowledge: depromoteKnowledge,
  getCommonKnowledgeForMate: getCommonKnowledgeForMate,
  readCommonKnowledgeFile: readCommonKnowledgeFile,
  isPromoted: isPromoted,
  enforceStickyNotes: enforceStickyNotes,
  STICKY_NOTES_MARKER: STICKY_NOTES_MARKER,
  STICKY_NOTES_SECTION: STICKY_NOTES_SECTION,
  enforceProjectRegistry: enforceProjectRegistry,
  buildProjectRegistrySection: buildProjectRegistrySection,
  PROJECT_REGISTRY_MARKER: PROJECT_REGISTRY_MARKER,
  enforceDebateAwareness: enforceDebateAwareness,
  DEBATE_AWARENESS_MARKER: DEBATE_AWARENESS_MARKER,
  DEBATE_AWARENESS_SECTION: DEBATE_AWARENESS_SECTION,
  enforceAllSections: enforceAllSections,
  buildTeamSection: buildTeamSection,
  buildPrimaryCapabilitiesSection: buildPrimaryCapabilitiesSection,
  PRIMARY_CAPABILITIES_MARKER: PRIMARY_CAPABILITIES_MARKER,
  extractIdentity: extractIdentity,
  backupIdentity: backupIdentity,
  loadIdentityBackup: loadIdentityBackup,
  logIdentityChange: logIdentityChange,
  createBuiltinMate: createBuiltinMate,
  getInstalledBuiltinKeys: getInstalledBuiltinKeys,
  getMissingBuiltinKeys: getMissingBuiltinKeys,
  ensureBuiltinMates: ensureBuiltinMates,
  syncArchivedBuiltinMates: syncArchivedBuiltinMates,
  syncPrimaryMates: syncPrimaryMates,
};
