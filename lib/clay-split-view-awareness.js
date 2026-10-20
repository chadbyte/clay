var currentState = require('./session-activity-state').currentState;
var sessionRef = require('./workspace-query-service').sessionRef;
function describe(current, observed, slug, workerReads) {
  var sessions = current.project.getSessionManager().sessions;
  var snapshot = observed.status === 'observed' ? observed.snapshot : null;
  function member(origin, id) {
    var matches = Array.from(sessions.values()).filter(function (session) {
      return session.sessionOriginId === origin && (id == null || session.localId === id) && !session.hidden && !session.destroying &&
        (session.ownerId || null) === (current.principal.userId || null);
    });
    if (matches.length !== 1) return { sessionOriginId: origin, id: id, availability: 'unknown', runtime: { state: 'unknown' }, screen: { status: 'unknown' } };
    var session = matches[0];
    var panes = snapshot ? snapshot.panes.filter(function (pane) { return pane.origin === origin && pane.sessionId === session.localId; }) : [];
    return { sessionOriginId: origin, id: session.localId, sessionRef: sessionRef(slug, session), availability: 'available', runtime: currentState(session),
      linkedWorkers: workerReads && workerReads.has(origin) ? workerReads.get(origin).read() : { status: 'unknown', workers: [] },
      screen: { status: snapshot ? 'observed' : 'unknown', observedAt: observed.observedAt || null,
        windowHidden: snapshot ? snapshot.hidden : null, activeConversation: snapshot ? snapshot.activeSessionId === session.localId : null,
        focused: snapshot ? snapshot.focusOrigin === origin : null,
        panes: panes.map(function (pane) {
          var exact = !!(pane.binding && pane.binding.sessionId === session.localId && pane.binding.sessionOriginId === origin && pane.binding.requestId);
          return { visible: !snapshot.hidden && pane.visible && !pane.cached, cached: pane.cached, ready: pane.ready && exact, binding: exact ? pane.binding : null };
        }), evidence: 'Client observation, separate from server runtime state; absent panes do not imply idle or disconnected.' } };
  }
  var views = current.saved.views.map(function (view) {
    return Object.assign({}, view, { sessions: view.sessions.map(function (item) { return Object.assign({}, item, member(item.sessionOriginId, item.id)); }) });
  });
  var selected = snapshot && views.find(function (view) { return view.id === snapshot.viewId; });
  var currentView = { status: 'unknown', membershipSource: 'unknown', sessions: [], reason: 'No exact saved view or singleton observation; cached/visible panes alone do not establish full view membership.' };
  if (selected) currentView = { status: 'observed', id: selected.id, revision: selected.revision, observedRevision: snapshot.revision,
    configurationMatches: selected.revision === snapshot.revision && JSON.stringify(selected.tree) === JSON.stringify(snapshot.tree),
    membershipSource: 'persisted_view', sessions: selected.sessions };
  else if (snapshot && !snapshot.viewId && snapshot.singletonOrigin) currentView = { status: 'observed', id: null, membershipSource: 'observed_singleton', sessions: [member(snapshot.singletonOrigin)] };
  return { views: views, currentView: currentView, runtimeObservedAt: Date.now() };
}
module.exports = { describe: describe };
