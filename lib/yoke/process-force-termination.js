// Terminate only the child owned by this query; never a shared server or PID scan.
function create(getProcess, hasExited, stopInput, options) {
  var pending = null;
  return function forceStop() {
    if (pending) return pending;
    stopInput();
    pending = new Promise(function (resolve) {
      var child = getProcess(), timer;
      function finish(terminated) {
        clearTimeout(timer);
        if (child) child.removeListener('exit', exited);
        resolve({ status: terminated ? 'terminated' : 'unconfirmed', scope: 'query-runtime', externalEffects: 'unconfirmed' });
      }
      function exited() { finish(true); }
      if (!child || hasExited()) { finish(true); return; }
      child.once('exit', exited);
      timer = setTimeout(function () { finish(false); }, options && options.timeoutMs || 5000);
      try { if (child.kill('SIGKILL') === false) finish(false); }
      catch (error) { finish(false); }
    });
    return pending;
  };
}
module.exports = { create: create };
