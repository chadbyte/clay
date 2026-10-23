// Static, init-free facts about each vendor YOKE supports. Host code that
// needs metadata before adapter initialization should read it from here.
// Only init-free contract data may be imported here; never runtime adapters.

// Canonical effort ordering used to clamp a level onto a vendor that does
// not support it (e.g. codex "minimal" -> claude "low", claude "max" ->
// codex "xhigh").
var EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

// sessionBoundTools gates whether per-session MCP tool mounting reaches a vendor's process.
var VENDOR_REGISTRY = {
  claude: {
    setupUrl: "https://code.claude.com/docs/en/setup",
    installRecipe: require("./provider-install-recipes").claude,
    readSessionHistory: require("./cli-sessions").readCliSessionHistory,
    terminalResumeCommand: "claude --resume",
    planPathSegments: [".claude/plans/"],
    notificationHooks: require("./claude-hook-installer"),
    maintenance: require("./claude-maintenance"),
    credentialDirectories: [".claude"],
    preferredModelFamilies: ["opus", "sonnet", "haiku"],
    provisionUser: require("./providers/claude-provision").attachProvisioning,
    configuration: require("./configuration").claude,
    normalizeContext: require("./usage").sdkContext, authenticationReply: require("./auth-events").authenticationReply,
    rateLimitScheduling: true, acceptsUnstampedQuota: true,
    terminalLoginCommand: "claude auth login", browserLoginCommand: "claude auth login",
    oauthHosts: ["claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com"],
    resolveExecutable: require("./discovery").bundledResolver(function() { return require("./providers/claude-executable").resolve(); }, "claude"),
    processControl: require("./providers/claude-process"),
    prepareIsolation: require("./providers/claude-process").prepareIsolation,
    recoveryFactory: require("./claude-response-recovery").attachResponseRecovery,
    supportsLegacyGuiResume: function(session) { return !!session.cliSessionId; },
    mapQueryOptions: require("./options/claude").map,
    queryContract: require("./adapters/claude-query-contract"),
    displayName: "Claude Code",
    loginCommand: "claude login",
    binaryName: "claude",
    avatar: "/claude-code-avatar.png",
    sessionModes: ["gui", "tui"],
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
    osUserIsolation: true,
    sessionBoundTools: true,
    usageDashboard: {
      icon: "/claude-code-avatar.png",
      alt: "Claude Code",
      href: "https://claude.ai/settings/usage",
      title: "Check usage on claude.ai",
    },
    rateLimitTracking: true,
  },
  codex: {
    setupUrl: "https://learn.chatgpt.com/docs/codex/cli",
    installRecipe: require("./provider-install-recipes").codex,
    credentialDirectories: [".codex"],
    preferredModelFamilies: ["astra", "sol", "gpt", "o"],
    classifyError: require("./providers/codex-errors").classify,
    settings: require("./options/codex-settings"),
    configuration: require("./configuration").codex,
    normalizeContext: require("./usage").tokenContext, requiresQuotaSource: true,
    browserLoginCommand: "codex login", oauthHosts: ["auth.openai.com"],
    resolveExecutable: require("./discovery").bundledResolver(function() { return require("./codex-app-server").findCodexPath(); }, "codex"),
    mapQueryOptions: require("./options/codex").map,
    queryContract: require("./adapters/codex-query-contract"),
    displayName: "Codex",
    loginCommand: "codex login --device-auth",
    binaryName: "codex",
    avatar: "/codex-avatar.png",
    sessionModes: ["gui"],
    // Fallback only; runtime model/list rows carry each model's own efforts.
    // Codex 0.162.1 presets and https://learn.chatgpt.com/docs/models
    // (verified 2026-10-17) offer ultra on gpt-6.1-sol, gpt-6-astra, gpt-6-sol,
    // gpt-5.6-sol and gpt-5.6-terra.
    effortLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    osUserIsolation: true,
    sessionBoundTools: false,
    usageDashboard: {
      icon: "/codex-avatar.png",
      alt: "Codex",
      href: "https://chatgpt.com/codex/settings/usage",
      title: "Check usage on ChatGPT",
    },
    rateLimitTracking: true,
  },
  muse: {
    setupUrl: "https://dev.meta.ai/docs/overview",
    displayName: "Muse Code",
    loginCommand: "muse",
    binaryName: "muse",
    avatar: "/muse-avatar.svg",
    sessionModes: ["gui"],
    effortLevels: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
    osUserIsolation: false,
    sessionBoundTools: true,
    usageDashboard: null,
    rateLimitTracking: false,
    forkHistoryBoundary: "completed-turn-inclusive",
    resolveExecutable: require("./providers/muse-executable").resolve,
    mapQueryOptions: require("./options/muse").map,
    queryContract: require("./adapters/muse-query-contract"),
    normalizeContext: require("./usage").tokenContext,
    configuration: { auto: true, permissionModes: [{ value: "default", label: "Ask" }] },
  },
  antigravity: {
    setupUrl: "https://www.antigravity.google/docs/getting-started?tab=cli",
    forceTermination: true,
    resolveExecutable: require("./providers/antigravity-executable").resolve,
    mapQueryOptions: require("./options/antigravity").map,
    displayName: "Antigravity CLI",
    loginCommand: "agy",
    binaryName: "agy",
    avatar: "/antigravity-avatar.png",
    sessionModes: ["gui"],
    effortLevels: ["low", "medium", "high"],
    osUserIsolation: false,
    sessionBoundTools: false,
    usageDashboard: null,
    rateLimitTracking: false,
  },
  opencode: {
    setupUrl: "https://opencode.ai/docs/",
    resolveExecutable: require("./discovery").acpResolver("opencode"),
    mapQueryOptions: require("./options/acp").map,
    displayName: "OpenCode",
    loginCommand: "opencode auth login",
    binaryName: "opencode",
    avatar: "/opencode-avatar.svg",
    sessionModes: ["gui"],
    effortLevels: [],
    osUserIsolation: false,
    sessionBoundTools: true,
    usageDashboard: null,
    rateLimitTracking: false,
  },
  kimi: {
    setupUrl: "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html",
    resolveExecutable: require("./discovery").acpResolver("kimi"),
    mapQueryOptions: require("./options/acp").map,
    displayName: "Kimi Code",
    loginCommand: "kimi login",
    binaryName: "kimi",
    avatar: "/kimi-avatar.svg",
    sessionModes: ["gui"],
    effortLevels: [],
    osUserIsolation: false,
    sessionBoundTools: true,
    usageDashboard: null,
    rateLimitTracking: false,
  },
  grok: {
    setupUrl: "https://docs.x.ai/build/overview",
    resolveExecutable: require("./discovery").acpResolver("grok"),
    mapQueryOptions: require("./options/acp").map,
    displayName: "Grok Build",
    loginCommand: "grok login --device-auth",
    binaryName: "grok",
    avatar: "/grok-avatar.svg",
    sessionModes: ["gui"],
    effortLevels: [],
    osUserIsolation: false,
    sessionBoundTools: true,
    usageDashboard: null,
    rateLimitTracking: false,
  },
  copilot: {
    setupUrl: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
    resolveExecutable: require("./discovery").acpResolver("copilot"),
    mapQueryOptions: require("./options/acp").map,
    displayName: "GitHub Copilot CLI",
    loginCommand: "copilot login",
    binaryName: "copilot",
    avatar: "/copilot-avatar.svg",
    sessionModes: ["gui"],
    effortLevels: [],
    osUserIsolation: false,
    sessionBoundTools: true,
    usageDashboard: null,
    rateLimitTracking: false,
  },
  qwen: {
    setupUrl: "https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/",
    resolveExecutable: require("./discovery").acpResolver("qwen"),
    mapQueryOptions: require("./options/acp").map,
    displayName: "Qwen Code",
    loginCommand: "qwen",
    binaryName: "qwen",
    avatar: "/qwen-avatar.svg",
    sessionModes: ["gui"],
    effortLevels: [],
    osUserIsolation: false,
    sessionBoundTools: true,
    usageDashboard: null,
    rateLimitTracking: false,
  },
  junie: {
    setupUrl: "https://junie.jetbrains.com/docs/junie-cli.html",
    resolveExecutable: require("./discovery").acpResolver("junie"),
    mapQueryOptions: require("./options/acp").map,
    displayName: "Junie CLI",
    loginCommand: "junie",
    binaryName: "junie",
    avatar: "/junie-avatar.svg",
    sessionModes: ["gui"],
    effortLevels: [],
    osUserIsolation: false,
    sessionBoundTools: true,
    usageDashboard: null,
    rateLimitTracking: false,
  },
  kiro: {
    setupUrl: "https://kiro.dev/docs/cli/",
    normalizeContext: require("./usage").tokenContext,
    resolveExecutable: require("./discovery").bundledResolver(function() { return require("./kiro-acp-server").findKiroPath(); }, "kiro-cli"),
    mapQueryOptions: require("./options/kiro").map,
    displayName: "Kiro CLI",
    loginCommand: "kiro-cli login",
    binaryName: "kiro-cli",
    avatar: "/kiro-avatar.svg",
    sessionModes: ["gui"],
    effortLevels: [],
    osUserIsolation: false,
    sessionBoundTools: true,
    usageDashboard: null,
    rateLimitTracking: false,
  },
};

// No other adapter currently confirms exact-query hard termination.
Object.keys(VENDOR_REGISTRY).forEach(function (vendor) {
  if (VENDOR_REGISTRY[vendor].forceTermination !== true) VENDOR_REGISTRY[vendor].forceTermination = false;
});

function getVendorInfo(vendor) {
  return VENDOR_REGISTRY[vendor] || null;
}

// Clamp an effort level onto what the vendor supports. Returns the level
// itself when supported, the nearest supported level by the canonical order
// otherwise, and undefined when the vendor has no effort concept (or the
// input is not a known level -- never forward junk to an adapter).
function clampEffort(vendor, effort) {
  if (!effort) return undefined;
  var info = VENDOR_REGISTRY[vendor];
  var levels = (info && info.effortLevels) || [];
  if (levels.length === 0) return undefined;
  if (levels.indexOf(effort) !== -1) return effort;
  var position = EFFORT_ORDER.indexOf(effort);
  if (position === -1) return undefined;
  var nearest = levels[0];
  var nearestDistance = Infinity;
  for (var i = 0; i < levels.length; i++) {
    var distance = Math.abs(EFFORT_ORDER.indexOf(levels[i]) - position);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = levels[i];
    }
  }
  return nearest;
}

// Publish only serializable product descriptions, never backend services.
function publicInfo() {
  var result = {};
  Object.keys(VENDOR_REGISTRY).forEach(function(vendor) {
    var info = VENDOR_REGISTRY[vendor], entry = {};
    ["forceTermination", "displayName", "terminalResumeCommand", "planPathSegments", "loginCommand", "binaryName", "avatar", "sessionModes", "effortLevels", "osUserIsolation", "sessionBoundTools", "usageDashboard", "rateLimitTracking", "rateLimitScheduling", "acceptsUnstampedQuota", "configuration"].forEach(function(key) {
      if (info[key] !== undefined) entry[key] = info[key];
    });
    entry.browserLoginSupported = typeof info.browserLoginCommand === "string" && Array.isArray(info.oauthHosts) && info.oauthHosts.length > 0;
    result[vendor] = entry;
  });
  return result;
}

module.exports = {
  publicInfo: publicInfo,
  VENDOR_REGISTRY: VENDOR_REGISTRY,
  getVendorInfo: getVendorInfo,
  clampEffort: clampEffort,
  EFFORT_ORDER: EFFORT_ORDER,
};
