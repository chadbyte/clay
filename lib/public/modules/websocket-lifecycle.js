// websocket-lifecycle.js - bounded connection attempt and retry policy

var DEFAULTS = {
  handshakeTimeoutMs: 12000,
  stableConnectionMs: 15000,
  retryMinMs: 1000,
  retryMaxMs: 15000,
  jitterRatio: 0.2,
  authTimeoutMs: 4000
};

function createWebSocketLifecycle(options) {
  var config = Object.assign({}, DEFAULTS, options || {});
  var epoch = 0;
  var retryAttempt = 0;
  var retryTimer = null;
  var handshakeTimer = null;
  var stableTimer = null;
  var authTimer = null;
  var authInFlight = false;
  var authCancel = null;
  var authGeneration = 0;
  var stableEpoch = 0;
  var cancelled = false;
  var offline = false;

  function clearTimer(timer) {
    if (timer) clearTimeout(timer);
    return null;
  }

  function clearTimers() {
    retryTimer = clearTimer(retryTimer);
    handshakeTimer = clearTimer(handshakeTimer);
    stableTimer = clearTimer(stableTimer);
    authTimer = clearTimer(authTimer);
    stableEpoch = 0;
    if (authCancel) authCancel();
    authCancel = null;
    authInFlight = false;
  }

  function current(value) {
    return value === epoch && !cancelled;
  }

  function canProceed(value) {
    return current(value) && !offline;
  }

  function beginAttempt() {
    clearTimers();
    cancelled = false;
    epoch += 1;
    var attemptEpoch = epoch;
    handshakeTimer = setTimeout(function () {
      handshakeTimer = null;
      if (current(attemptEpoch) && config.onHandshakeTimeout) config.onHandshakeTimeout(attemptEpoch);
    }, config.handshakeTimeoutMs);
    return attemptEpoch;
  }

  function delayForAttempt() {
    var base = Math.min(config.retryMaxMs, config.retryMinMs * Math.pow(1.5, retryAttempt));
    retryAttempt += 1;
    var jitter = base * config.jitterRatio;
    var random = config.random || Math.random;
    return Math.min(config.retryMaxMs, Math.max(0, Math.round(base - jitter + random() * jitter * 2)));
  }

  function schedule(reason, callback) {
    if (cancelled || offline || retryTimer) return null;
    var scheduledEpoch = epoch;
    var delay = delayForAttempt();
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (!canProceed(scheduledEpoch)) return;
      callback(scheduledEpoch, reason, delay);
    }, delay);
    return { epoch: scheduledEpoch, delay: delay };
  }

  function clearRetry() {
    retryTimer = clearTimer(retryTimer);
  }

  function beginAuth(authEpoch, onTimeout, onCancel) {
    if (!canProceed(authEpoch) || authInFlight) return null;
    authInFlight = true;
    authGeneration += 1;
    var authToken = { epoch: authEpoch, generation: authGeneration };
    authCancel = onCancel || null;
    authTimer = setTimeout(function () {
      authTimer = null;
      authInFlight = false;
      authCancel = null;
      if (canProceed(authEpoch) && onTimeout) onTimeout(authEpoch);
    }, config.authTimeoutMs);
    return authToken;
  }

  function finishAuth(authEpoch, authToken) {
    if (!authInFlight || !current(authEpoch) || !authToken || authToken.epoch !== authEpoch || authToken.generation !== authGeneration) return false;
    authInFlight = false;
    authCancel = null;
    authTimer = clearTimer(authTimer);
    return true;
  }

  function markOpen(attemptEpoch) {
    if (!current(attemptEpoch)) return false;
    handshakeTimer = clearTimer(handshakeTimer);
    return true;
  }

  function markLive(attemptEpoch) {
    if (!current(attemptEpoch)) return false;
    handshakeTimer = clearTimer(handshakeTimer);
    if (stableEpoch === attemptEpoch) return true;
    stableEpoch = attemptEpoch;
    stableTimer = clearTimer(stableTimer);
    stableTimer = setTimeout(function () {
      stableTimer = null;
      if (current(attemptEpoch)) retryAttempt = 0;
    }, config.stableConnectionMs);
    return true;
  }

  function invalidate(attemptEpoch) {
    if (attemptEpoch !== epoch) return false;
    epoch += 1;
    clearTimers();
    return true;
  }

  function cancel() {
    cancelled = true;
    epoch += 1;
    clearTimers();
  }

  function setOffline(value) {
    var nextOffline = value === true;
    if (nextOffline === offline) return offline;
    offline = nextOffline;
    if (offline) {
      epoch += 1;
      clearTimers();
    }
    return offline;
  }

  function wake(callback) {
    offline = false;
    if (!cancelled && callback) callback();
  }

  return {
    beginAttempt: beginAttempt,
    beginAuth: beginAuth,
    cancel: cancel,
    canProceed: canProceed,
    clearRetry: clearRetry,
    current: current,
    finishAuth: finishAuth,
    invalidate: invalidate,
    markOpen: markOpen,
    markLive: markLive,
    schedule: schedule,
    setOffline: setOffline,
    wake: wake,
    getRetryAttempt: function () { return retryAttempt; },
    getEpoch: function () { return epoch; },
    isOffline: function () { return offline; }
  };
}

export { createWebSocketLifecycle };
