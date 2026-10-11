function attachPreferences(deps) {
  var loadUsers = deps.loadUsers;
  var saveUsers = deps.saveUsers;
  var configModule = deps.config || require("./config");

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

  // --- Deleted built-in mate keys tracking ---
  //
  // In single-user mode there is no users.json, so the user row lookup
  // below returns nothing and the key is silently dropped. That made
  // "Remove mate" in the sidebar picker a no-op: the key was never
  // persisted, ensureBuiltinMates re-created the mate on next mate_list,
  // and the user could not actually get rid of built-in mates.
  //
  // Fallback: when the user record isn't found (single-user mode), read
  // and write deletedBuiltinKeys on daemon.json via lib/config.js. This
  // preserves multi-user behavior (users.json row still wins) while
  // giving single-user deploys a place to persist the setting.

  function loadSingleUserDeletedKeys() {
    try {
      var config = require("./config");
      var cfg = config.loadConfig() || {};
      return Array.isArray(cfg.deletedBuiltinKeys) ? cfg.deletedBuiltinKeys : [];
    } catch (e) {
      return [];
    }
  }

  function saveSingleUserDeletedKeys(keys) {
    try {
      var config = require("./config");
      var cfg = config.loadConfig() || {};
      cfg.deletedBuiltinKeys = keys;
      config.saveConfig(cfg);
    } catch (e) {}
  }

  function getDeletedBuiltinKeys(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].deletedBuiltinKeys || [];
      }
    }
    return loadSingleUserDeletedKeys();
  }

  function addDeletedBuiltinKey(userId, key) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].deletedBuiltinKeys) data.users[i].deletedBuiltinKeys = [];
        if (data.users[i].deletedBuiltinKeys.indexOf(key) === -1) {
          data.users[i].deletedBuiltinKeys.push(key);
          saveUsers(data);
        }
        return;
      }
    }
    // Single-user fallback
    var keys = loadSingleUserDeletedKeys();
    if (keys.indexOf(key) === -1) {
      keys.push(key);
      saveSingleUserDeletedKeys(keys);
    }
  }

  function removeDeletedBuiltinKey(userId, key) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].deletedBuiltinKeys) return;
        data.users[i].deletedBuiltinKeys = data.users[i].deletedBuiltinKeys.filter(function (k) {
          return k !== key;
        });
        saveUsers(data);
        return;
      }
    }
    // Single-user fallback
    var keys = loadSingleUserDeletedKeys();
    var filtered = keys.filter(function (k) { return k !== key; });
    if (filtered.length !== keys.length) {
      saveSingleUserDeletedKeys(filtered);
    }
  }

  // --- Per-user chat layout setting ---

  function getChatLayout(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].chatLayout || "channel";
      }
    }
    return "channel";
  }

  function setChatLayout(userId, layout) {
    var val = (layout === "bubble") ? "bubble" : "channel";
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].chatLayout = val;
        saveUsers(data);
        return { ok: true, chatLayout: val };
      }
    }
    return { error: "User not found" };
  }

  // --- Per-user auto-continue setting ---

  function getAutoContinue(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return !!data.users[i].autoContinueOnRateLimit;
      }
    }
    return false;
  }

  function setAutoContinue(userId, enabled) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].autoContinueOnRateLimit = !!enabled;
        saveUsers(data);
        return { ok: true, autoContinueOnRateLimit: !!enabled };
      }
    }
    return { error: "User not found" };
  }

  // --- Per-user cursor sharing preference ---

  function getCursorSharing(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) return data.users[i].cursorSharing !== false;
    }
    if (userId === "default") {
      var current = configModule.loadConfig() || {};
      return current.cursorSharing !== false;
    }
    return true;
  }

  function setCursorSharing(userId, enabled) {
    if (typeof enabled !== "boolean") return { error: "enabled must be a boolean" };
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].cursorSharing = enabled;
        saveUsers(data);
        return { ok: true, cursorSharing: enabled };
      }
    }
    if (userId === "default") {
      var current = configModule.loadConfig() || {};
      configModule.saveConfig(Object.assign({}, current, { cursorSharing: enabled }));
      return { ok: true, cursorSharing: enabled };
    }
    return { error: "User not found" };
  }

  // --- Per-user extra auto-approve patterns ---
  //
  // Strings appended to Clay's managed CLAY_MANAGED_ALLOW list when
  // generating ~/.claude/settings.json permissions.allow. User-authored
  // patterns survive Clay reinstalls because the installer only strips
  // entries that match CLAY_MANAGED_ALLOW exactly. Format is Claude Code's
  // own (e.g. "Bash(npm test:*)", "Read", "mcp__foo__bar").

  function getClaudeUserAllowList(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        var v = data.users[i].claudeUserAllowList;
        return Array.isArray(v) ? v : [];
      }
    }
    return [];
  }

  function setClaudeUserAllowList(userId, patterns) {
    if (!Array.isArray(patterns)) return { error: "patterns must be an array" };
    // Normalize: trim, dedupe, drop empties. Each pattern is opaque to us;
    // we don't validate the contents because Claude Code's matcher syntax
    // may evolve and we'd rather pass user input through than silently
    // reject a valid pattern.
    var seen = {};
    var clean = [];
    for (var i = 0; i < patterns.length; i++) {
      var p = String(patterns[i] || "").trim();
      if (!p) continue;
      if (seen[p]) continue;
      seen[p] = true;
      clean.push(p);
    }
    var data = loadUsers();
    for (var j = 0; j < data.users.length; j++) {
      if (data.users[j].id === userId) {
        data.users[j].claudeUserAllowList = clean;
        saveUsers(data);
        return { ok: true, claudeUserAllowList: clean };
      }
    }
    return { error: "User not found" };
  }

  // --- Per-user project Mate DM shortcut toggle ---
  //
  // `matesEnabled` is retained as the persisted field for compatibility.
  // It now controls only project-local Mate DM shortcuts. The broader Mate
  // capability surface is always available. Default remains off.

  function getMatesEnabled(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].matesEnabled === true;
      }
    }
    return false;
  }

  function setMatesEnabled(userId, enabled) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].matesEnabled = !!enabled;
        saveUsers(data);
        return { ok: true, matesEnabled: !!enabled };
      }
    }
    return { error: "User not found" };
  }

  // --- Per-user tool palette preferences ---
  //
  // Each user can customize the sidebar tool grid by reordering or
  // hiding individual tools. Stored as an object keyed by palette name
  // ("session" or "mate"), each holding { order: [...ids], hidden: [...ids] }.
  // Missing ids are treated as "use registry default at the end", so new
  // tools added in future releases show up for existing users without a
  // migration.

  var VALID_PALETTES = { session: true, mate: true };

  function getToolPalettes(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        return data.users[i].toolPalettes || {};
      }
    }
    return {};
  }

  function setToolPalette(userId, paletteName, order, hidden) {
    if (!VALID_PALETTES[paletteName]) {
      return { error: "Unknown palette" };
    }
    var safeOrder = Array.isArray(order)
      ? order.filter(function (s) { return typeof s === "string"; })
      : [];
    var safeHidden = Array.isArray(hidden)
      ? hidden.filter(function (s) { return typeof s === "string"; })
      : [];
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        if (!data.users[i].toolPalettes) data.users[i].toolPalettes = {};
        data.users[i].toolPalettes[paletteName] = {
          order: safeOrder,
          hidden: safeHidden,
        };
        saveUsers(data);
        return { ok: true, palette: paletteName, order: safeOrder, hidden: safeHidden };
      }
    }
    return { error: "User not found" };
  }

  // --- Terminal font preferences ---
  //
  // Per-user font family + size for every xterm in Clay (bottom panel
  // shell, Claude TUI session view, TUI attention modal). Stored as a
  // single object so the two values stay together.

  var DEFAULT_TERM_FONT_FAMILY = "'SF Mono', Menlo, Monaco, 'Courier New', monospace";
  var DEFAULT_TERM_FONT_SIZE = 14;
  var MIN_TERM_FONT_SIZE = 9;
  var MAX_TERM_FONT_SIZE = 32;

  function getTerminalFont(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        var tf = data.users[i].terminalFont || {};
        return {
          family: (typeof tf.family === "string" && tf.family.trim()) ? tf.family : DEFAULT_TERM_FONT_FAMILY,
          size: (typeof tf.size === "number" && tf.size >= MIN_TERM_FONT_SIZE && tf.size <= MAX_TERM_FONT_SIZE) ? tf.size : DEFAULT_TERM_FONT_SIZE,
        };
      }
    }
    return { family: DEFAULT_TERM_FONT_FAMILY, size: DEFAULT_TERM_FONT_SIZE };
  }

  function setTerminalFont(userId, family, size) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        var current = data.users[i].terminalFont || {};
        var nextFamily = (typeof family === "string" && family.trim()) ? family.trim().slice(0, 200) : current.family;
        var nextSize = current.size;
        if (typeof size === "number" && size >= MIN_TERM_FONT_SIZE && size <= MAX_TERM_FONT_SIZE) {
          nextSize = Math.round(size);
        }
        data.users[i].terminalFont = { family: nextFamily, size: nextSize };
        saveUsers(data);
        return { ok: true, terminalFont: data.users[i].terminalFont };
      }
    }
    return { error: "User not found" };
  }

  // --- Mate onboarding ---

  function setMateOnboarded(userId) {
    var data = loadUsers();
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === userId) {
        data.users[i].mateOnboardingShown = true;
        saveUsers(data);
        return { ok: true };
      }
    }
    return { error: "User not found" };
  }

  return {
    getDmFavorites: getDmFavorites,
    addDmFavorite: addDmFavorite,
    removeDmFavorite: removeDmFavorite,
    getDmHidden: getDmHidden,
    addDmHidden: addDmHidden,
    removeDmHidden: removeDmHidden,
    getDeletedBuiltinKeys: getDeletedBuiltinKeys,
    addDeletedBuiltinKey: addDeletedBuiltinKey,
    removeDeletedBuiltinKey: removeDeletedBuiltinKey,
    getChatLayout: getChatLayout,
    setChatLayout: setChatLayout,
    getAutoContinue: getAutoContinue,
    setAutoContinue: setAutoContinue,
    getCursorSharing: getCursorSharing,
    setCursorSharing: setCursorSharing,
    getClaudeUserAllowList: getClaudeUserAllowList,
    setClaudeUserAllowList: setClaudeUserAllowList,
    getMatesEnabled: getMatesEnabled,
    setMatesEnabled: setMatesEnabled,
    getToolPalettes: getToolPalettes,
    setToolPalette: setToolPalette,
    getTerminalFont: getTerminalFont,
    setTerminalFont: setTerminalFont,
    setMateOnboarded: setMateOnboarded,
  };
}

module.exports = { attachPreferences: attachPreferences };
