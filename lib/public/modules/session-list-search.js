// Session list search: query, open state and results live in the store
// (sessionSearch) so the folder toolbar on every surface can drive and show them.
// Behavior is unchanged from the former header search: a debounced
// search_sessions request, stale responses ignored, matches filter the list while
// keeping Driver/Worker hierarchy.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { hierarchyItemMatches } from './sidebar-session-hierarchy.js';

var DEBOUNCE_MS = 200;

function current() {
  return store.get('sessionSearch') || { open: false, query: "", matchIds: null, timer: null, focus: false, selStart: null, selEnd: null };
}

function patch(change) {
  store.set({ sessionSearch: Object.assign({}, current(), change) });
}

export function getListSearchQuery() {
  return current().query;
}

// null means no search; otherwise a Set of matching session ids.
export function getListSearchMatchIds() {
  return current().matchIds;
}

export function listSearchActive() {
  var state = current();
  return state.open || !!state.query;
}

function cancelTimer() {
  var timer = current().timer;
  if (timer) clearTimeout(timer);
}

export function openListSearch() {
  patch({ open: true, focus: true, selStart: null, selEnd: null });
}

// Close always clears the query, so the list returns to its normal state.
export function closeListSearch() {
  cancelTimer();
  patch({ open: false, query: "", matchIds: null, timer: null, focus: false, selStart: null, selEnd: null });
}

// Clear empties the text but keeps the search open for another query.
export function clearListSearchText() {
  cancelTimer();
  patch({ query: "", matchIds: null, timer: null, focus: true, selStart: 0, selEnd: 0 });
}

export function setListSearchQuery(raw) {
  var query = raw || "";
  cancelTimer();
  if (!query.trim()) {
    patch({ query: query, matchIds: null, timer: null });
    return;
  }
  var timer = setTimeout(function () {
    var ws = getWs();
    var state = current();
    if (ws && store.get('connected') && state.query === query) ws.send(JSON.stringify({ type: "search_sessions", query: query }));
  }, DEBOUNCE_MS);
  patch({ query: query, timer: timer });
}

export function rememberListSearchCaret(focus, selStart, selEnd) {
  var state = current();
  if (state.focus === focus && state.selStart === selStart && state.selEnd === selEnd) return;
  patch({ focus: focus, selStart: selStart, selEnd: selEnd });
}

export function applyListSearchResults(msg) {
  if (msg.query !== current().query) return; // stale response
  var ids = new Set();
  for (var i = 0; i < msg.results.length; i++) ids.add(msg.results[i].id);
  patch({ matchIds: ids });
}

// What a list rerender needs to react to; typing and caret movement do not.
export function listSearchNeedsRender(state, previous) {
  var a = state.sessionSearch;
  var b = previous.sessionSearch;
  if (a === b) return false;
  var after = a || { open: false, query: "", matchIds: null };
  var before = b || { open: false, query: "", matchIds: null };
  if (after.open !== before.open || after.matchIds !== before.matchIds) return true;
  return after.query !== before.query && !after.query.trim();
}

// Shared by the desktop list and the mobile sheet: drops items with no match and
// keeps a Driver visible when it or any of its Workers match.
export function filterItemsBySearch(items, matchIds) {
  if (matchIds === null) return items;
  return items.filter(function (item) {
    if (item.type === "session") return !!(item.data && matchIds.has(item.data.id));
    if (item.type === "driver-hierarchy" || item.type === "orphan-workers") return hierarchyItemMatches(item, matchIds);
    if (item.type === "split-group") {
      for (var i = 0; i < item.members.length; i++) if (matchIds.has(item.members[i].id)) return true;
      return false;
    }
    return true;
  });
}
