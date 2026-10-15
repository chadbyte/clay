// Translate common execution intent at the provider implementation boundary.
function map(provider, intent) {
  var info = provider && Object.prototype.hasOwnProperty.call(provider, "mapQueryOptions") ? provider : require("./provider-contract").resolve(provider);
  if (info.mapQueryOptions === undefined) return {};
  if (typeof info.mapQueryOptions !== "function") throw new Error("Provider option mapping is unavailable.");
  var options = info.mapQueryOptions(intent || {});
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Invalid provider option mapping.");
  return options;
}
module.exports = { map: map };
