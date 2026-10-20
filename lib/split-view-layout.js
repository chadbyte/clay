var MAX_SESSIONS = 8;
var MIN_RATIO = 0.05;
var MAX_RATIO = 0.95;
var PRESETS = ["balanced", "columns", "rows", "grid", "main-left", "main-right"];

function validOrigin(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function validateTree(tree, expectedOrigins) {
  var origins = [];
  var invalid = null;
  function walk(node, depth) {
    if (invalid) return;
    if (!node || typeof node !== "object" || depth > MAX_SESSIONS) { invalid = "Layout tree is malformed"; return; }
    if (Object.prototype.hasOwnProperty.call(node, "id")) {
      if (Object.keys(node).length !== 1 || !validOrigin(node.id) || origins.indexOf(node.id) !== -1) {
        invalid = "Layout leaves must have unique valid session origins"; return;
      }
      origins.push(node.id);
      if (origins.length > MAX_SESSIONS) invalid = "A Split view can contain at most eight sessions";
      return;
    }
    if (Object.keys(node).sort().join(",") !== "axis,left,ratio,right" ||
        ["horizontal", "vertical"].indexOf(node.axis) === -1 || typeof node.ratio !== "number" ||
        !Number.isFinite(node.ratio) || node.ratio < MIN_RATIO || node.ratio > MAX_RATIO) {
      invalid = "Layout branch must have a valid axis and bounded ratio"; return;
    }
    walk(node.left, depth + 1); walk(node.right, depth + 1);
  }
  walk(tree, 0);
  if (invalid) return { ok: false, error: invalid, origins: origins };
  if (origins.length < 2 || origins.length > MAX_SESSIONS) return { ok: false, error: "A Split view requires two to eight sessions", origins: origins };
  if (expectedOrigins) {
    if (!Array.isArray(expectedOrigins) || expectedOrigins.length !== origins.length ||
        expectedOrigins.some(function (id) { return !validOrigin(id) || origins.indexOf(id) === -1; })) {
      return { ok: false, error: "Layout leaves must exactly match the selected sessions", origins: origins };
    }
  }
  return { ok: true, origins: origins };
}

function validateName(name) {
  if (typeof name !== "string") return { ok: false, error: "Split view name is required" };
  var normalized = name.trim();
  if (!normalized || normalized.length > 80) return { ok: false, error: "Split view name must be between 1 and 80 characters" };
  return { ok: true, name: normalized };
}

function validatePreset(name) {
  return PRESETS.indexOf(name) !== -1;
}

function removeLeaf(tree, originId) {
  if (!tree || typeof tree !== "object") return tree;
  if (Object.prototype.hasOwnProperty.call(tree, "id")) return tree.id === originId ? null : tree;
  var left = removeLeaf(tree.left, originId), right = removeLeaf(tree.right, originId);
  if (!left) return right;
  if (!right) return left;
  if (left === tree.left && right === tree.right) return tree;
  return { axis: tree.axis, ratio: tree.ratio, left: left, right: right };
}

function leaf(id) { return { id: id }; }
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
function createPreset(origins, name) {
  if (!Array.isArray(origins) || origins.length > MAX_SESSIONS ||
      origins.some(function (id) { return !validOrigin(id); }) || new Set(origins).size !== origins.length) {
    throw new TypeError("Preset input must contain zero to eight unique session origins");
  }
  if (!validatePreset(name)) throw new TypeError("Unknown Split view preset");
  if (!origins.length) return null;
  if (origins.length === 1) return leaf(origins[0]);
  if (name === "columns") return chain(origins, "horizontal");
  if (name === "rows") return chain(origins, "vertical");
  if (name === "grid") return grid(origins);
  if (name === "main-left" || name === "main-right") {
    var main = leaf(origins[0]), rest = grid(origins.slice(1)), mainShare = origins.length === 2 ? 0.5 : 2 / 3;
    return name === "main-left" ? { axis: "horizontal", ratio: mainShare, left: main, right: rest } : { axis: "horizontal", ratio: 1 - mainShare, left: rest, right: main };
  }
  if (origins.length <= 3) {
    return { axis: "horizontal", ratio: 0.55, left: leaf(origins[0]), right: chain(origins.slice(1), "vertical") };
  }
  return grid(origins);
}

function validateViewShape(view) {
  if (!view || typeof view !== "object" || typeof view.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(view.id)) return { ok: false, error: "Split view identity is invalid" };
  if (view.folderId != null && (typeof view.folderId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(view.folderId))) return { ok: false, error: 'Invalid Split view folder' };
  if (view.favorite !== undefined && typeof view.favorite !== 'boolean') return { ok: false, error: 'Invalid Split view favorite' };
  var name = validateName(view.name);
  if (!name.ok) return name;
  if (view.nameMode != null && ["automatic", "custom"].indexOf(view.nameMode) === -1) return { ok: false, error: "Split view name mode is invalid" };
  if (!Number.isInteger(view.revision) || view.revision < 1 || !validatePreset(view.layout)) return { ok: false, error: "Split view revision or layout is invalid" };
  var refs = view.sessionRefs;
  if (!Array.isArray(refs) || refs.length < 2 || refs.length > MAX_SESSIONS) return { ok: false, error: "A Split view requires two to eight sessions" };
  var ids = [];
  for (var i = 0; i < refs.length; i++) {
    var ref = refs[i];
    if (!ref || !validOrigin(ref.originId) || ids.indexOf(ref.originId) !== -1 ||
        !(ref.ownerId === null || typeof ref.ownerId === "string") ||
        !(ref.linuxUser === null || typeof ref.linuxUser === "string")) return { ok: false, error: "Split view session references are invalid" };
    ids.push(ref.originId);
  }
  var tree = validateTree(view.tree, ids);
  if (!tree.ok) return tree;
  if (typeof view.activeSessionOriginId !== "string" || ids.indexOf(view.activeSessionOriginId) === -1) return { ok: false, error: "Active session must belong to the Split view" };
  return { ok: true, name: name.name, origins: ids };
}

module.exports = {
  MAX_SESSIONS: MAX_SESSIONS,
  MIN_RATIO: MIN_RATIO,
  MAX_RATIO: MAX_RATIO,
  PRESETS: PRESETS.slice(),
  validOrigin: validOrigin,
  validateTree: validateTree,
  validateName: validateName,
  validatePreset: validatePreset,
  removeLeaf: removeLeaf,
  createPreset: createPreset,
  validateViewShape: validateViewShape,
};
