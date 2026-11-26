// Session list search: query, open state and results live in the store
// (sessionSearch) so the folder toolbar on every surface can drive and show them.
// Debounced searches are correlated to the exact query and scope selection.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { hierarchyItemMatches } from './sidebar-session-hierarchy.js';

var DEBOUNCE_MS = 200;
var DEFAULT_SCOPES = ["title", "chat"];
var nextRequestId = 0;

function current() {
  return store.get('sessionSearch') || { open: false, query: "", matchIds: null, timer: null, focus: false, selStart: null, selEnd: null };
}

function patch(change) {
  store.set({ sessionSearch: Object.assign({}, current(), change) });
}

export function getListSearchQuery() {
  return current().query;
}

export function getListSearchScopes() {
  return current().scopes || DEFAULT_SCOPES;
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
  patch({ open: true, scopes: getListSearchScopes(), focus: true, focusedScope: null, selStart: null, selEnd: null });
}

// Close always clears the query, so the list returns to its normal state.
export function closeListSearch() {
  cancelTimer();
  patch({ open: false, query: "", scopes: DEFAULT_SCOPES, matchIds: null, timer: null, requestId: null, focus: false, focusedScope: null, selStart: null, selEnd: null });
}

// Clear empties the text but keeps the search open for another query.
export function clearListSearchText() {
  cancelTimer();
  patch({ query: "", matchIds: null, timer: null, requestId: null, focus: true, focusedScope: null, selStart: 0, selEnd: 0 });
}

export function toggleListSearchScope(scope) {
  var scopes = getListSearchScopes();
  var next = scopes.includes(scope) ? scopes.filter(function (item) { return item !== scope; }) : scopes.concat(scope);
  setListSearchQuery(current().query, next);
}

export function setListSearchQuery(raw, scopes) {
  var query = raw || "";
  scopes = scopes || getListSearchScopes();
  cancelTimer();
  if (!query.trim()) {
    patch({ query: query, scopes: scopes, matchIds: null, timer: null, requestId: null });
    return;
  }
  var requestId = String(++nextRequestId);
  var timer = setTimeout(function () {
    var ws = getWs();
    if (ws && store.get('connected') && current().requestId === requestId) {
      ws.send(JSON.stringify({ type: "search_sessions", query: query, source: "sidebar", scopes: scopes, requestId: requestId }));
    }
  }, DEBOUNCE_MS);
  patch({ query: query, scopes: scopes, timer: timer, requestId: requestId });
}

export function rememberListSearchCaret(focus, selStart, selEnd, focusedScope) {
  var state = current();
  focusedScope = focusedScope || null;
  if (state.focus === focus && state.selStart === selStart && state.selEnd === selEnd && state.focusedScope === focusedScope) return;
  patch({ focus: focus, selStart: selStart, selEnd: selEnd, focusedScope: focusedScope });
}

export function applyListSearchResults(msg) {
  var state = current();
  if (!state.requestId || msg.requestId !== state.requestId || msg.query !== state.query) return;
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
  if (after.open !== before.open || after.matchIds !== before.matchIds || after.scopes !== before.scopes) return true;
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
