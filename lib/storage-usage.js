var fs = require('node:fs/promises');
var path = require('node:path');
var execFile = require('node:child_process').execFile;
var nativeWalk = require('./storage-native-walk');

function resolveIdentity(username) {
  return new Promise(function (resolve) {
    if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(username || '')) return resolve(null);
    execFile('getent', ['passwd', username], { timeout: 3000, maxBuffer: 8192 }, function (error, output) {
      if (error) return resolve(null);
      var parts = output.trim().split(':');
      var uid = Number(parts[2]);
      resolve(parts.length >= 7 && /^\d+$/.test(parts[2]) && Number.isInteger(uid) && uid >= 0 && path.isAbsolute(parts[5]) ? { uid: uid, home: parts[5] } : null);
    });
  });
}

// Read metadata only. Shared paths and hard links count once across all roots.
async function scanStorage(options) {
  var started = Date.now();
  var deadline = options.maxMs ? started + options.maxMs : Infinity;
  var maxEntries = options.maxEntries || Infinity;
  var users = options.users || [];
  var projectMode = options.attribution === "project";
  var projects = options.projects || [];
  var identities = await Promise.all(users.map(function (user) {
    return !projectMode && options.platform === 'linux' && user.linuxUser ? (options.resolveIdentity || resolveIdentity)(user.linuxUser) : null;
  }));
  var rows = users.map(function (user, index) {
    return { id: user.id, name: user.displayName || user.username, linuxUser: user.linuxUser || null, mapped: projectMode || !!identities[index], projects: 0, bytes: 0, files: 0 };
  });
  var owners = new Map();
  identities.forEach(function (identity, index) {
    if (!identity) return;
    // A reused OS identity cannot be split accurately between Clay accounts.
    owners.set(identity.uid, owners.has(identity.uid) ? null : rows[index]);
  });
  identities.forEach(function (identity, index) {
    if (identity && !owners.get(identity.uid)) rows[index].mapped = false;
  });
  var projectRoots = new Map();
  var projectErrors = 0;
  for (var project of projects) {
    try {
      var projectPath = await fs.realpath(project.path);
      var row = rows.find(function (item) { return item.id === project.projectOwnerId; }) || null;
      if (row) row.projects++;
      if (projectRoots.has(projectPath) && projectRoots.get(projectPath) !== row) row = null;
      projectRoots.set(projectPath, row);
    } catch (error) { projectErrors++; }
  }
  var orderedProjects = Array.from(projectRoots.keys()).sort(function (a, b) { return b.length - a.length; });
  function projectOwner(filePath) {
    var root = orderedProjects.find(function (candidate) { return filePath === candidate || filePath.indexOf(candidate + path.sep) === 0; });
    return root ? projectRoots.get(root) : null;
  }
  var roots = orderedProjects.concat(options.projectPaths || []);
  identities.forEach(function (identity) { if (identity) roots.push(identity.home); });
  roots.push(options.configDir);
  var report = { attribution: projectMode ? "project" : "filesystem", users: rows, totalBytes: 0, totalFiles: 0, unattributedBytes: 0, unattributedFiles: 0,
    partial: false, errors: projectErrors + users.filter(function (user, index) { return !projectMode && options.platform === 'linux' && user.linuxUser && !identities[index]; }).length, skippedLinks: 0, skippedMounts: 0, scannedEntries: 0, roots: 0, platform: options.platform };
  var lastProgress = 0;
  function progress() {
    if (!options.onProgress || Date.now() - lastProgress < 500) return;
    lastProgress = Date.now();
    options.onProgress(Object.assign({}, report, { scanning: true, checkedAt: new Date().toISOString(),
      users: rows.map(function (row) { return Object.assign({}, row); }) }));
  }
  progress();
  var seen = new Map();
  var rootPaths = new Set();
  var completedRoots = [];
  var useNative = options.native !== false && await nativeWalk.available();
  for (var root of roots) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) { report.errors++; continue; }
    try {
      root = await fs.realpath(root);
      // Never turn a misconfigured home/project into a whole-host scan.
      if (root === path.parse(root).root) { report.errors++; continue; }
      if (rootPaths.has(root)) continue;
      rootPaths.add(root);
      var rootStat = await fs.lstat(root);
      report.roots++;
      if (useNative) {
        if (seen.has(rootStat.dev + ':' + rootStat.ino)) continue;
        var result = await nativeWalk.walk(root, completedRoots, function (filePath, stat) {
          if (Date.now() >= deadline || report.scannedEntries >= maxEntries) { report.partial = true; return false; }
          account(filePath, stat, rootStat.dev);
        }, deadline - Date.now());
        report.errors += result.errors;
        if (result.stopped) report.partial = true;
        completedRoots.push(root);
      } else await walk(root, rootStat.dev);
    } catch (error) { report.errors++; }
    if (report.partial) break;
  }
  report.partial = report.partial || report.errors > 0 || report.skippedMounts > 0;
  report.scanning = false;
  report.checkedAt = new Date().toISOString();
  return report;

  async function walk(filePath, device) {
    if (Date.now() >= deadline || report.scannedEntries >= maxEntries) { report.partial = true; return; }
    var stat;
    try { stat = await fs.lstat(filePath); } catch (error) { report.errors++; return; }
    if (!account(filePath, stat, device)) return;
    if (!stat.isDirectory()) return;
    try {
      var directory = await fs.opendir(filePath);
      for await (var entry of directory) {
        await walk(path.join(filePath, entry.name), device);
        if (report.partial) break;
      }
    } catch (error) { report.errors++; }
  }

  function account(filePath, stat, device) {
    if (stat.isSymbolicLink()) { report.skippedLinks++; return; }
    if (stat.dev !== device) { report.skippedMounts++; return; }
    var key = stat.dev + ':' + stat.ino;
    var owner = projectMode ? projectOwner(filePath) : owners.get(stat.uid);
    if (seen.has(key)) {
      var previous = seen.get(key);
      if (projectMode && stat.isFile() && previous.owner && previous.owner !== owner) {
        previous.owner.bytes -= previous.bytes; previous.owner.files--;
        report.unattributedBytes += previous.bytes; report.unattributedFiles++;
        previous.owner = null;
      }
      return;
    }
    report.scannedEntries++;
    if (!stat.isDirectory() && !stat.isFile()) return;
    var bytes = typeof stat.blocks === 'number' ? stat.blocks * 512 : stat.size;
    // Only directories and multiply-linked files need identity deduplication.
    if (stat.isDirectory() || stat.nlink > 1) seen.set(key, { owner: owner, bytes: bytes });
    report.totalBytes += bytes;
    if (stat.isFile()) report.totalFiles++;
    if (owner) { owner.bytes += bytes; if (stat.isFile()) owner.files++; }
    else { report.unattributedBytes += bytes; if (stat.isFile()) report.unattributedFiles++; }
    progress();
    return true;
  }
}
module.exports = { scanStorage: scanStorage };
