import { getWs } from './ws-ref.js';
import { addToMessages, scrollToBottom, VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { effortLevelsFor, effortDisplayName } from './app-panels.js';
import { iconHtml, refreshIcons } from './icons.js';
import { workerProposalSelection, syncWorkerProposalSelection } from './worker-proposal-state.js';

function optionValue(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.value || entry.id) || "";
}

function optionLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.displayName || entry.name || entry.value || entry.id) || "";
}

function findCard(proposalId) {
  var cards = document.querySelectorAll(".worker-proposal-card");
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].dataset.proposalId === proposalId) return cards[i];
  }
  return null;
}

function planSteps(plan) {
  return String(plan || "").split("\n").map(function (line) {
    return line.trim().replace(/^\s*(?:\d+[.)]|[-*])\s*/, "");
  }).filter(Boolean).slice(0, 8);
}

function buildVendorSelect(msg, preferred) {
  var select = document.createElement("select");
  select.className = "worker-proposal-select worker-proposal-vendor";
  var installed = (msg.options && msg.options.installedVendors) || [];
  for (var i = 0; i < installed.length; i++) {
    var option = document.createElement("option");
    option.value = installed[i];
    option.textContent = VENDOR_NAMES[installed[i]] || installed[i];
    select.appendChild(option);
  }
  if (installed.indexOf(preferred) !== -1) select.value = preferred;
  return select;
}

function fillModels(select, vendor, msg, preferred) {
  var models = (msg.options && msg.options.modelsByVendor && msg.options.modelsByVendor[vendor]) || [];
  select.innerHTML = "";
  var automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "Automatic";
  select.appendChild(automatic);
  for (var i = 0; i < models.length; i++) {
    var option = document.createElement("option");
    option.value = optionValue(models[i]);
    option.textContent = optionLabel(models[i]);
    select.appendChild(option);
  }
  select.value = preferred || "";
  if (select.value !== (preferred || "")) select.value = "";
}

function fillEffort(card, vendor, model, msg, preferred) {
  var wrap = card.querySelector(".worker-proposal-effort");
  var buttons = card.querySelector(".worker-proposal-effort-buttons");
  var capabilities = (msg.options && msg.options.capabilitiesByVendor && msg.options.capabilitiesByVendor[vendor]) || {};
  if (capabilities.effort === false) {
    wrap.classList.add("hidden");
    buttons.innerHTML = "";
    return;
  }
  wrap.classList.remove("hidden");
  var models = (msg.options && msg.options.modelsByVendor && msg.options.modelsByVendor[vendor]) || [];
  var levels = effortLevelsFor(vendor, models, model);
  buttons.innerHTML = "";
  var selected = levels.indexOf(preferred) !== -1 ? preferred : (levels.indexOf("medium") !== -1 ? "medium" : levels[0]);
  for (var i = 0; i < levels.length; i++) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "worker-proposal-effort-btn" + (levels[i] === selected ? " active" : "");
    button.dataset.effort = levels[i];
    button.textContent = effortDisplayName(levels[i]);
    button.addEventListener("click", function () {
      buttons.querySelectorAll("button").forEach(function (item) { item.classList.remove("active"); });
      this.classList.add("active");
    });
    buttons.appendChild(button);
  }
}

function setControlsDisabled(card, disabled) {
  var controls = card.querySelectorAll("select, .worker-proposal-effort-btn, .worker-proposal-action");
  for (var i = 0; i < controls.length; i++) controls[i].disabled = disabled;
}

function statusLabel(status) {
  if (status === "starting") return "Starting Worker";
  if (status === "running") return "Worker running";
  if (status === "completed") return "Completed";
  if (status === "interrupted") return "Interrupted";
  if (status === "declined") return "Continuing here";
  if (status === "error") return "Needs attention";
  return "Awaiting your choice";
}

function decisionLabel(status, autoAccepted) {
  if (autoAccepted) return "Driver recommendation auto-accepted under Full auto";
  if (status === "pending") return "Runtime choice remains with you";
  if (status === "declined") return "Runtime proposal declined by user";
  return "Runtime configuration accepted by user";
}

function applyState(card, msg) {
  var status = msg.status || "pending";
  card.dataset.status = status;
  if (msg.autoAccepted || msg.autoApproved) card.dataset.autoAccepted = "true";
  if (msg.autoAccepted === false || msg.autoApproved === false) card.dataset.autoAccepted = "false";
  var autoAccepted = card.dataset.autoAccepted === "true";
  syncWorkerProposalSelection(msg, card._syncWorkerProposalSelection);
  var badge = card.querySelector(".worker-proposal-status");
  if (badge) badge.textContent = statusLabel(status) + (autoAccepted ? " · auto-accepted" : "");
  var decision = card.querySelector(".worker-proposal-decision");
  if (decision) {
    decision.textContent = decisionLabel(status, autoAccepted);
    decision.classList.toggle("automatic", autoAccepted);
  }
  var error = card.querySelector(".worker-proposal-error");
  if (error) {
    error.textContent = msg.error || "";
    error.classList.toggle("hidden", !msg.error);
  }
  setControlsDisabled(card, status !== "pending");
  var actions = card.querySelector(".worker-proposal-actions");
  if (actions) actions.classList.toggle("hidden", autoAccepted);
}

function sendDecision(card, accepted) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1 || card.dataset.status !== "pending") return;
  var vendor = card.querySelector(".worker-proposal-vendor");
  var model = card.querySelector(".worker-proposal-model");
  var effort = card.querySelector(".worker-proposal-effort-btn.active");
  applyState(card, { status: accepted ? "starting" : "declined" });
  ws.send(JSON.stringify({
    type: "worker_proposal_response",
    proposalId: card.dataset.proposalId,
    accepted: accepted,
    vendor: vendor ? vendor.value : "",
    model: model ? model.value : "",
    effort: effort ? effort.dataset.effort : "",
  }));
}

export function renderWorkerProposal(msg) {
  var existing = findCard(msg.proposalId);
  if (existing) {
    applyState(existing, msg);
    return;
  }
  var card = document.createElement("section");
  card.className = "worker-proposal-card";
  card.dataset.proposalId = msg.proposalId;
  card.dataset.status = msg.status || "pending";
  var runtimeSelection = workerProposalSelection(msg);

  var header = document.createElement("div");
  header.className = "worker-proposal-header";
  var replacing = msg.action === "replace";
  header.innerHTML = '<div class="worker-proposal-mark">' + iconHtml("git-branch") + '</div><div class="worker-proposal-heading"><span class="worker-proposal-kicker">DRIVER / SPLIT WORKER</span><strong>' + (replacing ? "Configure a replacement Split Worker" : "Configure a Split Worker") + '</strong></div><span class="worker-proposal-status"></span>';
  card.appendChild(header);

  var summary = document.createElement("p");
  summary.className = "worker-proposal-summary";
  summary.textContent = msg.summary || "This task can be planned here and executed in a visible Split Worker session.";
  card.appendChild(summary);

  var steps = planSteps(msg.plan);
  if (steps.length > 0) {
    var plan = document.createElement("ol");
    plan.className = "worker-proposal-plan";
    for (var i = 0; i < steps.length; i++) {
      var item = document.createElement("li");
      item.textContent = steps[i];
      plan.appendChild(item);
    }
    card.appendChild(plan);
  }

  if (msg.recommendationRationale) {
    var rationale = document.createElement("div");
    rationale.className = "worker-proposal-rationale";
    var rationaleLabel = document.createElement("span");
    rationaleLabel.textContent = "Driver's recommendation rationale";
    var rationaleText = document.createElement("p");
    rationaleText.textContent = msg.recommendationRationale;
    rationale.appendChild(rationaleLabel);
    rationale.appendChild(rationaleText);
    card.appendChild(rationale);
  }

  var config = document.createElement("div");
  config.className = "worker-proposal-config";
  var vendorField = document.createElement("label");
  vendorField.className = "worker-proposal-field worker-proposal-vendor-field";
  vendorField.innerHTML = '<span>Worker</span><span class="worker-proposal-vendor-control"><img alt=""></span>';
  var vendorSelect = buildVendorSelect(msg, runtimeSelection.vendor);
  vendorField.querySelector(".worker-proposal-vendor-control").appendChild(vendorSelect);
  config.appendChild(vendorField);
  var modelField = document.createElement("label");
  modelField.className = "worker-proposal-field";
  modelField.innerHTML = "<span>Model</span>";
  var modelSelect = document.createElement("select");
  modelSelect.className = "worker-proposal-select worker-proposal-model";
  modelField.appendChild(modelSelect);
  config.appendChild(modelField);
  var effortField = document.createElement("div");
  effortField.className = "worker-proposal-field worker-proposal-effort";
  effortField.innerHTML = '<span>Reasoning</span><div class="worker-proposal-effort-buttons"></div>';
  config.appendChild(effortField);
  card.appendChild(config);

  var decision = document.createElement("div");
  decision.className = "worker-proposal-decision";
  card.appendChild(decision);

  function syncVendor(preferredModel, preferredEffort) {
    var vendor = vendorSelect.value;
    var avatar = vendorField.querySelector("img");
    avatar.src = VENDOR_AVATARS[vendor] || VENDOR_AVATARS.claude;
    fillModels(modelSelect, vendor, msg, preferredModel);
    fillEffort(card, vendor, modelSelect.value, msg, preferredEffort);
  }
  card._syncWorkerProposalSelection = function (selection) {
    if (selection.vendor && vendorSelect.value !== selection.vendor) vendorSelect.value = selection.vendor;
    syncVendor(selection.model, selection.effort);
  };
  vendorSelect.addEventListener("change", function () { syncVendor("", "medium"); });
  modelSelect.addEventListener("change", function () {
    var active = card.querySelector(".worker-proposal-effort-btn.active");
    fillEffort(card, vendorSelect.value, modelSelect.value, msg, active ? active.dataset.effort : "medium");
  });
  syncVendor(runtimeSelection.model, runtimeSelection.effort);

  var error = document.createElement("div");
  error.className = "worker-proposal-error hidden";
  card.appendChild(error);

  var actions = document.createElement("div");
  actions.className = "worker-proposal-actions";
  var decline = document.createElement("button");
  decline.type = "button";
  decline.className = "worker-proposal-action secondary";
  decline.textContent = replacing ? "Keep current Worker" : "Continue here";
  decline.addEventListener("click", function () { sendDecision(card, false); });
  var accept = document.createElement("button");
  accept.type = "button";
  accept.className = "worker-proposal-action primary";
  accept.innerHTML = iconHtml("panel-right-open") + "<span>" + (replacing ? "Replace Split Worker" : "Run with Split Worker") + "</span>";
  accept.addEventListener("click", function () { sendDecision(card, true); });
  actions.appendChild(decline);
  actions.appendChild(accept);
  card.appendChild(actions);

  addToMessages(card);
  applyState(card, msg);
  refreshIcons();
  scrollToBottom();
}

export function updateWorkerProposal(msg) {
  var card = findCard(msg.proposalId);
  if (!card) return;
  applyState(card, msg);
}
