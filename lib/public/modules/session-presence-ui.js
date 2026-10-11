import { avatarUrl, userAvatarUrl } from './avatar.js';
import { store } from './store.js';

function avatarFor(userOrStyle, seed) {
  if (userOrStyle && typeof userOrStyle === "object") return userAvatarUrl(userOrStyle, 24);
  return avatarUrl(userOrStyle || "imprint", seed, 24);
}

export function setSessionPresence(presence) {
  store.set({ sessionPresence: presence || {} });
}

export function renderSessionPresence(row, sessionId) {
  var existing = row.querySelector(".session-presence");
  if (existing) existing.remove();
  var all = store.get('sessionPresence') || {};
  var users = all[String(sessionId)] || all[sessionId];
  if (!users || !users.length) return null;

  var container = document.createElement("span");
  container.className = "session-presence";
  container.setAttribute("aria-label", users.length + (users.length === 1 ? " person viewing" : " people viewing"));
  var max = 3;
  var shown = Math.min(max, users.length);
  for (var i = 0; i < shown; i++) {
    var user = users[i];
    var image = document.createElement("img");
    image.className = "session-presence-avatar";
    image.src = avatarFor(user);
    image.alt = user.displayName || "Viewer";
    image.dataset.tip = (user.displayName || "Viewer") + (user.username ? " (@" + user.username + ")" : "");
    container.appendChild(image);
  }
  if (users.length > max) {
    var more = document.createElement("span");
    more.className = "session-presence-more";
    more.textContent = "+" + (users.length - max);
    container.appendChild(more);
  }

  var anchor = row.querySelector(".session-item-age, .mobile-worker-generation, .mobile-session-unread, .session-row-actions, .mobile-session-star");
  // Desktop age/actions now live inside one trailing slot. insertBefore only
  // accepts a direct child, so promote a nested match to its row-level owner.
  while (anchor && anchor.parentNode !== row) anchor = anchor.parentNode;
  row.insertBefore(container, anchor || null);
  return container;
}
