import { store } from './store.js';
import { livePaneBinding, paneMessageBinding } from './pane-binding.js';
import { showToast } from './utils.js';

export function forwardPaneBrowserLink(url) {
  if (!store.get('paneMode') || window.parent === window) return false;
  window.parent.postMessage({ type: 'clay-pane-open-browser', paneBinding: paneMessageBinding(), url: url, projectSlug: store.get('currentSlug'), sessionId: String(store.get('activeSessionId')) }, window.location.origin);
  return true;
}
export function handlePaneBrowserMessage(event, host) {
  if (!event || event.origin !== window.location.origin || !host || !event.data || event.data.type !== 'clay-pane-open-browser') return false;
  var msg = event.data, s = store.snap();
  var frame = Array.from(host.querySelectorAll('.split-pane-frame')).find(function (item) { return item.contentWindow === event.source; });
  var pane = frame && s.splitPanes && s.splitPanes.panes && s.splitPanes.panes.find(function (item) { return String(item.slug) === frame.dataset.projectSlug && String(item.sessionId) === frame.dataset.sessionId; });
  if (!pane || msg.projectSlug !== s.currentSlug || msg.projectSlug !== frame.dataset.projectSlug || String(msg.sessionId) !== frame.dataset.sessionId) return true;
  var expected = new URL('/p/' + encodeURIComponent(pane.slug) + '/?pane=1&session=' + encodeURIComponent(pane.sessionId), window.location.href).href;
  if (frame.clayPane ? !livePaneBinding(frame, msg) : frame.src !== expected) return true;
  // The authenticated host owns the browser; a live same-project pane supplies only a URL.
  var binding = frame.clayPane && frame.clayPane.identity().binding;
  import('./shared-browser.js').then(function (module) { if (binding && (!livePaneBinding(frame, msg) || frame.clayPane.identity().binding !== binding)) return; module.openSharedBrowserAt(msg.url); }).catch(function (error) { showToast(error.message || 'Could not open the browser.', 'warn'); });
  return true;
}
