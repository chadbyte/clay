import { dismissTooltip } from './tooltip.js';
import { renderMarkdown } from './markdown.js';
import { store } from './store.js';

var timer = null;
function context() { return JSON.stringify([store.get('myUserId') || null, store.get('currentSlug'), store.get('projectSplitViewSocketGeneration') || 0]); }
export function messagePreviewKey(kind, identities) { return JSON.stringify([context(), kind].concat(identities)); }
function element() { return document.getElementById('agent-message-bubble'); }
function anchor(key) { return Array.from(document.querySelectorAll('[data-message-preview]')).find(function (node) { return node.dataset.messagePreview === key && node.isConnected && node.getClientRects().length && !node.closest('[hidden], .split-pane-cached'); }); }
function remove() {
  if (timer) clearTimeout(timer); timer = null;
  var node = element(); if (node) node.remove();
  document.querySelectorAll('[aria-describedby="agent-message-bubble"]').forEach(function (chip) { chip.removeAttribute('aria-describedby'); });
  if (store.get('agentMessageBubble')) store.set({ agentMessageBubble: null });
}
function position() {
  var state = store.get('agentMessageBubble'), node = element(), chip = state && anchor(state.key);
  if (!chip || !node) { remove(); return; }
  var rect = chip.getBoundingClientRect(), width = Math.min(360, innerWidth - 20);
  var left = Math.max(10, Math.min(rect.left, innerWidth - width - 10));
  node.style.width = width + 'px'; node.style.left = left + 'px'; node.style.top = Math.min(rect.bottom + 8, innerHeight - 70) + 'px';
  node.style.setProperty('--bubble-tip-x', Math.max(16, Math.min(width - 16, rect.left + Math.min(rect.width / 2, 40) - left)) + 'px');
}
function renderMetadata(node, latest) {
  var meta = node.querySelector('.agent-message-bubble-meta');
  if (!meta) { meta = document.createElement('div'); meta.className = 'agent-message-bubble-meta'; node.prepend(meta); }
  meta.textContent = '';
  var vendor = (store.get('vendorInfo') || {})[latest.vendor] || {};
  if (vendor.avatar) {
    var avatar = document.createElement('img'); avatar.className = 'agent-message-bubble-avatar';
    avatar.src = vendor.avatar; avatar.alt = ''; meta.appendChild(avatar);
  }
  var name = document.createElement('span'); name.className = 'agent-message-bubble-vendor';
  name.textContent = vendor.displayName || 'Assistant'; meta.appendChild(name);
  var time = document.createElement('time'); time.className = 'agent-message-bubble-time';
  if (latest.timestamp && Number.isFinite(new Date(latest.timestamp).getTime())) {
    var date = new Date(latest.timestamp); time.dateTime = date.toISOString();
    time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    time.setAttribute('aria-label', 'Message time: ' + date.toLocaleString());
  } else time.textContent = 'Time unavailable';
  meta.appendChild(time);
}
function show(key, held, fresh) {
  var latest = (store.get('agentMessagePreviews') || {})[key], chip = anchor(key);
  if (!latest || !chip || store.get('splitViewWorkerConversation') || store.get('backgroundTaskViewer') || store.get('paneSuspended') || document.hidden || !store.get('connected')) return;
  var old = store.get('agentMessageBubble'), expires = fresh ? Date.now() + 7000 : old && old.key === key ? old.expiresAt : 0;
  var node = element();
  if (!node || !old || old.key !== key || fresh) {
    if (node) node.remove();
    document.querySelectorAll('[aria-describedby="agent-message-bubble"]').forEach(function (other) { other.removeAttribute('aria-describedby'); });
    node = document.createElement('div'); node.id = 'agent-message-bubble'; node.className = 'agent-message-bubble';
    node.setAttribute('role', 'tooltip'); var text = document.createElement('div'); text.className = 'agent-message-bubble-text'; node.appendChild(text); document.body.appendChild(node);
  }
  renderMetadata(node, latest);
  node.querySelector('.agent-message-bubble-text').innerHTML = DOMPurify.sanitize(renderMarkdown(latest.text), { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'del', 's'], ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false }); node.dataset.held = String(!!held); node.dataset.live = String(expires > Date.now());
  dismissTooltip();
  chip.setAttribute('aria-describedby', node.id);
  store.set({ agentMessageBubble: { key: key, expiresAt: expires, held: !!held } }); position();
  if (timer) clearTimeout(timer);
  if (expires > Date.now()) timer = setTimeout(function () {
    timer = null; var state = store.get('agentMessageBubble'); if (state && state.key === key && !state.held) remove();
  }, Math.max(0, expires - Date.now()));
}
export function rememberAgentMessage(key, preview, live) {
  if (!preview || typeof preview.id !== 'string' || typeof preview.text !== 'string' || !preview.text.trim()) return;
  var all = Object.assign({}, store.get('agentMessagePreviews') || {}), previous = all[key];
  var fresh = !previous || previous.id !== preview.id;
  all[key] = { id: preview.id, text: preview.text.slice(0, 1200), vendor: preview.vendor || previous && previous.vendor || null, timestamp: typeof preview.timestamp === 'number' && Number.isFinite(preview.timestamp) && preview.timestamp > 0 ? preview.timestamp : previous && previous.id === preview.id ? previous.timestamp : null };
  var keys = Object.keys(all); while (keys.length > 128) delete all[keys.shift()];
  store.set({ agentMessagePreviews: all });
  var state = store.get('agentMessageBubble'), chip = anchor(key);
  var held = !!(chip && (chip.matches(':hover') || chip.contains(document.activeElement)));
  if (live && fresh || held || state && state.key === key) show(key, held || !!(state && state.key === key && state.held), !!live && fresh);
}
export function bindAgentMessageBubble(chip, key) {
  chip.dataset.messagePreview = key;
  if (chip.dataset.previewBound) return;
  chip.dataset.previewBound = 'true';
  function enter() { show(chip.dataset.messagePreview, true, false); }
  function leave() {
    var state = store.get('agentMessageBubble'); if (!state || state.key !== chip.dataset.messagePreview || chip.matches(':hover') || chip.contains(document.activeElement)) return;
    if (state.expiresAt <= Date.now()) remove(); else show(state.key, false, false);
  }
  chip.addEventListener('pointerenter', enter); chip.addEventListener('pointerleave', leave);
  chip.addEventListener('focusin', enter); chip.addEventListener('focusout', leave);
  var state = store.get('agentMessageBubble'); if (state && state.key === key) requestAnimationFrame(position);
}
store.subscribe(function (state, previous) {
  if (state.splitViewWorkerConversation && !previous.splitViewWorkerConversation || state.backgroundTaskViewer && !previous.backgroundTaskViewer) remove();
  if (state.sessionOriginId !== previous.sessionOriginId || state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId || state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration || state.connected === false && previous.connected !== false || state.projectSplitViewActiveId !== previous.projectSplitViewActiveId || state.paneSuspended === true && previous.paneSuspended !== true) {
    remove(); if (Object.keys(state.agentMessagePreviews || {}).length) store.set({ agentMessagePreviews: {} });
  }
});
document.addEventListener('keydown', function (event) { if (event.key === 'Escape') remove(); });
document.addEventListener('visibilitychange', function () { if (document.hidden) remove(); });
window.addEventListener('resize', position); window.addEventListener('scroll', function (event) { if (!element() || event.target === element()) return; position(); }, true);
