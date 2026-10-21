import { WORKBENCH_PANELS } from './workbench-panels.js';
import { listIds, remove, pairTree, swap } from './split-view-layout-client.js';

export var TOOL_PANES = { terminal: { id: 'terminal-container', label: 'Terminal', icon: 'terminal' },
  browser: { id: 'shared-browser-panel', label: 'Browser', icon: 'globe' }, 'file-viewer': { id: 'file-viewer', label: 'Files', icon: 'file-text' } };
Object.assign(TOOL_PANES, WORKBENCH_PANELS);
export function toolWindowId(name) { return 'tool-' + name; }
export function isToolWindow(id) { return /^tool-file-[A-Za-z0-9_-]+$/.test(id) || Object.keys(TOOL_PANES).some(function (name) { return toolWindowId(name) === id; }); }
export function insertWindow(tree, source, target, side, ratio) {
  if (source === target) return tree;
  if (side === 'center' && isToolWindow(source) && isToolWindow(target)) return swap(tree, source, target).tree;
  side = side === 'center' ? 'right' : side;
  var base = remove(tree, source), found = false;
  function walk(node) {
    if (!node) return node;
    if (node.id) {
      if (node.id !== target) return node;
      found = true;
      var result = pairTree(target, source, side);
      result.ratio = ratio || .5;
      return result;
    }
    return { axis: node.axis, ratio: node.ratio, left: walk(node.left), right: walk(node.right) };
  }
  var next = walk(base);
  return found && listIds(next).length <= 24 ? next : tree;
}
function stripUnknown(tree, allowed) {
  var result = tree;
  listIds(tree).forEach(function (id) { if (allowed.indexOf(id) < 0) result = remove(result, id); });
  return result;
}
function placements(tree, output) {
  if (!tree || tree.id) return;
  var left = listIds(tree.left), right = listIds(tree.right);
  if (tree.left.id && isToolWindow(tree.left.id)) output.push({ id: tree.left.id, target: right[0], side: tree.axis === 'horizontal' ? 'left' : 'top', ratio: tree.ratio });
  else if (tree.right.id && isToolWindow(tree.right.id)) output.push({ id: tree.right.id, target: left[0], side: tree.axis === 'horizontal' ? 'right' : 'bottom', ratio: tree.ratio });
  placements(tree.left, output); placements(tree.right, output);
}
export function workspaceWindowTree(base, saved, owners) {
  var sessions = listIds(base), tools = owners.map(toolWindowId), allowed = sessions.concat(tools), tree = base;
  if (saved && saved.tree && JSON.stringify(saved.base) === JSON.stringify(base)) tree = stripUnknown(saved.tree, allowed);
  else if (saved && saved.tree) {
    var attached = []; placements(saved.tree, attached);
    attached.reverse().forEach(function (item) { if (tools.indexOf(item.id) >= 0 && listIds(tree).indexOf(item.target) >= 0) tree = insertWindow(tree, item.id, item.target, item.side, item.ratio); });
  }
  tools.forEach(function (id) {
    if (listIds(tree).indexOf(id) < 0) tree = tree ? { axis: 'horizontal', ratio: .66, left: tree, right: { id: id } } : { id: id };
  });
  return tree;
}
