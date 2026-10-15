function resolve(provider) {
  if (provider && typeof provider === "object" && provider.providerContract) return provider.providerContract;
  return require("./vendor-registry").getVendorInfo(typeof provider === "string" ? provider : provider && provider.vendor) || {};
}
module.exports = { resolve: resolve };
