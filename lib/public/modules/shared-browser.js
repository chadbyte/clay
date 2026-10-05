import { renderBrowserTabs } from './shared-browser-tabs.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';
import { bindBrowserInput, clearBrowserInput } from './shared-browser-input.js';
import { activityHtml, renderBrowserActivity } from './shared-browser-activity.js';
import { viewportMenuHtml, bindViewportMenu, renderViewportMenu, closeViewportMenu } from './shared-browser-viewport-menu.js';

function desktop() { return window.matchMedia('(min-width: 1024px)').matches; }
function eligible() {
  var permissions = store.get('permissions');
  return desktop() && !!store.get('currentSlug') && !!store.get('activeSessionId') && !store.get('dmMode') && (!permissions || permissions.terminal !== false);
}
function panel() { return document.getElementById('shared-browser-panel'); }
function ui(patch) { store.set({ sharedBrowserUi: Object.assign({}, store.get('sharedBrowserUi'), patch) }); }
function send(type, fields) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1 || !store.get('activeSessionId')) return false;
  var browser = store.get('sharedBrowser');
  ws.send(JSON.stringify(Object.assign({ type: 'shared_browser_' + type, sessionId: store.get('activeSessionId'),
    browserId: browser && browser.id, epoch: browser && browser.epoch }, fields || {})));
  return true;
}
export function sendBrowserInput(event) { ui({ error: '' }); send('input', { event: event }); }
function layoutMonitor() {
  var el = panel();
  if (!el || !store.get('sharedBrowserOpen')) return;
  var stage = el.querySelector('.shared-browser-viewport');
  var canvas = el.querySelector('canvas');
  var skin = canvas.width === 800 && canvas.height === 600 ? 'mac' : canvas.width === 1024 && canvas.height === 768 ? 'crt' : canvas.width < canvas.height ? 'phone' : 'laptop';
  stage.dataset.skin = skin;
  var scale = Math.min((stage.clientWidth - 96) / canvas.width, (stage.clientHeight - 140 - el.querySelector('.shared-browser-caption').offsetHeight) / canvas.height, 1);
  if (scale <= 0) return;
  var monitor = el.querySelector('.shared-browser-monitor');
  monitor.style.width = Math.floor(canvas.width * scale) + 'px';
  monitor.style.height = Math.floor(canvas.height * scale) + 'px';
  el.querySelector('.shared-browser-monitor-label').textContent = canvas.width + ' × ' + canvas.height + ' · ' + Math.round(scale * 100) + '%';
}
function iconButton(action, icon, label) {
  return '<button type="button" data-action="' + action + '" title="' + label + '" aria-label="' + label + '">' + iconHtml(icon) + '</button>';
}
function ensurePanel() {
  if (panel()) return;
  var root = document.getElementById('main-panels');
  if (!root) return;
  var el = document.createElement('section');
  el.id = 'shared-browser-panel';
  el.className = 'shared-browser-panel hidden';
  el.setAttribute('aria-label', 'Shared browser');
  el.innerHTML = '<header class="shared-browser-header"><span class="shared-browser-title">' + iconHtml('globe') + 'Browser</span><span class="shared-browser-phase" role="status">Ready</span><div class="shared-browser-window">' +
    iconButton('wide', 'chevrons-left-right', 'Widen browser panel') + iconButton('fullscreen', 'maximize-2', 'Toggle browser fullscreen') + iconButton('hide', 'x', 'Hide browser panel') + '</div></header>' +
    '<div class="shared-browser-tabs" role="tablist" aria-label="Browser tabs"></div><form class="shared-browser-address">' + iconButton('back', 'arrow-left', 'Back') + iconButton('forward', 'arrow-right', 'Forward') + iconButton('reload', 'rotate-cw', 'Reload') +
    '<input aria-label="Browser address" placeholder="Enter a URL" type="text" autocomplete="off" spellcheck="false"><button type="submit" aria-label="Open address">' + iconHtml('arrow-right') + '</button></form>' +
    '<div class="shared-browser-viewport"><div class="shared-browser-monitor"><div class="shared-browser-pointer-layer" aria-hidden="true"><div class="shared-browser-pointer" hidden><svg viewBox="0 0 24 28"><path d="M3 2 L3 22 L8 17 L12 26 L16 24 L12 15 L20 15 Z"/></svg><i></i></div></div><canvas width="1280" height="800" tabindex="0" aria-label="Shared browser page"></canvas>' +
    '<div class="shared-browser-empty">' + iconHtml('globe') + '<h3>A browser you can share with your Driver</h3><p>Enter an address to browse together.<br>Localhost connects to the Clay host.</p><p class="shared-browser-private">Cookies last only for this browser session.</p></div>' +
    '<textarea class="shared-browser-keyboard" aria-label="Type into shared browser" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea><span class="shared-browser-monitor-brand" aria-hidden="true">Clay Studio</span><span class="shared-browser-monitor-detail" aria-hidden="true"></span><span class="shared-browser-monitor-stand" aria-hidden="true"></span></div><div class="shared-browser-caption"><span class="shared-browser-monitor-label"></span>' + activityHtml() + '</div></div>' +
    '<p class="shared-browser-error hidden" role="status"></p>' +
    '<footer class="shared-browser-footer"><div class="shared-browser-control"><span class="shared-browser-control-status" role="status" aria-live="polite">Clay can control this browser</span><button type="button" data-action="control" aria-pressed="false"></button></div>' +
    '<div class="shared-browser-details">' + viewportMenuHtml() + '<button type="button" data-action="end">End browser</button></div></footer>';
  root.appendChild(el);
  el.querySelector('[data-action="hide"]').onclick = hideSharedBrowser;
  el.querySelector('[data-action="wide"]').onclick = function () { var wide = !(store.get('sharedBrowserUi') || {}).wide; ui({ wide: wide }); render(); };
  el.querySelector('[data-action="fullscreen"]').onclick = function () { var full = !(store.get('sharedBrowserUi') || {}).fullscreen; ui({ fullscreen: full }); render(); };
  ['back', 'forward', 'reload'].forEach(function (action) { el.querySelector('[data-action="' + action + '"]').onclick = function () { sendBrowserInput({ kind: action }); }; });
  el.querySelector('form').onsubmit = function (event) { event.preventDefault(); sendBrowserInput({ kind: 'navigate', url: el.querySelector('form input').value }); };
  el.querySelector('[data-action="control"]').onclick = function () {
    var browser = store.get('sharedBrowser');
    if (browser) send('control', { control: browser.control === 'user' ? 'agent' : 'user' });
  };
  el.querySelector('[data-action="end"]').onclick = function () { var browser = store.get('sharedBrowser'); send(browser && browser.phase === 'ended' ? 'open' : 'end'); };
  bindViewportMenu(el);
  var observer = new ResizeObserver(layoutMonitor);
  observer.observe(el.querySelector('.shared-browser-viewport'));
  bindBrowserInput(el.querySelector('canvas'), el.querySelector('textarea'));
  refreshIcons();
}
function renderEntry() {
  var button = document.getElementById('shared-browser-btn');
  if (!button) return;
  button.classList.toggle('hidden', !eligible());
  var browser = store.get('sharedBrowser');
  button.title = browser ? 'View browser · ' + (store.get('connected') ? browser.phase : 'Disconnected') : 'Open browser';
  button.setAttribute('aria-label', browser ? 'View browser' : 'Open browser');
  button.setAttribute('aria-expanded', String(!!store.get('sharedBrowserOpen')));
  button.disabled = !store.get('connected');
}
function controlText(browser, live, connected) {
  if (!connected) return 'Disconnected. Status returns on reconnect.';
  if (!live) return browser && browser.phase === 'starting' ? 'Starting…' : 'Ended';
  if (browser.handoff) return 'Switching control…';
  if (browser.control === 'user') return 'You have temporary control. Clay is paused until you restore access.';
  return browser.activity && browser.activity.phase === 'running' ? 'Clay is working in this browser' : 'Clay can control this browser';
}
function renderControl(el, browser, live, connected) {
  var status = el.querySelector('.shared-browser-control-status');
  var text = controlText(browser, live, connected);
  if (status.textContent !== text) status.textContent = text;
  var button = el.querySelector('[data-action="control"]');
  var human = !!browser && browser.control === 'user';
  var key = String(human);
  if (button.dataset.mode !== key) {
    button.dataset.mode = key;
    button.innerHTML = iconHtml(human ? 'lock' : 'lock-open') + '<span>' + (human ? 'Restore Clay access' : 'Take control') + '</span>';
    refreshIcons();
  }
  button.title = human ? 'Give this browser back to Clay' : 'Temporarily take control. Clay pauses until you restore access.';
  button.setAttribute('aria-pressed', String(human));
}
function render() {
  renderEntry();
  var el = panel();
  if (!el) return;
  renderBrowserTabs(el, selectBrowserTab, send);
  var browser = store.get('sharedBrowser');
  var state = store.get('sharedBrowserUi') || {};
  var connected = store.get('connected');
  var live = browser && browser.phase === 'live';
  var user = live && !browser.handoff && browser.control === 'user' && connected;
  el.classList.toggle('hidden', !store.get('sharedBrowserOpen') || !eligible());
  el.classList.toggle('shared-browser-wide', !!state.wide);
  el.classList.toggle('panel-fullscreen', !!state.fullscreen);
  el.querySelector('[data-action="wide"]').setAttribute('aria-pressed', state.wide ? 'true' : 'false');
  el.querySelector('[data-action="fullscreen"]').setAttribute('aria-pressed', state.fullscreen ? 'true' : 'false');
  el.querySelector('.shared-browser-phase').textContent = !connected ? 'Disconnected' : browser ? ({ starting: 'Starting…', live: 'Live', ended: 'Ended · Last frame' })[browser.phase] : 'Ready';
  el.querySelector('.shared-browser-phase').dataset.live = live && connected ? 'true' : 'false';
  el.querySelector('.shared-browser-monitor').dataset.live = live && connected ? 'true' : 'false';
  var address = el.querySelector('form input');
  if (document.activeElement !== address) address.value = browser ? browser.url : '';
  el.querySelectorAll('form input, form button').forEach(function (node) { node.disabled = !user; });
  el.querySelector('textarea').disabled = !user;
  el.querySelector('canvas').style.cursor = user ? 'default' : 'not-allowed';
  renderControl(el, browser, live, connected);
  el.querySelector('[data-action="control"]').disabled = !live || !!browser.handoff || !connected;
  el.querySelector('[data-action="control"]').hidden = !live;
  el.querySelector('[data-action="end"]').disabled = !browser || !connected;
  el.querySelector('[data-action="end"]').textContent = browser && browser.phase === 'ended' ? 'New browser' : 'End browser';
  var error = state.error || (browser && browser.error) || '';
  el.querySelector('.shared-browser-error').textContent = error;
  el.querySelector('.shared-browser-error').classList.toggle('hidden', !error);
  el.querySelector('.shared-browser-empty').classList.toggle('hidden', !!(browser && browser.url && state.hasFrame));
  renderViewportMenu(el, browser, live && !browser.handoff && connected);
  renderBrowserActivity(el, browser, connected);
  layoutMonitor();
}
function setBrowserTab(browser) {
  var old = store.get('sharedBrowser');
  store.set({ sharedBrowser: browser });
  if (!old || !browser || old.id !== browser.id) {
    clearBrowserInput(); closeViewportMenu(); ui({ hasFrame: false, error: '', decoding: false, captionHistoryKey: null });
    var el = panel(); if (el) el.querySelector('canvas').getContext('2d').clearRect(0, 0, 1920, 1200);
  } else if (old.epoch !== browser.epoch) clearBrowserInput();
}
function selectBrowserTab(id) {
  var browser = (store.get('sharedBrowsers') || []).find(function (tab) { return tab.id === id; });
  if (!browser) return;
  setBrowserTab(browser);
  send('view', { visible: desktop() && !document.hidden }); render();
}
export function openSharedBrowser() {
  if (!eligible()) return;
  ensurePanel();
  claimRightWorkbench('browser');
  store.set({ sharedBrowserOpen: true });
  var browser = store.get('sharedBrowser');
  if (!browser) send('open');
  else send('view', { visible: true });
  render();
}
export function hideSharedBrowser() {
  closeViewportMenu();
  clearBrowserInput();
  if (store.get('sharedBrowserOpen')) send('view', { visible: false });
  store.set({ sharedBrowserOpen: false });
  releaseRightWorkbench('browser');
  render();
}
export function handleSharedBrowserMessage(msg) {
  if (!msg.type || msg.type.indexOf('shared_browser_') !== 0) return false;
  if (String(msg.sessionId) !== String(store.get('activeSessionId'))) return true;
  if (msg.type === 'shared_browser_state') {
    var old = store.get('sharedBrowser');
    var tabs = msg.browsers || (msg.browser ? [msg.browser] : []);
    store.set({ sharedBrowsers: tabs });
    var selected = !msg.focus && old && tabs.find(function (tab) { return tab.id === old.id; });
    selected = selected || msg.browser || tabs[0] || null;
    setBrowserTab(selected);
    if (msg.present && eligible()) {
      ensurePanel(); claimRightWorkbench('browser'); store.set({ sharedBrowserOpen: true });
    }
    if (store.get('sharedBrowserOpen') && selected) send('view', { visible: desktop() && !document.hidden });
    render();
  } else if (msg.type === 'shared_browser_error') { ui({ error: msg.error }); render(); }
  else if (msg.type === 'shared_browser_frame') {
    var current = store.get('sharedBrowser');
    if (!desktop() || !store.get('sharedBrowserOpen') || !current || current.id !== msg.browserId || (store.get('sharedBrowserUi') || {}).decoding) return true;
    var sessionId = store.get('activeSessionId');
    ui({ decoding: true });
    var image = new Image();
    image.onload = function () {
      var latest = store.get('sharedBrowser');
      if (latest && latest.id === msg.browserId && store.get('activeSessionId') === sessionId && panel()) {
        var canvas = panel().querySelector('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        ui({ decoding: false, hasFrame: true }); render();
      }
    };
    image.onerror = function () { if (store.get('activeSessionId') === sessionId) ui({ decoding: false }); };
    image.src = 'data:image/jpeg;base64,' + msg.data;
  }
  return true;
}
export function initSharedBrowser() {
  var button = document.getElementById('shared-browser-btn');
  if (!button) return;
  button.onclick = openSharedBrowser;
  window.matchMedia('(min-width: 1024px)').addEventListener('change', function () { if (!desktop()) hideSharedBrowser(); renderEntry(); });
  document.addEventListener('visibilitychange', function () { if (store.get('sharedBrowserOpen')) send('view', { visible: !document.hidden && desktop() }); });
  refreshIcons(); renderEntry();
  if (store.get('connected')) send('state_request');
}
registerRightWorkbench('browser', hideSharedBrowser);
store.subscribe(function (state, previous) {
  if (state.currentSlug !== previous.currentSlug || state.activeSessionId !== previous.activeSessionId || state.myUserId !== previous.myUserId) {
    clearBrowserInput(); releaseRightWorkbench('browser');
    store.set({ sharedBrowser: null, sharedBrowsers: [], sharedBrowserOpen: false, sharedBrowserUi: {} });
    if (state.connected) send('state_request');
    render();
  } else if (state.connected !== previous.connected) {
    if (state.connected) send('state_request');
    render();
  } else if (state.permissions !== previous.permissions || state.dmMode !== previous.dmMode) {
    if (!eligible()) hideSharedBrowser(); renderEntry();
  }
});
