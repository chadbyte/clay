// Static, init-free facts about each vendor YOKE supports. Host code that
// needs metadata before adapter initialization should read it from here.
// Do not import adapters into this module.

// Canonical effort ordering used to clamp a level onto a vendor that does
// not support it (e.g. codex "minimal" -> claude "low", claude "max" ->
// codex "xhigh").
var EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

// sessionBoundTools gates whether per-session MCP tool mounting reaches a vendor's process.
var VENDOR_REGISTRY = {
  claude: {
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

module.exports = {
  VENDOR_REGISTRY: VENDOR_REGISTRY,
  getVendorInfo: getVendorInfo,
  clampEffort: clampEffort,
  EFFORT_ORDER: EFFORT_ORDER,
};
