// Display preferences only: these records never open sessions or run tools.
var tools = ['tool-terminal', 'tool-browser', 'tool-file-viewer'];
function validTree(tree, allowTools) {
  var ids = [], nodes = 0;
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || ++nodes > 21 || depth > 10) return false;
    if (Object.prototype.hasOwnProperty.call(node, 'id')) {
      if (Object.keys(node).length !== 1 || typeof node.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(node.id)) return false;
      if (node.id.indexOf('tool-') === 0 && (!allowTools || tools.indexOf(node.id) < 0)) return false;
      ids.push(node.id); return true;
    }
    return Object.keys(node).sort().join(',') === 'axis,left,ratio,right' && ['horizontal', 'vertical'].indexOf(node.axis) >= 0 &&
      Number.isFinite(node.ratio) && node.ratio >= .05 && node.ratio <= .95 && walk(node.left, depth + 1) && walk(node.right, depth + 1);
  }
  return walk(tree, 0) && ids.length > 0 && ids.length <= (allowTools ? 11 : 8) && new Set(ids).size === ids.length;
}
function validLayout(input) {
  return !!input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).sort().join(',') === 'base,key,tree' &&
    typeof input.key === 'string' && input.key.length > 0 && input.key.length <= 512 && input.key !== '__proto__' &&
    validTree(input.base, false) && validTree(input.tree, true) && sameSessions(input.base, input.tree);
}
function sameSessions(base, tree) {
  function ids(node) { return node.id ? (tools.indexOf(node.id) >= 0 ? [] : [node.id]) : ids(node.left).concat(ids(node.right)); }
  return JSON.stringify(ids(base).sort()) === JSON.stringify(ids(tree).sort());
}
function validLayouts(layouts) {
  return !!layouts && typeof layouts === 'object' && !Array.isArray(layouts) && Object.keys(layouts).length <= 32 &&
    Object.keys(layouts).every(function (key) { var item = layouts[key]; return item && validLayout({ key: key, base: item.base, tree: item.tree }); });
}
module.exports = { validLayout: validLayout, validLayouts: validLayouts };
