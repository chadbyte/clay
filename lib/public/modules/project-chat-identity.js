// Session-bound assistant identity for ordinary project and Mate transcripts.

import { store } from './store.js';
import { mateAvatarUrl } from './avatar.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './chat-render-runtime.js';

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
    var avatarMate = mate || { id: mateId, name: fallbackName, profile: { displayName: fallbackName } };
    return {
      kind: 'mate',
      mateId: mateId,
      name: mateName(mate, fallbackName),
      avatarUrl: mateAvatarUrl(avatarMate, 34),
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
  var avatar = element.querySelector('.dm-bubble-avatar');
  var name = element.querySelector('.dm-bubble-name');
  if (avatar) avatar.src = identity.avatarUrl;
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
