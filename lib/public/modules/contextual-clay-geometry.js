import { contextualTrigger } from './contextual-mate-identity.js';
import { renderContextualMateHint } from './contextual-mate-hint.js';
import { store } from './store.js';
import { showToast } from './utils.js';

var endpoint = '/api/user/contextual-clay-geometry';
function state() { return store.get('contextualClayGeometry') || {}; }
function surface() { return document.getElementById('contextual-clay'); }
function narrow() { return window.matchMedia('(max-width: 768px)').matches; }
function rectValue(rect) { return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; }
function bounded(value) {
  return { left: Math.round(Math.max(0, Math.min(16384, value.left))), top: Math.round(Math.max(0, Math.min(16384, value.top))), width: Math.round(Math.max(340, Math.min(2560, value.width))), height: Math.round(Math.max(360, Math.min(2160, value.height))) };
}
function setState(patch) { store.set({ contextualClayGeometry: Object.assign({}, state(), patch) }); }
function defaultGeometry() {
  var trigger = contextualTrigger();
  var anchor = trigger && trigger.getBoundingClientRect();
  return { left: anchor ? anchor.right + 8 : 64, top: anchor ? anchor.top : 38, width: 480, height: 640 };
}
export function positionContextualClay() {
  var element = surface();
  var hint = renderContextualMateHint();
  if (!element || narrow() || (store.get('contextualClay') || {}).mode === 'opening') return;
  var desired = state().preview || state().desired || defaultGeometry();
  var width = Math.min(desired.width, window.innerWidth - 16);
  var height = Math.min(desired.height, window.innerHeight - 16);
  var left = Math.max(8, Math.min(desired.left, window.innerWidth - width - 8));
  var top = Math.max(8, Math.min(desired.top, window.innerHeight - height - 8));
  if (hint && left < hint.right + 8 && left + width > hint.left && top < hint.bottom + 8 && top + height > hint.top) {
    left = hint.right + 8; width = Math.min(width, window.innerWidth - left - 8);
  }
  element.style.setProperty('--contextual-left', left + 'px');
  element.style.setProperty('--contextual-top', top + 'px');
  element.style.setProperty('--contextual-width', width + 'px');
  element.style.setProperty('--contextual-height', height + 'px');
}
async function flushSave() {
  var current = state();
  if (current.saving || !current.pending) return;
  var owner = store.get('myUserId'); var value = current.pending;
  setState({ saving: true, pending: null });
  try {
    var response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Clay-Settings': '1' }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error('Could not save popover position and size.');
    if (store.get('myUserId') === owner) setState({ saved: value });
  } catch (error) {
    if (store.get('myUserId') === owner) showToast('Popover position and size could not be saved. Adjust again to retry.', 'error');
  } finally {
    if (store.get('myUserId') === owner) { setState({ saving: false }); flushSave(); }
  }
}
function commit(value) {
  var next = bounded(value);
  setState({ desired: next, pending: next, revision: (state().revision || 0) + 1 });
  positionContextualClay(); flushSave();
}
function finish(cancel) {
  var drag = state().interaction;
  if (!drag) return;
  var value = state().preview;
  setState({ interaction: null, preview: null });
  var element = surface();
  if (element) {
    element.classList.remove('contextual-clay-manipulating');
    var handle = drag.edge ? element.querySelector('[data-clay-resize="' + drag.edge + '"]') : element.querySelector('header');
    if (handle && handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
  }
  if (!cancel && value) {
    if (!drag.edge && drag.desired) { value.width = drag.desired.width; value.height = drag.desired.height; }
    commit(value);
  }
  else positionContextualClay();
}
function move(event) {
  var drag = state().interaction;
  if (!drag || event.pointerId !== drag.pointerId) return;
  var dx = event.clientX - drag.x; var dy = event.clientY - drag.y;
  if (!state().preview && Math.hypot(dx, dy) < 3) return;
  var value = Object.assign({}, drag.start);
  if (drag.edge) {
    if (drag.edge.indexOf('e') >= 0) value.width = Math.max(340, Math.min(2560, window.innerWidth - value.left - 8, value.width + dx));
    if (drag.edge.indexOf('s') >= 0) value.height = Math.max(360, Math.min(2160, window.innerHeight - value.top - 8, value.height + dy));
  } else {
    value.left = Math.max(8, Math.min(window.innerWidth - value.width - 8, value.left + dx));
    value.top = Math.max(8, Math.min(window.innerHeight - value.height - 8, value.top + dy));
  }
  setState({ preview: value }); positionContextualClay();
}
async function loadPreference(owner) {
  setState({ owner: owner, desired: null, revision: 0, pending: null, saving: false });
  try {
    var response = await fetch(endpoint);
    if (!response.ok) throw new Error('Preference unavailable');
    var data = await response.json();
    if (store.get('myUserId') === owner && !state().revision && !state().interaction) {
      setState({ desired: data.geometry, saved: data.geometry }); positionContextualClay();
    }
  } catch (error) { /* Keep the usable anchored default when preferences are unavailable. */ }
}
export function attachContextualGeometry(element) {
  var header = element.querySelector('header');
  header.tabIndex = 0;
  header.setAttribute('aria-label', 'Move Clay conversation. Use arrow keys to move; hold Shift for larger steps.');
  header.title = 'Drag to move · Arrow keys when focused';
  ['e', 's', 'se'].forEach(function (edge) {
    var handle = document.createElement('button');
    handle.type = 'button'; handle.dataset.clayResize = edge;
    handle.setAttribute('aria-label', 'Resize Clay conversation' + (edge === 'e' ? ' width' : edge === 's' ? ' height' : '') + '. Use arrow keys; hold Shift for larger steps.');
    handle.title = 'Drag to resize · Arrow keys when focused';
    element.appendChild(handle);
  });
  element.addEventListener('pointerdown', function (event) {
    var handle = event.target.closest('[data-clay-resize]');
    var heading = event.target.closest('header');
    if (narrow() || event.button !== 0 || (!handle && (!heading || event.target.closest('button, details, a, input')))) return;
    if ((store.get('contextualClay') || {}).mode !== 'popover') return;
    event.preventDefault();
    var target = handle || header;
    setState({ interaction: { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: rectValue(element.getBoundingClientRect()), desired: state().desired, edge: handle ? handle.dataset.clayResize : null } });
    element.classList.add('contextual-clay-manipulating');
    target.setPointerCapture(event.pointerId);
  });
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', function (event) { if (state().interaction && event.pointerId === state().interaction.pointerId) { move(event); finish(false); } });
  element.addEventListener('pointercancel', function () { finish(true); });
  element.addEventListener('lostpointercapture', function () { finish(true); });
  element.addEventListener('keydown', function (event) {
    if (narrow() || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) < 0) return;
    var edge = event.target.dataset.clayResize;
    if (event.target !== header && !edge) return;
    event.preventDefault();
    var value = rectValue(element.getBoundingClientRect()); var step = event.shiftKey ? 32 : 8;
    var horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    var delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -step : step;
    if (edge) {
      if (horizontal && edge.indexOf('e') >= 0) value.width = Math.min(window.innerWidth - value.left - 8, value.width + delta);
      if (!horizontal && edge.indexOf('s') >= 0) value.height = Math.min(window.innerHeight - value.top - 8, value.height + delta);
    } else if (horizontal) value.left = Math.max(8, Math.min(window.innerWidth - value.width - 8, value.left + delta));
    else value.top = Math.max(8, Math.min(window.innerHeight - value.height - 8, value.top + delta));
    if (!edge && state().desired) { value.width = state().desired.width; value.height = state().desired.height; }
    commit(value);
  });
}
export function initContextualGeometry() {
  store.subscribe(function (value, previous) {
    if (value.myUserId && value.myUserId !== previous.myUserId) { finish(true); loadPreference(value.myUserId); }
    if ((value.contextualClay || {}).mode !== (previous.contextualClay || {}).mode) finish(true);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state().interaction) { event.preventDefault(); event.stopImmediatePropagation(); finish(true); }
  }, true);
  window.addEventListener('blur', function () { finish(true); });
  window.addEventListener('resize', function () { finish(true); positionContextualClay(); });
  if (store.get('myUserId')) loadPreference(store.get('myUserId'));
}
