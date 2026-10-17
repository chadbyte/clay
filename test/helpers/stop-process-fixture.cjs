// Observe native process termination before removing its writable fixture HOME.
function stopAndWait(server, timeoutMs) {
  var proc = server.proc;
  if (!proc || proc.exitCode != null || proc.signalCode != null) {
    server.stop();
    return Promise.resolve();
  }
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      proc.removeListener("close", closed);
      reject(new Error("Fixture provider did not confirm shutdown; storage retained"));
    }, timeoutMs || 5000);
    function closed() { clearTimeout(timer); resolve(); }
    proc.once("close", closed);
    try { server.stop(); } catch (error) {
      clearTimeout(timer); proc.removeListener("close", closed); reject(error);
    }
  });
}
module.exports = { stopAndWait: stopAndWait };
