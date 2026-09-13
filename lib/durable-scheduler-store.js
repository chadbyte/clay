var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeError(message, code, cause) {
  var error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function pidIsAlive(pid) {
  if (typeof pid !== "number" || !isFinite(pid) || Math.floor(pid) !== pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !!(error && error.code !== "ESRCH");
  }
}

function attachDurableSchedulerStore(ctx) {
  var filePath = ctx.filePath;
  var namespace = ctx.namespace;
  var fsImpl = ctx.fs || fs;
  var lockPath = filePath + ".lock";
  var guardPath = lockPath + ".acquire";
  var lockToken = crypto.randomBytes(16).toString("hex");
  var lockFd = null;
  var closed = false;

  if (!filePath || !namespace) throw new Error("Scheduler store requires filePath and namespace");

  function acquireLockUnderGuard() {
    try {
      lockFd = fsImpl.openSync(lockPath, "wx", 0o600);
      fsImpl.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, namespace: namespace, token: lockToken }) + "\n");
      return;
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        if (lockFd !== null) {
          try { fsImpl.closeSync(lockFd); } catch (closeError) {}
          lockFd = null;
          try { fsImpl.unlinkSync(lockPath); } catch (unlinkError) {}
        }
        throw makeError("Unable to lock scheduler store: " + error.message, "SCHEDULER_STORE_LOCK", error);
      }
    }

    var lock;
    try {
      lock = JSON.parse(fsImpl.readFileSync(lockPath, "utf8"));
    } catch (error) {
      throw makeError("Scheduler store lock is unreadable", "SCHEDULER_STORE_LOCK", error);
    }
    if (pidIsAlive(lock.pid)) {
      throw makeError("Scheduler store is already owned by process " + lock.pid, "SCHEDULER_STORE_LOCKED");
    }
    var stalePath = lockPath + ".stale-" + process.pid + "-" + lockToken;
    try {
      fsImpl.renameSync(lockPath, stalePath);
      lockFd = fsImpl.openSync(lockPath, "wx", 0o600);
      fsImpl.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, namespace: namespace, token: lockToken }) + "\n");
      try { fsImpl.unlinkSync(stalePath); } catch (cleanupError) {}
    } catch (error) {
      if (lockFd !== null) {
        try { fsImpl.closeSync(lockFd); } catch (closeError) {}
        lockFd = null;
        try { fsImpl.unlinkSync(lockPath); } catch (unlinkError) {}
      }
      try { fsImpl.unlinkSync(stalePath); } catch (cleanupError) {}
      throw makeError("Unable to recover stale scheduler store lock", "SCHEDULER_STORE_LOCK", error);
    }
  }

  function acquireLock() {
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    try {
      fsImpl.mkdirSync(guardPath, { mode: 0o700 });
    } catch (error) {
      if (error && error.code === "EEXIST") {
        throw makeError("Scheduler store acquisition is already in progress or requires manual stale-guard recovery", "SCHEDULER_STORE_LOCKED", error);
      }
      throw makeError("Unable to guard scheduler store acquisition", "SCHEDULER_STORE_LOCK", error);
    }

    var acquisitionError = null;
    try {
      acquireLockUnderGuard();
    } catch (error) {
      acquisitionError = error;
    }
    try {
      fsImpl.rmdirSync(guardPath);
    } catch (error) {
      if (lockFd !== null) {
        try { fsImpl.closeSync(lockFd); } catch (closeError) {}
        lockFd = null;
        try { fsImpl.unlinkSync(lockPath); } catch (unlinkError) {}
      }
      throw makeError("Unable to release scheduler store acquisition guard", "SCHEDULER_STORE_LOCK", error);
    }
    if (acquisitionError) throw acquisitionError;
  }

  function emptyData() {
    return { version: 1, namespace: namespace, jobs: [] };
  }

  function load() {
    if (closed) throw makeError("Scheduler store is closed", "SCHEDULER_STORE_CLOSED");
    if (!fsImpl.existsSync(filePath)) return emptyData();
    var parsed;
    try {
      parsed = JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw makeError("Scheduler store is corrupt or unreadable", "SCHEDULER_STORE_CORRUPT", error);
    }
    if (!parsed || parsed.version !== 1 || parsed.namespace !== namespace || !Array.isArray(parsed.jobs)) {
      throw makeError("Scheduler store has an invalid schema or namespace", "SCHEDULER_STORE_CORRUPT");
    }
    return clone(parsed);
  }

  function save(data) {
    if (closed) throw makeError("Scheduler store is closed", "SCHEDULER_STORE_CLOSED");
    var serialized;
    try {
      serialized = JSON.stringify(data, null, 2) + "\n";
    } catch (error) {
      throw makeError("Scheduler store data is not serializable", "SCHEDULER_STORE_WRITE", error);
    }
    var temporary = filePath + ".tmp-" + process.pid;
    var temporaryFd = null;
    try {
      temporaryFd = fsImpl.openSync(temporary, "w", 0o600);
      fsImpl.writeFileSync(temporaryFd, serialized, "utf8");
      if (typeof fsImpl.fsyncSync === "function") fsImpl.fsyncSync(temporaryFd);
      fsImpl.closeSync(temporaryFd);
      temporaryFd = null;
      fsImpl.renameSync(temporary, filePath);
      try { fsImpl.chmodSync(filePath, 0o600); } catch (error) {}
      var directoryFd = null;
      try {
        directoryFd = fsImpl.openSync(path.dirname(filePath), "r");
        if (typeof fsImpl.fsyncSync === "function") fsImpl.fsyncSync(directoryFd);
      } catch (error) {
        var unsupported = error && (error.code === "EINVAL" || error.code === "ENOTSUP" || error.code === "EISDIR" || error.code === "EBADF" || error.code === "EPERM" || error.code === "EACCES");
        if (!unsupported) throw error;
      } finally {
        if (directoryFd !== null) {
          try { fsImpl.closeSync(directoryFd); } catch (closeError) {}
        }
      }
    } catch (error) {
      if (temporaryFd !== null) {
        try { fsImpl.closeSync(temporaryFd); } catch (closeError) {}
      }
      try { fsImpl.unlinkSync(temporary); } catch (cleanupError) {}
      throw makeError("Scheduler store write failed", "SCHEDULER_STORE_WRITE", error);
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    if (lockFd !== null) {
      try { fsImpl.closeSync(lockFd); } catch (error) {}
      lockFd = null;
    }
    try {
      var lock = JSON.parse(fsImpl.readFileSync(lockPath, "utf8"));
      if (lock.pid === process.pid && lock.namespace === namespace && lock.token === lockToken) fsImpl.unlinkSync(lockPath);
    } catch (error) {}
  }

  acquireLock();
  return { load: load, save: save, close: close, filePath: filePath, namespace: namespace };
}

module.exports = { attachDurableSchedulerStore: attachDurableSchedulerStore };
