// Temporary Clay announcements with an expandable saved-change history.
import { store } from './store.js';
import { sendYou, openYou } from './you.js';
import { relativeTime } from './project-logs-render.js';

function state() { return store.get('youActivity') || {}; }
function put(values) { store.set({ youActivity: Object.assign({}, state(), values) }); }
function el(id) { return document.getElementById(id); }
function describe(item) {
  if (item.action === 'archive') return 'Clay stopped using a memory about you.';
  return (item.action === 'update' ? 'Clay updated: ' : 'Clay remembered: ') + (item.summary || item.title);
}
function request(more) {
  put({ requestId: sendYou('you_activity', { offset: more ? state().nextOffset : 0, limit: 20 }), append: !!more });
}
function idle() {
  clearTimeout(state().typingTimer); clearTimeout(state().hideTimer);
  put({ active: false, typingTimer: null, hideTimer: null });
  el('you-activity').classList.remove('announcing');
}
function announce(message) {
  if (state().active) { put({ queue: (state().queue || []).concat(message) }); return; }
  put({ active: true });
  el('you-activity').classList.add('announcing');
  el('you-activity-toggle').setAttribute('aria-label', message);
  el('you-activity-toggle').title = message;
  var characters = Array.from(message);
  var index = 0;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function type() {
    index = reduced ? characters.length : Math.min(characters.length, index + 2);
    el('you-activity-text').textContent = characters.slice(0, index).join('');
    el('you-activity-text').scrollLeft = el('you-activity-text').scrollWidth;
    if (index < characters.length) put({ typingTimer: setTimeout(type, 30) });
    else { el('you-announcement-status').textContent = message; put({ hideTimer: setTimeout(settle, 6500) }); }
  }
  type();
}
function settle() {
  if (state().open || el('you-activity').matches(':hover, :focus-within')) {
    put({ hideTimer: setTimeout(settle, 1000) }); return;
  }
  var queue = (state().queue || []).slice();
  var next = queue.shift();
  idle(); put({ queue: queue });
  if (next) announce(next);
}
function close() {
  put({ open: false });
  el('you-activity-history').classList.add('hidden');
  el('you-activity-toggle').setAttribute('aria-expanded', 'false');
}
function render() {
  var items = state().items || [];
  var list = el('you-activity-list');
  list.replaceChildren();
  if (!items.length) {
    var empty = document.createElement('p');
    empty.className = 'you-activity-empty';
    empty.textContent = 'When Clay records something about you, it appears here.';
    list.appendChild(empty);
  }
  items.forEach(function (item) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'you-activity-entry';
    var text = document.createElement('span'); text.textContent = describe(item);
    var time = document.createElement('small'); time.textContent = relativeTime(item.at);
    button.append(text, time);
    button.addEventListener('click', function () { close(); openYou(item.action === 'archive' ? null : item.ref); });
    list.appendChild(button);
  });
  el('you-activity-more').classList.toggle('hidden', state().nextOffset == null);
}
export function handleYouActivity(msg) {
  if (!el('you-activity') || (msg.activity && msg.activity.seen)) return;
  if (msg.type === 'you_reviewed') { put({ error: '' }); render(); return; }
  if (msg.type === 'you_changed') {
    if (msg.activity && msg.activity.error) { put({ error: msg.activity.error }); announce(msg.activity.error); return; }
    put({ error: '' });
    if (msg.activity && msg.activity.id && (state().seen || []).indexOf(msg.activity.id) === -1) {
      put({ seen: (state().seen || []).concat(msg.activity.id).slice(-100) });
      announce(describe(msg.activity));
    }
    request();
  } else if (msg.operation === 'you_activity' && msg.requestId === state().requestId) {
    if (!msg.ok) { put({ requestId: null, error: msg.error || 'Could not load Clay’s memory activity.' }); render(); return; }
    var items = state().append ? (state().items || []).concat(msg.result.items) : msg.result.items;
    put({ requestId: null, items: items, nextOffset: msg.result.nextOffset, error: '' });
    render();
  }
}
export function initYouActivity() {
  var host = document.createElement('div'); host.id = 'you-activity';
  host.innerHTML = '<button id="you-activity-toggle" type="button" aria-expanded="false" aria-controls="you-activity-history"><span id="you-activity-text" aria-hidden="true"></span></button>' +
    '<section id="you-activity-history" class="hidden" aria-label="Clay’s memory activity"><header><strong>Clay’s memory</strong><button id="you-activity-close" type="button" aria-label="Close memory activity">Close</button></header>' +
    '<div id="you-activity-list"></div><button id="you-activity-more" class="hidden" type="button">Load earlier activity</button><button id="you-activity-open" type="button">Open Me</button></section>';
  document.querySelector('.top-bar-left-pills').prepend(host);
  var live = document.createElement('span'); live.id = 'you-announcement-status'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); document.body.appendChild(live);
  el('you-activity-toggle').addEventListener('click', function () {
    if (state().open) { close(); return; }
    put({ open: true });
    el('you-activity-history').classList.remove('hidden');
    this.setAttribute('aria-expanded', 'true');
    request();
  });
  el('you-activity-close').addEventListener('click', function () { close(); el('you-activity-toggle').focus(); });
  el('you-activity-open').addEventListener('click', function () { close(); openYou(); });
  el('you-activity-more').addEventListener('click', function () { request(true); });
  document.addEventListener('click', function (event) { if (state().open && !host.contains(event.target)) close(); });
  host.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.stopPropagation(); close(); el('you-activity-toggle').focus(); }
  });
  store.subscribe(function (next, previous) {
    if (next.myUserId !== previous.myUserId) { idle(); store.set({ youActivity: {} }); close(); render(); }
    if (next.currentSlug !== previous.currentSlug) close();
    if ((!previous.connected && next.connected) || (next.myUserId !== previous.myUserId && next.connected)) request();
  });
  render();
  if (store.get('connected')) request();
}
