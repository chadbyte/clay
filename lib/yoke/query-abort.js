// Query-local cancellation. Never terminates a shared provider process.
function bindAbort(controller, abort) {
  var signal = controller && controller.signal;
  if (!signal) return function () {};
  if (signal.aborted) { abort(); return function () {}; }
  signal.addEventListener('abort', abort, { once: true });
  return function () { signal.removeEventListener('abort', abort); };
}

function createAbortScope() {
  var stopped = false;
  var controller = new AbortController();
  var waiting = new Set();
  function error() { var err = new Error('Query cancelled'); err.name = 'AbortError'; return err; }
  return {
    signal: controller.signal,
    stopped: function () { return stopped; },
    wait: function (promise) {
      return new Promise(function (resolve, reject) {
        function cancel() { reject(error()); }
        if (stopped) cancel();
        else waiting.add(cancel);
        Promise.resolve(promise).then(function (value) {
          waiting.delete(cancel);
          if (stopped) cancel(); else resolve(value);
        }, function (err) { waiting.delete(cancel); reject(err); });
      });
    },
    stop: function () {
      if (stopped) return;
      stopped = true;
      controller.abort();
      waiting.forEach(function (cancel) { cancel(); });
      waiting.clear();
    },
    check: function () { if (stopped) throw error(); },
  };
}

module.exports = { bindAbort: bindAbort, createAbortScope: createAbortScope };
