import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { livePaneBinding, samePaneBinding, samePaneTarget, paneTarget } from './pane-binding.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { modelEntryValue } from './model-picker.js';

export function renderPaneRuntime(paneEl, session) {
  var runtime = paneEl.querySelector('.split-view-runtime');
  if (!runtime) return;
  var vendor = session && session.vendor || 'unknown', model = modelEntryValue(session && session.model);
  var frame = paneEl.querySelector('.split-pane-frame'), controller = frame && frame.clayPane;
  var live = controller && controller.identity(), target = session && paneTarget(store.snap(), getCachedSessions(), session.id);
  if (session && live && live.ready && live.sessionId === session.id && !frame.dataset.requestedSessionId &&
      samePaneTarget(target, live.binding) && livePaneBinding(frame) && typeof controller.headerRuntime === 'function') {
    var observed = controller.headerRuntime();
    if (observed && observed.vendor === vendor && samePaneBinding(live.binding, observed.binding)) model = modelEntryValue(observed.model) || model;
  }
  var label = model || (vendor === 'unknown' ? 'Model unavailable' : 'Provider default');
  var icon = runtime.querySelector('.split-view-runtime-icon'), text = runtime.querySelector('.split-view-model');
  if (icon) { icon.hidden = !VENDOR_AVATARS[vendor]; if (!icon.hidden) icon.src = VENDOR_AVATARS[vendor]; icon.title = VENDOR_NAMES[vendor] || vendor; icon.alt = ''; }
  if (text) { text.textContent = label; text.title = (VENDOR_NAMES[vendor] || vendor) + ' · ' + label; }
  runtime.setAttribute('aria-label', (VENDOR_NAMES[vendor] || vendor) + ' · ' + label);
}
