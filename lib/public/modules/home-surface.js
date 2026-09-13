// Durable, server-backed Home conversation selection state.

import { store } from './store.js';
import { getWs } from './ws-ref.js';

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function normalizeSessions(value) {
  var source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  var result = {};
  var keys = Object.keys(source);
  for (var i = 0; i < keys.length; i++) {
    if (typeof source[keys[i]] === "string" && source[keys[i]]) result[keys[i]] = source[keys[i]];
  }
  return result;
}

function normalizePrimarySurface(value) {
  return value === "home" || value === "project" ? value : null;
}

function normalizeProjectSlug(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(value) ? value : null;
}

function normalizeChatScope(value) {
  return value === "current" ? "current" : "all";
}

function normalizeSubSurface(value) {
  return value === "debates" ? "debates" : "chat";
}

export function requestHomeSurfacePreference() {
  return send({ type: "home_surface_get" });
}

export function updateHomeSurfacePreference(patch) {
  var state = store.snap();
  var next = {
    surface: normalizePrimarySurface(state.homePrimarySurface),
    projectSlug: normalizeProjectSlug(state.homeSurfaceProjectSlug || state.currentSlug),
    activeMateId: state.homeChatMateId || null,
    activeSessionByMate: Object.assign({}, state.homeActiveSessionByMate || {}),
    sidebarCollapsed: state.homeSidebarCollapsed === true,
    matesCollapsed: state.homeMatesCollapsed === true,
    chatScope: normalizeChatScope(state.homeChatScope),
    subSurface: normalizeSubSurface(state.homeSubSurface),
  };
  if (patch && Object.prototype.hasOwnProperty.call(patch, "surface")) next.surface = normalizePrimarySurface(patch.surface);
  if (patch && Object.prototype.hasOwnProperty.call(patch, "projectSlug")) next.projectSlug = normalizeProjectSlug(patch.projectSlug);
  if (patch && Object.prototype.hasOwnProperty.call(patch, "activeMateId")) next.activeMateId = patch.activeMateId;
  if (patch && patch.activeSessionByMate) next.activeSessionByMate = Object.assign({}, next.activeSessionByMate, patch.activeSessionByMate);
  if (patch && Object.prototype.hasOwnProperty.call(patch, "sidebarCollapsed")) next.sidebarCollapsed = patch.sidebarCollapsed === true;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "matesCollapsed")) next.matesCollapsed = patch.matesCollapsed === true;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "chatScope")) next.chatScope = normalizeChatScope(patch.chatScope);
  if (patch && Object.prototype.hasOwnProperty.call(patch, "subSurface")) next.subSurface = normalizeSubSurface(patch.subSurface);
  store.set({
    homePrimarySurface: next.surface,
    homeSurfaceProjectSlug: next.projectSlug,
    homeActiveSessionByMate: normalizeSessions(next.activeSessionByMate),
    homeSidebarCollapsed: next.sidebarCollapsed,
    homeMatesCollapsed: next.matesCollapsed,
    homeChatScope: next.chatScope,
    homeSubSurface: next.subSurface,
  });
  var outgoing = {};
  if (patch && Object.prototype.hasOwnProperty.call(patch, "surface")) outgoing.surface = next.surface;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "projectSlug")) outgoing.projectSlug = next.projectSlug;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "activeMateId")) outgoing.activeMateId = next.activeMateId;
  if (patch && patch.activeSessionByMate) outgoing.activeSessionByMate = patch.activeSessionByMate;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "sidebarCollapsed")) outgoing.sidebarCollapsed = next.sidebarCollapsed;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "matesCollapsed")) outgoing.matesCollapsed = next.matesCollapsed;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "chatScope")) outgoing.chatScope = next.chatScope;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "subSurface")) outgoing.subSurface = next.subSurface;
  return send({ type: "home_surface_set", preference: outgoing });
}

export function rememberHomePrimarySurface(surface, routeProjectSlug) {
  var normalized = normalizePrimarySurface(surface);
  if (!normalized) return false;
  var projectSlug = normalizeProjectSlug(routeProjectSlug || store.get('currentSlug'));
  if (store.get('homePrimarySurface') === normalized && store.get('homeSurfaceProjectSlug') === projectSlug) return false;
  store.set({ homeSurfaceIntent: normalized, homePrimarySurface: normalized, homeSurfaceProjectSlug: projectSlug });
  return updateHomeSurfacePreference({ surface: normalized, projectSlug: projectSlug });
}

export function rememberHomeMate(mateId) {
  if (!mateId) return;
  if (store.get('homePreferredMateId') === mateId) return;
  store.set({ homePreferredMateId: mateId });
  updateHomeSurfacePreference({ activeMateId: mateId });
}

export function rememberHomeSession(mateId, sessionId) {
  if (!mateId || !sessionId) return;
  if ((store.get('homeActiveSessionByMate') || {})[mateId] === sessionId && store.get('homePreferredMateId') === mateId) return;
  var patch = {};
  patch[mateId] = sessionId;
  updateHomeSurfacePreference({ activeMateId: mateId, activeSessionByMate: patch });
}

export function forgetHomeSession(mateId) {
  if (!mateId) return;
  var sessions = Object.assign({}, store.get('homeActiveSessionByMate') || {});
  delete sessions[mateId];
  store.set({ homeActiveSessionByMate: sessions, homeChatSessionId: null });
  var patch = {};
  patch[mateId] = "";
  send({ type: "home_surface_set", preference: { activeSessionByMate: patch } });
}

export function handleHomeSurfaceState(msg) {
  if (!msg || msg.error || !msg.preference) {
    if (!store.get('homeSurfaceLoaded')) store.set({ homeSurfaceLoaded: true });
    return;
  }
  var preference = msg.preference;
  var wasLoaded = store.get('homeSurfaceLoaded');
  var intent = normalizePrimarySurface(store.get('homeSurfaceIntent'));
  var intendedProject = normalizeProjectSlug(store.get('homeSurfaceProjectSlug'));
  var savedSurface = normalizePrimarySurface(preference.surface);
  var savedProject = normalizeProjectSlug(preference.projectSlug);
  var intentConfirmed = !!intent && intent === savedSurface && intendedProject === savedProject;
  var update = {
    homeSurfaceLoaded: true,
    homePrimarySurface: intent || savedSurface,
    homeSurfaceProjectSlug: intent ? intendedProject : savedProject,
    homeActiveSessionByMate: normalizeSessions(preference.activeSessionByMate),
    homeSidebarCollapsed: preference.sidebarCollapsed === true,
    homeMatesCollapsed: preference.matesCollapsed === true,
    homeChatScope: normalizeChatScope(preference.chatScope),
    homeSubSurface: normalizeSubSurface(preference.subSurface),
  };
  if (intentConfirmed) update.homeSurfaceIntent = null;
  if (!wasLoaded) {
    update.homePreferredMateId = store.get('homePreferredMateId') || preference.activeMateId || store.get('homeChatMateId') || null;
  }
  store.set(update);
  if (intent && !intentConfirmed) send({ type: "home_surface_set", preference: { surface: intent, projectSlug: intendedProject } });
}
