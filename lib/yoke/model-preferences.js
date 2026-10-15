function families() {
  var registry = require("./vendor-registry").VENDOR_REGISTRY, result = {};
  Object.keys(registry).forEach(function(vendor) { if (registry[vendor].preferredModelFamilies) result[vendor] = registry[vendor].preferredModelFamilies.slice(); });
  return result;
}
module.exports = { families: families };
