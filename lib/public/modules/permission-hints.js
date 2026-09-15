import { store } from './store.js';

export function applyPermissionHints(container, hints) {
  if (!container || !hints) return;
  if (hints.suppressAlwaysAllowRule) {
    var persistent = container.querySelectorAll('.permission-allow-session, .mate-permission-always, .notif-banner-always');
    persistent.forEach(function(button) { button.remove(); });
  }
  if (hints.defaultToNo && !store.get('replayingHistory')) {
    var decline = container.querySelector('.permission-deny, .mate-permission-deny, .notif-banner-deny');
    if (decline) decline.focus({ preventScroll: true });
  }
}
