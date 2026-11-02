// Shared bounded catalog for persistence, first paint and the settings gallery.
(function (root) {
  var colors = Object.freeze([
    Object.freeze({ id: 'clay', name: 'Clay', light: '#e2c4b5', dark: '#493831' }),
    Object.freeze({ id: 'sand', name: 'Sand', light: '#e7dcc2', dark: '#433d2f' }),
    Object.freeze({ id: 'sage', name: 'Sage', light: '#cedbd0', dark: '#303f37' }),
    Object.freeze({ id: 'indigo', name: 'Indigo', light: '#d4d3e8', dark: '#35354b' }),
    Object.freeze({ id: 'cream', name: 'Cream', light: '#eee3d5', dark: '#443c32' }),
    Object.freeze({ id: 'rose', name: 'Rose', light: '#e9cbd4', dark: '#49333d' }),
    Object.freeze({ id: 'plum', name: 'Plum', light: '#ddcde1', dark: '#423247' }),
    Object.freeze({ id: 'coral', name: 'Coral', light: '#e9c6c3', dark: '#4c3332' }),
    Object.freeze({ id: 'peach', name: 'Peach', light: '#edd0b8', dark: '#4c3a2e' }),
    Object.freeze({ id: 'gold', name: 'Gold', light: '#e9dfb5', dark: '#47402b' }),
    Object.freeze({ id: 'mint', name: 'Mint', light: '#cce2d8', dark: '#2d433a' }),
    Object.freeze({ id: 'sky', name: 'Sky', light: '#cbdfe9', dark: '#2e3f4b' }),
    Object.freeze({ id: 'slate', name: 'Slate', light: '#d3dbe2', dark: '#343e48' }),
    Object.freeze({ id: 'ink', name: 'Ink', light: '#c9cbd6', dark: '#292b38' }),
    Object.freeze({ id: 'paper', name: 'Paper', light: '#f2f2ef', dark: '#272725' })
  ]);
  var defaultColorId = 'sky';
  var MAX_CUSTOM = 12;
  function normalizeHex(value) { return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : null; }
  function normalizeCustom(value) {
    if (!Array.isArray(value) || value.length > MAX_CUSTOM) return null;
    var ids = new Set(), result = [];
    for (var entry of value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || !/^custom-[a-z0-9-]{1,48}$/.test(entry.id) || ids.has(entry.id)) return null;
      if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 40 || /[<>\x00-\x1f\x7f]/.test(entry.name)) return null;
      var light = normalizeHex(entry.light), dark = normalizeHex(entry.dark);
      if (!light || !dark) return null;
      ids.add(entry.id); result.push({ id: entry.id, name: entry.name.trim(), light: light, dark: dark });
    }
    return result;
  }
  function isColor(value, custom) { return typeof value === 'string' && colors.concat(normalizeCustom(custom || []) || []).some(function (color) { return color.id === value; }); }
  function getColor(value, custom) { return colors.concat(normalizeCustom(custom || []) || []).find(function (color) { return color.id === value; }) || colors.find(function (color) { return color.id === defaultColorId; }); }
  var catalog = Object.freeze({ colors: colors, defaultColorId: defaultColorId, maxCustom: MAX_CUSTOM, normalizeHex: normalizeHex, normalizeCustom: normalizeCustom, isColor: isColor, getColor: getColor });
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.ClayWorkspaceBackgrounds = catalog;
}(globalThis));
