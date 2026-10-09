// Visibility policy for the ordinary desktop and mobile session lists.
// Debate sessions remain in the session cache for the Debate workbench and
// exact-session navigation; only their ordinary-list presentation is removed.

export function isDebateOwnedSession(session) {
  var phase = session && session.homeDebatePhase;
  return !!(session && (
    session.homeDebatePlanning === true
    || phase === "planning"
    || phase === "live"
    || phase === "ended"
    || phase === "interrupted"
    || (session.loop && session.loop.source === "debate")
  ));
}

export function ordinarySessionListSessions(sessions) {
  var source = Array.isArray(sessions) ? sessions : [];
  var hiddenIds = new Set();
  for (var i = 0; i < source.length; i++) {
    if (isDebateOwnedSession(source[i])) hiddenIds.add(source[i].id);
  }

  // A debate Driver owns its Worker rows even if an older Worker payload did
  // not copy the debate marker. Follow parent links so those children cannot
  // leak into the ordinary list as orphan Workers.
  var changed = true;
  while (changed) {
    changed = false;
    for (var j = 0; j < source.length; j++) {
      var session = source[j];
      if (hiddenIds.has(session.id) || !hiddenIds.has(session.parentSessionId)) continue;
      hiddenIds.add(session.id);
      changed = true;
    }
  }

  return source.filter(function (session) {
    return !hiddenIds.has(session.id);
  });
}
