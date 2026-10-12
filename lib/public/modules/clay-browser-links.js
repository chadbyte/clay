import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { forwardPaneBrowserLink } from './pane-browser-bridge.js';

function escape(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
export function browserLinkTarget(href) {
  if (typeof href !== 'string' || !href.startsWith('browser:') || href.length > 8200) return null;
  var raw = href.slice(8);
  if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020]/.test(raw)) return null;
  try {
    var url = new URL(raw);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch (error) { return null; }
}
export function renderBrowserLink(href, title, text) {
  var url = browserLinkTarget(href);
  if (!url) return null;
  var label = String(text || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  if (!label || label === href || label === url) label = new URL(url).host;
  return '<button type="button" class="clay-browser-link clayos-record-link" data-browser-url="' + escape(url) + '" data-browser-project="' + escape(store.get('currentSlug') || '') + '" title="' + escape('Open in Clay Browser · ' + url) + '" aria-label="' + escape('Open in Clay Browser: ' + label) + '">' + iconHtml('globe') + '<span>Browser</span><small>' + escape(label) + '</small></button>';
}
export function enhanceBrowserLinks(root) {
  if (!root || typeof document === 'undefined') return;
  root.querySelectorAll('a[href]').forEach(function (anchor) {
    if (anchor.closest('pre, code, button')) return;
    var html = renderBrowserLink(anchor.getAttribute('href'), '', anchor.textContent);
    if (html) { var template = document.createElement('template'); template.innerHTML = html; anchor.replaceWith(template.content); }
  });
  initBrowserLinks();
  refreshIcons();
}
export function initBrowserLinks() {
  if (store.get('browserLinksBound')) return;
  store.set({ browserLinksBound: true });
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('.clay-browser-link');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    var url = browserLinkTarget('browser:' + button.dataset.browserUrl);
    if (!url) { showToast('This browser link is invalid.', 'warn'); return; }
    if (button.dataset.browserProject && button.dataset.browserProject !== store.get('currentSlug')) { showToast('Open this link from its original project.', 'warn'); return; }
    if (forwardPaneBrowserLink(url)) return;
    import('./shared-browser.js').then(function (module) { module.openSharedBrowserAt(url); }).catch(function (error) { showToast(error.message || 'Could not open the browser.', 'warn'); });
  });
}
