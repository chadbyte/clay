// Internal adapter operation only: Kiro session choices are not yet published
// into Clay's vendor-wide UI/canonical effort catalogs.
function applyOptions(state, options) {
  state.configOptions = Array.isArray(options) ? options : [];
  state.configRevision = (state.configRevision || 0) + 1;
}
function setEffort(state, effort, send, captureSession) {
  var scope = captureSession();
  if (!scope || !scope.isCurrent()) return Promise.reject(new Error("Kiro configuration target is stale"));
  if (state.engine !== "v3" || !state.sessionId) return Promise.reject(new Error("Kiro effort requires an open v3 session"));
  if (state.pendingEffort) return Promise.reject(new Error("A Kiro effort change is already pending"));
  var option = state.configOptions.find(function(item) { return item && item.id === "effortLevel"; });
  var choices = option && Array.isArray(option.options) ? option.options : [];
  if (!choices.some(function(item) { return item && item.value === effort; })) return Promise.reject(new Error("Kiro did not advertise the requested effortLevel"));
  var revision = state.configRevision;
  var pending = {};
  state.pendingEffort = pending;
  return Promise.resolve().then(function() {
    if (!scope.isCurrent() || revision !== state.configRevision) throw new Error("Kiro configuration target or advertisement changed");
    return send("session/set_config_option", { sessionId: state.sessionId, configId: "effortLevel", value: effort }, 15000);
  }).then(function(result) {
    if (!scope.isCurrent() || revision !== state.configRevision) throw new Error("Kiro configuration response is stale; the native change is unconfirmed");
    if (!result || !Array.isArray(result.configOptions)) throw new Error("Kiro configuration response is malformed; the native change is unconfirmed");
    applyOptions(state, result.configOptions);
  }).finally(function() { if (state.pendingEffort === pending) state.pendingEffort = null; });
}
module.exports = { setEffort: setEffort, applyOptions: applyOptions };
