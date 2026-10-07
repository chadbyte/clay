// Pure projection of sidebar units into folder sections. No DOM, no store.
//
// A unit is one organizable root: a standalone session or a Driver with all of
// its Workers. { key, title, createdAt, lastActivity, item }. Units whose key
// is null (loop runs, split groups, orphan Workers) cannot be filed, so they
// always live with the ordinary, unfiled sessions.

export var FAVORITES_ID = "favorites";
export var UNFILED_ID = "unfiled";
export var ALL_ID = "all";

var DATE_ORDER = ["Today", "Yesterday", "This Week", "Older"];

export function defaultFolderState() {
  return { folders: [], assignments: {}, orders: {}, collapsed: {}, view: { group: "folders", sort: "activity", direction: "desc" } };
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

// Favorites are curated by hand, so they always keep their own order whatever
// the view sort is. Unlisted entries follow, most recent first.
function favoriteOrder(units, order) {
  return sortUnits(units, { sort: "manual", direction: "desc" }, order);
}

export function containerOf(state, unit) {
  if (unit.key === null) return UNFILED_ID;
  var id = state.assignments[unit.key];
  if (id === FAVORITES_ID) return FAVORITES_ID;
  for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === id) return id;
  return UNFILED_ID;
}

function dateTimestamp(unit, view) {
  return view.sort === "created" ? (unit.createdAt || 0) : (unit.lastActivity || 0);
}

// Returns { favorites: [units], mode, sections }. Sections: { id, type, label,
// units, collapsed, folderId }. While a search is active every section is
// expanded and empty ones disappear so matches are never hidden.
export function buildLayout(units, state, options) {
  var opts = options || {};
  var view = state.view;
  var searching = opts.searching === true;
  var favorites = [];
  var ordinary = [];
  for (var i = 0; i < units.length; i++) {
    if (containerOf(state, units[i]) === FAVORITES_ID) favorites.push(units[i]);
    else ordinary.push(units[i]);
  }
  var result = {
    favorites: favoriteOrder(favorites, state.orders[FAVORITES_ID]),
    favoritesCollapsed: !searching && state.collapsed[FAVORITES_ID] === true,
    mode: view.group,
    searching: searching,
    sections: [],
  };

  if (view.group === "folders") {
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
  } else if (view.group === "dates") {
    var groups = {};
    for (var d = 0; d < ordinary.length; d++) {
      var label = opts.dateGroup(dateTimestamp(ordinary[d], view));
      if (!groups[label]) groups[label] = [];
      groups[label].push(ordinary[d]);
    }
    var labels = DATE_ORDER.filter(function (l) { return groups[l]; });
    if (view.direction === "asc" && view.sort !== "title" && view.sort !== "manual") labels.reverse();
    for (var g = 0; g < labels.length; g++) {
      result.sections.push({ id: "date:" + labels[g], type: "date", label: labels[g], units: sortUnits(groups[labels[g]], view, state.orders[ALL_ID]), collapsed: false, folderId: null });
    }
  } else {
    result.sections.push({ id: ALL_ID, type: "flat", label: "", units: sortUnits(ordinary, view, state.orders[ALL_ID]), collapsed: false, folderId: null });
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
  else if (containerId === ALL_ID) {
    list = [];
    for (var a = 0; a < layout.sections.length; a++) list = list.concat(layout.sections[a].units);
  } else {
    list = [];
    for (var i = 0; i < layout.sections.length; i++) {
      if (layout.sections[i].id === containerId) list = layout.sections[i].units;
    }
  }
  return list.filter(function (u) { return u.key !== null; }).map(function (u) { return u.key; });
}

export var SORT_OPTIONS = [
  { sort: "activity", label: "Last activity", directions: { desc: "Most recent first", asc: "Least recent first" } },
  { sort: "created", label: "Date created", directions: { desc: "Newest first", asc: "Oldest first" } },
  { sort: "title", label: "Title", directions: { asc: "A to Z", desc: "Z to A" } },
  { sort: "manual", label: "Manual order", directions: null },
];

export var GROUP_OPTIONS = [
  { group: "folders", label: "Folders" },
  { group: "dates", label: "Dates" },
  { group: "none", label: "None" },
];

// Switching sort starts at that sort's natural direction.
export function defaultDirectionFor(sort) {
  return sort === "title" ? "asc" : "desc";
}
