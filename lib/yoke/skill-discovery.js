// Cross-vendor skill discovery
// ----------------------------
// Ordinary skills stay in vendor-owned directories. Clay-specific skills use
// private roots and are attached only to Clay-owned adapter queries.

var fs = require("fs");
var os = require("os");
var path = require("path");
var clayStorage = require("../clay-skill-storage");

function defaultHomeDir() {
  try { return require("../config").REAL_HOME; } catch (e) { return os.homedir(); }
}

function optionsForOsUser(userInfo, fsAsUser) {
  if (!userInfo || typeof userInfo.home !== "string" || !userInfo.home) return { disable: true };
  var migrateAsUser = !fsAsUser || fsAsUser === require("../os-users").fsAsUser;
  fsAsUser = fsAsUser || require("../os-users").fsAsUser;
  return {
    homeDir: userInfo.home,
    scopedHome: true,
    migrationIdentity: migrateAsUser ? userInfo : null,
    readDir: function (dir) { return fsAsUser("list", { dir: dir }, userInfo).map(function (entry) { return { name: entry.name, isDir: entry.isDir }; }); },
    readFile: function (file) { return fsAsUser("read", { file: file, readContent: true }, userInfo).content; },
    realpath: function (file) { return fsAsUser("realpath", { file: file }, userInfo).path; },
  };
}

function unquote(value) {
  var text = String(value || "").trim();
  if ((text[0] === '"' && text[text.length - 1] === '"') ||
      (text[0] === "'" && text[text.length - 1] === "'")) {
    return text.slice(1, -1);
  }
  return text;
}

function readMetadata(skillPath, fallbackName, opts) {
  var content;
  try { content = opts && opts.readFile ? opts.readFile(skillPath) : fs.readFileSync(skillPath, "utf8"); } catch (e) { return null; }
  var name = fallbackName;
  var description = "";
  var version = "";
  var frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/);
  if (frontmatter) {
    var nameMatch = frontmatter[1].match(/^name:\s*(.+)$/m);
    var descriptionMatch = frontmatter[1].match(/^description:\s*(.+)$/m);
    if (nameMatch) name = unquote(nameMatch[1]) || fallbackName;
    if (descriptionMatch) description = unquote(descriptionMatch[1]);
    var versionMatch = frontmatter[1].match(/^version:\s*(.+)$/m);
    if (versionMatch) version = unquote(versionMatch[1]);
  }
  if (!description) {
    var heading = content.match(/^#\s+(.+)$/m);
    if (heading) description = heading[1].trim();
  }
  return { name: name, description: description, version: version };
}

function scanRoot(root, source, merged, opts) {
  var entries;
  try { entries = opts && opts.readDir ? opts.readDir(root) : fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return; }
  entries.sort(function(a, b) { return a.name.localeCompare(b.name); });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if ((!opts || !opts.readDir) && (entry.isDir === false || (typeof entry.isDirectory === "function" && !entry.isDirectory() && !entry.isSymbolicLink()))) continue;
    var skillPath = path.join(root, entry.name, "SKILL.md");
    var realSkillPath;
    try { realSkillPath = opts && opts.realpath ? opts.realpath(skillPath) : fs.realpathSync(skillPath); } catch (e) { continue; }
    var metadata = readMetadata(realSkillPath, entry.name, opts);
    if (!metadata) continue;
    var key = opts && opts.includeDuplicates ? source + "\0" + metadata.name : metadata.name;
    merged[key] = {
      name: metadata.name,
      path: realSkillPath,
      description: metadata.description,
      version: metadata.version,
      source: source,
    };
  }
}

function getSkillRoots(cwd, opts) {
  opts = opts || {};
  var env = opts.env || (opts.homeDir ? {} : process.env);
  if (opts.scopedHome) {
    env = Object.assign({}, env);
    delete env.CODEX_HOME;
    delete env.CLAUDE_CONFIG_DIR;
  }
  var homeDir = opts.homeDir || env.HOME || defaultHomeDir();
  var codexHome = env.CODEX_HOME ? path.resolve(homeDir, env.CODEX_HOME) : path.join(homeDir, ".codex");
  var claudeConfigDir = env.CLAUDE_CONFIG_DIR ? path.resolve(homeDir, env.CLAUDE_CONFIG_DIR) : path.join(homeDir, ".claude");
  var roots = [
    { path: path.join(__dirname, "../bundled-skills"), source: "clay-builtin" },
    { path: path.join(homeDir, ".agents", "skills"), source: "agents-user" },
    { path: path.join(codexHome, "skills"), source: "codex-user" },
    { path: path.join(codexHome, "skills", ".system"), source: "codex-system-user" },
    { path: path.join(claudeConfigDir, "skills"), source: "claude-user" },
  ];
  if (cwd) {
    roots.push({ path: path.join(cwd, "skills"), source: "project" });
    roots.push({ path: path.join(cwd, ".agents", "skills"), source: "agents-project" });
    roots.push({ path: path.join(cwd, ".codex", "skills"), source: "codex-project" });
    roots.push({ path: path.join(cwd, ".codex", "skills", ".system"), source: "codex-system-project" });
    roots.push({ path: path.join(cwd, ".claude", "skills"), source: "claude-project" });
  }
  roots.push({ path: clayStorage.privateRoot(homeDir), source: "clay-user" });
  if (cwd) roots.push({ path: clayStorage.privateRoot(cwd), source: "clay-project" });
  return roots;
}

function discoverSkills(cwd, opts) {
  if (opts && opts.disable) return [];
  var merged = {};
  var roots = getSkillRoots(cwd, opts);
  var home = path.dirname(path.dirname(roots.find(function (root) { return root.source === "clay-user"; }).path));
  var legacy = roots.filter(function (root) { return !/^clay-/.test(root.source); }).map(function (root) {
    return { path: root.path, base: root.source === "project" || /-project$/.test(root.source) ? cwd : home };
  });
  // Run filesystem migration as the same OS owner used for skill discovery.
  if (!opts || !opts.readDir || opts.migrationIdentity) {
    try {
      if (opts && opts.migrationIdentity) {
        var identity = opts.migrationIdentity;
        var job = require("../os-users").wrapSpawnAsUser(process.execPath, [require.resolve("../clay-skill-storage"), JSON.stringify(legacy)], { uid: identity.uid, gid: identity.gid, timeout: 10000 });
        require("child_process").execFileSync(job.command, job.args, job.options);
      } else clayStorage.migrate(legacy);
    } catch (error) { console.error("[skills] Clay-only skill migration failed: " + error.message); }
  }
  for (var i = 0; i < roots.length; i++) scanRoot(roots[i].path, roots[i].source, merged, opts);
  // Per-session exclusions (Personal Agent behavior). Only names a caller lists
  // are removed; nothing is excluded by default.
  var excluded = opts && Array.isArray(opts.excludeSkills) ? opts.excludeSkills : [];
  return Object.keys(merged).sort().filter(function(name) { return excluded.indexOf(name) === -1; }).map(function(name) { return merged[name]; });
}

function indexSkills(skills) {
  var indexed = {};
  for (var i = 0; i < skills.length; i++) indexed[skills[i].name] = skills[i];
  return indexed;
}

function findSkillReferences(text, skills) {
  if (typeof text !== "string") return [];
  var indexed = Array.isArray(skills) ? indexSkills(skills) : skills;
  var found = [];
  var seen = {};
  var match;
  var pattern = /\$([a-zA-Z0-9_-]+)/g;
  while ((match = pattern.exec(text)) !== null) {
    var skill = indexed[match[1]];
    if (!skill || seen[skill.name]) continue;
    seen[skill.name] = true;
    found.push(skill);
  }
  return found;
}

function buildSkillIndex(skills) {
  if (!skills.length) return "";
  var lines = [
    "Available shared skills. When a task matches a description, read that SKILL.md with your file tools before proceeding. A user may also invoke one with $skill-name:",
  ];
  for (var i = 0; i < skills.length; i++) {
    var suffix = skills[i].description ? " — " + skills[i].description.replace(/\s+/g, " ") : "";
    lines.push("- $" + skills[i].name + suffix + " — " + skills[i].path);
  }
  return lines.join("\n");
}

function readReferencedSkills(text, skills, maxChars, readOpts) {
  var references = findSkillReferences(text, skills);
  var remaining = maxChars || 32768;
  var blocks = [];
  for (var i = 0; i < references.length && remaining > 0; i++) {
    var content;
    try { content = readOpts && readOpts.readFile ? readOpts.readFile(references[i].path) : fs.readFileSync(references[i].path, "utf8"); } catch (e) { continue; }
    var header = "<shared-skill name=\"" + references[i].name + "\" source=\"" + references[i].source + "\">\n";
    var footer = "\n</shared-skill>";
    var available = Math.max(0, remaining - header.length - footer.length);
    if (!available) break;
    if (content.length > available) {
      var marker = "\n[Skill truncated by Clay]";
      content = content.slice(0, Math.max(0, available - marker.length)) + marker.slice(0, available);
    }
    var block = header + content + footer;
    blocks.push(block);
    remaining -= block.length;
  }
  return blocks.join("\n\n");
}

function lstatOrNull(target) {
  try { return fs.lstatSync(target); } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function openBridgeDirectory(dir, scope) {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (!scope) {
    if (!fs.lstatSync(dir).isDirectory()) throw new Error("Expected a skill bridge directory");
    return { path: dir };
  }
  var fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  scope.fds.push(fd);
  var uid = fs.fstatSync(fd).uid;
  if (uid !== process.getuid() && uid !== scope.readerUid) throw new Error("Unexpected skill bridge directory owner");
  // Keep each parent pinned while writing inside the mapped user's home.
  return { path: "/proc/self/fd/" + fd, fd: fd };
}

function bridgeManifest(dir, content, legacy, scope) {
  var file = path.join(dir, "plugin.json");
  var noFollow = fs.constants.O_NOFOLLOW || 0;
  var fd;
  try {
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  var created = fd !== undefined;
  if (!created && !scope && !fs.lstatSync(file).isFile()) return null;
  if (!created) fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | fs.constants.O_NONBLOCK);
  if (scope) scope.fds.push(fd);
  try {
    if (created) {
      fs.writeFileSync(fd, content);
    } else {
      var stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) return null;
      var buffer = Buffer.alloc(Math.max(Buffer.byteLength(content), Buffer.byteLength(legacy || "")) + 1);
      var count = fs.readSync(fd, buffer, 0, buffer.length, 0);
      var existing = buffer.toString("utf8", 0, count);
      if (existing !== content && existing !== legacy) return null;
    }
    return { fd: fd };
  } finally {
    if (!scope) fs.closeSync(fd);
  }
}

function grantBridgeRead(dir, uid, permissions) {
  var stat = fs.fstatSync(dir.fd);
  if (stat.uid === uid) return;
  if (stat.uid !== process.getuid()) throw new Error("Unexpected skill bridge owner");
  var execFileSync = require("child_process").execFileSync;
  var options = { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe", dir.fd] };
  var aclPath = "/proc/self/fd/3";
  var acl = execFileSync("getfacl", ["-acne", "--", aclPath], options);
  var entry = "user:" + uid + ":";
  var current = "---";
  var changes = acl.trim().split("\n").flatMap(function (line) {
    var parts = line.trim().split(/\s+#effective:/);
    if (parts[0].startsWith(entry)) {
      current = parts[1] || parts[0].slice(entry.length);
      return [];
    }
    // Keep the effective permissions of existing ACL entries when the mask grows.
    if (!parts[1] || parts[0].endsWith(":" + parts[1]) || !/^(group:|user:[^:]+:)/.test(parts[0])) return [];
    return [parts[0].slice(0, -3) + parts[1]];
  });
  var wanted = Array.from("rwx", function (bit, index) {
    return current[index] === bit || permissions[index] === bit ? bit : "-";
  }).join("");
  if (wanted === current) return;
  changes.push(entry + wanted);
  execFileSync("setfacl", ["-m", changes.join(","), "--", aclPath], options);
}

function withSkillBridge(homeDir, bridgeName, readerUid, create) {
  if (!/^[a-z0-9_-]+$/i.test(bridgeName)) return null;
  var mapped = process.platform === "linux" && Number.isSafeInteger(readerUid) && readerUid > 0 && readerUid !== process.getuid();
  var scope = mapped ? { readerUid: readerUid, fds: [] } : null;
  var pluginPath = path.join(homeDir, ".clay", "skill-bridge", bridgeName);
  try {
    if (!mapped) fs.mkdirSync(homeDir, { recursive: true });
    var home = mapped ? openBridgeDirectory(fs.realpathSync(homeDir), scope) : { path: homeDir };
    var clay = openBridgeDirectory(path.join(home.path, ".clay"), scope);
    var root = openBridgeDirectory(path.join(clay.path, "skill-bridge"), scope);
    var plugin = openBridgeDirectory(path.join(root.path, bridgeName), scope);
    var metadata = openBridgeDirectory(path.join(plugin.path, ".claude-plugin"), scope);
    var result = create(plugin.path, metadata.path, scope);
    if (!result) return null;
    if (mapped) {
      grantBridgeRead(result.manifest, readerUid, "r--");
      if (result.skills) grantBridgeRead(result.skills, readerUid, "r-x");
      grantBridgeRead(metadata, readerUid, "r-x");
      grantBridgeRead(plugin, readerUid, "r-x");
      grantBridgeRead(root, readerUid, "--x");
      grantBridgeRead(clay, readerUid, "--x");
    }
    return pluginPath;
  } catch (error) {
    if (error.code !== "ENOENT") console.error("[yoke/skills] Failed to prepare Claude skill bridge:", error.message);
    return null;
  } finally {
    if (scope) scope.fds.reverse().forEach(function (fd) { fs.closeSync(fd); });
  }
}

function ensureClaudeCodexPlugin(opts) {
  opts = opts || {};
  var homeDir = opts.homeDir || defaultHomeDir();
  var source = opts.source || path.join(homeDir, ".codex", "skills");
  var bridgeName = opts.name || "codex";
  try {
    if (!fs.statSync(source).isDirectory()) return null;
  } catch (e) { return null; }

  var manifest = JSON.stringify({ name: bridgeName, version: "1.0.0", description: "Shared skills provided by Clay" }, null, 2) + "\n";
  var legacy = JSON.stringify({ name: "codex", version: "1.0.0", description: "Codex skills shared by Clay" }, null, 2) + "\n";
  return withSkillBridge(homeDir, bridgeName, opts.readerUid, function (pluginDir, manifestDir, scope) {
    var result = bridgeManifest(manifestDir, manifest, legacy, scope);
    if (!result) return null;
    var skillsLink = path.join(pluginDir, "skills");
    var resolvedPlugin = fs.realpathSync(pluginDir);
    var stat = lstatOrNull(skillsLink);
    if (stat) {
      if (!stat.isSymbolicLink() || path.resolve(resolvedPlugin, fs.readlinkSync(skillsLink)) !== path.resolve(source)) return null;
    } else {
      fs.symlinkSync(path.resolve(source), skillsLink, "dir");
    }
    return { manifest: result };
  });
}

// A per-exclusion plugin for the Claude provider: its skills directory is a real
// directory of symlinks to every skill in source except the excluded names. The
// unfiltered bridge is never modified; each distinct exclusion set gets its own
// deterministic directory under the same bridge root.
function ensureFilteredClaudePlugin(opts) {
  var homeDir = opts.homeDir || defaultHomeDir();
  var excluded = (opts.exclude || []).slice().sort();
  var tag = require("crypto").createHash("sha256").update(excluded.join("\0")).digest("hex").slice(0, 10);
  var bridgeName = (opts.name || "shared") + "-without-" + tag;
  var entries;
  try { entries = fs.readdirSync(opts.source, { withFileTypes: true }); } catch (e) { return null; }
  var manifest = JSON.stringify({ name: bridgeName, version: "1.0.0", description: "Shared skills provided by Clay (filtered)" }, null, 2) + "\n";
  return withSkillBridge(homeDir, bridgeName, opts.readerUid, function (pluginDir, manifestDir, scope) {
    var result = bridgeManifest(manifestDir, manifest, null, scope);
    if (!result) return null;
    var filteredSkills = openBridgeDirectory(path.join(pluginDir, "skills"), scope);
    var skillsDir = filteredSkills.path;
    var wanted = {};
    entries.forEach(function (entry) {
      if (excluded.indexOf(entry.name) !== -1 || !(entry.isDirectory() || entry.isSymbolicLink())) return;
      wanted[entry.name] = path.resolve(opts.source, entry.name);
    });
    fs.readdirSync(skillsDir).forEach(function (name) {
      var stale = lstatOrNull(path.join(skillsDir, name));
      if (!wanted[name] && stale && stale.isSymbolicLink()) fs.unlinkSync(path.join(skillsDir, name));
    });
    Object.keys(wanted).forEach(function (name) {
      var link = path.join(skillsDir, name);
      if (!lstatOrNull(link)) fs.symlinkSync(wanted[name], link, "dir");
    });
    return { manifest: result, skills: filteredSkills };
  });
}

module.exports = {
  ensureFilteredClaudePlugin: ensureFilteredClaudePlugin,
  buildSkillIndex: buildSkillIndex,
  discoverSkills: discoverSkills,
  ensureClaudeCodexPlugin: ensureClaudeCodexPlugin,
  findSkillReferences: findSkillReferences,
  getSkillRoots: getSkillRoots,
  indexSkills: indexSkills,
  optionsForOsUser: optionsForOsUser,
  readReferencedSkills: readReferencedSkills,
};
