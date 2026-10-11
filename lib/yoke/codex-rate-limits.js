// Account quota snapshots describe usage, never whether a turn was rejected.
function normalizeSnapshot(rateLimits) {
  var windows = [];
  ["primary", "secondary"].forEach(function (key) {
    var window = rateLimits[key];
    if (!window || window.windowDurationMins === 0) return;
    var duration = window.windowDurationMins;
    var used = window.usedPercent;
    windows.push({
      key: key,
      windowDurationMins: Number.isFinite(duration) && duration > 0 ? duration : null,
      usedPercent: Number.isFinite(used) && used >= 0 ? used : null,
      resetsAt: Number.isFinite(window.resetsAt) && window.resetsAt > 0 ? window.resetsAt : null,
    });
  });
  return {
    yokeType: "rate_limit",
    rateLimitInfo: {
      source: "account_snapshot",
      limitId: rateLimits.limitId || "codex",
      windows: windows,
    },
  };
}

module.exports = { normalizeSnapshot: normalizeSnapshot };
