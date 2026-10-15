function cleanup(home) {
  var registry = require("./vendor-registry").VENDOR_REGISTRY;
  Object.keys(registry).forEach(function(vendor) {
    var service = registry[vendor].maintenance;
    if (service && typeof service.cleanup === "function") service.cleanup(home);
  });
}
function credentialPaths(home) {
  var registry = require("./vendor-registry").VENDOR_REGISTRY, path = require("path");
  return Object.keys(registry).flatMap(function(vendor) { return (registry[vendor].credentialDirectories || []).map(function(name) { return path.join(home, name); }); });
}
module.exports = { cleanup: cleanup, credentialPaths: credentialPaths };
