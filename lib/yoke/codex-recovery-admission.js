var idleRecovery = require('./codex-idle-recovery');

// Serialize decisions, not whole model turns. Waiting for a target must release
// the gate so an unrelated Driver can still answer its Worker's permissions.
function attachRecoveryAdmission(ctx) {
  var handoff = null;
  var runtimes = [];
  var targets = new Map();
  var cleanupTasks = new Map();
  var cleanupFailures = new Map();
  var cleanup = Promise.resolve();
  var unconfirmedSharedProcess = null;

  function checkSharedExit() {
    if (!unconfirmedSharedProcess) return;
    if (unconfirmedSharedProcess.exitCode === null && unconfirmedSharedProcess.signalCode === null) {
      throw new Error('Codex shared runtime exit could not be confirmed; recovery remains reserved.');
    }
    unconfirmedSharedProcess = null;
  }

  function checker(queryOpts) {
    var epoch = ctx.state().epoch;
    return function() {
      idleRecovery.checkAbort(queryOpts);
      var state = ctx.state();
      if ((state.shuttingDown && !state.retiring) || state.epoch !== epoch) throw ctx.shutdownError();
    };
  }

  function cleanupRuntime(runtime) {
    if (cleanupTasks.has(runtime)) return cleanupTasks.get(runtime);
    var task = cleanup.catch(function() { return null; }).then(function() {
      return runtime.shutdownForRecovery();
    }).then(function() {
      runtimes = runtimes.filter(function(current) { return current !== runtime; });
      targets.forEach(function(current, threadId) { if (current === runtime) targets.delete(threadId); });
      cleanupTasks.delete(runtime);
      return true;
    }, function(error) {
      console.error('[yoke/codex] Isolated recovery runtime shutdown failed:', error.message || error);
      // Retain ownership after an unconfirmed exit. In particular, never admit
      // a second writer just because bounded process cleanup reached its limit.
      cleanupFailures.set(runtime, error);
      return false;
    });
    cleanupTasks.set(runtime, task);
    cleanup = task;
    return task;
  }

  async function withAdmission(checkCurrent, action) {
    var release;
    var prior = handoff;
    var own = new Promise(function(resolve) { release = resolve; });
    var tail = Promise.resolve(prior).then(function() { return own; });
    handoff = tail;
    tail.then(function() { if (handoff === tail) handoff = null; });
    try {
      await idleRecovery.wait(prior || Promise.resolve(), checkCurrent);
      await idleRecovery.wait(cleanup, checkCurrent);
      checkSharedExit();
      return await action();
    } finally {
      // An aborted waiter still links to its predecessor. Releasing its own
      // slot cannot let a later caller overtake a probe that is still running.
      release();
    }
  }

  async function releaseTarget(threadId, checkCurrent) {
    var prior = targets.get(threadId);
    if (!prior) return true;
    if (cleanupFailures.has(prior)) throw cleanupFailures.get(prior);
    await prior.retireIdleForRecovery(checkCurrent);
    await cleanup;
    checkCurrent();
    if (cleanupFailures.has(prior)) throw cleanupFailures.get(prior);
    return !targets.has(threadId);
  }

  async function prepareShared(threadId, checkCurrent) {
    var state = ctx.state();
    if (state.initializing) return false;
    var retiredThreads = [];
    if (state.refCount > 0) {
      var snapshots = state.entries.map(function(entry) { return entry.handle && entry.handle.getIdleRecoverySnapshot(); });
      if (await idleRecovery.retireIdleQueries(state.entries, state.server, checkCurrent)) {
        retiredThreads = snapshots.filter(Boolean).map(function(snapshot) { return snapshot.threadId; });
      }
    }
    state = ctx.state();
    if (!state.server) return true;
    if (!state.refCount && await idleRecovery.runtimeCanStop(state.server, retiredThreads, checkCurrent)) {
      var proc = state.server.proc;
      var stopped = await ctx.stopIdle();
      if (stopped) { unconfirmedSharedProcess = proc || null; checkSharedExit(); }
      return stopped;
    }
    return idleRecovery.releaseThread(state.entries, state.server, threadId, checkCurrent);
  }

  async function waitUntilAvailable(queryOpts, action) {
    var checkCurrent = checker(queryOpts);
    var waiting = false;
    if (typeof queryOpts.onRecoveryAdmission === 'function') queryOpts.onRecoveryAdmission(true);
    try {
      while (true) {
        checkCurrent();
        // Cancellation returns to the caller immediately, but an in-flight
        // unsubscribe or shutdown retains the gate until its bounded RPC settles.
        var result = await idleRecovery.wait(withAdmission(checkCurrent, action.bind(null, checkCurrent)), checkCurrent);
        if (result) {
          if (waiting && typeof queryOpts.onRecoveryWaiting === 'function') queryOpts.onRecoveryWaiting(false);
          return result;
        }
        if (!waiting && typeof queryOpts.onRecoveryWaiting === 'function') queryOpts.onRecoveryWaiting(true);
        waiting = true;
        await idleRecovery.wait(new Promise(function(resolve) { setTimeout(resolve, 50); }), checkCurrent);
      }
    } finally {
      if (typeof queryOpts.onRecoveryAdmission === 'function') queryOpts.onRecoveryAdmission(false);
    }
  }

  function createQuery(queryOpts) {
    return waitUntilAvailable(queryOpts, async function(checkCurrent) {
      if (!await releaseTarget(queryOpts.resumeSessionId, checkCurrent)) return false;
      if (!await prepareShared(queryOpts.resumeSessionId, checkCurrent)) return false;
      checkCurrent();
      var runtime = ctx.createRuntime(queryOpts);
      runtimes.push(runtime);
      targets.set(queryOpts.resumeSessionId, runtime);
      try {
        return await runtime.createQuery(Object.assign({}, queryOpts, {
          isolatedRecovery: true,
          onRuntimeFinished: function() { return cleanupRuntime(runtime); },
        }));
      } catch (error) {
        await cleanupRuntime(runtime);
        throw error;
      }
    });
  }

  return {
    createQuery: createQuery,
    pending: function() { return handoff; },
    checkSharedExit: checkSharedExit,
    hasTarget: function(threadId) { return targets.has(threadId); },
    waitForTarget: function(queryOpts) {
      return waitUntilAvailable(queryOpts, function(checkCurrent) { return releaseTarget(queryOpts.resumeSessionId, checkCurrent); });
    },
    shutdown: function() {
      return Promise.all(runtimes.slice().map(cleanupRuntime)).then(function(results) {
        checkSharedExit();
        if (results.indexOf(false) !== -1) throw new Error('Codex recovery runtime cleanup could not be confirmed.');
        return cleanup;
      });
    },
  };
}

module.exports = { attachRecoveryAdmission: attachRecoveryAdmission };
