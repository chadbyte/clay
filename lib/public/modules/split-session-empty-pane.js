import { store } from './store.js';
import { currentLayoutScope } from './split-view-layout-scope.js';

export function clearEmptySplit(host) {
  var pane = host && host.querySelector(':scope > .split-session-empty-pane');
  var menu = document.getElementById('split-view-create-menu');
  if (pane && menu && pane.contains(menu)) {
    menu.hidden = true;
    if (menu.contains(document.activeElement)) document.activeElement.blur();
    if (pane.contains(menu)) document.body.appendChild(menu);
  }
  if (pane) pane.remove();
  var divider = host && host.querySelector(':scope > .split-session-reserved-divider');
  if (divider) divider.remove();
}

export function reserveEmptySplit(host, geometry, inset) {
  var state = store.get('splitSessionPicker');
  var receipt = state && state.receipt;
  var target = receipt && geometry.panes[receipt.origin];
  if (!state || !state.side || !target || !currentLayoutScope(receipt.scope)) { clearEmptySplit(host); return false; }
  var side = state.side, vertical = side === 'top' || side === 'bottom', before = side === 'left' || side === 'top';
  var size = vertical ? 'height' : 'width', axis = vertical ? 'y' : 'x';
  var half = Math.max(0, (target[size] - 7) / 2);
  var original = Object.assign({}, target), empty = Object.assign({}, target), gap = Object.assign({}, target);
  original[size] = half; empty[size] = half; gap[size] = 7;
  gap[axis] += half;
  if (before) original[axis] += half + 7; else empty[axis] += half + 7;
  geometry.panes[receipt.origin] = original;
  var pane = host.querySelector(':scope > .split-session-empty-pane');
  if (!pane) {
    pane = document.createElement('section'); pane.className = 'split-session-empty-pane';
    pane.innerHTML = '<div class="split-session-empty-body"></div>';
    host.appendChild(pane);
  }
  pane.dataset.side = side; pane.setAttribute('aria-label', 'Empty ' + side + ' split');
  var menu = document.getElementById('split-view-create-menu');
  var body = pane.querySelector('.split-session-empty-body');
  if (menu && menu.parentNode !== body) body.appendChild(menu);
  var divider = host.querySelector(':scope > .split-session-reserved-divider');
  if (!divider) { divider = document.createElement('div'); divider.className = 'split-session-reserved-divider'; divider.setAttribute('aria-hidden', 'true'); host.appendChild(divider); }
  [[pane, empty], [divider, gap]].forEach(function (entry) {
    entry[0].style.left = inset.left + entry[1].x + 'px'; entry[0].style.top = inset.top + entry[1].y + 'px';
    entry[0].style.width = entry[1].width + 'px'; entry[0].style.height = entry[1].height + 'px';
  });
  return true;
}
