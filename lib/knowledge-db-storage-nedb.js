var fs = require("fs");
var path = require("path");
var Datastore = require("@seald-io/nedb");
var maintenance = require("./knowledge-db-storage-nedb-maintenance");
var STORE_REGISTRY = new Map();

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function error(message, code) { return Object.assign(new Error(message), { code: code }); }
function createKnowledgeDbNedbStorage(options) {
  var projectDir = path.resolve(options.projectDir); var projectReal = null;
  var knowledgeDir = path.join(projectDir, "knowledge"); var dataDir = path.join(knowledgeDir, ".clay-db");
  var filename = path.join(dataDir, "databases.db"); var entry = STORE_REGISTRY.get(filename);
  if (!entry) { entry = { queues: new Map(), database: null, loading: null, ready: false }; STORE_REGISTRY.set(filename, entry); }
  function safeDirectory(target, create) {
    var stat;
    try { stat = fs.lstatSync(target); }
    catch (cause) { if (!create || cause.code !== "ENOENT") throw cause; fs.mkdirSync(target, { recursive: true, mode: 0o700 }); stat = fs.lstatSync(target); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw error("Knowledge database path is unsafe.", "UNSAFE_PATH");
    var real = fs.realpathSync(target);
    if (real !== projectReal && !real.startsWith(projectReal + path.sep)) throw error("Knowledge database path escapes the Mate project.", "UNSAFE_PATH");
  }
  function open() {
    if (entry.loading) return entry.loading;
    entry.loading = Promise.resolve().then(function () {
      projectReal = fs.realpathSync(projectDir); safeDirectory(knowledgeDir, true); safeDirectory(dataDir, true);
      var stat; try { stat = fs.lstatSync(filename); } catch (cause) { if (cause.code !== "ENOENT") throw cause; }
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw error("Knowledge database file is unsafe.", "UNSAFE_PATH");
      entry.database = new Datastore({ filename: filename }); return entry.database.loadDatabaseAsync();
    }).then(function () { return entry.database.ensureIndexAsync({ fieldName: "_id", unique: true }); })
      .then(function () { entry.ready = true; return entry.database; })
      .catch(function (cause) { invalidate(); throw cause; });
    return entry.loading;
  }
  function invalidate() { entry.database = null; entry.loading = null; entry.ready = false; }
  var io = maintenance.attachKnowledgeDbNedbMaintenance({ entry: entry, filename: filename, open: open, invalidate: invalidate });
  function serialize(scope, work) {
    var previous = entry.queues.get(scope) || Promise.resolve(); var next = previous.catch(function () {}).then(function () { return work(); });
    entry.queues.set(scope, next.catch(function () {})); return next;
  }
  function insert(snapshot) {
    var value = clone(snapshot);
    return io.write(function (store) { return store.insertAsync(value); }, value).then(function () {}, function (cause) {
      if (cause.errorType === "uniqueViolated") throw error("Knowledge storage identity already exists.", "ALREADY_EXISTS");
      throw cause;
    });
  }
  function replaceIfRevision(id, revision, snapshot) {
    var value = clone(snapshot);
    if (value._id !== id) return Promise.reject(error("Knowledge storage replacement identity must match.", "INVALID_STORAGE_ID"));
    return io.write(function (store) { return store.updateAsync({ _id: id, revision: revision }, value, {}); }, value)
      .then(function (result) { return result.numAffected === 1; });
  }
  return {
    contractVersion: 1,
    initialize: function () { return io.read(function () {}); },
    hasStore: function () { try { return fs.lstatSync(filename).isFile(); } catch (cause) { return false; } },
    isReady: function () { return entry.ready === true; },
    get: function (id) { return io.read(function (store) { return store.findOneAsync({ _id: id }); }); },
    list: function () { return io.read(function (store) { return store.findAsync({}); }); },
    getCached: function () { return clone(io.cached()); },
    insert: insert, replaceIfRevision: replaceIfRevision, serialize: serialize,
    diagnostics: function () { return io.readStorageStatus().then(function (status) { return Object.assign({ engine: "nedb", automaticCompaction: false }, status); }); }
  };
}

module.exports = { createKnowledgeDbNedbStorage: createKnowledgeDbNedbStorage };
