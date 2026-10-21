function check(input, slug, ownerId, extended, view) {
  if (input.projectSlug !== undefined && input.projectSlug !== slug || input.accountId !== undefined && input.accountId !== ownerId ||
      extended && (input.projectSlug !== slug || input.accountId !== ownerId)) {
    return { ok: false, code: 'identity', error: 'View account or project identity does not match' };
  }
  if (view && (extended || input.expectedViewRevision !== undefined) && input.expectedViewRevision !== view.revision) {
    return { ok: false, code: 'conflict', error: 'View revision changed. Reload and try again.' };
  }
  return { ok: true };
}
module.exports = { check: check };
