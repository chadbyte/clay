// Independent contract fixture: no filesystem, NeDB, adapter factory or production helper.
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function createMemoryStorage(state) {
  state = state || { values: new Map(), scopes: new Map(), ready: false };
  function initialize() { state.ready = true; return Promise.resolve(); }
  function serialize(scope, work) {
    var previous = state.scopes.get(scope) || Promise.resolve();
    var next = previous.catch(function () {}).then(function () { return work(); });
    state.scopes.set(scope, next.catch(function () {})); return next;
  }
  return {
    contractVersion: 1,
    initialize: initialize, hasStore: function () { return state.ready; }, isReady: function () { return state.ready; },
    get: function (id) { return initialize().then(function () { return state.values.has(id) ? clone(state.values.get(id)) : null; }); },
    list: function () { return initialize().then(function () { return Array.from(state.values.values()).map(clone); }); },
    getCached: function () { return Array.from(state.values.values()).map(clone); },
    insert: function (snapshot) {
      var value = clone(snapshot);
      return initialize().then(function () {
        if (state.values.has(value._id)) throw Object.assign(new Error("Identity exists."), { code: "ALREADY_EXISTS" });
        state.values.set(value._id, value);
      });
    },
    replaceIfRevision: function (id, revision, snapshot) {
      var value = clone(snapshot);
      if (value._id !== id) return Promise.reject(Object.assign(new Error("Identity mismatch."), { code: "INVALID_STORAGE_ID" }));
      return initialize().then(function () {
        var current = state.values.get(id);
        if (!current || current.revision !== revision) return false;
        state.values.set(id, value); return true;
      });
    },
    serialize: serialize
  };
}
module.exports = { createMemoryStorage: createMemoryStorage };
