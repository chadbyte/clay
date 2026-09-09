import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { VENDOR_AVATARS } from './app-rendering.js';
import { buildAgentVendorSelect, fillAgentModels, buildAgentEffortSelect, fillAgentEffort } from './agent-config-selects.js';
import { showToast } from './utils.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { appendWorkerRuntime } from './split-worker-runtime.js';

var pairDialog = null;
// Set when the dialog was opened via "Add Split Worker" on an existing session:
// that session becomes the Driver and the dialog only configures the Split Worker.
var pendingDriver = null;

function closePairDialog() {
  if (pairDialog) pairDialog.remove();
  pairDialog = null;
}

// Effort levels are vendor- and model-specific (codex: minimal..xhigh,
// claude/kiro: low..max, plus per-model supportedEffortLevels overrides), so
// options are rebuilt whenever the role's vendor or model changes.
function fieldLabel(text, control) {
  var label = document.createElement("label");
  label.className = "wt-modal-label";
  label.textContent = text;
  var wrap = document.createDocumentFragment();
  wrap.appendChild(label);
  wrap.appendChild(control);
  return { label: label, fragment: wrap };
}

// One role column: heading + Vendor/Model/Effort fields on the standard
// wt-modal form controls. Effort visibility follows the selected vendor's
// capability map (effort === false hides the field).
function roleColumn(role, description, vendorSelect, modelSelect, effortSelect, options) {
  var col = document.createElement("section");
  col.className = "pair-modal-role";
  var heading = document.createElement("div");
  heading.className = "pair-modal-role-heading";
  heading.innerHTML = '<span class="pair-role-dot pair-role-' + role.toLowerCase().replace(/ /g, "-") + '"></span><div><strong>' + role + '</strong><span>' + description + '</span></div>';
  col.appendChild(heading);
  var vendorField = fieldLabel("Vendor", vendorSelect);
  col.appendChild(vendorField.fragment);
  var modelField = fieldLabel("Model", modelSelect);
  col.appendChild(modelField.fragment);
  var effortField = fieldLabel("Reasoning effort", effortSelect);
  col.appendChild(effortField.fragment);
  function syncEffort() {
    var capabilities = (options.capabilitiesByVendor && options.capabilitiesByVendor[vendorSelect.value]) || {};
    var hidden = capabilities.effort === false;
    effortField.label.style.display = hidden ? "none" : "";
    effortSelect.style.display = hidden ? "none" : "";
  }
  vendorSelect.addEventListener("change", syncEffort);
  syncEffort();
  return col;
}

export function openPairDialog(driverInfo) {
  if (!getWs() || getWs().readyState !== 1) return;
  pendingDriver = driverInfo && Number.isInteger(driverInfo.sessionId) ? driverInfo : null;
  getWs().send(JSON.stringify({ type: "pair_session_options" }));
}

export function showPairDialog(options) {
  closePairDialog();
  var driverInfo = pendingDriver;
  pendingDriver = null;
  var installed = options.installedVendors || [];
  if (installed.length < 1) {
    showToast("Install a coding agent before creating a pair.", "error");
    return;
  }
  // Standard app modal pattern (wt-modal): overlay + centered modal with
  // title, wt-modal-label/-input fields, and a wt-modal-actions row.
  var container = document.createElement("div");
  var overlay = document.createElement("div");
  overlay.className = "wt-modal-overlay";
  container.appendChild(overlay);
  var modal = document.createElement("div");
  modal.className = "wt-modal pair-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  var title = document.createElement("div");
  title.className = "wt-modal-title";
  title.textContent = driverInfo ? "Add Split Worker" : "Pair session";
  modal.appendChild(title);
  var desc = document.createElement("div");
  desc.className = "pair-modal-desc";
  desc.textContent = driverInfo
    ? "This session becomes the Driver; a new Split Worker opens beside it."
    : "One Driver plans and directs a visible Split Worker session.";
  modal.appendChild(desc);

  var driverVendor = buildAgentVendorSelect(installed, installed.indexOf("claude") !== -1 ? "claude" : installed[0]);
  var workerDefault = options.lastVendor && options.lastVendor !== driverVendor.value ? options.lastVendor : (installed.indexOf("codex") !== -1 ? "codex" : installed[0]);
  var workerVendor = buildAgentVendorSelect(installed, workerDefault);
  var driverModel = document.createElement("select");
  driverModel.className = "wt-modal-input";
  var workerModel = document.createElement("select");
  workerModel.className = "wt-modal-input";
  var driverEffort = buildAgentEffortSelect();
  var workerEffort = buildAgentEffortSelect();
  function refreshDriverEffort() { fillAgentEffort(driverEffort, driverVendor.value, options, driverModel.value); }
  function refreshWorkerEffort() { fillAgentEffort(workerEffort, workerVendor.value, options, workerModel.value); }
  fillAgentModels(driverModel, driverVendor.value, options);
  fillAgentModels(workerModel, workerVendor.value, options);
  refreshDriverEffort();
  refreshWorkerEffort();
  workerEffort.value = "medium";
  if (workerEffort.value !== "medium") workerEffort.value = "";
  driverVendor.addEventListener("change", function () { fillAgentModels(driverModel, driverVendor.value, options); refreshDriverEffort(); });
  workerVendor.addEventListener("change", function () { fillAgentModels(workerModel, workerVendor.value, options); refreshWorkerEffort(); });
  driverModel.addEventListener("change", refreshDriverEffort);
  workerModel.addEventListener("change", refreshWorkerEffort);

  var roles = document.createElement("div");
  roles.className = "pair-modal-roles";
  if (driverInfo) {
    var driverCard = document.createElement("section");
    driverCard.className = "pair-modal-role";
    var driverHeading = document.createElement("div");
    driverHeading.className = "pair-modal-role-heading";
    driverHeading.innerHTML = '<span class="pair-role-dot pair-role-driver"></span><div><strong>Driver</strong><span>Plans, delegates, and integrates</span></div>';
    driverCard.appendChild(driverHeading);
    var driverCurrent = document.createElement("div");
    driverCurrent.className = "pair-modal-current";
    var driverAvatar = document.createElement("img");
    driverAvatar.className = "session-vendor-icon";
    driverAvatar.src = VENDOR_AVATARS[driverInfo.vendor] || VENDOR_AVATARS.claude;
    driverAvatar.alt = "";
    driverCurrent.appendChild(driverAvatar);
    var driverName = document.createElement("span");
    driverName.textContent = driverInfo.title || "Current session";
    driverCurrent.appendChild(driverName);
    driverCard.appendChild(driverCurrent);
    roles.appendChild(driverCard);
  } else {
    roles.appendChild(roleColumn("Driver", "Plans, delegates, and integrates", driverVendor, driverModel, driverEffort, options));
  }
  roles.appendChild(roleColumn("Split Worker", "Executes delegated tasks", workerVendor, workerModel, workerEffort, options));
  modal.appendChild(roles);

  var actions = document.createElement("div");
  actions.className = "wt-modal-actions";
  var cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "wt-modal-btn";
  cancelBtn.textContent = "Cancel";
  var createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "wt-modal-btn primary";
  createBtn.textContent = driverInfo ? "Add Split Worker" : "Create pair";
  actions.appendChild(cancelBtn);
  actions.appendChild(createBtn);
  modal.appendChild(actions);

  container.appendChild(modal);
  document.body.appendChild(container);
  pairDialog = container;

  cancelBtn.addEventListener("click", closePairDialog);
  overlay.addEventListener("click", closePairDialog);
  document.addEventListener("keydown", function onKey(event) {
    if (event.key === "Escape" && pairDialog === container) {
      document.removeEventListener("keydown", onKey);
      closePairDialog();
    }
  });
  createBtn.addEventListener("click", function () {
    getWs().send(JSON.stringify({
      type: "pair_session_create",
      driver: driverInfo
        ? { sessionId: driverInfo.sessionId }
        : { vendor: driverVendor.value, model: driverModel.value, effort: driverEffort.value },
      worker: { vendor: workerVendor.value, model: workerModel.value, effort: workerEffort.value },
    }));
    this.disabled = true;
    this.textContent = "Creating…";
  });
}

export function handlePairCreated(msg) {
  if (!msg.ok) {
    showToast(msg.error || "Could not create the pair.", "error");
    return null;
  }
  closePairDialog();
  return msg.group || null;
}

// --- Worker-pane composer notice -------------------------------------
// Shown inside a pane iframe while ITS session is processing a delegated
// turn. Identifies the Driver responsible for the current task.
var workerNoticeEl = null;

export function showWorkerDelegationNotice(driverTitle) {
  if (!store.get('paneMode')) return;
  var inputArea = document.getElementById("input-area");
  var inputWrapper = document.getElementById("input-wrapper");
  if (!inputArea || !inputWrapper) return;
  if (!workerNoticeEl) {
    workerNoticeEl = document.createElement("div");
    workerNoticeEl.className = "pane-delegation-notice";
    inputArea.insertBefore(workerNoticeEl, inputWrapper);
  }
  var who = driverTitle ? "“" + driverTitle + "”" : "the Driver";
  workerNoticeEl.textContent = "Working on a task from " + who + ".";
  workerNoticeEl.classList.add("visible");
}

export function hideWorkerDelegationNotice() {
  if (workerNoticeEl) workerNoticeEl.classList.remove("visible");
}

export function handleSplitDelegation(msg) {
  var states = Object.assign({}, store.get('splitDelegations') || {});
  if (msg.active) states[msg.groupId] = msg;
  else delete states[msg.groupId];
  store.set({ splitDelegations: states });
  // Inside the Split Worker's own pane, mirror the delegation into the composer
  // notice (the delegated user_message shows it too; this covers the end).
  if (store.get('paneMode') && msg.to === store.get('activeSessionId')) {
    if (msg.active) showWorkerDelegationNotice(null);
    else hideWorkerDelegationNotice();
  }
}

function sendSetPair(groupId, driverId) {
  if (getWs() && getWs().readyState === 1) {
    getWs().send(JSON.stringify({ type: "split_group_set_pair", id: groupId, driverId: driverId }));
  }
}

export function syncPairChrome(host, split) {
  if (!host || !split || !split.groupId) return;
  var groups = store.get('splitGroups') || [];
  var group = null;
  for (var i = 0; i < groups.length; i++) {
    if (groups[i].id === split.groupId) { group = groups[i]; break; }
  }
  var oldBadges = host.querySelectorAll(".split-pair-role, .split-pair-live, .split-pair-set-driver, .split-worker-runtime");
  for (var bi = 0; bi < oldBadges.length; bi++) oldBadges[bi].remove();
  var runtimeHeaders = host.querySelectorAll(".has-worker-runtime");
  for (var ri = 0; ri < runtimeHeaders.length; ri++) runtimeHeaders[ri].classList.remove("has-worker-runtime");
  host.classList.remove("split-delegating", "split-direction-right", "split-direction-left");
  if (!group) return;
  var headers = host.querySelectorAll(".split-pane-header");
  if (!group.pair) {
    // Ad-hoc split: offer a hover-revealed "Set Driver" action per pane.
    for (var ai = 0; ai < split.panes.length && ai < headers.length; ai++) {
      (function (paneSessionId, header) {
        var setBtn = document.createElement("button");
        setBtn.type = "button";
        setBtn.className = "split-pair-set-driver";
        setBtn.textContent = "Set Driver";
        setBtn.title = "Make this session the Driver; the other pane becomes its Split Worker";
        setBtn.addEventListener("click", function () { sendSetPair(group.id, paneSessionId); });
        var titleEl = header.querySelector(".split-pane-title");
        var accessEl = header.querySelector(".split-pane-full-access");
        header.insertBefore(setBtn, accessEl ? accessEl.nextSibling : (titleEl ? titleEl.nextSibling : null));
      })(split.panes[ai].sessionId, headers[ai]);
    }
    return;
  }
  for (var pi = 0; pi < split.panes.length && pi < headers.length; pi++) {
    (function (sessionId, header) {
      var isDriver = sessionId === group.pair.driverId;
      var role = isDriver ? "Driver" : "Split Worker";
      var badge = document.createElement("span");
      badge.className = "split-pair-role split-pair-role-" + role.toLowerCase().replace(/ /g, "-");
      badge.textContent = role;
      badge.title = isDriver ? "Driver controls this Split Worker" : "Split Worker controlled by the Driver";
      var title = header.querySelector(".split-pane-title");
      var access = header.querySelector(".split-pane-full-access");
      header.insertBefore(badge, access ? access.nextSibling : (title ? title.nextSibling : null));
      if (!isDriver) {
        var sessions = getCachedSessions() || [];
        var workerSession = null;
        for (var wi = 0; wi < sessions.length; wi++) {
          if (sessions[wi].id === sessionId) { workerSession = sessions[wi]; break; }
        }
        appendWorkerRuntime(header, workerSession);
      }
    })(split.panes[pi].sessionId, headers[pi]);
  }
  var active = (store.get('splitDelegations') || {})[group.id];
  if (!active || !active.active) return;
  host.classList.add("split-delegating");
  var fromIndex = split.panes[0].sessionId === active.from ? 0 : 1;
  host.classList.add(fromIndex === 0 ? "split-direction-right" : "split-direction-left");
  for (var si = 0; si < split.panes.length && si < headers.length; si++) {
    var live = document.createElement("span");
    live.className = "split-pair-live";
    live.textContent = split.panes[si].sessionId === active.to ? "Following direction" : "Waiting";
    headers[si].appendChild(live);
  }
}
