// Stable catalog identities are the only accepted library references.
var catalog = require('./public/mate-avatars/catalog.json');
var ids = new Set(catalog.map(function (entry) { return entry.id; }));
function valid(id) { return typeof id === 'string' && ids.has(id); }
function validate(profile, mate) {
  if (profile !== undefined && (!profile || typeof profile !== 'object' || Array.isArray(profile))) return 'Choose a valid Mate profile.';
  if (profile && Object.prototype.hasOwnProperty.call(profile, 'avatarCatalogId') && profile.avatarCatalogId !== '' && !valid(profile.avatarCatalogId) && !(profile.avatarCatalogId === 'lead-clay' && mate && mate.builtinKey === 'clay')) {
    return 'Choose an avatar from the Clay catalog.';
  }
  return null;
}
module.exports = { valid: valid, validate: validate };
