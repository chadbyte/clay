function recordQuotaSnapshot(session, info, sendAndRecord) {
  var message = {
    type: "rate_limit_usage",
    sessionId: session.localId,
    vendor: session.vendor,
    source: "account_snapshot",
    limitId: info.limitId,
    quotaWindows: info.windows.map(function (window) {
      return Object.assign({}, window, { resetsAt: window.resetsAt ? window.resetsAt * 1000 : null });
    }),
  };
  var snapshots = session._quotaSnapshots || (session._quotaSnapshots = Object.create(null));
  var key = JSON.stringify([session.ownerId, session.vendor, info.limitId]);
  var serialized = JSON.stringify(message);
  if (snapshots[key] === serialized) return;
  snapshots[key] = serialized;
  sendAndRecord(session, message);
}

function attachQuotaSnapshots(sm) {
  if (typeof sm.addOnSessionViewed !== "function") return;
  sm.addOnSessionViewed(function (session, ws, send) {
    var seen = Object.create(null);
    var history = session.history || [];
    // A deduplicated snapshot may precede the initial page of chat history.
    for (var i = history.length - 1; i >= 0; i--) {
      var entry = history[i];
      if (entry.type !== "rate_limit_usage" || entry.source !== "account_snapshot" || entry.vendor !== session.vendor) continue;
      if (seen[entry.limitId]) continue;
      seen[entry.limitId] = true;
      send(Object.assign({}, entry, { sessionId: session.localId }));
    }
  });
}

module.exports = { recordQuotaSnapshot: recordQuotaSnapshot, attachQuotaSnapshots: attachQuotaSnapshots };
