// Retire retained inputs only after every query is verified idle. The adapter
// holds admission closed while this runs; existing handles may still receive
// messages, so their input revisions must be checked again after each probe.
function checkAbort(queryOpts) {
  var signal = queryOpts.abortController && queryOpts.abortController.signal;
  if (signal && signal.aborted) {
    var error = new Error("Query cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function listedTerminals(result) {
  if (!result || result.nextCursor) return null;
  var terminals = Array.isArray(result) ? result
    : result.data || result.terminals || result.backgroundTerminals || result.items;
  return Array.isArray(terminals) ? terminals : null;
}

// Current Codex lists only live processes without a status field; legacy
// builds reported finished states, so an explicit finished status still counts.
function terminalFinished(terminal) {
  var status = String(terminal && (terminal.status || terminal.state) || "").toLowerCase();
  return /^(exited|terminated|completed|failed)$/.test(status);
}

function terminalsAreIdle(result) {
  var terminals = listedTerminals(result);
  if (!terminals) return false;
  return terminals.every(terminalFinished);
}

function observe(checkCurrent, reason, method, rpcCode, threadId) {
  if (typeof checkCurrent.observe === 'function') checkCurrent.observe(reason, method, rpcCode, threadId);
}

async function probe(server, method, params, timeout, checkCurrent) {
  observe(checkCurrent, 'probe_started', method, null, params.threadId);
  try {
    var result = await server.send(method, params, timeout);
    observe(checkCurrent, 'probe_returned', method, null, params.threadId);
    return result;
  } catch (error) {
    observe(checkCurrent, 'probe_failed', method, error && Number.isInteger(error.code) ? error.code : null, params.threadId);
    throw error;
  }
}

function probeFailure(error, method) {
  if (error && (error.code === -32601 || error.code === -32602)) {
    var unsupported = new Error('Codex cannot verify recovery safety: ' + method + ' is unavailable or incompatible. No message was sent to the runtime.');
    unsupported.code = 'CODEX_RECOVERY_PROBE_UNAVAILABLE';
    throw unsupported;
  }
  return false;
}

// Owner-approved unblock for the conversation being resumed: its own live
// background terminals would be orphaned in the retired process anyway, so
// terminate them instead of retaining the conversation blocked forever.
// Only the recovery target's thread is ever touched; sibling conversations
// keep their background work. Requires the provider to report the thread
// idle first so an active turn's terminals are never stopped.
async function terminateTargetTerminals(server, threadId, checkCurrent, onTerminated) {
  var method = 'thread/read';
  var live;
  try {
    var status = await probe(server, method, { threadId: threadId, includeTurns: false }, 5000, checkCurrent);
    checkCurrent();
    if (!status || !status.thread || status.thread.id !== threadId
        || !status.thread.status || status.thread.status.type !== 'idle') return false;
    method = 'thread/backgroundTerminals/list';
    var terminals = listedTerminals(await probe(server, method, { threadId: threadId }, 5000, checkCurrent));
    checkCurrent();
    if (!terminals) return false;
    live = terminals.filter(function(terminal) { return !terminalFinished(terminal); });
  } catch (error) { checkCurrent(); if (!server.started) throw error; return probeFailure(error, method); }
  if (!live.length) return false;
  var commands = [];
  for (var i = 0; i < live.length; i++) {
    var processId = live[i] && (live[i].processId !== undefined && live[i].processId !== null ? live[i].processId : live[i].id);
    if (processId === undefined || processId === null || processId === '') return false;
    var outcome;
    try {
      outcome = await probe(server, 'thread/backgroundTerminals/terminate', { threadId: threadId, processId: String(processId) }, 5000, checkCurrent);
    } catch (error) {
      checkCurrent();
      if (!server.started) throw error;
      // An unsupported or failed terminate leaves the conversation retained,
      // exactly like before this repair existed. Never escalate it.
      return false;
    }
    checkCurrent();
    observe(checkCurrent, outcome && outcome.terminated === true
      ? 'background_terminal_terminated' : 'background_terminal_terminate_unconfirmed',
      'thread/backgroundTerminals/terminate', null, threadId);
    if (!outcome || outcome.terminated !== true) return false;
    if (typeof live[i].command === 'string' && live[i].command) commands.push(live[i].command);
  }
  if (typeof onTerminated === 'function') {
    try { onTerminated(commands, live.length); } catch (error) {}
  }
  return true;
}

async function retireIdleQueries(entries, server, checkCurrent, repair) {
  checkCurrent();
  var candidates = [];
  for (var i = 0; i < entries.length; i++) {
    var handle = entries[i].handle;
    var snapshot = handle && handle.getIdleRecoverySnapshot && handle.getIdleRecoverySnapshot();
    if (!snapshot) { observe(checkCurrent, 'idle_input_snapshot_unavailable', null, null, handle && handle.getRecoveryThreadId && handle.getRecoveryThreadId()); return false; }
    candidates.push({ handle: handle, snapshot: snapshot });
  }
  var safe = await Promise.all(candidates.map(function(candidate) {
    return probe(server, "thread/backgroundTerminals/list", {
      threadId: candidate.snapshot.threadId,
    }, 5000, checkCurrent).then(terminalsAreIdle, function(error) { return probeFailure(error, 'thread/backgroundTerminals/list'); });
  }));
  checkCurrent();
  for (var ci = 0; ci < candidates.length; ci++) {
    var current = candidates[ci].handle.getIdleRecoverySnapshot();
    if (!safe[ci]) {
      observe(checkCurrent, 'background_state_not_proven_idle', null, null, candidates[ci].snapshot.threadId);
      if (repair && repair.threadId && repair.threadId === candidates[ci].snapshot.threadId) {
        await terminateTargetTerminals(server, repair.threadId, checkCurrent, repair.onTerminated);
      }
      return false;
    }
    if (!current || current.revision !== candidates[ci].snapshot.revision) { observe(checkCurrent, 'input_changed_during_probe', null, null, candidates[ci].snapshot.threadId); return false; }
  }
  // No awaits between validation and closing every input. A new send either
  // already invalidated its snapshot or sees a closed input and resumes anew.
  var finished = candidates.map(function(candidate) {
    return candidate.handle.retireIdleForRecovery();
  });
  await Promise.all(finished);
  return true;
}

// A separate process may resume a different thread only after the shared
// process proves it has no writer for that thread. Never infer this from the
// number of query handles: Codex can retain a loaded thread after input ends.
async function loadedThreads(server, checkCurrent) {
  var cursor = null;
  var threads = [];
  var deadline = Date.now() + 5000;
  for (var page = 0; page < 20; page++) {
    var remaining = deadline - Date.now();
    if (remaining <= 0) { observe(checkCurrent, 'loaded_list_deadline'); return null; }
    var result;
    try {
      result = await probe(server, 'thread/loaded/list', { cursor: cursor, limit: 100 }, remaining, checkCurrent);
    } catch (error) {
      checkCurrent();
      if (!server.started) throw error;
      probeFailure(error, 'thread/loaded/list');
      return null;
    }
    checkCurrent();
    if (!result || !Array.isArray(result.data) || !result.data.every(function(id) { return typeof id === 'string'; })) { observe(checkCurrent, 'loaded_list_invalid'); return null; }
    threads = threads.concat(result.data);
    if (!result.nextCursor) return threads;
    if (result.nextCursor === cursor) { observe(checkCurrent, 'loaded_list_cursor_repeated'); return null; }
    cursor = result.nextCursor;
  }
  observe(checkCurrent, 'loaded_list_page_limit');
  return null;
}

async function threadIsAbsent(server, threadId, checkCurrent) {
  var threads = await loadedThreads(server, checkCurrent);
  if (threads && threads.indexOf(threadId) !== -1) observe(checkCurrent, 'target_still_loaded', null, null, threadId);
  return !!threads && threads.indexOf(threadId) === -1;
}

async function runtimeCanStop(server, retiredThreads, checkCurrent) {
  var threads = await loadedThreads(server, checkCurrent);
  if (!threads) return false;
  // The caller has no live handles and holds admission. Closed handles can
  // leave loaded threads that unsubscribe cannot release; prove every such
  // thread idle before stopping their shared process, including siblings.
  for (var threadId of threads) {
    if (retiredThreads.indexOf(threadId) === -1 && !await threadIsIdle(server, threadId, checkCurrent)) return false;
  }
  checkCurrent();
  return true;
}

async function threadIsIdle(server, threadId, checkCurrent) {
  var method = 'thread/read';
  try {
    var status = await probe(server, method, { threadId: threadId, includeTurns: false }, 5000, checkCurrent);
    checkCurrent();
    if (!status || !status.thread || status.thread.id !== threadId
        || !status.thread.status || status.thread.status.type !== 'idle') {
      observe(checkCurrent, status && status.thread && status.thread.id === threadId && status.thread.status && status.thread.status.type === 'active'
        ? 'provider_reports_active' : 'provider_idle_not_proven', method, null, threadId);
      return false;
    }
    method = 'thread/backgroundTerminals/list';
    var terminals = await probe(server, method, { threadId: threadId }, 5000, checkCurrent);
    checkCurrent();
    var idle = terminalsAreIdle(terminals);
    if (!idle) observe(checkCurrent, 'background_state_not_proven_idle', method, null, threadId);
    return idle;
  } catch (error) { checkCurrent(); if (!server.started) throw error; return probeFailure(error, method); }
}

async function releaseThread(entries, server, threadId, checkCurrent, repair) {
  if (!server || !server.started) throw new Error('Codex disconnected while checking recovery admission');
  var matching = entries.filter(function(entry) {
    return entry.handle && entry.handle.getRecoveryThreadId() === threadId;
  });
  if (!matching.length && await threadIsAbsent(server, threadId, checkCurrent)) return true;
  if (matching.length) {
    if (!await retireIdleQueries(matching, server, checkCurrent, repair)) return false;
    checkCurrent();
  } else {
    // A closed SDK handle can leave a loaded provider thread behind. Only an
    // explicitly idle provider thread with verified terminal state may unload.
    if (!await threadIsIdle(server, threadId, checkCurrent)) {
      if (repair && repair.threadId === threadId) {
        await terminateTargetTerminals(server, threadId, checkCurrent, repair.onTerminated);
      }
      return false;
    }
  }
  try {
    var result = await probe(server, 'thread/unsubscribe', { threadId: threadId }, 5000, checkCurrent);
    var status = result && result.status;
    observe(checkCurrent, ['unsubscribed', 'notSubscribed', 'notLoaded'].indexOf(status) !== -1 ? 'unsubscribe_' + status : 'unsubscribe_status_unknown', 'thread/unsubscribe', null, threadId);
  }
  catch (error) { checkCurrent(); if (!server.started) throw error; return probeFailure(error, 'thread/unsubscribe'); }
  return threadIsAbsent(server, threadId, checkCurrent);
}

// Poll the lifecycle without holding the admission lock. Also check Stop and
// shutdown while a provider probe, initialization, or process exit is pending.
function wait(promise, checkCurrent) {
  return new Promise(function(resolve, reject) {
    var timer = setInterval(function() {
      try { checkCurrent(); } catch (error) { clearInterval(timer); reject(error); }
    }, 25);
    Promise.resolve(promise).then(function(value) {
      clearInterval(timer);
      try { checkCurrent(); resolve(value); } catch (error) { reject(error); }
    }, function(error) { clearInterval(timer); reject(error); });
  });
}

module.exports = { retireIdleQueries: retireIdleQueries, checkAbort: checkAbort,
  releaseThread: releaseThread, runtimeCanStop: runtimeCanStop, wait: wait };
