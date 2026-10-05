// Rate-limited log hint for rejected WebSocket origins. State is fixed-size
// (one timestamp and one counter), so hostile traffic cannot grow memory or
// flood the daemon log. Only Origin and Host are logged, never cookies or tokens.
var DEFAULT_INTERVAL_MS = 60000;
var MAX_VALUE_LENGTH = 200;

function safeValue(value) {
  if (typeof value !== "string") return "(none)";
  var text = value.length > MAX_VALUE_LENGTH ? value.slice(0, MAX_VALUE_LENGTH) + "..." : value;
  // JSON quoting escapes newlines and control characters, preventing log injection.
  return JSON.stringify(text);
}

function createOriginRejectionLogger(options) {
  var opts = options || {};
  var intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;
  var now = opts.now || Date.now;
  var log = opts.log || function (message) { console.warn(message); };
  var lastLoggedAt = null;
  var suppressed = 0;

  return function logRejectedOrigin(origin, host) {
    var current = now();
    if (lastLoggedAt !== null && current - lastLoggedAt < intervalMs) {
      suppressed++;
      return false;
    }
    var message = "[network] Rejected WebSocket connection from origin " + safeValue(origin) +
      " (Host " + safeValue(host) + "). If this is your reverse proxy or tunnel address, an administrator can add it in Server Settings > Network.";
    if (suppressed > 0) message += " " + suppressed + " similar rejection(s) were not logged.";
    lastLoggedAt = current;
    suppressed = 0;
    log(message);
    return true;
  };
}

module.exports = { createOriginRejectionLogger: createOriginRejectionLogger };
