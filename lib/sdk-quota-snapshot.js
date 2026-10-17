function recordQuotaSnapshot(session, info, sendAndRecord, observe) {
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
  if (Number.isFinite(info.observedAtMs)) message.observedAtMs = info.observedAtMs;
  // The overview records every live observation, including an unchanged one:
  // deduplication below only avoids re-recording identical history.
  if (typeof observe === "function") observe(session, message, Number.isFinite(info.observedAtMs) ? info.observedAtMs : Date.now());
  var snapshots = session._quotaSnapshots || (session._quotaSnapshots = Object.create(null));
  var key = JSON.stringify([session.ownerId, session.vendor, info.limitId]);
  var serialized = JSON.stringify(message);
  if (snapshots[key] === serialized) return;
  snapshots[key] = serialized;
  sendAndRecord(session, message);
}

// Observation listeners feed the owner-scoped vendor overview. They never
// influence rejection handling or scheduling.
function attachQuotaObservers(sm) {
  // Idempotent: the processor and the overview may attach in either order.
  if (typeof sm.addOnQuotaObserved === "function") return;
  var listeners = [];
  sm.addOnQuotaObserved = function (fn) { if (typeof fn === "function") listeners.push(fn); };
  sm.notifyQuotaObserved = function (session, message, observedAtMs) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](session, message, observedAtMs); } catch (e) { /* the overview is optional */ }
    }
  };
}

function attachQuotaSnapshots(sm) {
  attachQuotaObservers(sm);
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

module.exports = { recordQuotaSnapshot: recordQuotaSnapshot, attachQuotaSnapshots: attachQuotaSnapshots, attachQuotaObservers: attachQuotaObservers };
