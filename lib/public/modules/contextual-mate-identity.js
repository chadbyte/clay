import { store } from './store.js';

export function contextualMate(id) {
  var mate = (store.get('cachedMatesList') || []).find(function (item) { return item && item.id === id; });
  if (!mate || mate.archived || mate.contentAccess === false || mate.accessible === false) return null;
  var owner = store.get('myUserId');
  if (owner && mate.createdBy && mate.createdBy !== owner) return null;
  var project = (store.get('projectsHubList') || []).find(function (item) { return item.slug === 'mate-' + id; });
  if (project && project.contentAccess === false) return null;
  return mate;
}
export function contextualMateStamp(mate) { return JSON.stringify([mate.id, mate.createdBy || null, mate.createdAt || null, mate.builtinKey || null]); }
export function contextualFrame(id, sessionId) {
  var mateId = id || (store.get('contextualClay') || {}).mateId;
  var current = store.get('contextualClay') || {};
  if (!sessionId && current.mateId === mateId && current.startingAsk) return null;
  var selected = sessionId || (current.mateId === mateId && current.sessionId) || (store.get('contextualSessionSelection') || {})[mateId];
  return Array.from(document.querySelectorAll('#contextual-clay iframe')).find(function (frame) { return frame.dataset.mateId === mateId && (!selected || String(selected) === frame.dataset.sessionId); }) || null;
}
export function contextualTrigger(id) {
  var mate = contextualMate(id || (store.get('contextualClay') || {}).mateId);
  return mate && mate.builtinKey !== 'clay' ? document.querySelector('.icon-strip-project-mate[data-mate-id="' + CSS.escape(mate.id) + '"]') : document.querySelector('.icon-strip-brand');
}
