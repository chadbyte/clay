// Session-bound assistant identity for ordinary project and Mate transcripts.

import { store } from './store.js';
import { mateAvatarUrl } from './avatar.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './chat-render-runtime.js';

// A missing or failed profile image must never borrow another speaker's identity.
var NEUTRAL_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#888" fill-opacity=".14"/><circle cx="16" cy="12" r="5" fill="#888"/><path d="M6 29a10 10 0 0 1 20 0" fill="#888"/></svg>');

function mateById(state, mateId) {
  var mates = state.cachedMatesList || [];
  for (var i = 0; i < mates.length; i++) {
    if (mates[i] && mates[i].id === mateId) return mates[i];
  }
  return null;
}

function mateName(mate, fallback) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.displayName || (mate && (mate.displayName || mate.name)) || fallback || 'Mate';
}

export function resolveProjectAssistantIdentity(state, vendor) {
  state = state || store.snap();
  var dmTarget = state.dmMode && state.dmTargetUser && state.dmTargetUser.isMate ? state.dmTargetUser : null;
  var mateId = dmTarget ? dmTarget.id : state.activeSessionMateId;
  if (mateId) {
    var mate = mateById(state, mateId) || dmTarget;
    var fallbackName = dmTarget && dmTarget.displayName || state.activeSessionMateName || 'Mate';
    return {
      kind: 'mate',
      mateId: mateId,
      name: mateName(mate, fallbackName),
      avatarUrl: mate ? mateAvatarUrl(mate, 34) : NEUTRAL_AVATAR,
    };
  }
  var vendorId = vendor || state.currentVendor || 'claude';
  return {
    kind: 'provider',
    mateId: '',
    name: VENDOR_NAMES[vendorId] || VENDOR_NAMES.claude,
    avatarUrl: VENDOR_AVATARS[vendorId] || VENDOR_AVATARS.claude,
  };
}

export function getProjectAssistantPlaceholder(state, vendor) {
  return 'Message ' + resolveProjectAssistantIdentity(state, vendor).name + '...';
}

export function applyProjectAssistantIdentity(element, identity) {
  if (!element || !identity) return element;
  var avatar = element.querySelector('.dm-bubble-avatar') || element.querySelector('.activity-inline-avatar');
  var name = element.querySelector('.dm-bubble-name');
  if (avatar) {
    avatar.onerror = identity.kind === 'mate' ? function () { avatar.onerror = null; avatar.src = NEUTRAL_AVATAR; } : null;
    avatar.src = identity.avatarUrl;
  }
  if (element.className.indexOf('activity-inline') >= 0) {
    var activityLabel = element.querySelector('.activity-state-label');
    element.setAttribute('aria-label', identity.name + ' · ' + (activityLabel ? activityLabel.textContent : 'Responding'));
  }
  if (name) name.textContent = identity.name;
  if (identity.kind === 'mate') {
    element.dataset.sessionMateId = identity.mateId;
    element.dataset.sessionMateName = identity.name;
  } else {
    delete element.dataset.sessionMateId;
    delete element.dataset.sessionMateName;
  }
  return element;
}

export function refreshProjectAssistantIdentities(root) {
  var target = root || document;
  var elements = target.querySelectorAll('[data-session-mate-id]');
  var state = store.snap();
  for (var i = 0; i < elements.length; i++) {
    var mateId = elements[i].dataset.sessionMateId;
    var mate = mateById(state, mateId);
    if (!mate) continue;
    applyProjectAssistantIdentity(elements[i], {
      kind: 'mate',
      mateId: mateId,
      name: mateName(mate, elements[i].dataset.sessionMateName || 'Mate'),
      avatarUrl: mateAvatarUrl(mate, 34),
    });
  }
}
