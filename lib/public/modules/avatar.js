// Centralized local avatar URL builder for people and Mates.
import { imprintDataUrl } from './avatar-imprint.js';

export function avatarUrl(style, seed, size) {
  // Legacy user styles remain part of the seed identity, never the artwork.
  return imprintDataUrl({ style: style || 'imprint', seed: seed || 'anonymous', size: size || 64 });
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

function mappedMateAvatarId(mate) {
  var p = mate.profile || mate;
  var key = JSON.stringify([mate.id || '', p.avatarStyle || 'imprint', p.avatarSeed || mate.id || p.displayName || mate.name || 'Mate']);
  var hash = 2166136261;
  for (var i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  var index = hash % 96;
  return (index < 48 ? 'B' : 'C') + String(index % 48 + 1).padStart(2, '0');
}

export function mateCatalogAvatarUrl(id) {
  if (id === 'lead-clay') return '/mate-avatars/lead-clay.png?v=4';
  return typeof id === 'string' && /^[BC](0[1-9]|[1-3][0-9]|4[0-8])$/.test(id) ? '/mate-avatars/' + id + '.png?v=4' : '';
}

// Build avatar URL for a mate object, preferring custom avatar if set.
export function mateAvatarUrl(mate, size) {
  if (!mate) return mateCatalogAvatarUrl('B01');
  var p = mate.profile || mate;
  if (p.avatarCustom || mate.avatarCustom) return p.avatarCustom || mate.avatarCustom;
  return mateCatalogAvatarUrl(p.avatarCatalogId) || mateCatalogAvatarUrl(mate.builtinKey === 'clay' ? 'lead-clay' : mappedMateAvatarId(mate));
}
