function implementations(provider) {
  if (provider) { var policy = require("./provider-contract").resolve(provider); return policy.settings ? [policy.settings] : []; }
  var registry = require("./vendor-registry").VENDOR_REGISTRY;
  return Array.from(new Set(Object.keys(registry).map(function(vendor) { return registry[vendor].settings; }).filter(Boolean)));
}
function defaults() {
  var result = {};
  implementations().forEach(function(service) { Object.assign(result, service.defaults()); });
  return result;
}
function messages(settings) {
  return implementations().flatMap(function(service) { return service.messages(settings); });
}
function change(message, settings, provider) {
  var services = implementations(provider);
  for (var i = 0; i < services.length; i++) {
    if (typeof services[i].change !== "function") throw new Error("Provider settings implementation is unavailable.");
    var result = services[i].change(message, settings);
    if (result) return result;
  }
  return null;
}
module.exports = { defaults: defaults, messages: messages, change: change };
