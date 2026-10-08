import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showConfirm } from './app-misc.js';
import { describeGroupDelete } from './session-delete-scope.js';
import { showToast } from './utils.js';
import { renderSidebarCount } from './sidebar-session-counts.js';

function confirmClear(label, ids, sessions) {
  if (!ids.length) return;
  var requestedIds = ids.slice();
  var originSlug = store.get('currentSlug');
  var originWs = getWs();
  showConfirm(describeGroupDelete(label, requestedIds, sessions).message, function () {
    var ws = getWs();
    var permissions = store.get('permissions');
    var valid = store.get('currentSlug') === originSlug && ws === originWs && ws && ws.readyState === 1 &&
      store.get('connected') && (!permissions || permissions.sessionDelete !== false);
    if (!valid) {
      showToast("Clear cancelled because the project, connection, or delete permission changed.", "warn");
      return;
    }
    ws.send(JSON.stringify({ type: "bulk_delete_sessions", sessionIds: requestedIds }));
  });
}

export function renderDateGroupHeader(dateLabel, folderLabel, ids, sessions, surface, searching, displayCounts) {
  var header = document.createElement("div");
  header.className = "session-group-header session-date-group-header" + (surface === "mobile" ? " is-mobile" : "");
  header.setAttribute("role", "heading");
  header.setAttribute("aria-level", "3");

  var label = document.createElement("span");
  label.className = "session-group-header-label";
  label.textContent = dateLabel;
  header.appendChild(label);

  var count = renderSidebarCount("session-date-group-count", displayCounts || { roots: ids.length, workers: 0 }, true);
  header.appendChild(count);

  if ((!store.get('permissions') || store.get('permissions').sessionDelete !== false) && ids.length) {
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "session-group-clear-btn";
    clear.textContent = "Clear";
    clear.setAttribute("aria-label", "Clear " + ids.length + " " + (searching ? "matching " : "") + (ids.length === 1 ? "session" : "sessions") + " from " + dateLabel + " in " + folderLabel);
    clear.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var scope = dateLabel + " in " + folderLabel + (searching ? " (matching search)" : "");
      confirmClear(scope, ids, sessions);
    });
    header.appendChild(clear);
  }
  return header;
}
