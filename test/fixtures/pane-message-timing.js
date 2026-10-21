// Fixture-only timing around the actual WebSocket message callback. Captures
// bounded type/timing metadata, never payloads, identifiers or transcript text.
(function () {
  var descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  if (!descriptor || !descriptor.set || !descriptor.get) return;
  var callbacks = new WeakMap();
  var records = window.__paneFixtureMessageTiming = [];
  window.__paneFixtureMessageTimingOverflow = false;
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: descriptor.configurable, enumerable: descriptor.enumerable,
    get: function () { return callbacks.has(this) ? callbacks.get(this) : descriptor.get.call(this); },
    set: function (callback) {
      callbacks.set(this, callback);
      if (typeof callback !== 'function') { descriptor.set.call(this, callback); return; }
      descriptor.set.call(this, function (event) {
        var type = 'unknown';
        try { var value = JSON.parse(event.data); if (value && /^[a-z_]{1,64}$/.test(value.type)) type = value.type; } catch (error) {}
        var started = performance.now();
        try { return callback.call(this, event); }
        finally {
          var duration = performance.now() - started;
          if (records.length < 256) records.push({ type: type, startMs: started, durationMs: duration });
          else window.__paneFixtureMessageTimingOverflow = true;
        }
      });
    },
  });
}());
