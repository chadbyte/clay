// Exact project/session navigation shared by search, notifications and links.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { switchProject } from './app-projects.js';

function flush() {
  var pending = store.get('pendingProjectSessionNavigation');
  var ws = getWs();
  if (!pending || store.get('activeProjectSlug') !== pending.projectSlug || !ws || ws.readyState !== 1) return false;
  store.set({ pendingProjectSessionNavigation: null });
  ws.send(JSON.stringify({ type: 'switch_session', id: pending.sessionId }));
  return true;
}

export function openProjectSession(projectSlug, sessionId) {
  var id = Number(sessionId);
  if (!projectSlug || !Number.isSafeInteger(id) || id < 1) return false;
  store.set({ pendingProjectSessionNavigation: { projectSlug: projectSlug, sessionId: id } });
  switchProject(projectSlug);
  flush();
  return true;
}

export function initProjectSessionNavigation() {
  store.subscribe(function (state, previous) {
    if (state.activeProjectSlug !== previous.activeProjectSlug || state.connected !== previous.connected || state.pendingProjectSessionNavigation !== previous.pendingProjectSessionNavigation) flush();
  });
  flush();
}
