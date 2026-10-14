// A transport error must settle startup even before a query iterator exists.
function attachWorkerStartup(worker, options) {
  options = options || {};
  var schedule = options.setTimeout || setTimeout;
  var cancel = options.clearTimeout || clearTimeout;
  var timer;
  var settled = false;
  worker.readyPromise = new Promise(function(resolve, reject) {
    worker._readyResolve = function() { settle(null, resolve, reject); };
    worker._readyReject = function(error) { settle(error, resolve, reject); };
  });
  // Warmup and cancellation may abandon startup before their await is installed.
  worker.readyPromise.catch(function() {});
  function settle(error, resolve, reject) {
    if (settled) return;
    settled = true;
    if (timer) cancel(timer);
    worker._readyResolve = null;
    worker._readyReject = null;
    if (error) reject(error); else resolve();
  }
  timer = schedule(function() {
    if (worker._readyReject) worker._readyReject(new Error("Claude worker did not become ready before the startup deadline."));
    if (typeof worker.kill === "function") worker.kill();
  }, options.timeoutMs || 180000);
  if (timer && typeof timer.unref === "function") timer.unref();
}
module.exports = { attachWorkerStartup: attachWorkerStartup };
