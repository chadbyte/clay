// Pure model for per-user, per-project session folders. No I/O and no
// dependency on live sessions: callers inject the checks that need them, so
// every invariant here is enforced the same way for any transport.
//
// Shape of one state:
//   folders:     [{ id, name }]            custom folders, array order = display order
//   assignments: { sessionKey: folderId }  folderId is "favorites" or a custom id; absent = Unfiled
//   orders:      { containerKey: [keys] }  manual order per container ("favorites", "unfiled", custom id, "all")
//   collapsed:   { containerKey: true }
//   view:        { group, sort, direction }
// sessionKey is the session's opaque, durable sessionOriginId.

var crypto = require("crypto");

var FAVORITES_ID = "favorites";
var UNFILED_ID = "unfiled";
var ALL_ID = "all";
var MAX_FOLDERS = 50;
var MAX_NAME_LENGTH = 60;
var MAX_KEYS = 5000;
var MAX_KEY_LENGTH = 128;

// Folders are the only layout. Older clients and stored preferences may still
// name "dates" or "none"; those are accepted and canonicalized to "folders".
var LEGACY_GROUPS = ["folders", "dates", "none"];
var SORTS = ["activity", "created", "title", "manual"];
var DIRECTIONS = ["desc", "asc"];

function defaultState() {
  return {
    folders: [],
    assignments: {},
    orders: {},
    collapsed: {},
    view: { group: "folders", sort: "activity", direction: "desc" },
    legacyFavoritesMigrated: false,
  };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// Dictionary keys come from storage and clients, so names that exist on
// Object.prototype must never be treated as present, and __proto__ is refused.
function validKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH && !/[\x00-\x1f]/.test(value) && value !== "__proto__";
}

function validFolderId(value) {
  return typeof value === "string" && /^f_[a-z0-9]{6,32}$/.test(value);
}

function cleanName(raw) {
  if (typeof raw !== "string") return { error: "Folder name must be text" };
  var name = raw.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return { error: "Folder name is required" };
  if (name.length > MAX_NAME_LENGTH) return { error: "Folder name must be " + MAX_NAME_LENGTH + " characters or fewer" };
  var lower = name.toLowerCase();
  if (lower === "favorites" || lower === "unfiled") return { error: "That name is reserved for a built-in folder" };
  return { name: name };
}

function nameTaken(state, name, exceptId) {
  var lower = name.toLowerCase();
  for (var i = 0; i < state.folders.length; i++) {
    if (state.folders[i].id !== exceptId && state.folders[i].name.toLowerCase() === lower) return true;
  }
  return false;
}

function knownContainer(state, id) {
  if (typeof id !== "string") return false;
  if (id === FAVORITES_ID) return true;
  for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === id) return true;
  return false;
}

function uniqueKeys(list) {
  var seen = Object.create(null);
  var out = [];
  if (!Array.isArray(list)) return out;
  for (var i = 0; i < list.length && out.length < MAX_KEYS; i++) {
    if (!validKey(list[i]) || seen[list[i]]) continue;
    seen[list[i]] = true;
    out.push(list[i]);
  }
  return out;
}

// Accepts anything stored on disk and returns a state that satisfies every
// invariant; unknown fields and dangling references are dropped.
function normalizeState(raw) {
  var source = isPlainObject(raw) ? raw : {};
  var state = defaultState();
  var seenIds = Object.create(null);
  var seenNames = Object.create(null);
  var folders = Array.isArray(source.folders) ? source.folders : [];
  for (var i = 0; i < folders.length && state.folders.length < MAX_FOLDERS; i++) {
    var f = folders[i];
    if (!isPlainObject(f) || !validFolderId(f.id) || seenIds[f.id]) continue;
    var cleaned = cleanName(f.name);
    if (cleaned.error || seenNames[cleaned.name.toLowerCase()]) continue;
    seenIds[f.id] = true;
    seenNames[cleaned.name.toLowerCase()] = true;
    state.folders.push({ id: f.id, name: cleaned.name });
  }
  var assignments = isPlainObject(source.assignments) ? source.assignments : {};
  var keys = Object.keys(assignments);
  for (var a = 0; a < keys.length && a < MAX_KEYS; a++) {
    if (validKey(keys[a]) && has(assignments, keys[a]) && knownContainer(state, assignments[keys[a]])) state.assignments[keys[a]] = assignments[keys[a]];
  }
  var orders = isPlainObject(source.orders) ? source.orders : {};
  var containers = Object.keys(orders);
  for (var o = 0; o < containers.length; o++) {
    var cid = containers[o];
    if (cid !== FAVORITES_ID && cid !== UNFILED_ID && cid !== ALL_ID && !knownContainer(state, cid)) continue;
    state.orders[cid] = uniqueKeys(orders[cid]);
  }
  reconcileOrders(state);
  var collapsed = isPlainObject(source.collapsed) ? source.collapsed : {};
  var collapsedKeys = Object.keys(collapsed);
  for (var c = 0; c < collapsedKeys.length; c++) {
    var ck = collapsedKeys[c];
    if (has(collapsed, ck) && collapsed[ck] === true && (ck === FAVORITES_ID || ck === UNFILED_ID || knownContainer(state, ck))) state.collapsed[ck] = true;
  }
  var view = isPlainObject(source.view) ? source.view : {};
  if (SORTS.indexOf(view.sort) !== -1) state.view.sort = view.sort;
  if (DIRECTIONS.indexOf(view.direction) !== -1) state.view.direction = view.direction;
  state.legacyFavoritesMigrated = source.legacyFavoritesMigrated === true;
  return state;
}

// A container's manual order may only list sessions that currently belong to
// it. Moves, folder deletion and legacy data can leave stale members behind;
// dropping them here keeps every order consistent with the assignments.
// "all" spans every ordinary session and is not membership-checked.
function reconcileOrders(state) {
  var containers = Object.keys(state.orders);
  for (var c = 0; c < containers.length; c++) {
    var cid = containers[c];
    if (cid === ALL_ID) continue;
    var members = state.orders[cid].filter(function (key) {
      var assigned = has(state.assignments, key) ? state.assignments[key] : UNFILED_ID;
      return assigned === cid;
    });
    if (members.length) state.orders[cid] = members;
    else delete state.orders[cid];
  }
  return state;
}

// One-time seed from the legacy session-level favorites. Existing explicit
// assignments always win; the legacy flags themselves are left untouched.
function seedLegacyFavorites(state, legacyKeys) {
  var next = normalizeState(state);
  if (next.legacyFavoritesMigrated) return next;
  var order = (next.orders[FAVORITES_ID] || []).slice();
  for (var i = 0; i < legacyKeys.length; i++) {
    var key = legacyKeys[i];
    if (!validKey(key) || has(next.assignments, key)) continue;
    next.assignments[key] = FAVORITES_ID;
    if (order.indexOf(key) === -1) order.push(key);
  }
  if (order.length) next.orders[FAVORITES_ID] = order;
  next.legacyFavoritesMigrated = true;
  return next;
}

function newFolderId() {
  return "f_" + crypto.randomBytes(6).toString("hex");
}

function pruneKeys(state, exists) {
  var keys = Object.keys(state.assignments);
  for (var i = 0; i < keys.length; i++) if (!exists(keys[i])) delete state.assignments[keys[i]];
  var containers = Object.keys(state.orders);
  for (var c = 0; c < containers.length; c++) {
    state.orders[containers[c]] = state.orders[containers[c]].filter(exists);
  }
}

function containerOf(state, key) {
  return has(state.assignments, key) ? state.assignments[key] : UNFILED_ID;
}

// env.canOrganize(key): the key names a session this user may see and that is
// a movable unit (a Driver root or standalone session, never a Worker).
// env.exists(key): the session still exists in the project (for pruning).
function applyOperation(input, op, env) {
  var result = applyRaw(input, op, env);
  if (result.state) {
    pruneKeys(result.state, env.exists);
    reconcileOrders(result.state);
  }
  return result;
}

function applyRaw(input, op, env) {
  var state = normalizeState(input);
  if (!isPlainObject(op) || typeof op.op !== "string") return { error: "Invalid folder request" };
  var kind = op.op;
  var i;

  if (kind === "create_folder") {
    if (state.folders.length >= MAX_FOLDERS) return { error: "You can have at most " + MAX_FOLDERS + " folders" };
    var created = cleanName(op.name);
    if (created.error) return created;
    if (nameTaken(state, created.name, null)) return { error: "A folder with that name already exists" };
    var folder = { id: newFolderId(), name: created.name };
    state.folders.push(folder);
    return { state: state, folderId: folder.id };
  }

  if (kind === "rename_folder") {
    if (!validFolderId(op.folderId) || !knownContainer(state, op.folderId)) return { error: "Folder not found" };
    var renamed = cleanName(op.name);
    if (renamed.error) return renamed;
    if (nameTaken(state, renamed.name, op.folderId)) return { error: "A folder with that name already exists" };
    for (i = 0; i < state.folders.length; i++) if (state.folders[i].id === op.folderId) state.folders[i].name = renamed.name;
    return { state: state };
  }

  if (kind === "delete_folder") {
    if (!validFolderId(op.folderId) || !knownContainer(state, op.folderId)) return { error: "Folder not found" };
    // Contents either go to Unfiled (the default, and what older clients get) or
    // to another folder. Deleting the sessions themselves is a separate,
    // server-authorized request and never reaches this pure model.
    var mode = op.mode === undefined ? "unfiled" : op.mode;
    if (mode !== "unfiled" && mode !== "move") return { error: "Unsupported folder deletion" };
    var members = Object.keys(state.assignments).filter(function (k) { return state.assignments[k] === op.folderId; });
    if (mode === "move") {
      var dest = op.destinationId;
      if (typeof dest !== "string" || dest === op.folderId || dest === UNFILED_ID || !knownContainer(state, dest)) return { error: "Choose another folder for these sessions" };
      var listed = (state.orders[op.folderId] || []).filter(function (k) { return members.indexOf(k) !== -1; });
      var moved = listed.concat(members.filter(function (k) { return listed.indexOf(k) === -1; }));
      for (i = 0; i < moved.length; i++) state.assignments[moved[i]] = dest;
      if (moved.length && (state.orders[dest] || dest === FAVORITES_ID)) {
        state.orders[dest] = (state.orders[dest] || []).concat(moved);
      }
    } else {
      for (i = 0; i < members.length; i++) delete state.assignments[members[i]];
    }
    state.folders = state.folders.filter(function (f) { return f.id !== op.folderId; });
    delete state.orders[op.folderId];
    delete state.collapsed[op.folderId];
    return { state: state };
  }

  if (kind === "reorder_folder") {
    if (!validFolderId(op.folderId) || !knownContainer(state, op.folderId)) return { error: "Folder not found" };
    if (!validFolderId(op.targetId) || !knownContainer(state, op.targetId)) return { error: "Target folder not found" };
    if (op.folderId === op.targetId) return { state: state };
    var moving = null;
    var rest = [];
    for (i = 0; i < state.folders.length; i++) {
      if (state.folders[i].id === op.folderId) moving = state.folders[i];
      else rest.push(state.folders[i]);
    }
    var at = -1;
    for (i = 0; i < rest.length; i++) if (rest[i].id === op.targetId) at = i;
    rest.splice(op.insertBefore === false ? at + 1 : at, 0, moving);
    state.folders = rest;
    return { state: state };
  }

  if (kind === "place_session") {
    if (!validKey(op.sessionKey) || !env.canOrganize(op.sessionKey)) return { error: "Session not found" };
    var folderId = op.folderId === null || op.folderId === undefined || op.folderId === UNFILED_ID ? UNFILED_ID : op.folderId;
    if (folderId !== UNFILED_ID && !knownContainer(state, folderId)) return { error: "Folder not found" };
    if (folderId === UNFILED_ID) delete state.assignments[op.sessionKey];
    else state.assignments[op.sessionKey] = folderId;
    pruneKeys(state, env.exists);
    if (op.order !== undefined) {
      var placed = setOrder(state, op.order, op.sessionKey, folderId, env);
      if (placed.error) return placed;
    }
    return { state: state };
  }

  if (kind === "set_order") {
    var target = op.containerKey;
    if (target !== FAVORITES_ID && target !== UNFILED_ID && target !== ALL_ID && !knownContainer(state, target)) return { error: "Folder not found" };
    var result = setOrder(state, op.order, null, target, env);
    if (result.error) return result;
    return { state: state };
  }

  if (kind === "set_collapsed") {
    var key = op.containerKey;
    if (key !== FAVORITES_ID && key !== UNFILED_ID && !knownContainer(state, key)) return { error: "Folder not found" };
    if (op.collapsed === true) state.collapsed[key] = true;
    else delete state.collapsed[key];
    return { state: state };
  }

  if (kind === "set_view") {
    if (op.group !== undefined) {
      if (LEGACY_GROUPS.indexOf(op.group) === -1) return { error: "Invalid grouping" };
      state.view.group = "folders";
    }
    if (op.sort !== undefined) {
      if (SORTS.indexOf(op.sort) === -1) return { error: "Invalid sort" };
      state.view.sort = op.sort;
    }
    if (op.direction !== undefined) {
      if (DIRECTIONS.indexOf(op.direction) === -1) return { error: "Invalid direction" };
      state.view.direction = op.direction;
    }
    return { state: state };
  }

  return { error: "Unknown folder request" };
}

// Replaces one container's manual order. Every key must name an organizable
// session; keys that belong to another folder are rejected so a crafted list
// cannot smuggle sessions across containers.
function setOrder(state, order, requiredKey, containerKey, env) {
  if (!Array.isArray(order) || order.length > MAX_KEYS) return { error: "Invalid order" };
  var keys = [];
  var seen = {};
  for (var i = 0; i < order.length; i++) {
    var key = order[i];
    if (!validKey(key) || seen[key]) return { error: "Invalid order" };
    if (!env.canOrganize(key)) return { error: "Session not found" };
    if (containerKey !== ALL_ID && containerOf(state, key) !== containerKey) return { error: "Order does not match the folder contents" };
    seen[key] = true;
    keys.push(key);
  }
  if (requiredKey && !seen[requiredKey]) return { error: "Order must include the moved session" };
  state.orders[containerKey] = keys;
  return { ok: true };
}

module.exports = {
  FAVORITES_ID: FAVORITES_ID,
  UNFILED_ID: UNFILED_ID,
  ALL_ID: ALL_ID,
  MAX_FOLDERS: MAX_FOLDERS,
  LEGACY_GROUPS: LEGACY_GROUPS,
  SORTS: SORTS,
  DIRECTIONS: DIRECTIONS,
  defaultState: defaultState,
  normalizeState: normalizeState,
  seedLegacyFavorites: seedLegacyFavorites,
  applyOperation: applyOperation,
};
