// New execution pairs keep the Driver's current presentation; Workers live in pills.
import { showCreatedWorkerViewer } from './split-view-workers.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { splitGroupRoles } from './split-group-helpers.js';
import { setActiveView, switchToStandalone } from './split-view-presentations.js';

export function showCreatedWorkerPresentation(group) {
  var roles = splitGroupRoles(group), state = store.snap();
  if (!roles || state.paneMode || state.dmMode) return false;
  store.set({ createdWorkerPresentation: { group: group, slug: state.currentSlug, ownerId: state.myUserId,
    activeSessionId: state.activeSessionId, socketGeneration: state.projectSplitViewSocketGeneration } });
  return reconcileCreatedWorkerPresentation();
}
function reconcileCreatedWorkerPresentation() {
  var pending = store.get('createdWorkerPresentation'), state = store.snap();
  if (!pending) return false;
  if (pending.slug !== state.currentSlug || pending.ownerId !== state.myUserId || pending.activeSessionId !== state.activeSessionId ||
      pending.socketGeneration !== state.projectSplitViewSocketGeneration || !state.connected) {
    store.set({ createdWorkerPresentation: null }); return false;
  }
  var roles = splitGroupRoles(pending.group), sessions = getCachedSessions() || [];
  var driver = sessions.find(function (session) { return session.id === roles.driverId && session.sessionRole === 'driver' &&
    (session.ownerId || null) === (state.myUserId || null); });
  if (state.sessionListProjectSlug !== state.currentSlug || !driver || !driver.sessionOriginId || !getWs() || getWs().readyState !== 1) return false;
  store.set({ createdWorkerPresentation: null });
  showCreatedWorkerViewer(pending.group);
  if (state.activeSessionId === driver.id && !state.splitPanes) return true;
  var view = (state.projectSplitViews || []).find(function (item) {
    return item.sessions.some(function (ref) { return ref.id === driver.id && ref.sessionOriginId === driver.sessionOriginId; });
  });
  return view ? setActiveView(view.id, driver.sessionOriginId) : switchToStandalone(driver.id);
}
store.subscribe(function (state, previous) {
  if (state.createdWorkerPresentation && (state.paneBindingSessions !== previous.paneBindingSessions ||
      state.activeSessionId !== previous.activeSessionId || state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration ||
      state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId || state.connected !== previous.connected)) reconcileCreatedWorkerPresentation();
});
