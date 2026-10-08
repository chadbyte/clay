// Pure projection of sidebar units into folder sections. No DOM, no store.
//
// A unit is one organizable root: a standalone session or a Driver with all of
// its Workers. { key, title, createdAt, lastActivity, item }. Units whose key
// is null (loop runs, split groups, orphan Workers) cannot be filed, so they
// always live with the ordinary, unfiled sessions.

export var FAVORITES_ID = "favorites";
export var UNFILED_ID = "unfiled";

export function defaultFolderState() {
  return { folders: [], assignments: {}, favorites: [], orders: {}, collapsed: {}, view: { sort: "activity", direction: "desc" } };
}

export function sortUnits(units, view, order) {
  var position = {};
  var list = order || [];
  for (var i = 0; i < list.length; i++) position[list[i]] = i;
  var sort = view.sort;
  var sign = view.direction === "asc" ? 1 : -1;
  return units.slice().sort(function (a, b) {
    var result = 0;
    if (sort === "manual") {
      var ap = a.key !== null && position[a.key] !== undefined ? position[a.key] : Number.MAX_SAFE_INTEGER;
      var bp = b.key !== null && position[b.key] !== undefined ? position[b.key] : Number.MAX_SAFE_INTEGER;
      result = ap - bp;
    } else if (sort === "title") {
      result = String(a.title || "").toLowerCase().localeCompare(String(b.title || "").toLowerCase()) * (view.direction === "desc" ? -1 : 1);
    } else if (sort === "created") {
      result = ((a.createdAt || 0) - (b.createdAt || 0)) * sign;
    } else {
      result = ((a.lastActivity || 0) - (b.lastActivity || 0)) * sign;
    }
    if (result !== 0) return result;
    return (b.lastActivity || 0) - (a.lastActivity || 0);
  });
}

// Favorites are a tag curated by hand, so they always keep their own order
// whatever the view sort is. A favorite also stays in its real folder.
function favoriteOrder(units, order) {
  return sortUnits(units, { sort: "manual", direction: "desc" }, order);
}

export function isFavorite(state, key) {
  return key !== null && key !== undefined && (state.favorites || []).indexOf(key) !== -1;
}

export function containerOf(state, unit) {
  if (unit.key === null) return UNFILED_ID;
  var id = state.assignments[unit.key];
  for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === id) return id;
  return UNFILED_ID;
}

// Returns { favorites: [units], sections }. Folders are the only layout; the
// view sort and direction order sessions inside each folder, never the folders
// themselves. Sections: { id, type, label,
// units, collapsed, folderId }. While a search is active every section is
// expanded and empty ones disappear so matches are never hidden.
export function buildLayout(units, state, options) {
  var opts = options || {};
  var view = state.view;
  var searching = opts.searching === true;
  var favorites = [];
  var ordinary = [];
  for (var i = 0; i < units.length; i++) {
    // The same unit may appear twice: once as a favorite, once in its folder.
    if (isFavorite(state, units[i].key)) favorites.push(units[i]);
    ordinary.push(units[i]);
  }
  var result = {
    favorites: favoriteOrder(favorites, state.favorites),
    favoritesCollapsed: !searching && state.collapsed[FAVORITES_ID] === true,
    searching: searching,
    sections: [],
  };

  var byContainer = {};
  for (var u = 0; u < ordinary.length; u++) {
    var id = containerOf(state, ordinary[u]);
    if (!byContainer[id]) byContainer[id] = [];
    byContainer[id].push(ordinary[u]);
  }
  for (var f = 0; f < state.folders.length; f++) {
    var folder = state.folders[f];
    var members = sortUnits(byContainer[folder.id] || [], view, state.orders[folder.id]);
    if (searching && members.length === 0) continue;
    result.sections.push({ id: folder.id, type: "folder", label: folder.name, units: members, collapsed: !searching && state.collapsed[folder.id] === true, folderId: folder.id });
  }
  var unfiled = sortUnits(byContainer[UNFILED_ID] || [], view, state.orders[UNFILED_ID]);
  if (!searching || unfiled.length) {
    result.sections.push({ id: UNFILED_ID, type: "unfiled", label: "Unfiled", units: unfiled, collapsed: !searching && state.collapsed[UNFILED_ID] === true, folderId: null });
  }
  return result;
}

// New order for one container after dropping `movingKey` next to `targetKey`
// (or at the end when targetKey is null). `currentKeys` is the container's
// displayed order, which already reflects the active sort.
export function orderAfterMove(currentKeys, movingKey, targetKey, insertBefore) {
  var rest = currentKeys.filter(function (k) { return k !== movingKey; });
  var at = targetKey === null ? -1 : rest.indexOf(targetKey);
  if (at === -1) rest.push(movingKey);
  else rest.splice(insertBefore === false ? at + 1 : at, 0, movingKey);
  return rest;
}

// The keys a container shows right now, in order. Used both to build the
// move payload and to decide whether a drop is allowed.
export function containerKeys(layout, containerId) {
  var list;
  if (containerId === FAVORITES_ID) list = layout.favorites;
  else {
    list = [];
    for (var i = 0; i < layout.sections.length; i++) {
      if (layout.sections[i].id === containerId) list = layout.sections[i].units;
    }
  }
  return list.filter(function (u) { return u.key !== null; }).map(function (u) { return u.key; });
}

export var SORT_OPTIONS = [
  { sort: "activity", label: "Last activity", directions: { desc: "Recent", asc: "Oldest" } },
  { sort: "created", label: "Date created", directions: { desc: "Newest", asc: "Oldest" } },
  { sort: "title", label: "Title", directions: { asc: "A to Z", desc: "Z to A" } },
  { sort: "manual", label: "Manual order", directions: null },
];

// Switching sort starts at that sort's natural direction.
export function defaultDirectionFor(sort) {
  return sort === "title" ? "asc" : "desc";
}
