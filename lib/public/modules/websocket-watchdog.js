// websocket-watchdog.js - suspendable liveness timers for the browser socket

function createWebSocketWatchdog(options) {
  var suspended = false;
  var heartbeatTimer = null;
  var heartbeatDeadlineTimer = null;
  var heartbeatSocket = null;
  var heartbeatEpoch = 0;
  var heartbeatGeneration = 0;
  var deadlineGeneration = 0;
  var probeTimer = null;
  var probeSocket = null;
  var probeEpoch = 0;
  var probeStartedAt = 0;
  var probeGeneration = 0;

  function clearHeartbeatDeadline() {
    deadlineGeneration += 1;
    if (heartbeatDeadlineTimer) clearTimeout(heartbeatDeadlineTimer);
    heartbeatDeadlineTimer = null;
  }

  function stopHeartbeat() {
    heartbeatGeneration += 1;
    clearHeartbeatDeadline();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    heartbeatSocket = null;
    heartbeatEpoch = 0;
  }

  function clearProbe() {
    probeGeneration += 1;
    if (probeTimer) clearTimeout(probeTimer);
    probeTimer = null;
    probeSocket = null;
    probeEpoch = 0;
    probeStartedAt = 0;
  }

  function suspend() {
    suspended = true;
    stopHeartbeat();
    clearProbe();
  }

  function resume() {
    var changed = suspended;
    suspended = false;
    return changed;
  }

  function startHeartbeat(socket, epoch) {
    stopHeartbeat();
    if (suspended || !socket) return false;
    heartbeatSocket = socket;
    heartbeatEpoch = epoch;
    var generation = heartbeatGeneration;
    heartbeatTimer = setInterval(function () {
      if (suspended || generation !== heartbeatGeneration) return;
      if (!options.isCurrent(socket, epoch)) {
        stopHeartbeat();
        return;
      }
      clearHeartbeatDeadline();
      var currentDeadlineGeneration = deadlineGeneration;
      heartbeatDeadlineTimer = setTimeout(function () {
        if (suspended || currentDeadlineGeneration !== deadlineGeneration) return;
        heartbeatDeadlineTimer = null;
        if (heartbeatSocket === socket && heartbeatEpoch === epoch && options.isCurrent(socket, epoch)) {
          options.onFailure("heartbeat_timeout", epoch, null);
        }
      }, options.heartbeatDeadlineMs);
      try {
        options.sendPing(socket);
      } catch (e) {
        options.onFailure("heartbeat_error", epoch, null);
      }
    }, options.heartbeatIntervalMs);
    return true;
  }

  function probe(socket, epoch) {
    if (suspended) return "suspended";
    if (probeTimer) return "pending";
    probeSocket = socket;
    probeEpoch = epoch;
    probeStartedAt = options.now();
    probeGeneration += 1;
    var generation = probeGeneration;
    probeTimer = setTimeout(function () {
      if (suspended || generation !== probeGeneration) return;
      probeTimer = null;
      if (probeSocket === socket && probeEpoch === epoch && options.isCurrent(socket, epoch)) {
        options.onFailure("probe_timeout", epoch, options.now() - probeStartedAt);
      }
    }, options.probeTimeoutMs);
    try {
      options.sendPing(socket);
    } catch (e) {
      if (generation !== probeGeneration) return "cleared";
      var latency = options.now() - probeStartedAt;
      clearProbe();
      options.onFailure("probe_error", epoch, latency);
      return "failed";
    }
    return "started";
  }

  function acceptPong(socket, epoch) {
    if (heartbeatSocket === socket && heartbeatEpoch === epoch) clearHeartbeatDeadline();
    if (probeSocket === socket && probeEpoch === epoch) clearProbe();
  }

  return {
    acceptPong: acceptPong,
    clearProbe: clearProbe,
    probe: probe,
    resume: resume,
    startHeartbeat: startHeartbeat,
    stopHeartbeat: stopHeartbeat,
    suspend: suspend
  };
}

export { createWebSocketWatchdog };
