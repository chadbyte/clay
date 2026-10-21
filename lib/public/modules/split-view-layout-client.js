// Browser-side parity for lib/split-view-layout.js. This module stays pure so
// client geometry and server validation can be exercised independently.
var MAX_SESSIONS = 8;
var MIN_RATIO = 0.05;
var MAX_RATIO = 0.95;
var PRESETS = ["balanced", "columns", "rows", "grid", "main-left", "main-right"];

export function listIds(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Object.prototype.hasOwnProperty.call(tree, "id")) return [tree.id];
  return listIds(tree.left).concat(listIds(tree.right));
}

export function validateTree(tree, expectedIds) {
  var ids = listIds(tree);
  var valid = true;
  function walk(node, depth) {
    if (!node || typeof node !== "object" || depth > MAX_SESSIONS) return false;
    if (Object.prototype.hasOwnProperty.call(node, "id")) {
      return Object.keys(node).length === 1 && validId(node.id);
    }
    if (Object.keys(node).sort().join(",") !== "axis,left,ratio,right" ||
        ["horizontal", "vertical"].indexOf(node.axis) === -1 || typeof node.ratio !== "number" ||
        !Number.isFinite(node.ratio) || node.ratio < MIN_RATIO || node.ratio > MAX_RATIO) return false;
    return walk(node.left, depth + 1) && walk(node.right, depth + 1);
  }
  valid = (tree === null || walk(tree, 0)) && ids.length >= 0 && ids.length <= MAX_SESSIONS && new Set(ids).size === ids.length;
  if (valid && expectedIds) {
    valid = Array.isArray(expectedIds) && expectedIds.length === ids.length &&
      expectedIds.every(function (id) { return ids.indexOf(id) !== -1; });
  }
  return { ok: valid, ids: ids };
}

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}
function leaf(id) { return { id: id }; }
export function pairTree(targetId, sourceId, position) {
  if (!validId(targetId) || !validId(sourceId) || ["left", "right", "top", "bottom"].indexOf(position) === -1 || targetId === sourceId) {
    throw new TypeError("Pair layout requires two distinct session origins and a valid position");
  }
  var before = position === "left" || position === "top";
  return { axis: position === "top" || position === "bottom" ? "vertical" : "horizontal", ratio: 0.5,
    left: before ? leaf(sourceId) : leaf(targetId), right: before ? leaf(targetId) : leaf(sourceId) };
}
function chain(ids, axis) {
  if (ids.length === 1) return leaf(ids[0]);
  return { axis: axis, ratio: 1 / ids.length, left: leaf(ids[0]), right: chain(ids.slice(1), axis) };
}
function grid(ids) {
  if (ids.length <= 2) return chain(ids, "horizontal");
  var split = Math.ceil(ids.length / 2);
  return { axis: "vertical", ratio: split / ids.length,
    left: chain(ids.slice(0, split), "horizontal"), right: chain(ids.slice(split), "horizontal") };
}

export function preset(ids, name) {
  if (!Array.isArray(ids) || ids.length > MAX_SESSIONS || ids.some(function (id) { return !validId(id); }) || new Set(ids).size !== ids.length) {
    throw new TypeError("Preset input must contain zero to eight unique session origins");
  }
  if (PRESETS.indexOf(name) === -1) throw new TypeError("Unknown Split view preset");
  if (!ids.length) return null;
  if (ids.length === 1) return leaf(ids[0]);
  if (name === "columns") return chain(ids, "horizontal");
  if (name === "rows") return chain(ids, "vertical");
  if (name === "grid") return grid(ids);
  if (name === "main-left" || name === "main-right") {
    var share = ids.length === 2 ? 0.5 : 2 / 3;
    return name === "main-left" ? { axis: "horizontal", ratio: share, left: leaf(ids[0]), right: grid(ids.slice(1)) } :
      { axis: "horizontal", ratio: 1 - share, left: grid(ids.slice(1)), right: leaf(ids[0]) };
  }
  if (ids.length <= 3) return { axis: "horizontal", ratio: 0.55, left: leaf(ids[0]), right: chain(ids.slice(1), "vertical") };
  return grid(ids);
}

export function remove(tree, id) {
  if (!tree || typeof tree !== "object") return tree;
  if (Object.prototype.hasOwnProperty.call(tree, "id")) return tree.id === id ? null : tree;
  var left = remove(tree.left, id), right = remove(tree.right, id);
  if (!left) return right;
  if (!right) return left;
  if (left === tree.left && right === tree.right) return tree;
  return { axis: tree.axis, ratio: tree.ratio, left: left, right: right };
}

function insert(tree, id, targetId, position, share) {
  if (!tree || typeof tree !== "object") return { tree: tree, found: false };
  if (Object.prototype.hasOwnProperty.call(tree, "id")) {
    if (tree.id !== targetId) return { tree: tree, found: false };
    var horizontal = position === "left" || position === "right";
    var before = position === "left" || position === "top";
    var branch = { axis: horizontal ? "horizontal" : "vertical", ratio: before ? share : 1 - share,
      left: before ? leaf(id) : tree, right: before ? tree : leaf(id) };
    return { tree: branch, found: true };
  }
  var left = insert(tree.left, id, targetId, position, share);
  if (left.found) return { tree: { axis: tree.axis, ratio: tree.ratio, left: left.tree, right: tree.right }, found: true };
  var right = insert(tree.right, id, targetId, position, share);
  if (right.found) return { tree: { axis: tree.axis, ratio: tree.ratio, left: tree.left, right: right.tree }, found: true };
  return { tree: tree, found: false };
}

export function place(tree, sourceId, targetId, position, share) {
  var allowed = ["left", "right", "top", "bottom"];
  var amount = share === undefined ? 0.5 : share;
  if (!validId(sourceId) || !validId(targetId)) return { ok: false, tree: tree, reason: "invalid-id" };
  if (allowed.indexOf(position) === -1) return { ok: false, tree: tree, reason: "invalid-position" };
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < MIN_RATIO || amount > MAX_RATIO) return { ok: false, tree: tree, reason: "invalid-share" };
  if (sourceId === targetId) return { ok: true, tree: tree, changed: false };
  if (!tree) return { ok: false, tree: tree, reason: "unknown-target" };
  var targetIds = listIds(tree);
  if (targetIds.indexOf(targetId) === -1) return { ok: false, tree: tree, reason: "unknown-target" };
  var sourceExists = targetIds.indexOf(sourceId) !== -1;
  if (!sourceExists && targetIds.length >= MAX_SESSIONS) return { ok: false, tree: tree, reason: "limit" };
  var base = sourceExists ? remove(tree, sourceId) : tree;
  var result = insert(base, sourceId, targetId, position, amount);
  if (!result.found) return { ok: false, tree: tree, reason: "unknown-target" };
  return { ok: true, tree: result.tree, changed: true };
}

export function swap(tree, firstId, secondId) {
  var ids = listIds(tree);
  if (firstId === secondId) return { ok: ids.indexOf(firstId) !== -1, tree: tree, changed: false, reason: ids.indexOf(firstId) === -1 ? "unknown-id" : null };
  if (ids.indexOf(firstId) === -1 || ids.indexOf(secondId) === -1) return { ok: false, tree: tree, changed: false, reason: "unknown-id" };
  function walk(node) {
    if (Object.prototype.hasOwnProperty.call(node, "id")) return leaf(node.id === firstId ? secondId : node.id === secondId ? firstId : node.id);
    return { axis: node.axis, ratio: node.ratio, left: walk(node.left), right: walk(node.right) };
  }
  return { ok: true, tree: walk(tree), changed: true };
}

export function resize(tree, path, ratio) {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < MIN_RATIO || ratio > MAX_RATIO) return null;
  if (!Array.isArray(path)) return null;
  function walk(node, index) {
    if (!node || Object.prototype.hasOwnProperty.call(node, "id")) return null;
    if (index === path.length) return { axis: node.axis, ratio: ratio, left: node.left, right: node.right };
    var side = path[index];
    if (side !== "left" && side !== "right") return null;
    var child = walk(node[side], index + 1);
    if (!child) return null;
    return { axis: node.axis, ratio: node.ratio, left: side === "left" ? child : node.left, right: side === "right" ? child : node.right };
  }
  return walk(tree, 0);
}

export function arrangeRegion(tree, sourceId, position) {
  var positions = ["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right", "left-third", "right-third"];
  if (positions.indexOf(position) === -1) return { ok: false, tree: tree, reason: "invalid-position" };
  var ids = listIds(tree), remaining = ids.filter(function (id) { return id !== sourceId; });
  if (!validId(sourceId) || ids.indexOf(sourceId) === -1) return { ok: false, tree: tree, reason: "unknown-source" };
  if (!remaining.length) return { ok: false, tree: tree, reason: "insufficient-windows" };
  var rest = preset(remaining, "balanced");
  if (position === "left-third" || position === "right-third") {
    var leftThird = position === "left-third";
    return { ok: true, tree: leftThird ? { axis: "horizontal", ratio: 1 / 3, left: leaf(sourceId), right: rest } :
      { axis: "horizontal", ratio: 2 / 3, left: rest, right: leaf(sourceId) } };
  }
  if (position.indexOf("-") !== -1) {
    if (remaining.length < 2) return { ok: false, tree: tree, reason: "quarter-requires-three" };
    var top = position.indexOf("top-") === 0, left = position.slice(-4) === "left", companion = remaining[0];
    var bulk = preset(remaining.slice(1), "balanced");
    var corner = top ? { axis: "vertical", ratio: 0.5, left: leaf(sourceId), right: leaf(companion) } :
      { axis: "vertical", ratio: 0.5, left: leaf(companion), right: leaf(sourceId) };
    return { ok: true, tree: left ? { axis: "horizontal", ratio: 0.5, left: corner, right: bulk } :
      { axis: "horizontal", ratio: 0.5, left: bulk, right: corner } };
  }
  var horizontal = position === "left" || position === "right", before = position === "left" || position === "top";
  return { ok: true, tree: { axis: horizontal ? "horizontal" : "vertical", ratio: 0.5,
    left: before ? leaf(sourceId) : rest, right: before ? rest : leaf(sourceId) } };
}

// Rectangles are returned by leaf ID and divider path. The host owns flat pane
// nodes; callers apply these numbers as inline positions without reparenting.
export function rectangles(tree, width, height, gap) {
  var paneRects = {};
  var dividers = [];
  var dividerSize = Number.isFinite(gap) && gap >= 0 ? gap : 7;
  function visit(node, rect, path) {
    if (!node) return;
    if (Object.prototype.hasOwnProperty.call(node, "id")) { paneRects[node.id] = rect; return; }
    var horizontal = node.axis === "horizontal";
    var available = Math.max(0, (horizontal ? rect.width : rect.height) - dividerSize);
    var first = available * node.ratio;
    var split = horizontal ? rect.x + first : rect.y + first;
    var divider = horizontal ? { x: split, y: rect.y, width: dividerSize, height: rect.height } :
      { x: rect.x, y: split, width: rect.width, height: dividerSize };
    dividers.push({ path: path.slice(), axis: node.axis, rect: divider, branchRect: rect, ratio: node.ratio, available: available });
    var left = horizontal ? { x: rect.x, y: rect.y, width: first, height: rect.height } : { x: rect.x, y: rect.y, width: rect.width, height: first };
    var right = horizontal ? { x: split + dividerSize, y: rect.y, width: available - first, height: rect.height } :
      { x: rect.x, y: split + dividerSize, width: rect.width, height: available - first };
    visit(node.left, left, path.concat("left"));
    visit(node.right, right, path.concat("right"));
  }
  visit(tree, { x: 0, y: 0, width: width, height: height }, []);
  return { panes: paneRects, dividers: dividers };
}
