var idleRecovery = require('./codex-idle-recovery');
var crypto = require('crypto');

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
      checkCurrent.phase('admission_gate');
      if (prior) checkCurrent.observe('admission_gate_pending');
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
    checkCurrent.phase('isolated_target');
    var prior = targets.get(threadId);
    if (!prior) return true;
    checkCurrent.observe('isolated_target_reserved');
    if (cleanupFailures.has(prior)) throw cleanupFailures.get(prior);
    await prior.retireIdleForRecovery(checkCurrent);
    await cleanup;
    checkCurrent();
    if (cleanupFailures.has(prior)) throw cleanupFailures.get(prior);
    return !targets.has(threadId);
  }

  async function prepareShared(threadId, checkCurrent) {
    checkCurrent.phase('shared_target');
    var state = ctx.state();
    if (state.initializing) { checkCurrent.observe('shared_runtime_initializing'); return false; }
    // Independent conversations do not participate in target handoff. Probing
    // every idle sibling first can consume the whole admission budget even
    // when this target can be unloaded immediately.
    if (state.server && state.entries.some(function(entry) {
      return !entry.handle || entry.handle.getRecoveryThreadId() !== threadId;
    })) {
      if (await idleRecovery.releaseThread(state.entries, state.server, threadId, checkCurrent)) return true;
      checkCurrent();
    }
    checkCurrent.phase('shared_idle_retirement');
    var retiredThreads = [];
    if (state.refCount > 0) {
      var snapshots = state.entries.map(function(entry) { return entry.handle && entry.handle.getIdleRecoverySnapshot(); });
      if (await idleRecovery.retireIdleQueries(state.entries, state.server, checkCurrent)) {
        retiredThreads = snapshots.filter(Boolean).map(function(snapshot) { return snapshot.threadId; });
      }
    }
    state = ctx.state();
    if (!state.server) return true;
    checkCurrent.phase('shared_runtime_release');
    if (!state.refCount && await idleRecovery.runtimeCanStop(state.server, retiredThreads, checkCurrent)) {
      var proc = state.server.proc;
      var stopped = await ctx.stopIdle();
      if (stopped) { unconfirmedSharedProcess = proc || null; checkSharedExit(); }
      return stopped;
    }
    checkCurrent.phase('shared_target');
    return idleRecovery.releaseThread(state.entries, state.server, threadId, checkCurrent);
  }

  async function waitUntilAvailable(queryOpts, action) {
    var checkLifecycle = checker(queryOpts);
    var startedAt = Date.now();
    var deadline = startedAt + (ctx.timeoutMs || 15000);
    var admitted = false;
    var observations = new Set();
    var lastEvidence = null;
    var ended = false;
    var phase = 'admission_gate';
    function targetKey(threadId) {
      return crypto.createHash('sha256').update(String(threadId || queryOpts.resumeSessionId || '')).digest('hex').slice(0, 16);
    }
    checkCurrent.phase = function(value) { phase = value; };
    function checkCurrent() {
      checkLifecycle();
      if (!admitted && Date.now() >= deadline) {
        var error = new Error('Tool recovery could not verify that this conversation is safe to resume. No message was sent to the runtime. Review your retained messages and send again when the runtime is available.');
        error.code = 'CODEX_RECOVERY_UNAVAILABLE';
        throw error;
      }
    }
    // Fixed evidence labels only: never log thread contents, RPC payloads,
    // commands, credentials, or provider error strings. Bound polling noise.
    checkCurrent.observe = function(reason, method, rpcCode, threadId) {
      if (ended) return;
      var evidence = { reason: reason, phase: phase, targetKey: targetKey(threadId), method: method || null, rpcCode: Number.isInteger(rpcCode) ? rpcCode : null };
      lastEvidence = evidence;
      var key = JSON.stringify(evidence);
      if (observations.has(key) || observations.size >= 24) return;
      observations.add(key);
      if (typeof queryOpts.onRecoveryDiagnostic === 'function') {
        try { queryOpts.onRecoveryDiagnostic(Object.assign({ elapsedMs: Date.now() - startedAt }, evidence)); } catch (error) {}
      }
    };
    checkCurrent.admit = function() { checkCurrent(); admitted = true; };
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
      ended = true;
      if (typeof queryOpts.onRecoveryDiagnostic === 'function') {
        try { queryOpts.onRecoveryDiagnostic({ reason: admitted ? 'admission_granted' : 'admission_ended_without_grant', phase: phase, targetKey: targetKey(), elapsedMs: Date.now() - startedAt, lastEvidence: lastEvidence }); } catch (error) {}
      }
      if (typeof queryOpts.onRecoveryAdmission === 'function') queryOpts.onRecoveryAdmission(false);
    }
  }

  function createQuery(queryOpts) {
    return waitUntilAvailable(queryOpts, async function(checkCurrent) {
      if (!await releaseTarget(queryOpts.resumeSessionId, checkCurrent)) return false;
      if (!await prepareShared(queryOpts.resumeSessionId, checkCurrent)) return false;
      // Once ownership is reserved, normal startup/cleanup owns cancellation.
      // A deadline must not discard a handle being created after admission.
      checkCurrent.admit();
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
      return waitUntilAvailable(queryOpts, async function(checkCurrent) {
        var released = await releaseTarget(queryOpts.resumeSessionId, checkCurrent);
        if (released) checkCurrent.admit();
        return released;
      });
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
