// Shared Driver/Worker hierarchy behavior for the project desktop and mobile lists.

import { iconHtml } from './icons.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { buildSessionHierarchy } from './session-hierarchy.js';
import { splitGroupRoles } from './split-group-helpers.js';

var expansionBySurface = {
  desktop: new Map(),
  mobile: new Map(),
};

var workerHistoryMenu = null;
var workerHistoryOpener = null;
var workerHistoryKeyHandler = null;
var workerHistoryOutsideHandler = null;

export function closeWorkerHistoryMenu(restoreFocus) {
  if (workerHistoryMenu) {
    workerHistoryMenu.remove();
    workerHistoryMenu = null;
  }
  if (typeof document !== "undefined" && workerHistoryKeyHandler) document.removeEventListener("keydown", workerHistoryKeyHandler, true);
  if (typeof document !== "undefined" && workerHistoryOutsideHandler) document.removeEventListener("click", workerHistoryOutsideHandler, true);
  workerHistoryKeyHandler = null;
  workerHistoryOutsideHandler = null;
  var opener = workerHistoryOpener;
  workerHistoryOpener = null;
  if (restoreFocus !== false && opener && typeof document !== "undefined" && document.contains(opener)) opener.focus();
}

function workerIsCurrent(worker) {
  var groups = store.get('splitGroups') || [];
  for (var i = 0; i < groups.length; i++) {
    var roles = splitGroupRoles(groups[i]);
    if (roles && roles.workerIds.indexOf(worker.id) !== -1) return true;
  }
  return false;
}

function workerLabel(worker) {
  var generation = worker && worker.workerGeneration ? "Generation " + worker.workerGeneration : "Worker";
  return generation + (workerIsCurrent(worker) ? " · Current" : " · History");
}

function openWorkerHistoryMenu(button, driver, workers, options) {
  var opts = options || {};
  if (opts.validate && !opts.validate(driver, workers)) return;
  closeWorkerHistoryMenu();
  var menu = document.createElement("div");
  menu.className = "session-worker-history-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Worker history for " + (driver.title || "this session"));
  var heading = document.createElement("div");
  heading.className = "session-worker-history-heading";
  heading.textContent = "Worker history";
  menu.appendChild(heading);
  for (var i = 0; i < workers.length; i++) {
    var worker = workers[i];
    var item = document.createElement("button");
    item.type = "button";
    item.className = "session-worker-history-item" + (workerIsCurrent(worker) ? " current" : "");
    item.setAttribute("role", "menuitem");
    item.setAttribute("aria-label", workerLabel(worker));
    var label = document.createElement("span");
    label.className = "session-worker-history-label";
    label.textContent = workerLabel(worker);
    var title = document.createElement("span");
    title.className = "session-worker-history-title";
    title.textContent = worker.title || "Untitled Worker";
    item.appendChild(label);
    item.appendChild(title);
    item.addEventListener("click", (function (id, historyWorker) {
      return function (event) {
        event.preventDefault();
        event.stopPropagation();
        var ws = getWs();
        var valid = ws && ws.readyState === 1 && store.get('connected') && (!opts.validate || opts.validate(driver, workers));
        var navigated = false;
        if (valid && opts.navigate) navigated = opts.navigate(historyWorker) !== false;
        else if (valid) {
          ws.send(JSON.stringify({ type: "switch_session", id: id }));
          navigated = true;
        }
        if (navigated) closeWorkerHistoryMenu(false);
        else closeWorkerHistoryMenu();
      };
    })(worker.id, worker));
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  var rect = button.getBoundingClientRect();
  var menuRect = menu.getBoundingClientRect();
  var left = Math.max(8, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
  var top = rect.bottom + 4;
  if (top + menuRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - menuRect.height - 4);
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  workerHistoryMenu = menu;
  workerHistoryOpener = button;
  workerHistoryKeyHandler = function (event) {
    var items = menu.querySelectorAll(".session-worker-history-item");
    var currentIndex = -1;
    for (var ii = 0; ii < items.length; ii++) if (items[ii] === document.activeElement) currentIndex = ii;
    if (event.key === "Escape") {
      event.preventDefault();
      closeWorkerHistoryMenu();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!items.length) return;
      var nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : currentIndex + (event.key === "ArrowDown" ? 1 : -1);
      if (nextIndex < 0) nextIndex = items.length - 1;
      if (nextIndex >= items.length) nextIndex = 0;
      items[nextIndex].focus();
    }
  };
  workerHistoryOutsideHandler = function (event) {
    if (!menu.contains(event.target) && event.target !== button) closeWorkerHistoryMenu();
  };
  document.addEventListener("keydown", workerHistoryKeyHandler, true);
  document.addEventListener("click", workerHistoryOutsideHandler, true);
  var firstItem = menu.querySelector(".session-worker-history-item");
  if (firstItem) firstItem.focus();
}

export function createWorkerHistoryControl(driver, workers, options) {
  if (!workers || !workers.length) return null;
  var opts = options || {};
  var button = document.createElement("button");
  button.type = "button";
  button.className = "session-worker-history-btn" + (opts.className ? " " + opts.className : "");
  button.setAttribute("aria-label", opts.label || "Show Worker history");
  button.setAttribute("aria-haspopup", "menu");
  button.innerHTML = iconHtml("history");
  button.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (workerHistoryMenu) closeWorkerHistoryMenu();
    else openWorkerHistoryMenu(button, driver, workers, opts);
  });
  return button;
}

store.subscribe(function (state, previous) {
  if (state.activeSessionId !== previous.activeSessionId || state.currentSlug !== previous.currentSlug || state.activeProjectMateId !== previous.activeProjectMateId || state.splitPanes !== previous.splitPanes) closeWorkerHistoryMenu(false);
});

export function prepareSidebarHierarchy(sessions) {
  var hierarchy = buildSessionHierarchy(sessions);
  var byDriver = new Map();
  var sessionIds = new Set();
  for (var i = 0; i < hierarchy.roots.length; i++) {
    var root = hierarchy.roots[i];
    if (!root.workers.length) continue;
    byDriver.set(root.driver.id, root);
    sessionIds.add(root.driver.id);
    for (var j = 0; j < root.workers.length; j++) sessionIds.add(root.workers[j].id);
  }
  for (var k = 0; k < hierarchy.orphans.length; k++) sessionIds.add(hierarchy.orphans[k].id);
  return {
    byDriver: byDriver,
    orphans: hierarchy.orphans,
    sessionIds: sessionIds,
  };
}

export function currentWorkerIds() {
  var result = new Set();
  var groups = store.get('splitGroups') || [];
  for (var i = 0; i < groups.length; i++) {
    var roles = splitGroupRoles(groups[i]);
    if (roles) for (var j = 0; j < roles.workerIds.length; j++) result.add(roles.workerIds[j]);
  }
  return result;
}

export function hierarchyItemMatches(item, matchIds) {
  if (matchIds === null) return true;
  if (item.type === "driver-hierarchy") {
    if (matchIds.has(item.root.driver.id)) return true;
    for (var i = 0; i < item.root.workers.length; i++) {
      if (matchIds.has(item.root.workers[i].id)) return true;
    }
    return false;
  }
  if (item.type === "orphan-workers") {
    for (var j = 0; j < item.workers.length; j++) {
      if (matchIds.has(item.workers[j].id)) return true;
    }
    return false;
  }
  return true;
}

function expanded(surface, key, workers, matchIds) {
  var state = expansionBySurface[surface];
  if (state.has(key)) return state.get(key);
  return defaultHierarchyExpanded(workers, matchIds, currentWorkerIds());
}

export function defaultHierarchyExpanded(workers, matchIds, current) {
  var currentIds = current || new Set();
  for (var i = 0; i < workers.length; i++) {
    if (workers[i].active || currentIds.has(workers[i].id) || (matchIds !== null && matchIds.has(workers[i].id))) return true;
  }
  return false;
}

function toggle(surface, key, wasExpanded, rerender) {
  expansionBySurface[surface].set(key, !wasExpanded);
  rerender();
}

function visibleWorker(worker, driver, matchIds) {
  return matchIds === null || matchIds.has(worker.id) || matchIds.has(driver.id);
}

export function renderDesktopDriverHierarchy(root, renderSession, rerender, matchIds) {
  var wrapper = document.createElement("div");
  wrapper.className = "session-driver-hierarchy";
  var header = document.createElement("div");
  header.className = "session-driver-header";
  var selectedSessionId = store.get('activeSessionId');
  var anyActive = !!root.driver.active || root.workers.some(function (worker) { return worker.id === selectedSessionId; });
  var anyProcessing = root.workers.some(function (worker) { return worker.isProcessing; });
  var workerUnread = root.workers.reduce(function (total, worker) { return total + (worker.unread || 0); }, 0);
  var row = renderSession(root.driver, { promotedActive: anyActive, promotedProcessing: anyProcessing, promotedUnread: workerUnread });
  row.classList.add("session-driver-item");
  header.appendChild(row);
  wrapper.appendChild(header);
  return wrapper;
}

export function renderDesktopOrphanHierarchy(workers, renderSession, rerender, matchIds) {
  var wrapper = document.createElement("div");
  wrapper.className = "session-driver-hierarchy session-orphan-hierarchy";
  var isExpanded = expanded("desktop", "orphan", workers, matchIds);
  var control = document.createElement("button");
  control.type = "button";
  control.className = "session-orphan-toggle";
  control.setAttribute("aria-expanded", String(isExpanded));
  control.setAttribute("aria-controls", "session-orphan-workers");
  control.innerHTML = iconHtml("chevron-right") + '<span class="session-orphan-title">Unavailable Driver</span><span class="session-worker-count">' + workers.length + "</span>";
  control.addEventListener("click", function () { toggle("desktop", "orphan", isExpanded, rerender); });
  wrapper.appendChild(control);

  var children = document.createElement("div");
  children.id = "session-orphan-workers";
  children.className = "session-worker-children";
  children.setAttribute("role", "group");
  children.setAttribute("aria-label", "Workers whose Driver is unavailable");
  children.hidden = !isExpanded;
  var current = currentWorkerIds();
  for (var i = 0; i < workers.length; i++) {
    if (matchIds !== null && !matchIds.has(workers[i].id)) continue;
    children.appendChild(renderSession(workers[i], { worker: true, current: current.has(workers[i].id) }));
  }
  wrapper.appendChild(children);
  return wrapper;
}

export function renderMobileDriverHierarchy(root, renderSession, rerender) {
  var wrapper = document.createElement("div");
  wrapper.className = "mobile-driver-hierarchy";
  var header = document.createElement("div");
  header.className = "mobile-driver-header";
  var selectedSessionId = store.get('activeSessionId');
  var anyActive = !!root.driver.active || root.workers.some(function (worker) { return worker.id === selectedSessionId; });
  var anyProcessing = root.workers.some(function (worker) { return worker.isProcessing; });
  var workerUnread = root.workers.reduce(function (total, worker) { return total + (worker.unread || 0); }, 0);
  header.appendChild(renderSession(root.driver, { promotedActive: anyActive, promotedProcessing: anyProcessing, promotedUnread: workerUnread }));
  wrapper.appendChild(header);
  return wrapper;
}

export function renderMobileOrphanHierarchy(workers, renderSession, rerender) {
  var wrapper = document.createElement("div");
  wrapper.className = "mobile-driver-hierarchy mobile-orphan-hierarchy";
  var isExpanded = expanded("mobile", "orphan", workers, null);
  var control = document.createElement("button");
  control.type = "button";
  control.className = "mobile-orphan-toggle";
  control.setAttribute("aria-expanded", String(isExpanded));
  control.setAttribute("aria-controls", "mobile-orphan-workers");
  control.innerHTML = iconHtml("chevron-right") + "<span>Unavailable Driver</span><span>" + workers.length + "</span>";
  control.addEventListener("click", function () { toggle("mobile", "orphan", isExpanded, rerender); });
  wrapper.appendChild(control);

  var children = document.createElement("div");
  children.id = "mobile-orphan-workers";
  children.className = "mobile-worker-children";
  children.setAttribute("role", "group");
  children.setAttribute("aria-label", "Workers whose Driver is unavailable");
  children.hidden = !isExpanded;
  var current = currentWorkerIds();
  for (var i = 0; i < workers.length; i++) {
    children.appendChild(renderSession(workers[i], { worker: true, current: current.has(workers[i].id) }));
  }
  wrapper.appendChild(children);
  return wrapper;
}
