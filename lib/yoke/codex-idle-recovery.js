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

function terminalsAreIdle(result) {
  if (!result || result.nextCursor) return false;
  var terminals = Array.isArray(result) ? result
    : result.data || result.terminals || result.backgroundTerminals || result.items;
  if (!Array.isArray(terminals)) return false;
  return terminals.every(function(terminal) {
    var status = String(terminal && (terminal.status || terminal.state) || "").toLowerCase();
    return /^(exited|terminated|completed|failed)$/.test(status);
  });
}

async function retireIdleQueries(entries, server, checkCurrent) {
  checkCurrent();
  var candidates = [];
  for (var i = 0; i < entries.length; i++) {
    var handle = entries[i].handle;
    var snapshot = handle && handle.getIdleRecoverySnapshot && handle.getIdleRecoverySnapshot();
    if (!snapshot) return false;
    candidates.push({ handle: handle, snapshot: snapshot });
  }
  var safe = await Promise.all(candidates.map(function(candidate) {
    return server.send("thread/backgroundTerminals/list", {
      threadId: candidate.snapshot.threadId,
    }, 5000).then(terminalsAreIdle, function() { return false; });
  }));
  checkCurrent();
  for (var ci = 0; ci < candidates.length; ci++) {
    var current = candidates[ci].handle.getIdleRecoverySnapshot();
    if (!safe[ci] || !current || current.revision !== candidates[ci].snapshot.revision) return false;
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
    if (remaining <= 0) return null;
    var result;
    try {
      result = await server.send('thread/loaded/list', { cursor: cursor, limit: 100 }, remaining);
    } catch (error) {
      checkCurrent();
      if (!server.started) throw error;
      return null;
    }
    checkCurrent();
    if (!result || !Array.isArray(result.data) || !result.data.every(function(id) { return typeof id === 'string'; })) return null;
    threads = threads.concat(result.data);
    if (!result.nextCursor) return threads;
    if (result.nextCursor === cursor) return null;
    cursor = result.nextCursor;
  }
  return null;
}

async function threadIsAbsent(server, threadId, checkCurrent) {
  var threads = await loadedThreads(server, checkCurrent);
  return !!threads && threads.indexOf(threadId) === -1;
}

async function runtimeCanStop(server, retiredThreads, checkCurrent) {
  var threads = await loadedThreads(server, checkCurrent);
  return !!threads && threads.every(function(threadId) { return retiredThreads.indexOf(threadId) !== -1; });
}

async function releaseThread(entries, server, threadId, checkCurrent) {
  if (!server || !server.started) throw new Error('Codex disconnected while checking recovery admission');
  var matching = entries.filter(function(entry) {
    return entry.handle && entry.handle.getRecoveryThreadId() === threadId;
  });
  if (!matching.length && await threadIsAbsent(server, threadId, checkCurrent)) return true;
  if (matching.length) {
    if (!await retireIdleQueries(matching, server, checkCurrent)) return false;
    checkCurrent();
  } else {
    // A closed SDK handle can leave a loaded provider thread behind. Only an
    // explicitly idle provider thread with verified terminal state may unload.
    try {
      var status = await server.send('thread/read', { threadId: threadId, includeTurns: false }, 5000);
      checkCurrent();
      if (!status || !status.thread || status.thread.id !== threadId
          || !status.thread.status || status.thread.status.type !== 'idle') return false;
      var terminals = await server.send('thread/backgroundTerminals/list', { threadId: threadId }, 5000);
      checkCurrent();
      if (!terminalsAreIdle(terminals)) return false;
    } catch (error) { checkCurrent(); if (!server.started) throw error; return false; }
  }
  try { await server.send('thread/unsubscribe', { threadId: threadId }, 5000); }
  catch (error) { checkCurrent(); if (!server.started) throw error; return false; }
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
