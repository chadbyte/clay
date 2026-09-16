var yoke = require("./yoke");

function modelValue(entry) { return typeof entry === "string" ? entry : entry && (entry.value || entry.id) || ""; }

function build(options, fullAccess, preflight) {
  var vendors = [];
  var installed = options.installedVendors || [];
  for (var i = 0; i < installed.length; i++) {
    var vendor = installed[i];
    var models = options.modelsByVendor[vendor] || [];
    var capability = options.capabilitiesByVendor[vendor] || {};
    var vendorInfo = yoke.getVendorInfo(vendor) || {};
    var combinations = [];
    var readyObserved = Array.isArray(options.availableVendors);
    var adapterReady = !readyObserved || options.availableVendors.indexOf(vendor) !== -1;
    for (var j = 0; j < models.length; j++) {
      var model = modelValue(models[j]);
      if (!model) continue;
      var levels = models[j] && models[j].supportedEffortLevels;
      if (!Array.isArray(levels) || levels.length === 0) levels = vendorInfo.effortLevels || [];
      if (capability.effort === false || levels.length === 0) levels = [null];
      for (var k = 0; k < levels.length; k++) {
        try {
          if (preflight) preflight(vendor, model, levels[k]);
          if (adapterReady) combinations.push({ model: model, effort: levels[k] });
        } catch (err) {}
      }
    }
    vendors.push({
      vendor: vendor,
      status: combinations.length ? "available" : "temporarily_unavailable",
      unavailableReason: combinations.length ? null : (!adapterReady ? "The runtime adapter is not currently available." : (options.unavailableReasons && options.unavailableReasons[vendor] || "No executable model and effort combination passed server preflight.")),
      evidence: {
        installation: "observed",
        adapter: readyObserved ? (adapterReady ? "ready" : "unavailable") : "unknown",
        authentication: "unknown",
        authenticationReason: "Authentication is confirmed by the vendor runtime when a task starts; catalog discovery alone is not proof of credentials.",
      },
      combinations: combinations,
    });
  }
  return {
    status: "ok",
    observedAt: Date.now(),
    vendors: vendors,
    approval: fullAccess
      ? { mode: "conditional_auto_accept", reason: "Only an exact server-validated Driver recommendation may auto-accept." }
      : { mode: "user_required", reason: "Runtime creation and replacement require the visible configuration decision." },
  };
}

module.exports = { build: build };
