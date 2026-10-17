// A provider fork may return local history or require a provider-owned reader.
// Absence is an unsupported operation, never an empty successful transcript.
function read(provider, home, cwd, sessionId) {
  var reader = require("./provider-contract").resolve(provider).readSessionHistory;
  if (typeof reader !== "function") throw new Error("Provider session history reading is unavailable.");
  return reader(home, cwd, sessionId);
}
module.exports = { read: read };
