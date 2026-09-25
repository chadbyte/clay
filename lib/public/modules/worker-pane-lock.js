// Driver-operated Split Worker surface.
//
// A configured Split Worker executes work its Driver delegated, so its pane is
// an execution surface rather than a chat the person types into. This module
// takes the composer's footprint away and replaces it with one compact,
// non-interactive status line.
//
// What stays, deliberately: the transcript, streaming status, tool and
// permission progress, scrolling, and the stop control — the human keeps their
// emergency brake. What goes: the text input, attachments, send, the composer
// context row, and any Worker-local permission-mode affordance.
//
// The role is read from pair state only (`splitGroups` + the displayed
// session), which is server-broadcast and therefore correct across reconnect,
// project switch, session switch, dissolve, replacement and role change. There
// is no second copy of the role and nothing in localStorage. A plain ad-hoc
// side-by-side split has no pair roles, so it is never locked and keeps its
// composer.
//
// Accessibility: locked controls are removed from the tab order with `disabled`
// and `tabindex="-1"`, and the composer region is `aria-hidden` while the
// status line carries the explanation, so a screen reader is told the pane is
// Driver-controlled instead of finding focusable inputs that do nothing.

import { store } from './store.js';

var STATUS_ID = "worker-pane-status";
var LOCK_CLASS = "worker-pane-locked";

function configuredWorkerIds(group) {
  if (!group || !group.pair || !Array.isArray(group.members)) return [];
  var pair = group.pair;
  var ids = Array.isArray(pair.workerIds) ? pair.workerIds :
    (pair.workerId !== undefined ? [pair.workerId] : []);
  if (pair.driverId === undefined || ids.length < 1 || ids.length > 2 || group.members.indexOf(pair.driverId) === -1) return [];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] === pair.driverId || group.members.indexOf(ids[i]) === -1) return [];
  }
  return ids;
}

// Every interactive composer affordance. Queried lazily: a pane iframe and the
// main window share this markup, and some ids are mobile-only.
var LOCKED_CONTROL_IDS = [
  "input",
  "send-btn",
  "attach-file-btn",
  "attach-image-btn",
  "input-more-btn",
  "shell-command-btn",
  "stt-btn",
  "stt-btn-language",
  "schedule-btn",
  "ask-mate-btn",
  "context-sources-add",
  "composer-add-worker-btn",
  "composer-handoff-btn",
];

function lockedControls() {
  var found = [];
  for (var i = 0; i < LOCKED_CONTROL_IDS.length; i++) {
    var el = document.getElementById(LOCKED_CONTROL_IDS[i]);
    if (el) found.push(el);
  }
  return found;
}

// The configured Worker of a live pair, for the session actually on screen.
// Returns false for an ad-hoc split, for the Driver, and for any ordinary
// session, so the composer is only ever taken away in the one real case.
export function isDriverOperatedView(state) {
  var snapshot = state || store.snap();
  var sessionId = snapshot.paneMode && snapshot.paneSessionId
    ? snapshot.paneSessionId
    : snapshot.activeSessionId;
  if (!sessionId) return false;
  var groups = snapshot.splitGroups || [];
  for (var i = 0; i < groups.length; i++) {
    if (configuredWorkerIds(groups[i]).indexOf(sessionId) !== -1) return true;
  }
  return false;
}

function ensureStatusLine(inputArea) {
  var existing = document.getElementById(STATUS_ID);
  if (existing) return existing;
  var line = document.createElement("div");
  line.id = STATUS_ID;
  line.className = "worker-pane-status";
  // A status region, not a live region: it states a standing condition rather
  // than announcing a change, so it should not interrupt.
  line.setAttribute("role", "status");
  var mark = document.createElement("span");
  mark.className = "worker-pane-status-mark";
  mark.setAttribute("aria-hidden", "true");
  var label = document.createElement("span");
  label.className = "worker-pane-status-label";
  label.textContent = "Controlled by Driver";
  line.appendChild(mark);
  line.appendChild(label);
  inputArea.appendChild(line);
  return line;
}

function applyLock(locked) {
  var inputArea = document.getElementById("input-area");
  var inputWrapper = document.getElementById("input-wrapper");
  if (!inputArea) return;

  document.body.classList.toggle(LOCK_CLASS, locked);

  if (inputWrapper) {
    // Hidden from assistive tech as well as sight; the status line speaks for
    // the region instead.
    if (locked) inputWrapper.setAttribute("aria-hidden", "true");
    else inputWrapper.removeAttribute("aria-hidden");
  }

  var controls = lockedControls();
  for (var i = 0; i < controls.length; i++) {
    var el = controls[i];
    if (locked) {
      if (el.dataset.workerLockPrev === undefined) {
        el.dataset.workerLockPrev = el.disabled ? "1" : "0";
      }
      el.disabled = true;
      el.setAttribute("tabindex", "-1");
    } else if (el.dataset.workerLockPrev !== undefined) {
      // Restore exactly what was there before the lock, so an independently
      // disabled send button stays disabled when the pair dissolves.
      el.disabled = el.dataset.workerLockPrev === "1";
      el.removeAttribute("tabindex");
      delete el.dataset.workerLockPrev;
    }
  }

  var status = document.getElementById(STATUS_ID);
  if (locked) {
    status = ensureStatusLine(inputArea);
    status.classList.add("visible");
  } else if (status) {
    status.classList.remove("visible");
  }
}

// Skip permissions and any other Worker-local permission-mode affordance are
// the Driver's to set, so they are removed from this pane only. The Driver pane
// and ordinary sessions are untouched.
function applyPermissionChrome(locked) {
  var ids = ["skip-perms-pill", "config-chip-wrap"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (!el) continue;
    if (locked) {
      if (el.dataset.workerLockHidden === undefined) {
        el.dataset.workerLockHidden = el.classList.contains("hidden") ? "1" : "0";
      }
      el.classList.add("hidden");
      el.setAttribute("aria-hidden", "true");
    } else if (el.dataset.workerLockHidden !== undefined) {
      if (el.dataset.workerLockHidden === "0") el.classList.remove("hidden");
      el.removeAttribute("aria-hidden");
      delete el.dataset.workerLockHidden;
    }
  }
}

export function syncWorkerPaneLock(state) {
  var locked = isDriverOperatedView(state);
  applyLock(locked);
  applyPermissionChrome(locked);
  return locked;
}

export function initWorkerPaneLock() {
  syncWorkerPaneLock();
  // Pair state is the source of truth, so every input that could change the
  // role re-runs the same resolution: a dissolve, a replacement, a role swap,
  // switching to another session, or a reconnect that reloads the groups.
  store.subscribe(function (state, prev) {
    if (state.splitGroups === prev.splitGroups
      && state.activeSessionId === prev.activeSessionId
      && state.paneSessionId === prev.paneSessionId) return;
    syncWorkerPaneLock(state);
  });
}
