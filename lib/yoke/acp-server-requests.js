// Request IDs are retained for one child-process lifetime, including settled
// IDs. A full ledger closes the transport; it never evicts and replays effects.
function create(manager) {
  var process = null;
  var receipts = new Map();
  var capacity = 4096;
  return {
    admit: function(msg) {
      if (!manager.started || !manager.proc) return null;
      if (process !== manager.proc) { process = manager.proc; receipts = new Map(); }
      var key = typeof msg.id + ":" + msg.id;
      if (receipts.has(key)) return null;
      if (receipts.size >= capacity) {
        manager._write({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "ACP request tracking limit reached; transport closed without replay." } });
        manager.stop(new Error("ACP request tracking limit reached; transport closed without replay."));
        return null;
      }
      var receipt = { process: process, generation: manager._processGeneration, settled: false };
      receipts.set(key, receipt);
      return receipt;
    },
    finish: function(id, receipt) {
      if (!receipt || !manager.started || receipt.process !== manager.proc || receipt.generation !== manager._processGeneration ||
          receipt !== receipts.get(typeof id + ":" + id) || receipt.settled) return false;
      receipt.settled = true;
      return true;
    },
  };
}
module.exports = { create: create };
