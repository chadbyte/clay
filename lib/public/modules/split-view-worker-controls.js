import { store } from './store.js';
import { livePaneBinding } from './pane-binding.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { showToast } from './utils.js';
import { splitGroupRoles } from './split-group-helpers.js';

export function initSplitViewWorkerControls(openGroup) {
  document.addEventListener('clay-split-view-open-worker-controls', function (event) {
    var detail = event.detail || {}, state = store.snap(), sessions = getCachedSessions() || [];
    var driver = sessions.find(function (session) { return session.sessionOriginId === detail.driverOriginId && session.id === detail.driverId && session.sessionRole === 'driver'; });
    var view = (state.projectSplitViews || []).find(function (item) { return item.id === state.projectSplitViewActiveId; });
    var singleton = !view && state.projectSplitViewSingletonOrigin === detail.driverOriginId;
    var frame = document.querySelector('.split-pane[data-session-origin="' + CSS.escape(String(detail.driverOriginId || '')) + '"] .split-pane-frame');
    var live = frame && frame.clayPane && frame.clayPane.identity();
    var group = (state.splitGroups || []).find(function (item) { return String(item.id) === String(detail.groupId); });
    var roles = splitGroupRoles(group);
    if (!driver || !(singleton || view && view.sessions.some(function (session) { return session.id === driver.id && session.sessionOriginId === driver.sessionOriginId; })) ||
        detail.projectSlug !== state.currentSlug || state.splitGroupsProjectSlug !== state.currentSlug ||
        detail.ownerId !== (state.myUserId || null) || (driver.ownerId || null) !== (state.myUserId || null) || !frame || frame.dataset.projectSlug !== state.currentSlug ||
        !live || !live.ready || !livePaneBinding(frame) || live.sessionId !== driver.id || live.binding.sessionOriginId !== driver.sessionOriginId ||
        !roles || roles.version !== 2 || roles.driverId !== driver.id || !Array.isArray(detail.workerOrigins) ||
        detail.workerOrigins.length !== group.members.length) return;
    for (var i = 0; i < roles.workerIds.length; i++) {
      var worker = sessions.find(function (session) { return session.id === roles.workerIds[i]; });
      if (!worker || worker.sessionRole !== 'worker' || worker.parentSessionId !== driver.id || worker.parentAvailable !== true ||
          (worker.ownerId || null) !== (driver.ownerId || null) || detail.workerOrigins.indexOf(worker.sessionOriginId) === -1) return;
    }
    if (!openGroup(group)) showToast('Worker controls could not be opened. The Split view remains open.', 'warn');
  });
}
