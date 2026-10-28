// Pane chrome and Worker viewers share the existing delegated tooltip service.
import { registerTooltip, pruneTooltip } from './tooltip.js';

var HEADERS = '.split-pane-header, .tool-pane-header, .file-viewer-tabbar, .terminal-header, .shared-browser-header, .split-view-workers, #top-bar .top-bar-actions, #split-view-worker-popover, body.worker-pane-locked #messages, body.worker-pane-locked #input-area';
var labels = new WeakMap();
function sync(header) {
  if (header.id === 'split-view-worker-popover' || header.id === 'messages') header.querySelectorAll('.tool-header[role="button"], .tool-group-header[role="button"]').forEach(function (element) {
    if (element.hasAttribute('aria-label') && element.dataset.tooltipDisclosure !== 'true') return;
    var name = element.querySelector('.tool-name, .tool-group-label');
    if (!name) return;
    element.dataset.tooltipDisclosure = 'true';
    var label = (element.getAttribute('aria-expanded') === 'true' ? 'Hide ' : 'Show ') + name.textContent + ' details';
    if (element.getAttribute('aria-label') !== label) element.setAttribute('aria-label', label);
  });
  // Move icon-owned native hints to the operable control before removing them.
  header.querySelectorAll('[title], svg title').forEach(function (element) {
    var control = element.closest('button, [role="button"], a, [role="img"]');
    if (!control && element.matches('svg title')) control = element.parentElement;
    if (!control || control === element) return;
    var label = element.getAttribute('title') || element.textContent;
    if (label && !control.hasAttribute('title') && !control.hasAttribute('data-tip') && !control.hasAttribute('aria-label')) control.setAttribute('title', label);
    if (element.matches('svg title')) element.remove(); else element.removeAttribute('title');
  });
  (header.matches('[title], [data-tip]') ? [header] : []).concat(Array.from(header.querySelectorAll('[title], button, [role="button"], a[aria-label], [data-tip]'))).forEach(function (element) {
    var previous = labels.get(element), tip = element.getAttribute('data-tip'), title = element.getAttribute('title');
    var explicit = tip && (!previous || previous.explicit || tip !== previous.tip);
    var aria = element.getAttribute('aria-label');
    if (previous && aria && previous.aria !== aria) delete element.dataset.tooltipGeneratedLabel;
    var label = explicit ? tip : title || (previous && previous.source === 'title' ? tip : aria || tip);
    if (!label || !label.trim()) { element.removeAttribute('title'); return; }
    if (element.matches('button, [role="button"], a') && (!element.hasAttribute('aria-label') || element.dataset.tooltipGeneratedLabel === 'true' && title)) {
      element.dataset.tooltipGeneratedLabel = 'true';
      if (element.getAttribute('aria-label') !== label) element.setAttribute('aria-label', label);
    }
    if (tip !== label || element.hasAttribute('title')) registerTooltip(element, label);
    labels.set(element, { tip: label, explicit: !!explicit, aria: element.getAttribute('aria-label'), source: title ? 'title' : previous && previous.source || 'aria' });
  });
}
export function initPaneHeaderTooltips() {
  document.querySelectorAll(HEADERS).forEach(sync);
  var observer = new MutationObserver(function (records) {
    var headers = new Set();
    records.forEach(function (record) {
      if (record.type === 'attributes' && (record.attributeName === 'class' || record.attributeName === 'hidden')) {
        if (record.target === document.body) document.querySelectorAll('body.worker-pane-locked #messages, body.worker-pane-locked #input-area').forEach(function (root) { headers.add(root); });
        return;
      }
      var parent = record.target.nodeType === 1 && record.target.closest(HEADERS); if (parent) headers.add(parent);
      (record.addedNodes || []).forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches(HEADERS)) headers.add(node);
        node.querySelectorAll(HEADERS).forEach(function (header) { headers.add(header); });
      });
    });
    headers.forEach(function (header) { if (header.isConnected) sync(header); });
    pruneTooltip();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'aria-label', 'data-tip', 'aria-expanded', 'hidden', 'class'] });
}
