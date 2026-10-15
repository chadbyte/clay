// Static, init-free facts about each vendor YOKE supports. Host code that
// needs metadata before adapter initialization should read it from here.
// Only init-free contract data may be imported here; never runtime adapters.

// Canonical effort ordering used to clamp a level onto a vendor that does
// not support it (e.g. codex "minimal" -> claude "low", claude "max" ->
// codex "xhigh").
var EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

// sessionBoundTools gates whether per-session MCP tool mounting reaches a vendor's process.
var VENDOR_REGISTRY = {
  claude: {
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
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
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
  antigravity: {
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
    ["displayName", "terminalResumeCommand", "planPathSegments", "loginCommand", "binaryName", "avatar", "sessionModes", "effortLevels", "osUserIsolation", "sessionBoundTools", "usageDashboard", "rateLimitTracking", "rateLimitScheduling", "acceptsUnstampedQuota", "configuration"].forEach(function(key) {
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
