import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';

var requestSequence = 0;
var initialized = false;

function selectElement() {
  return document.getElementById("ps-session-visibility-default");
}

function pendingState() {
  return (store.get('projectSessionVisibilityState') || {}).pending || null;
}

function activeState() {
  return (store.get('projectSessionVisibilityState') || {}).active || null;
}

function setVisibilityState(active, pending) {
  store.set({ projectSessionVisibilityState: { active: active || null, pending: pending || null } });
}

function setSelectState(select, value, disabled) {
  if (!select) return;
  select.value = value;
  select.disabled = !!disabled;
}

// Editable for any authorised selected project: the server re-authorises the
// exact slug (owner, permission, access, worktree) and echoes it back.
function isReadOnly(active) {
  return !active || !active.authorized || active.isWorktree;
}

function renderActiveState() {
  var active = activeState();
  var pending = pendingState();
  var select = selectElement();
  var inheritedHint = document.getElementById("ps-session-visibility-default-inherited-hint");
  if (inheritedHint) inheritedHint.classList.toggle("hidden", !(active && active.isWorktree));
  if (!select || !active) return;
  // One request at a time: a pending change for any project holds the control.
  setSelectState(select, active.effectiveValue, isReadOnly(active) || !!pending);
}

// The server requires the project owner plus the projectSettings permission.
// An administrator who is not the owner may see the value but not change it.
function visibilityAccess(project) {
  var users = store.get('cachedAllUsers') || [];
  var userId = store.get('myUserId');
  var currentUser = null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === userId) { currentUser = users[i]; break; }
  }
  var permitted = !store.get('permissions') || store.get('permissions').projectSettings !== false;
  var owner = !!(project && project.projectOwnerId && project.projectOwnerId === userId);
  var admin = !!(currentUser && currentUser.role === "admin");
  var multi = !!(store.get('isMultiUserMode') && project && permitted);
  return { visible: multi && (owner || admin), editable: multi && owner };
}

export function initProjectSessionVisibilitySettings() {
  var select = selectElement();
  if (!select || initialized) return;
  initialized = true;
  select.addEventListener("change", function () {
    var ws = getWs();
    var active = activeState();
    var slug = active && active.slug || "";
    var prior = active && active.effectiveValue || "private";
    if (!slug || !ws || ws.readyState !== 1 || pendingState() || isReadOnly(active)) {
      setSelectState(select, prior, isReadOnly(active) || !!pendingState());
      return;
    }
    requestSequence += 1;
    var requestId = "project-session-visibility-" + Date.now() + "-" + requestSequence;
    setVisibilityState(active, { requestId: requestId, slug: slug, requested: select.value, previous: prior });
    setSelectState(select, select.value, true);
    ws.send(JSON.stringify({ type: "set_project_session_visibility_default", slug: slug, visibility: select.value, requestId: requestId }));
  });

  store.subscribe(function (state, previous) {
    if (state.connected || previous.connected !== true) return;
    var pending = pendingState();
    if (!pending) return;
    var current = selectElement();
    var active = activeState();
    if (current && active && active.slug === pending.slug) setSelectState(current, pending.previous, isReadOnly(active));
    setVisibilityState(active, null);
    renderActiveState();
  });
}

export function populateProjectSessionVisibilitySettings(slug, project) {
  var field = document.getElementById("ps-session-visibility-default-field");
  var select = selectElement();
  var access = visibilityAccess(project);
  if (field) field.style.display = access.visible ? "" : "none";
  var ownerHint = document.getElementById("ps-session-visibility-default-owner-hint");
  if (ownerHint) ownerHint.classList.toggle("hidden", !(access.visible && !access.editable));
  if (!select) return;
  var value = project && project.sessionVisibilityDefault === "shared" ? "shared" : "private";
  var active = { slug: slug || "", effectiveValue: value, isWorktree: !!(project && project.isWorktree), authorized: access.editable };
  var pending = pendingState();
  setVisibilityState(active, pending);
  renderActiveState();
}

export function refreshProjectSessionVisibilitySettings(projects) {
  var select = selectElement();
  if (!select) return;
  var active = activeState();
  var slug = active && active.slug || "";
  var source = Array.isArray(projects) ? projects : [];
  for (var i = 0; i < source.length; i++) {
    if (source[i] && source[i].slug === slug) {
      populateProjectSessionVisibilitySettings(slug, source[i]);
      return;
    }
  }
}

export function handleProjectSessionVisibilityDefault(msg) {
  var pending = pendingState();
  if (!pending || msg.requestId !== pending.requestId || msg.slug !== pending.slug) return;
  var active = activeState();
  setVisibilityState(active, null);
  var select = selectElement();
  if (!select || !active || active.slug !== msg.slug) { renderActiveState(); return; }
  if (!msg.ok) {
    active = Object.assign({}, active, { effectiveValue: pending.previous });
    setVisibilityState(active, null);
    setSelectState(select, pending.previous, isReadOnly(active));
    showToast(msg.error || "Failed to update new session visibility", "error");
    return;
  }
  active = Object.assign({}, active, { effectiveValue: msg.visibility === "shared" ? "shared" : "private" });
  setVisibilityState(active, null);
  setSelectState(select, active.effectiveValue, isReadOnly(active));
}
