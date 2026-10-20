// Cache only an already authorized, serialized projection for this live socket.
// Callers must recompute visibility before every delivery; this is not an access
// cache. Ordinary refreshes always send, even when their content is unchanged.
function createSessionListDelivery() {
  var delivered = new WeakMap();
  var MAX_CACHED_BYTES = 1024 * 1024;
  return function (ws, message, skipUnchanged) {
    if (!ws || ws.readyState !== 1) { if (ws) delivered.delete(ws); return false; }
    var encoded = JSON.stringify(message);
    if (skipUnchanged && delivered.get(ws) === encoded) return false;
    ws.send(encoded);
    if (Buffer.byteLength(encoded) <= MAX_CACHED_BYTES) delivered.set(ws, encoded);
    else delivered.delete(ws);
    return true;
  };
}
module.exports = { createSessionListDelivery: createSessionListDelivery };
