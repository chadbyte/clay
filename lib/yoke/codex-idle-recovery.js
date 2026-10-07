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

module.exports = { retireIdleQueries: retireIdleQueries, checkAbort: checkAbort };
