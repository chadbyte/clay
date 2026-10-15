// Kiro-specific default values. Single source of truth — do not duplicate
// elsewhere. Consumed by the server-side vendor plumbing and sent to clients
// via the config state so the UI renders the right controls.

var KIRO_DEFAULTS = {
  // Kiro CLI 2.18.1 exposes the next-generation agent as the v3 engine. Its
  // general-purpose mode id is "vibe" (displayed as "Default").
  engine: "v3",
  mode: "vibe",
};

function getKiroConfig(sm) {
  return {
    engine: (sm && sm.kiroEngine) || KIRO_DEFAULTS.engine,
    mode: (sm && sm.kiroMode) || KIRO_DEFAULTS.mode,
  };
}

module.exports = {
  KIRO_DEFAULTS: KIRO_DEFAULTS,
  getKiroConfig: getKiroConfig,
};
