var CODEX_DEFAULTS = {
  approval: "on-request",
  sandbox: "danger-full-access",
  webSearch: "live",
};

var CODEX_APPROVAL_POLICIES = ["untrusted", "on-request", "granular", "never"];

function normalizeCodexApproval(value) {
  if (value === "on-failure") return CODEX_DEFAULTS.approval;
  if (CODEX_APPROVAL_POLICIES.indexOf(value) === -1) return CODEX_DEFAULTS.approval;
  return value;
}

function getCodexConfig(sm) {
  sm = sm || {};
  return {
    approval: normalizeCodexApproval(sm && sm.codexApproval),
    sandbox: (sm && sm.codexSandbox) === undefined ? CODEX_DEFAULTS.sandbox : ["read-only", "workspace-write", "danger-full-access"].indexOf(sm.codexSandbox) >= 0 ? sm.codexSandbox : "read-only",
    webSearch: (sm && sm.codexWebSearch) === undefined ? CODEX_DEFAULTS.webSearch : ["disabled", "cached", "live"].indexOf(sm.codexWebSearch) >= 0 ? sm.codexWebSearch : "disabled",
  };
}

module.exports = {
  CODEX_DEFAULTS: CODEX_DEFAULTS,
  CODEX_APPROVAL_POLICIES: CODEX_APPROVAL_POLICIES,
  normalizeCodexApproval: normalizeCodexApproval,
  getCodexConfig: getCodexConfig,
};
