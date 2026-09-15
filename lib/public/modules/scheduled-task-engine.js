import { effortLevelsFor, effortDisplayName } from './app-panels.js';

function modelValue(model) { return typeof model === "string" ? model : model && (model.value || model.id) || ""; }
function modelLabel(model) { return typeof model === "string" ? model : model && (model.displayName || model.name || model.value || model.id) || ""; }

function fillRuntimeRole(root, state, role, runtime) {
  var vendorSelect = root.querySelector('[data-runtime="' + role + '-vendor"]');
  var modelSelect = root.querySelector('[data-runtime="' + role + '-model"]');
  var effortSelect = root.querySelector('[data-runtime="' + role + '-effort"]');
  if (!vendorSelect || !modelSelect || !effortSelect) return null;
  var installed = state && (state.runtimeInstalledVendors || state.installedVendors) || [];
  runtime = runtime || {};
  var fallbackIndex = role === "worker" && installed.length > 1 ? 1 : 0;
  var vendor = runtime.vendor || installed[fallbackIndex] || "";
  vendorSelect.innerHTML = '<option value="">Choose vendor</option>';
  for (var i = 0; i < installed.length; i++) {
    var vendorOption = document.createElement("option"); vendorOption.value = installed[i]; vendorOption.textContent = installed[i].charAt(0).toUpperCase() + installed[i].slice(1); vendorSelect.appendChild(vendorOption);
  }
  if (vendor && installed.indexOf(vendor) === -1) { var unavailableVendor = document.createElement("option"); unavailableVendor.value = vendor; unavailableVendor.textContent = "Unavailable: " + vendor; unavailableVendor.disabled = true; vendorSelect.appendChild(unavailableVendor); }
  vendorSelect.value = vendor;
  var models = state && state.modelsByVendor && state.modelsByVendor[vendor] || [];
  var ready = !!(state && state.catalogReadyByVendor && state.catalogReadyByVendor[vendor]);
  modelSelect.innerHTML = '<option value="">Choose model</option>';
  var selectedModel = runtime.vendor === vendor ? runtime.model || "" : ""; var foundModel = !selectedModel;
  for (var mi = 0; mi < models.length; mi++) { var option = document.createElement("option"); option.value = modelValue(models[mi]); option.textContent = modelLabel(models[mi]); modelSelect.appendChild(option); if (option.value === selectedModel) foundModel = true; }
  if (!foundModel) { var unavailableModel = document.createElement("option"); unavailableModel.value = selectedModel; unavailableModel.textContent = "Unavailable: " + selectedModel; unavailableModel.disabled = true; modelSelect.appendChild(unavailableModel); }
  modelSelect.value = selectedModel;
  var levels = effortLevelsFor(vendor, models, modelSelect.value);
  effortSelect.innerHTML = '<option value="">Choose effort</option>';
  for (var ei = 0; ei < levels.length; ei++) { var effortOption = document.createElement("option"); effortOption.value = levels[ei]; effortOption.textContent = effortDisplayName(levels[ei]); effortSelect.appendChild(effortOption); }
  var selectedEffort = runtime.vendor === vendor ? runtime.effort || "" : "";
  if (selectedEffort && levels.indexOf(selectedEffort) === -1) { var unavailableEffort = document.createElement("option"); unavailableEffort.value = selectedEffort; unavailableEffort.textContent = "Unavailable: " + selectedEffort; unavailableEffort.disabled = true; effortSelect.appendChild(unavailableEffort); }
  effortSelect.value = selectedEffort;
  modelSelect.disabled = !ready; effortSelect.disabled = !ready;
  return { vendor: vendor, model: modelSelect.value, effort: effortSelect.value };
}

export function renderExecutionRuntime(root, state, execution) {
  execution = execution || {};
  return { driver: fillRuntimeRole(root, state, "driver", execution.driver), worker: fillRuntimeRole(root, state, "worker", execution.worker) };
}

export function readExecutionRuntime(root) {
  function role(name) {
    return { vendor: root.querySelector('[data-runtime="' + name + '-vendor"]').value, model: root.querySelector('[data-runtime="' + name + '-model"]').value || null, effort: root.querySelector('[data-runtime="' + name + '-effort"]').value || null };
  }
  return { driver: role("driver"), worker: role("worker") };
}
