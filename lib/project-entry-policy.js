var activity = require('./session-activity-state');
var provenance = require('./session-provenance');
var background = require('./background-task-timing');
var DAY = 24 * 60 * 60 * 1000;
function timestamp(value) { return Number.isFinite(value) && value > 0 ? value : null; }
function working(session) {
  var state = activity.currentState(session);
  if (state.processing || state.starting || state.recoveryStopPending || background.countUserTasks(session.activeBackgroundTasks) > 0) return true;
  if (state.stopRequested || state.queuePaused) return false;
  return state.pendingApprovalCount > 0 || state.pendingInputCount > 0 ||
    session._queuedTurnCount > 0 || !!session._pendingMessageClaimId;
}
// No file mtime or view timestamp: these can change merely by opening history.
function stoppedAt(session) {
  var value = timestamp(session.workStoppedAt);
  var history = session.history || [];
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i].type === 'done' && timestamp(history[i]._ts)) { value = Math.max(value || 0, history[i]._ts); break; }
  }
  return value || (session.workTimestampUnknown ? null : timestamp(session.createdAt));
}
function observe(session, now) {
  var active = working(session), previous = session._entryWorkActive;
  session._entryWorkActive = active;
  if (previous === true && !active) { session.workStoppedAt = now; return true; }
  return false;
}
function eligible(session) {
  return session && !session.hidden && !session.isMate && !provenance.isWorker(session) &&
    (session.runtimeMode || session.mode || 'gui') === 'gui' && !session.tuiSuspended && typeof session.sessionOriginId === 'string';
}
function choose(sessions, visits, now) {
  var candidates = sessions.filter(eligible), owned = provenance.ownedWorkersByDriver(sessions);
  var byOrigin = Object.create(null);
  candidates.forEach(function (session) {
    if (Object.prototype.hasOwnProperty.call(byOrigin, session.sessionOriginId)) byOrigin[session.sessionOriginId] = null;
    else byOrigin[session.sessionOriginId] = session;
  });
  function state(session) {
    var scope = [session].concat(owned[session.localId] || []);
    return { running: scope.some(working), stoppedAt: Math.max.apply(Math, scope.map(function (item) { return stoppedAt(item) || 0; })) };
  }
  var visited = (visits || []).map(function (visit) { return byOrigin[visit.originId]; }).filter(Boolean);
  var last = visited[0];
  if (last) {
    var lastState = state(last);
    if (lastState.running || lastState.stoppedAt > 0 && now >= lastState.stoppedAt && now - lastState.stoppedAt < DAY) return last;
  }
  var running = visited.find(function (session) { return state(session).running; });
  if (running) return running;
  // Unvisited running work has no human visit order. Stable origins break ties.
  return candidates.filter(function (session) { return byOrigin[session.sessionOriginId] === session && state(session).running; })
    .sort(function (a, b) { return a.sessionOriginId.localeCompare(b.sessionOriginId); })[0] || null;
}
module.exports = { choose: choose, eligible: eligible, working: working, stoppedAt: stoppedAt, observe: observe };
