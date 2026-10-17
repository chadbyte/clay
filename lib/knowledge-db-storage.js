// Version 1 persists opaque JSON aggregate snapshots with a stable _id and revision.
// _id is the existing Knowledge identity, not a query expression. Engines may map it
// to their own primary key; aggregate format/limits remain application responsibilities.
// Each adapter is bound to one server-authorized Mate-project store; get/list cannot
// broaden that scope. Facades for the same store must share locks and committed cache.
//
// initialize() -> Promise<void>; hasStore()/isReady() -> boolean.
// get(id) -> Promise<snapshot|null>; list() -> Promise<snapshot[]>;
// getCached() -> snapshot[] (committed, detached, no initialization side effect).
// insert(snapshot) -> Promise<void> (reject ALREADY_EXISTS; never overwrite).
// replaceIfRevision(id, revision, snapshot) -> Promise<boolean>: atomic compare and
// full replacement, false on missing/mismatch without writing. Same-revision writes
// are allowed for receipts/projection status. Identity must remain unchanged.
// serialize(scope, work) -> Promise<result>: same-scope callbacks exclude each other
// across all facades of one physical store. Callback receives no engine objects and
// may await adapter operations; this is not a multi-aggregate transaction or I/O lock.
// Engines separately serialize reads/writes/maintenance/recovery as needed. A failed
// write may have committed durably; restore readable committed state before releasing
// the I/O gate, or invalidate it. Never turn committed success into maintenance failure.
// Domain operation receipts resolve ambiguous retries; the adapter does not own them.
// diagnostics() -> Promise<JSON> is optional, engine-specific and never a native handle.

var METHODS = ["initialize", "hasStore", "isReady", "get", "list", "getCached", "insert", "replaceIfRevision", "serialize"];
function invalid(message) { return Object.assign(new Error("Invalid Knowledge storage adapter: " + message), { code: "INVALID_STORAGE_ADAPTER" }); }
function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || adapter.contractVersion !== 1) throw invalid("contractVersion must be 1.");
  METHODS.forEach(function (name) { if (typeof adapter[name] !== "function") throw invalid(name + " must be a function."); });
  if (adapter.diagnostics !== undefined && typeof adapter.diagnostics !== "function") throw invalid("diagnostics must be a function when supplied.");
  return adapter;
}
function bindAdapter(adapter) {
  function snapshot(value) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || typeof value._id !== "string" || !Number.isInteger(value.revision)) throw invalid("snapshot must be a plain aggregate with _id and integer revision.");
    return value;
  }
  function snapshots(values) { if (!Array.isArray(values)) throw invalid("list/getCached must return an array."); values.forEach(snapshot); return values; }
  function call(name, args, check) {
    var result;
    try { result = adapter[name].apply(adapter, args); } catch (cause) { return Promise.reject(cause); }
    if (!result || typeof result.then !== "function") return Promise.reject(invalid(name + " must return a Promise."));
    return result.then(check);
  }
  function flag(name) { var value = adapter[name](); if (typeof value !== "boolean") throw invalid(name + " must return a boolean."); return value; }
  var bound = {
    contractVersion: 1,
    initialize: function () { return call("initialize", [], function () {}); },
    hasStore: function () { return flag("hasStore"); }, isReady: function () { return flag("isReady"); },
    get: function (id) { return call("get", [id], function (value) { if (value === null) return null; snapshot(value); if (value._id !== id) throw invalid("get returned a different identity."); return value; }); },
    list: function () { return call("list", [], snapshots); }, getCached: function () { return snapshots(adapter.getCached()); },
    insert: function (value) { return call("insert", [value], function (result) { if (result !== undefined) throw invalid("insert must resolve without a native result."); }); },
    replaceIfRevision: function (id, revision, value) { return call("replaceIfRevision", [id, revision, value], function (result) { if (typeof result !== "boolean") throw invalid("replaceIfRevision must resolve to a boolean."); return result; }); },
    serialize: function (scope, work) { return call("serialize", [scope, function () { return work(); }], function (result) { return result; }); }
  };
  if (typeof adapter.diagnostics === "function") bound.diagnostics = function () {
    return call("diagnostics", [], function (result) { try { return JSON.parse(JSON.stringify(result)); } catch (cause) { throw invalid("diagnostics must resolve to JSON data."); } });
  };
  return bound;
}
function createDefaultKnowledgeDbStorage(options) {
  // Lazy engine loading: injected adapters can run domain code without NeDB installed.
  return require("./knowledge-db-storage-nedb").createKnowledgeDbNedbStorage(options);
}
function createKnowledgeDbStorage(options) {
  var settings = options || {}; var adapter;
  if (settings.storageAdapter !== undefined) adapter = settings.storageAdapter;
  else if (settings.storageFactory !== undefined) {
    if (typeof settings.storageFactory !== "function") throw invalid("storageFactory must be a synchronous function.");
    adapter = settings.storageFactory({ projectDir: settings.projectDir });
  } else adapter = module.exports.createDefaultKnowledgeDbStorage({ projectDir: settings.projectDir });
  return bindAdapter(validateAdapter(adapter));
}
module.exports = { createKnowledgeDbStorage: createKnowledgeDbStorage, createDefaultKnowledgeDbStorage: createDefaultKnowledgeDbStorage, validateAdapter: validateAdapter, invalid: invalid };
