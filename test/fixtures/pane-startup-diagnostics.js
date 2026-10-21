// Injected synchronously as the first head script by the isolated fixture only.
(function () {
  performance.setResourceTimingBufferSize(4096);
  window.__paneFixtureTimingOverflow = false;
  window.__paneFixtureErrors = [];
  performance.addEventListener('resourcetimingbufferfull', function () { window.__paneFixtureTimingOverflow = true; });
  function path(value) {
    try { var url = new URL(value, location.href); return url.origin + url.pathname; }
    catch (error) { return ''; }
  }
  function record(kind, message, source, line) {
    if (window.__paneFixtureErrors.length >= 20) return;
    window.__paneFixtureErrors.push({ kind: kind, message: String(message || '').slice(0, 240), source: path(source), line: line || 0, at: Math.round(performance.now()) });
  }
  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      record('resource', target.tagName + ' failed to load', target.src || target.href, 0);
    } else record('error', event.message, event.filename, event.lineno);
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    record('rejection', reason && reason.message || (typeof reason === 'string' ? reason : 'Unhandled rejection'), '', 0);
  });
}());
