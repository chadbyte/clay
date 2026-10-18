// Placement of the Browser, Terminal and sticky-note visibility buttons.
// Desktop keeps them in the top bar beside Notifications and Settings; where the
// top bar is hidden (mobile) the very same nodes return to the title bar status
// area. Nodes, IDs, handlers, state and permissions are never recreated.
var MOBILE = '(max-width: 768px)';
var IDS = ['sticky-notes-toggle-btn', 'shared-browser-toggle-btn', 'terminal-toggle-btn'];
var DESKTOP_ORDER = ['shared-browser-toggle-btn', 'terminal-toggle-btn', 'sticky-notes-toggle-btn'];

function place(mobile) {
  var status = document.querySelector('#main-column > .title-bar-content .status');
  var actions = document.querySelector('#top-bar .top-bar-actions');
  var anchor = document.getElementById('notif-center-btn');
  if (!status || !actions) return;
  var order = mobile ? IDS : DESKTOP_ORDER;
  for (var i = 0; i < order.length; i++) {
    var node = document.getElementById(order[i]);
    if (!node) continue;
    if (mobile) status.appendChild(node);
    else actions.insertBefore(node, anchor);
  }
}

// The search trigger is centred in the bar. It keeps that place and width when
// the free gap between the left group and the actions allows, otherwise it
// collapses to an icon-only trigger (same node, ID, handler and label) inside
// the gap. If even the icon cannot fit, the per-vendor usage chips fold into the
// existing all-vendors chip, then the active-session usage link folds, before
// anything else is touched. Action buttons are never hidden or clipped.
var MIN_FULL = 150, ICON = 24, MARGIN = 12;

function layoutTopbar() {
  var bar = document.getElementById('top-bar');
  var left = bar && bar.querySelector('.top-bar-left-pills');
  var actions = bar && bar.querySelector('.top-bar-actions');
  var search = document.getElementById('cmd-palette-btn');
  if (!bar || !left || !actions || !search) return;
  if (getComputedStyle(bar).display === 'none' || getComputedStyle(search).display === 'none') return;
  var levels = [[], ['usage-compact'], ['usage-compact', 'usage-compact-link']];
  var result = null;
  for (var i = 0; i < levels.length && !result; i++) {
    bar.classList.remove('usage-compact', 'usage-compact-link', 'search-icon');
    levels[i].forEach(function (name) { bar.classList.add(name); });
    bar.style.removeProperty('--top-bar-search-width'); bar.style.removeProperty('--top-bar-search-left');
    var width = bar.getBoundingClientRect().width, center = width / 2;
    var barLeft = bar.getBoundingClientRect().left;
    var leftEdge = left.getBoundingClientRect().right - barLeft, actionsEdge = actions.getBoundingClientRect().left - barLeft;
    var half = Math.min(center - leftEdge, actionsEdge - center) - MARGIN;
    var target = Math.min(520, width * 0.4);
    if (2 * half >= MIN_FULL) result = { mode: 'full', width: Math.min(target, 2 * half), left: null, level: i };
    else if (actionsEdge - leftEdge >= ICON + 2 * MARGIN) {
      // Stay centred in the bar when that is inside the gap.
      var lo = leftEdge + MARGIN + ICON / 2, hi = actionsEdge - MARGIN - ICON / 2;
      result = { mode: 'icon', width: ICON, left: Math.min(Math.max(center, lo), hi), level: i };
    }
  }
  if (!result) result = { mode: 'icon', width: ICON, left: Math.max(left.getBoundingClientRect().right - bar.getBoundingClientRect().left + MARGIN + ICON / 2, 0), level: levels.length - 1 };
  bar.classList.toggle('search-icon', result.mode === 'icon');
  if (result.mode === 'full') bar.style.setProperty('--top-bar-search-width', Math.round(result.width) + 'px');
  else bar.style.setProperty('--top-bar-search-left', Math.round(result.left) + 'px');
}

function observeTopbarLayout() {
  var bar = document.getElementById('top-bar');
  if (!bar || typeof ResizeObserver === 'undefined') return;
  var queued = false;
  var run = function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; layoutTopbar(); }); };
  var observer = new ResizeObserver(run);
  observer.observe(bar);
  ['.top-bar-left-pills', '.top-bar-actions'].forEach(function (selector) { var node = bar.querySelector(selector); if (node) observer.observe(node); });
  new MutationObserver(run).observe(bar.querySelector('.top-bar-actions'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  layoutTopbar();
}

export function initTopbarWorkbenchControls() {
  var query = window.matchMedia(MOBILE);
  place(query.matches);
  query.addEventListener('change', function () { place(query.matches); });
  observeTopbarLayout();
}
