// Centralized local avatar URL builder for people and Mates.
import { imprintDataUrl, mateMarkDataUrl } from './avatar-imprint.js';

var imprintCache = new Map();
var mateMarkCache = new Map();

// Legacy style remains part of the identity hash so existing selections map
// deterministically into the local pixel identity system.
export function avatarUrl(style, seed, size) {
  var cacheKey = [style || 'imprint', seed || 'anonymous', size || 64].join('|');
  if (imprintCache.has(cacheKey)) return imprintCache.get(cacheKey);
  var url = imprintDataUrl({ style: style || 'imprint', seed: seed || 'anonymous', size: size || 64 });
  if (imprintCache.size >= 512) imprintCache.delete(imprintCache.keys().next().value);
  imprintCache.set(cacheKey, url);
  return url;
}

// Use the same bounded account identity for fresh fallbacks across every surface.
export function userAvatarSeed(user) {
  var profile = user && user.profile ? user.profile : user;
  var savedSeed = profile && profile.avatarSeed || user && user.avatarSeed;
  if (savedSeed) return String(savedSeed);
  var identity = profile && (profile.username || profile.id || profile.userId) || user && (user.username || user.id || user.userId) || 'anonymous';
  return String(identity).substring(0, 30);
}

// Build avatar URL for a user object, preferring custom avatar if set.
export function userAvatarUrl(user, size) {
  if (user && user.avatarCustom) return user.avatarCustom;
  var style = (user && user.avatarStyle) || 'imprint';
  return avatarUrl(style, userAvatarSeed(user), size);
}

export function mateMarkUrl(seed, size) {
  var cacheKey = [seed || 'mate', size || 64].join('|');
  if (mateMarkCache.has(cacheKey)) return mateMarkCache.get(cacheKey);
  var url = mateMarkDataUrl({ seed: seed || 'mate', size: size || 64 });
  if (mateMarkCache.size >= 256) mateMarkCache.delete(mateMarkCache.keys().next().value);
  mateMarkCache.set(cacheKey, url);
  return url;
}

// Build avatar URL for a mate object, preferring custom avatar if set.
export function mateAvatarUrl(mate, size) {
  if (!mate) return mateMarkUrl('mate', size);
  var p = mate.profile || mate;
  if (p.avatarCustom || mate.avatarCustom) return p.avatarCustom || mate.avatarCustom;
  var identity = p.displayName || mate.name || mate.displayName || 'Mate';
  return mateMarkUrl(identity, size);
}
