// Initial Markdown view for the file viewer. Rendered is the default; an
// explicit line target or diff needs source rows, and a toggle made by the
// user for a path in this tab session is respected on later focus/reopen.
// Choices are scoped to the source project that owns the file.

import { store } from './store.js';

function modeKey(projectSlug, path) {
  return JSON.stringify([projectSlug || null, path]);
}

function chosenMode(projectSlug, path) {
  var modes = store.get('fileViewerMarkdownModes') || {};
  var key = modeKey(projectSlug, path);
  return Object.prototype.hasOwnProperty.call(modes, key) ? modes[key] : null;
}

export function initialMarkdownRendered(projectSlug, path, pendingNavigation, pendingMode) {
  if (pendingNavigation && pendingNavigation.line && pendingNavigation.path === path) return false;
  if (pendingMode && pendingMode.type === 'diff') return false;
  var chosen = chosenMode(projectSlug, path);
  return chosen ? chosen === 'rendered' : true;
}

export function rememberMarkdownViewMode(projectSlug, path, rendered) {
  if (!path) return;
  var next = Object.assign({}, store.get('fileViewerMarkdownModes') || {});
  next[modeKey(projectSlug, path)] = rendered ? 'rendered' : 'source';
  store.set({ fileViewerMarkdownModes: next });
}

export function resetMarkdownViewModes() {
  store.set({ fileViewerMarkdownModes: {} });
}
