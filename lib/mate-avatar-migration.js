// Stable v1 migration, run only against the caller's normal Mate registry.
var catalog = require('./mate-avatar-catalog');
var managedArtwork = { clay: ['/clay-studio-symbol.png', '/mates/ally.png', '/mate-avatars/lead-clay.png'], ally: ['/mates/ally.png'] };
function mappedId(mate) {
  var p = mate.profile || mate;
  var key = JSON.stringify([mate.id || '', p.avatarStyle || 'imprint', p.avatarSeed || mate.id || p.displayName || mate.name || 'Mate']);
  var hash = 2166136261;
  for (var i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  var index = hash % 96;
  return (index < 48 ? 'B' : 'C') + String(index % 48 + 1).padStart(2, '0');
}
function hasCustom(mate) {
  var p = mate.profile || {};
  var custom = p.avatarCustom || mate.avatarCustom;
  if (!custom) return false;
  var managed = managedArtwork[mate.builtinKey] || [];
  return managed.indexOf(custom) === -1;
}
function normalizeMate(mate) {
  if (!mate || hasCustom(mate)) return false;
  var before = JSON.stringify(mate.profile || {});
  var p = Object.assign({}, mate.profile || {});
  p.avatarCatalogId = mate.builtinKey === 'clay' ? 'lead-clay' : catalog.valid(p.avatarCatalogId) ? p.avatarCatalogId : mappedId(mate);
  p.avatarStyle = 'catalog';
  delete p.avatarSeed;
  if (p.avatarCustom) p.avatarCustom = '';
  if (mate.builtinKey === 'clay') p.avatarLocked = true;
  if (before === JSON.stringify(p) && !Object.prototype.hasOwnProperty.call(mate, 'avatarStyle') && !Object.prototype.hasOwnProperty.call(mate, 'avatarSeed') && !Object.prototype.hasOwnProperty.call(mate, 'avatarCustom')) return false;
  mate.profile = p;
  delete mate.avatarStyle;
  delete mate.avatarSeed;
  delete mate.avatarCustom;
  return true;
}
function migrate(data) {
  var changed = false;
  data.mates.forEach(function (mate) { if (normalizeMate(mate)) changed = true; });
  if (data.avatarCatalogMigrationVersion !== 1) { data.avatarCatalogMigrationVersion = 1; changed = true; }
  return changed;
}
module.exports = { mappedId: mappedId, hasCustom: hasCustom, normalizeMate: normalizeMate, migrate: migrate };
