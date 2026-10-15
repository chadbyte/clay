// Opaque server-only authority. Tool arguments cannot manufacture a binding.
var grants = new WeakMap();
function issue(resolve) {
  var token = Object.freeze({});
  grants.set(token, resolve);
  return token;
}
function resolve(token, slug) {
  var check = token && grants.get(token);
  if (!check) throw new Error('Canonical Clay record authority is required.');
  var live = check(slug);
  if (!live || !live.principal || !live.actor || !live.project || !live.status || live.status.isMate) throw new Error('Canonical Clay record authority is unavailable.');
  return live;
}
module.exports = { issue: issue, resolve: resolve };
