var ENABLED_GATE = Object.freeze({ feature: "multi-worker-runtime" });

function fromServerConfig(config) {
  return config && config.multiWorkerRuntimeEnabled === true ? ENABLED_GATE : null;
}

function isEnabled(gate) {
  return gate === ENABLED_GATE;
}

module.exports = { fromServerConfig: fromServerConfig, isEnabled: isEnabled };
