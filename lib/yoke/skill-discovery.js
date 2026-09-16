// Cross-vendor skill discovery
// ----------------------------
// Skills remain in their vendor-owned directories. This module only builds a
// merged view so every YOKE adapter can expose the same installed skills.

var fs = require("fs");
var os = require("os");
var path = require("path");

function defaultHomeDir() {
  try { return require("../config").REAL_HOME; } catch (e) { return os.homedir(); }
}

function optionsForOsUser(userInfo, fsAsUser) {
  if (!userInfo || typeof userInfo.home !== "string" || !userInfo.home) return { disable: true };
  fsAsUser = fsAsUser || require("../os-users").fsAsUser;
  return {
    homeDir: userInfo.home,
    scopedHome: true,
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
  return roots;
}

function discoverSkills(cwd, opts) {
  if (opts && opts.disable) return [];
  var merged = {};
  var roots = getSkillRoots(cwd, opts);
  for (var i = 0; i < roots.length; i++) scanRoot(roots[i].path, roots[i].source, merged, opts);
  return Object.keys(merged).sort().map(function(name) { return merged[name]; });
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

function ensureClaudeCodexPlugin(opts) {
  opts = opts || {};
  var homeDir = opts.homeDir || defaultHomeDir();
  var source = opts.source || path.join(homeDir, ".codex", "skills");
  var bridgeName = opts.name || "codex";
  try {
    if (!fs.statSync(source).isDirectory()) return null;
  } catch (e) { return null; }

  var pluginDir = path.join(homeDir, ".clay", "skill-bridge", bridgeName);
  var bridgeRoot = path.dirname(pluginDir);
  var manifestDir = path.join(pluginDir, ".claude-plugin");
  var manifestPath = path.join(manifestDir, "plugin.json");
  var skillsLink = path.join(pluginDir, "skills");
  var manifest = JSON.stringify({ name: bridgeName, version: "1.0.0", description: "Shared skills provided by Clay" }, null, 2) + "\n";

  try {
    fs.mkdirSync(path.join(homeDir, ".clay"), { recursive: true });
    var bridgeStat = lstatOrNull(bridgeRoot);
    if (bridgeStat && (!bridgeStat.isDirectory() || bridgeStat.isSymbolicLink())) return null;
    if (!bridgeStat) fs.mkdirSync(bridgeRoot);
    var pluginStat = lstatOrNull(pluginDir);
    if (pluginStat && (!pluginStat.isDirectory() || pluginStat.isSymbolicLink())) return null;
    if (!pluginStat) fs.mkdirSync(pluginDir);
    var manifestDirStat = lstatOrNull(manifestDir);
    if (manifestDirStat && (!manifestDirStat.isDirectory() || manifestDirStat.isSymbolicLink())) return null;
    if (!manifestDirStat) fs.mkdirSync(manifestDir);
    var manifestStat = lstatOrNull(manifestPath);
    if (manifestStat) {
      if (!manifestStat.isFile()) return null;
      var existingManifest = fs.readFileSync(manifestPath, "utf8");
      var legacyManifest = JSON.stringify({ name: "codex", version: "1.0.0", description: "Codex skills shared by Clay" }, null, 2) + "\n";
      if (existingManifest !== manifest && existingManifest !== legacyManifest) return null;
    } else {
      fs.writeFileSync(manifestPath, manifest, { mode: 0o600, flag: "wx" });
    }
    var stat = lstatOrNull(skillsLink);
    if (stat) {
      if (!stat.isSymbolicLink() || path.resolve(pluginDir, fs.readlinkSync(skillsLink)) !== path.resolve(source)) return null;
    } else {
      fs.symlinkSync(source, skillsLink, "dir");
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[yoke/skills] Failed to create Claude Codex skill bridge:", e.message);
    return null;
  }
  return pluginDir;
}

module.exports = {
  buildSkillIndex: buildSkillIndex,
  discoverSkills: discoverSkills,
  ensureClaudeCodexPlugin: ensureClaudeCodexPlugin,
  findSkillReferences: findSkillReferences,
  getSkillRoots: getSkillRoots,
  indexSkills: indexSkills,
  optionsForOsUser: optionsForOsUser,
  readReferencedSkills: readReferencedSkills,
};
