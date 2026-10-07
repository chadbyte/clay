// Per-connection inbound WebSocket message limiter: more than `limit` messages in one second closes with 1008.
function applyWsRateLimit(ws, limit) {
  var msgCount = 0;
  var msgWindowStart = Date.now();
  var origEmit = ws.emit;
  ws.emit = function (event) {
    if (event === "message") {
      var now = Date.now();
      if (now - msgWindowStart >= 1000) {
        msgCount = 0;
        msgWindowStart = now;
      }
      msgCount++;
      if (msgCount > limit) {
        try {
          ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded. Connection will be closed." }));
          ws.close(1008, "Rate limit exceeded");
        } catch (e) {}
        return false;
      }
    }
    return origEmit.apply(ws, arguments);
  };
}
module.exports = { applyWsRateLimit: applyWsRateLimit, WS_RATE_LIMIT: 60 };
