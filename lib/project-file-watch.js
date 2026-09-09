var fs = require("fs");
var path = require("path");

/**
 * Attach file/directory watcher engine to a project context.
 *
 * ctx fields:
 *   cwd, send, sendTo, safePath, BINARY_EXTS, FS_MAX_SIZE, IGNORED_DIRS, requestAccess, fsAsUser
 */
function attachFileWatch(ctx) {
  var cwd = ctx.cwd;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var safePath = ctx.safePath;
  var BINARY_EXTS = ctx.BINARY_EXTS;
  var FS_MAX_SIZE = ctx.FS_MAX_SIZE;
  var IGNORED_DIRS = ctx.IGNORED_DIRS;
  var access = ctx.requestAccess;

  function identityFor(client) {
    if (!access) return null;
    if (!access.canUseFiles(client)) throw new Error("File browser access is not permitted");
    return access.osIdentity(client);
  }

  function checkedPath(relPath) {
    var resolved = safePath(cwd, relPath);
    if (!resolved) throw new Error("Access denied");
    return resolved;
  }

  // --- File watcher ---
  // One open file per websocket client. A project-wide singleton watcher made
  // one browser tab silently replace another tab's live preview subscription.
  var fileWatchers = new Map();

  function settleFileWatchReady(entry, ready) {
    if (!entry || !entry.resolveReady) return;
    var resolve = entry.resolveReady;
    entry.resolveReady = null;
    resolve(ready);
  }

  function closeFileWatch(key) {
    var entry = fileWatchers.get(key);
    if (!entry) return;
    clearTimeout(entry.debounce);
    if (entry.reconcile) clearImmediate(entry.reconcile);
    if (entry.pollTimer) clearInterval(entry.pollTimer);
    try { entry.watcher.close(); } catch (e) {}
    fileWatchers.delete(key);
    settleFileWatchReady(entry, false);
  }

  function sendFileChanged(client, message) {
    if (client && typeof sendTo === "function") {
      sendTo(client, message);
    } else {
      send(message);
    }
  }

  function readFileSnapshot(client, relPath) {
    var identity = identityFor(client);
    var absPath = checkedPath(relPath);
    var stat = identity ? ctx.fsAsUser("stat", { file: absPath }, identity) : fs.statSync(absPath);
    var ext = path.extname(absPath).toLowerCase();
    if (stat.size > FS_MAX_SIZE || BINARY_EXTS.has(ext)) return null;
    if (identity) return ctx.fsAsUser("read", { file: absPath, readContent: true }, identity);
    return { content: fs.readFileSync(absPath, "utf8"), size: stat.size };
  }

  function publishFileChanged(key, client, relPath) {
    var latest = fileWatchers.get(key);
    if (!latest || latest.relPath !== relPath) return;
    try {
      var snapshot = readFileSnapshot(client, relPath);
      if (!snapshot) return;
      if (latest.hasSnapshot && latest.content === snapshot.content && latest.size === snapshot.size) return;
      latest.hasSnapshot = true;
      latest.content = snapshot.content;
      latest.size = snapshot.size;
      sendFileChanged(client, {
        type: "fs_file_changed",
        path: relPath,
        content: snapshot.content,
        size: snapshot.size,
      });
    } catch (e) {
      // Atomic saves can briefly remove the destination path between rename
      // events. Keep the parent watcher alive for the next event.
      if (e.code !== "ENOENT") closeFileWatch(key);
    }
  }

  function startFileWatch(client, relPath) {
    // Preserve the old single-argument API for callers outside the websocket
    // file browser. They share one legacy subscription.
    if (typeof relPath !== "string") {
      relPath = client;
      client = null;
    }
    var absPath = safePath(cwd, relPath);
    if (!absPath) return Promise.resolve(false);
    var key = client || "_legacy";
    var existing = fileWatchers.get(key);
    if (existing && existing.relPath === relPath) return existing.ready;
    closeFileWatch(key);

    // Watch the parent directory rather than the file inode. Editors and agent
    // tools commonly save with write-temp + rename; watching the old inode then
    // misses later edits even though the path still exists.
    var parentPath = path.dirname(absPath);
    var baseName = path.basename(absPath);
    var initialSnapshot = null;
    try { initialSnapshot = readFileSnapshot(client, relPath); } catch (e) {
      return Promise.resolve(false);
    }
    try {
      var watcher = fs.watch(parentPath, function (eventType, filename) {
        if (filename && String(filename) !== baseName) return;
        var active = fileWatchers.get(key);
        if (!active || active.relPath !== relPath) return;
        clearTimeout(active.debounce);
        active.debounce = setTimeout(function () {
          publishFileChanged(key, client, relPath);
        }, 200);
      });
      var resolveReady = null;
      var ready = new Promise(function (resolve) { resolveReady = resolve; });
      var entry = {
        watcher: watcher,
        relPath: relPath,
        debounce: null,
        reconcile: null,
        pollTimer: null,
        ready: ready,
        resolveReady: resolveReady,
        hasSnapshot: !!initialSnapshot,
        content: initialSnapshot ? initialSnapshot.content : null,
        size: initialSnapshot ? initialSnapshot.size : null,
      };
      fileWatchers.set(key, entry);
      // Directory events are the low-latency path, but macOS can coalesce or
      // drop them under load. Periodic content reconciliation is the source of
      // truth and also survives atomic replacements with identical metadata.
      entry.pollTimer = setInterval(function () {
        publishFileChanged(key, client, relPath);
      }, 1000);
      // fs.watch has no readiness event. Reconcile once on the next event-loop
      // turn so a change between the initial read and native watcher activation
      // cannot leave the browser showing stale content.
      entry.reconcile = setImmediate(function () {
        var active = fileWatchers.get(key);
        if (active) active.reconcile = null;
        publishFileChanged(key, client, relPath);
        if (fileWatchers.get(key) === entry) settleFileWatchReady(entry, true);
      });
      watcher.on("error", function () { closeFileWatch(key); });
      return ready;
    } catch (e) {
      closeFileWatch(key);
      return Promise.resolve(false);
    }
  }

  function stopFileWatch(client) {
    if (arguments.length > 0) {
      closeFileWatch(client || "_legacy");
      return;
    }
    var keys = Array.from(fileWatchers.keys());
    for (var i = 0; i < keys.length; i++) closeFileWatch(keys[i]);
  }

  // Directory subscriptions are private to the requesting socket.
  var dirWatchers = new Map();

  function readDirectory(client, relPath) {
    var identity = identityFor(client);
    var absPath = checkedPath(relPath);
    var items = identity ? ctx.fsAsUser("list", { dir: absPath }, identity) :
      fs.readdirSync(absPath, { withFileTypes: true }).map(function (item) {
        return { name: item.name, isDir: item.isDirectory() };
      });
    return items.filter(function (item) {
      return !item.isDir || !IGNORED_DIRS.has(item.name);
    }).map(function (item) {
      return { name: item.name, type: item.isDir ? "dir" : "file",
        path: path.relative(cwd, path.join(absPath, item.name)).split(path.sep).join("/") };
    });
  }

  function startDirWatch(client, relPath) {
    var subscriptions = dirWatchers.get(client);
    if (!subscriptions) { subscriptions = new Map(); dirWatchers.set(client, subscriptions); }
    if (subscriptions.has(relPath)) return;
    try {
      readDirectory(client, relPath);
      var entry = { watcher: null, debounce: null };
      entry.watcher = fs.watch(checkedPath(relPath), function () {
        clearTimeout(entry.debounce);
        entry.debounce = setTimeout(function () {
          try {
            var entries = readDirectory(client, relPath);
            sendTo(client, { type: "fs_dir_changed", path: relPath, entries: entries });
          } catch (e) { stopDirWatch(client, relPath); }
        }, 300);
      });
      entry.watcher.on("error", function () { stopDirWatch(client, relPath); });
      subscriptions.set(relPath, entry);
    } catch (e) {
      if (!subscriptions.size) dirWatchers.delete(client);
    }
  }

  function stopDirWatch(client, relPath) {
    var subscriptions = dirWatchers.get(client);
    var entry = subscriptions && subscriptions.get(relPath);
    if (!entry) return;
    clearTimeout(entry.debounce);
    try { entry.watcher.close(); } catch (e) {}
    subscriptions.delete(relPath);
    if (!subscriptions.size) dirWatchers.delete(client);
  }

  function stopAllDirWatches(client) {
    var clients = arguments.length ? [client] : Array.from(dirWatchers.keys());
    clients.forEach(function (key) {
      var subscriptions = dirWatchers.get(key);
      if (subscriptions) Array.from(subscriptions.keys()).forEach(function (relPath) {
        stopDirWatch(key, relPath);
      });
    });
  }

  return {
    startFileWatch: startFileWatch,
    stopFileWatch: stopFileWatch,
    startDirWatch: startDirWatch,
    stopDirWatch: stopDirWatch,
    stopAllDirWatches: stopAllDirWatches,
  };
}

module.exports = { attachFileWatch: attachFileWatch };
