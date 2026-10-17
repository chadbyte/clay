// Live appearance sync between the app shell and its pane iframes (split
// Driver/Worker panes and the contextual Mate window). Each iframe runs its own
// theme module and only reads the persisted preference at load, so the shell
// pushes the applied appearance down on every change and when a frame loads.
// Same-origin only, shell to child only; nothing is saved from either side.

import { store } from './store.js';
import { onThemeChange, getAppearanceSnapshot, applyExternalAppearance } from './theme.js';

var ID = /^[a-zA-Z0-9_-]{1,120}$/;

function paneFrames() {
  return Array.prototype.filter.call(document.querySelectorAll('iframe'), function (frame) {
    try { var url = new URL(frame.src, window.location.href); return url.origin === window.location.origin && url.searchParams.get('pane') === '1'; }
    catch (error) { return false; }
  });
}

function push(frame) {
  var snapshot = getAppearanceSnapshot();
  try { if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'clay-appearance', snapshot: snapshot }, window.location.origin); } catch (error) {}
}

function isId(value) { return typeof value === 'string' && ID.test(value); }
function isIdOrNull(value) { return value === null || isId(value); }

// Exact shape only: strings or null, never coerced values.
function validSnapshot(value) {
  var pref = value && typeof value === 'object' ? value.preference : null;
  if (!pref || typeof pref !== 'object' || !isId(value.themeId)) return false;
  if (value.userId !== null && (typeof value.userId !== 'string' || !value.userId || value.userId.length > 200)) return false;
  if (typeof pref.configured !== 'boolean') return false;
  if (pref.mode !== null && pref.mode !== 'light' && pref.mode !== 'dark') return false;
  return isIdOrNull(pref.theme) && isIdOrNull(pref.lightTheme) && isIdOrNull(pref.darkTheme);
}

export function initPaneAppearanceBridge() {
  if (store.get('paneMode')) {
    if (window.parent === window) return;
    window.addEventListener('message', function (event) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      var msg = event.data;
      if (!msg || msg.type !== 'clay-appearance' || !validSnapshot(msg.snapshot)) return;
      // Once this frame knows its owner the snapshot must name exactly that owner (null is a mismatch).
      // Before identity is known, or in solo mode without one, any well-formed snapshot applies.
      var owner = store.get('myUserId') || null;
      if (owner !== null && msg.snapshot.userId !== owner) return;
      applyExternalAppearance(msg.snapshot);
    });
    return;
  }
  onThemeChange(function () { paneFrames().forEach(push); });
  // Frames that rejected an early snapshot (identity not yet known here) get it again once it is.
  store.subscribe(function (state, previous) { if (state.myUserId !== previous.myUserId) paneFrames().forEach(push); });
  // A frame that finished loading may have been seeded before a pending save.
  document.addEventListener('load', function (event) {
    if (event.target && event.target.tagName === 'IFRAME' && paneFrames().indexOf(event.target) >= 0) push(event.target);
  }, true);
}
