// Only curated pigments may affect a Mate's workspace surface.
var COLORS = ['mint', 'rose', 'plum', 'coral', 'peach', 'gold', 'sky', 'indigo', 'stone'];
function valid(value) { return typeof value === 'string' && COLORS.indexOf(value) !== -1; }
module.exports = { colors: COLORS, valid: valid };
