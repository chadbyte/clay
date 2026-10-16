// Visual feedback for the existing, authenticated owner navigation path.
import { store } from './store.js';
import { mateAvatarUrl } from './avatar.js';

export function clearClayControlActivity() {
  var activity = store.get('clayControlActivity');
  if (activity) { clearTimeout(activity.timer); if (activity.observer) activity.observer.disconnect(); }
  store.set({ clayControlActivity: null });
  var element = document.getElementById('clay-control-activity');
  if (element) element.remove();
}

export function showClayNavigationActivity(target, failed) {
  clearClayControlActivity();
  var clay = (store.get('cachedMatesList') || []).find(function (mate) { return !mate.archived && (target && target.contextualSourceMateId ? mate.id === target.contextualSourceMateId : mate.builtinKey === 'clay'); });
  if (!clay) return;
  var element = document.createElement('div');
  element.id = 'clay-control-activity';
  element.setAttribute('role', 'status');
  var avatar = document.createElement('img'); avatar.src = mateAvatarUrl(clay, 28); avatar.alt = '';
  var bubble = document.createElement('span');
  bubble.textContent = failed ? 'I could not start that navigation.' : 'I’m opening the reviewed conversation.';
  element.append(avatar, bubble);
  var row = target && target.projectSlug === store.get('currentSlug') && Number.isSafeInteger(target.sessionId)
    ? document.querySelector('.session-item[data-session-id="' + target.sessionId + '"]') : null;
  var rect = row && row.getBoundingClientRect();
  var visible = rect && rect.width && rect.height && rect.top >= 0 && rect.bottom <= window.innerHeight && rect.right + 230 < window.innerWidth && row.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  if (!failed && visible && !window.matchMedia('(pointer: coarse), (max-width: 768px)').matches) {
    element.classList.add('has-target');
    element.style.left = (rect.right + 8) + 'px';
    element.style.top = Math.min(rect.top, window.innerHeight - 90) + 'px';
  }
  document.body.appendChild(element);
  var observer = row && visible ? new MutationObserver(function () {
    var box = row.getBoundingClientRect();
    if (!row.isConnected || !box.width || !box.height) clearClayControlActivity();
  }) : null;
  if (observer) observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  store.set({ clayControlActivity: { target: target, row: row, observer: observer, timer: setTimeout(clearClayControlActivity, 1800) } });
}

export function initClayControlActivity() {
  store.subscribe(function (value, previous) {
    if (!value.clayControlActivity) return;
    if (!value.connected || value.myUserId !== previous.myUserId || value.currentSlug !== previous.currentSlug || value.activeSessionId !== previous.activeSessionId || value.contextualClay !== previous.contextualClay || value.cachedMatesList !== previous.cachedMatesList || value.projectsHubList !== previous.projectsHubList) clearClayControlActivity();
  });
  ['resize', 'scroll', 'blur'].forEach(function (name) { window.addEventListener(name, clearClayControlActivity, true); });
  document.addEventListener('click', function (event) {
    if (event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) clearClayControlActivity();
  }, true);
}
