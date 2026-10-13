var fs = require("fs");

var MIN_COMPACTION_BYTES = 1024 * 1024;
var MAX_WRITE_AMPLIFICATION = 3;
var MAX_WRITES_WITHOUT_COMPACTION = 64;
var FAILURE_HEADROOM_BYTES = 4 * 1024 * 1024;
var FAILURE_AMPLIFICATION = 6;

// Shared by every service instance for this filename. No interval or background work:
// maintenance runs inside the same I/O gate as writes, reads and failed-write reloads.
function attachKnowledgeDbNedbMaintenance(ctx) {
  var entry = ctx.entry;
  if (!entry.storage) entry.storage = {
    queue: Promise.resolve(), store: null, cached: [], sizes: new Map(), liveBytes: 0,
    journalBytes: 0, peakJournalBytes: 0, journalUnknown: false, successfulWrites: 0,
    writesSinceCompaction: 0, compactions: 0, failedCompactions: 0, recoveries: 0,
    maintenancePending: false, maintenanceError: null
  };
  var state = entry.storage;
  function enqueue(work) {
    var next = state.queue.catch(function () {}).then(work);
    state.queue = next.catch(function () {}); return next;
  }
  function size(value) { return Buffer.byteLength(JSON.stringify(value), "utf8") + 1; }
  function refresh(store) {
    state.store = store; state.cached = store.getAllData(); state.sizes = new Map(); state.liveBytes = 0;
    state.cached.forEach(function (value) { var bytes = size(value); state.sizes.set(value._id, bytes); state.liveBytes += bytes; });
  }
  function issue(cause) { state.maintenancePending = true; state.maintenanceError = cause.message || String(cause); }
  async function measure() {
    try {
      state.journalBytes = (await fs.promises.stat(ctx.filename)).size; state.journalUnknown = false;
      state.peakJournalBytes = Math.max(state.peakJournalBytes, state.journalBytes);
      return true;
    } catch (cause) { state.journalUnknown = true; issue(cause); return false; }
  }
  async function ensure() {
    var store = await ctx.open();
    if (state.store !== store) { refresh(store); await measure(); }
    return store;
  }
  async function compact(store) {
    try {
      // Supported datastore API also participates in NeDB's own executor.
      await store.compactDatafileAsync();
      state.compactions++; state.writesSinceCompaction = 0;
      if (await measure()) { state.maintenancePending = false; state.maintenanceError = null; }
    } catch (cause) { state.failedCompactions++; issue(cause); await measure(); }
  }
  function due() {
    return state.journalBytes > Math.max(MIN_COMPACTION_BYTES, MAX_WRITE_AMPLIFICATION * state.liveBytes) ||
      state.writesSinceCompaction >= MAX_WRITES_WITHOUT_COMPACTION && state.journalBytes - state.liveBytes >= MIN_COMPACTION_BYTES;
  }
  function blocked() {
    return state.maintenancePending && (state.journalUnknown || state.journalBytes > Math.max(FAILURE_HEADROOM_BYTES, FAILURE_AMPLIFICATION * state.liveBytes));
  }
  function read(work) { return enqueue(async function () { return work(await ensure()); }); }
  function write(work, value) {
    return enqueue(async function () {
      var store = await ensure(); var attempted = false;
      if (state.maintenancePending) { attempted = true; await compact(store); }
      // Repeated maintenance failure cannot allow unbounded journal growth. This
      // rejection happens before the next canonical write, never after its success.
      if (blocked()) throw Object.assign(new Error("Knowledge database maintenance must recover before more writes: " + state.maintenanceError), { code: "STORAGE_MAINTENANCE_BLOCKED" });
      var result;
      try { result = await work(store); }
      catch (cause) {
        // NeDB changes indexes before appending. Hold the shared gate through reload
        // so another database cannot compact or persist an unsaved in-memory state.
        try {
          await store.loadDatabaseAsync(); refresh(store); state.recoveries++; state.writesSinceCompaction = 0;
          if (await measure()) { state.maintenancePending = false; state.maintenanceError = null; }
        } catch (recoveryCause) { state.store = null; state.cached = []; issue(recoveryCause); ctx.invalidate(); }
        throw cause;
      }
      if (result && result.numAffected === 0) return result;
      var bytes = size(value); state.liveBytes += bytes - (state.sizes.get(value._id) || 0); state.sizes.set(value._id, bytes);
      state.cached = store.getAllData(); state.successfulWrites++; state.writesSinceCompaction++;
      if (await measure() && !attempted && due()) await compact(store);
      // A maintenance error never changes a successful canonical write into a failure.
      return result;
    });
  }
  function status() {
    return read(async function () {
      await measure();
      return { maintenancePending: state.maintenancePending, maintenanceError: state.maintenanceError,
        liveBytes: state.liveBytes, journalBytes: state.journalBytes, peakJournalBytes: state.peakJournalBytes,
        successfulWrites: state.successfulWrites, writesSinceCompaction: state.writesSinceCompaction,
        compactions: state.compactions, failedCompactions: state.failedCompactions, recoveries: state.recoveries };
    });
  }
  return { read: read, write: write, cached: function () { return state.cached; }, readStorageStatus: status };
}

module.exports = { attachKnowledgeDbNedbMaintenance: attachKnowledgeDbNedbMaintenance,
  MIN_COMPACTION_BYTES: MIN_COMPACTION_BYTES, MAX_WRITE_AMPLIFICATION: MAX_WRITE_AMPLIFICATION,
  MAX_WRITES_WITHOUT_COMPACTION: MAX_WRITES_WITHOUT_COMPACTION,
  FAILURE_HEADROOM_BYTES: FAILURE_HEADROOM_BYTES, FAILURE_AMPLIFICATION: FAILURE_AMPLIFICATION };
