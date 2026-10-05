import { store } from './store.js';
import { iconHtml } from './icons.js';
import { sendBrowserInput } from './shared-browser.js';

var presets = ['1280,800', '1440,900', '1024,768', '800,600', '375,667', '390,844'];
function root() { return document.getElementById('shared-browser-resolution'); }
function setOpen(value) {
  store.set({ sharedBrowserUi: Object.assign({}, store.get('sharedBrowserUi'), { viewportMenuOpen: value }) });
  var el = root();
  if (!el) return;
  el.querySelector('[data-viewport-trigger]').setAttribute('aria-expanded', String(value));
  el.querySelector('[role="menu"]').hidden = !value;
}
export function closeViewportMenu() { setOpen(false); }
export function viewportMenuHtml() {
  return '<div id="shared-browser-resolution" class="shared-browser-resolution"><button type="button" data-viewport-trigger aria-label="Browser viewport" aria-haspopup="menu" aria-expanded="false" aria-controls="shared-browser-resolutions"><span>1280 × 800</span>' + iconHtml('chevron-up') + '</button><div id="shared-browser-resolutions" class="shared-browser-resolution-menu" role="menu" aria-label="Browser resolutions" hidden></div></div>';
}
export function renderViewportMenu(panel, browser, enabled) {
  var el = panel.querySelector('.shared-browser-resolution');
  var trigger = el.querySelector('[data-viewport-trigger]');
  trigger.disabled = !enabled;
  if (!enabled || !store.get('sharedBrowserOpen')) closeViewportMenu();
  var size = browser ? browser.width + ',' + browser.height : '1280,800';
  trigger.querySelector('span').textContent = size.replace(',', ' × ');
  var menu = el.querySelector('[role="menu"]');
  if (menu.dataset.size === size) return;
  menu.dataset.size = size;
  var values = presets.includes(size) ? presets : presets.concat([size]);
  menu.replaceChildren();
  values.forEach(function (value) {
    var option = document.createElement('button');
    option.type = 'button'; option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(value === size));
    option.dataset.size = value; option.tabIndex = -1;
    option.textContent = value.replace(',', ' × ');
    option.setAttribute('aria-label', option.textContent);
    menu.appendChild(option);
  });
}
export function bindViewportMenu(panel) {
  var el = panel.querySelector('.shared-browser-resolution');
  var trigger = el.querySelector('[data-viewport-trigger]');
  var menu = el.querySelector('[role="menu"]');
  function open(last) {
    if (trigger.disabled) return;
    setOpen(true);
    var items = menu.querySelectorAll('button');
    var selected = menu.querySelector('[aria-checked="true"]');
    (last ? items[items.length - 1] : selected || items[0]).focus();
  }
  trigger.onclick = function () {
    if ((store.get('sharedBrowserUi') || {}).viewportMenuOpen) closeViewportMenu(); else open(false);
  };
  trigger.onkeydown = function (event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(event.key === 'ArrowUp'); }
  };
  menu.onclick = function (event) {
    var option = event.target.closest('[data-size]');
    if (!option || trigger.disabled) return;
    var size = option.dataset.size.split(',');
    closeViewportMenu(); trigger.focus();
    sendBrowserInput({ kind: 'resize', width: Number(size[0]), height: Number(size[1]) });
  };
  el.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeViewportMenu(); trigger.focus(); return; }
    if (event.key === 'Tab') { closeViewportMenu(); return; }
    if (event.target === trigger || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    var items = Array.from(menu.querySelectorAll('button'));
    var index = items.indexOf(document.activeElement);
    index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index].focus();
  });
  document.addEventListener('pointerdown', function (event) { if (!el.contains(event.target)) closeViewportMenu(); });
  el.addEventListener('focusout', function (event) { if (!el.contains(event.relatedTarget)) closeViewportMenu(); });
}
