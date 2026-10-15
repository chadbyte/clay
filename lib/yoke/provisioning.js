function forProvider(provider, context) {
  var service = require("./provider-contract").resolve(provider).provisionUser;
  if (typeof service !== "function") throw new Error("Provider account provisioning is unavailable.");
  return service(context);
}
module.exports = { forProvider: forProvider };
