import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { checkComposerDeparture } from './session-rich-drafts.js';
import { showToast } from './utils.js';
import { buildSplitViewCreateRequest } from './split-view-create-request.js';

export function handleSplitViewCreateEvent(event, submit, checkMountedPaneDrafts) {
  var origins = event.detail && event.detail.origins || [], sessions = getCachedSessions() || [];
  var views = store.get('projectSplitViews') || [], activeView = views.find(function (view) { return view.id === store.get('projectSplitViewActiveId'); });
  var prepared = buildSplitViewCreateRequest(origins, sessions, store.get('activeSessionId'), activeView);
  if (!prepared.ok) { showToast(prepared.error, 'warn'); return; }
  try { if (activeView) checkMountedPaneDrafts(); else checkComposerDeparture(); }
  catch (error) { showToast(error.message, 'warn'); return; }
  submit(prepared.type, prepared.body, prepared.meta);
}
