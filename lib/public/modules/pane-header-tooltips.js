// Pane chrome uses the existing JS tooltip service, including lazy workbenches.
import { registerTooltip, pruneTooltip } from './tooltip.js';

var HEADERS = '.split-pane-header, .tool-pane-header, .file-viewer-tabbar, .terminal-header, .shared-browser-header, .split-view-workers, #top-bar .top-bar-actions';
function sync(header) {
  header.querySelectorAll('[title], button, [role="button"], a[aria-label]').forEach(function (element) {
    var label = element.getAttribute('title') || element.getAttribute('data-tip') || element.getAttribute('aria-label');
    if (!label || !label.trim()) return;
    if (element.matches('button, [role="button"], a') && (!element.hasAttribute('aria-label') || element.dataset.tooltipGeneratedLabel === 'true' && element.hasAttribute('title'))) {
      element.dataset.tooltipGeneratedLabel = 'true';
      if (element.getAttribute('aria-label') !== label) element.setAttribute('aria-label', label);
    }
    if (element.getAttribute('data-tip') !== label || element.hasAttribute('title')) registerTooltip(element, label);
  });
}
export function initPaneHeaderTooltips() {
  document.querySelectorAll(HEADERS).forEach(sync);
  var observer = new MutationObserver(function (records) {
    pruneTooltip();
    var headers = new Set();
    records.forEach(function (record) {
      var parent = record.target.nodeType === 1 && record.target.closest(HEADERS); if (parent) headers.add(parent);
      (record.addedNodes || []).forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches(HEADERS)) headers.add(node);
        node.querySelectorAll(HEADERS).forEach(function (header) { headers.add(header); });
      });
    });
    headers.forEach(function (header) { if (header.isConnected) sync(header); });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'aria-label'] });
}
