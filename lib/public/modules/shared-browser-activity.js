import { store } from './store.js';

export function activityHtml() {
  return '<div class="shared-browser-activity"><div class="shared-browser-caption-history" role="log" aria-live="off" aria-label="Browser caption history" tabindex="0"></div><button type="button" class="shared-browser-caption-latest" hidden>Back to live ↓</button><span class="shared-browser-caption-announcement" role="status" aria-live="polite"></span></div>';
}
function ui(patch) { store.set({ sharedBrowserUi: Object.assign({}, store.get('sharedBrowserUi'), patch) }); }
function renderCaptions(el, browser, active) {
  var caption = el.querySelector('.shared-browser-activity');
  var history = el.querySelector('.shared-browser-caption-history');
  var latest = el.querySelector('.shared-browser-caption-latest');
  if (!history.dataset.bound) {
    history.dataset.bound = 'true';
    history.addEventListener('scroll', function () {
      var pinned = history.scrollHeight - history.clientHeight - history.scrollTop < 20;
      ui({ captionPinned: pinned });
      caption.dataset.reviewing = String(!pinned);
      latest.hidden = pinned;
    });
    latest.onclick = function () { history.scrollTop = history.scrollHeight; ui({ captionPinned: true }); latest.hidden = true; caption.dataset.reviewing = 'false'; };
  }
  var entries = browser && browser.activityHistory || [];
  caption.hidden = !entries.length;
  var last = entries[entries.length - 1];
  var key = browser && browser.id + ':' + entries.length + ':' + (last ? last.id + ':' + last.phase + ':' + last.text : 'empty');
  var state = store.get('sharedBrowserUi') || {};
  if (state.captionHistoryKey === key) return;
  var fresh = state.captionBrowserId !== (browser && browser.id);
  var pinned = fresh || state.captionPinned !== false;
  var top = history.scrollTop;
  history.replaceChildren();
  entries.forEach(function (entry, index) {
    var row = document.createElement('div'); row.className = 'shared-browser-caption-row';
    row.dataset.age = String(Math.min(entries.length - index - 1, 3));
    var line = document.createElement('span'); line.className = 'shared-browser-activity-text'; line.textContent = entry.text;
    row.appendChild(line);
    if (entry.phase === 'failed' || entry.phase === 'interrupted') {
      var status = document.createElement('small'); status.textContent = entry.phase === 'failed' ? 'This step could not be completed.' : 'This step was interrupted.'; row.appendChild(status);
    }
    history.appendChild(row);
  });
  ui({ captionHistoryKey: key, captionBrowserId: browser && browser.id, captionPinned: pinned });
  history.scrollTop = pinned ? history.scrollHeight : top;
  latest.hidden = pinned;
  caption.dataset.reviewing = String(!pinned);
  var announcement = el.querySelector('.shared-browser-caption-announcement');
  var text = active && last ? last.text + (last.phase === 'failed' ? ' This step could not be completed.' : '') : '';
  if (announcement.textContent !== text) announcement.textContent = text;
}
export function renderBrowserActivity(el, browser, connected) {
  var active = browser && browser.phase === 'live' && browser.control === 'agent' && !browser.handoff && connected;
  renderCaptions(el, browser, active);
  var canvas = el.querySelector('canvas');
  var pointer = active && browser.pointer;
  var cursor = el.querySelector('.shared-browser-pointer');
  cursor.hidden = !pointer || pointer.width !== canvas.width || pointer.height !== canvas.height;
  if (cursor.hidden) return;
  cursor.style.left = (100 * pointer.x / canvas.width) + '%';
  cursor.style.top = (100 * pointer.y / canvas.height) + '%';
  var key = browser.id + ':' + browser.epoch + ':' + pointer.sequence;
  if ((store.get('sharedBrowserUi') || {}).pointerAnimationKey === key) return;
  store.set({ sharedBrowserUi: Object.assign({}, store.get('sharedBrowserUi'), { pointerAnimationKey: key }) });
  if (pointer.clicked && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cursor.querySelector('i').animate([{ opacity: .8, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.8)' }], { duration: 650 });
  }
}
