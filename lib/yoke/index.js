// YOKE - Yoke Overrides Known Engines
// Public entry point.

var iface = require("./interface");
var instructions = require("./instructions");
var vendorRegistry = require("./vendor-registry");
var completeOnce = require("./complete-once").completeOnce;
var userInput = require("./user-input");
var sessionTools = require("./session-tool-transport");
var createClaudeAdapter = require("./adapters/claude").createClaudeAdapter;
var createCodexAdapter = require("./adapters/codex").createCodexAdapter;
var createAntigravityAdapter = require("./adapters/antigravity").createAntigravityAdapter;
var createOpenCodeAdapter = require("./adapters/opencode").createOpenCodeAdapter;
var createKimiAdapter = require("./adapters/kimi").createKimiAdapter;
var createGrokAdapter = require("./adapters/grok").createGrokAdapter;
var createCopilotAdapter = require("./adapters/copilot").createCopilotAdapter;
var createQwenAdapter = require("./adapters/qwen").createQwenAdapter;
var createJunieAdapter = require("./adapters/junie").createJunieAdapter;
var createKiroAdapter = require("./adapters/kiro").createKiroAdapter;

// Keep the first session in a new project predictable. This order is also
// used by the UI when a project has no remembered vendor yet.
var DEFAULT_VENDOR_ORDER = ["claude", "codex", "grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode", "kiro"];

function resolveDefaultVendor(availableVendors) {
  availableVendors = availableVendors || {};
  for (var i = 0; i < DEFAULT_VENDOR_ORDER.length; i++) {
    var vendor = DEFAULT_VENDOR_ORDER[i];
    if (Array.isArray(availableVendors)) {
      if (availableVendors.indexOf(vendor) !== -1) return vendor;
    } else if (availableVendors[vendor]) {
      return vendor;
    }
  }
  return "claude";
}

/**
 * Wrap adapter.createQuery to inject cross-vendor project instructions.
 *
 * Scans the project directory for instruction files (CLAUDE.md, AGENTS.md,
 * .cursorrules, etc.) that the current vendor does NOT natively read,
 * and merges them into queryOpts.systemPrompt before calling the real
 * createQuery. This way every adapter gets project context regardless
 * of which vendor wrote the instruction file.
 */
function wrapCreateQuery(adapter, defaultCwd) {
  var originalCreateQuery = adapter.createQuery.bind(adapter);

  adapter.createQuery = function(queryOpts) {
    queryOpts = queryOpts || {};
    var projectDir = (queryOpts && queryOpts.cwd) || defaultCwd;
    var merged = queryOpts.skipProjectInstructions ? "" : instructions.scanAndMerge(projectDir, adapter.vendor);

    if (merged) {
      var parts = [];
      if (queryOpts.systemPrompt) parts.push(queryOpts.systemPrompt);
      parts.push(merged);
      queryOpts.systemPrompt = parts.join("\n\n");
    }

    return originalCreateQuery(queryOpts);
  };
}

/**
 * Create a YOKE adapter.
 *
 * @param {object} opts
 * @param {string} [opts.vendor="claude"] - Adapter vendor name
 * @param {string} opts.cwd              - Project working directory
 * @param {object} [opts.adapterOpts]    - Vendor-specific adapter construction options
 * @returns {Adapter}
 */
function createAdapter(opts) {
  // Adding a vendor here also requires a registry entry and an update to the
  // completeness list in test/yoke-vendor-registry.test.js.
  var vendor = (opts && opts.vendor) || "claude";
  var adapter;
  if (vendor === "claude") {
    adapter = createClaudeAdapter(opts);
  } else if (vendor === "codex") {
    adapter = createCodexAdapter(opts);
  } else if (vendor === "antigravity") {
    adapter = createAntigravityAdapter(opts);
  } else if (vendor === "opencode") {
    adapter = createOpenCodeAdapter(opts);
  } else if (vendor === "kimi") {
    adapter = createKimiAdapter(opts);
  } else if (vendor === "grok") {
    adapter = createGrokAdapter(opts);
  } else if (vendor === "copilot") {
    adapter = createCopilotAdapter(opts);
  } else if (vendor === "qwen") {
    adapter = createQwenAdapter(opts);
  } else if (vendor === "junie") {
    adapter = createJunieAdapter(opts);
  } else if (vendor === "kiro") {
    adapter = createKiroAdapter(opts);
  } else {
    throw new Error("[YOKE] Unknown adapter vendor: " + vendor);
  }
  iface.validateAdapter(adapter);
  wrapCreateQuery(adapter, opts && opts.cwd);
  return adapter;
}

/**
 * Check which vendors have valid auth credentials.
 * Result is cached after first call (auth state doesn't change during runtime).
 * Call invalidateAuthCache() to force re-check (e.g. after login).
 */
var _authCache = null;
var _lastAuthLogKey = null;
var _lastAuthLogAt = 0;

function logAuthCheck(auth) {
  var key = JSON.stringify(auth || {});
  var now = Date.now();
  if (_lastAuthLogKey === key && now - _lastAuthLogAt < 30000) return;
  _lastAuthLogKey = key;
  _lastAuthLogAt = now;
  console.log("[yoke] Auth check: " + Object.keys(auth).map(function(vendor) { return vendor + "=" + auth[vendor]; }).join(" "));
}

function checkAuth() {
  if (_authCache) return _authCache;

  var execSync = require("child_process").execSync;
  var execFileSync = require("child_process").execFileSync;

  function lookupBinary(name) {
    try {
      if (process.platform === "win32") {
        return execFileSync("where", [name], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim().split(/\r?\n/)[0] || null;
      }
      return execFileSync("which", [name], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim().split(/\r?\n/)[0] || null;
    } catch (e) {
      return null;
    }
  }

  function parseClaudeAuthStatusJson(out) {
    if (!out) return null;
    try {
      return JSON.parse(out);
    } catch (e) {
      return null;
    }
  }

  function isClaudeLoggedInText(out) {
    if (!out) return false;
    var text = String(out).toLowerCase();
    if (text.indexOf("not logged in") !== -1) return false;
    if (text.indexOf("login method:") !== -1) return true;
    if (text.indexOf("logged in") !== -1) return true;
    return false;
  }

  function hasThirdPartyProviderAuth() {
    // Claude Code supports third-party providers via env vars. When these are set,
    // `claude auth status` reports "not logged in" because there is no OAuth session,
    // but Claude Code itself authenticates directly through the provider.
    var env = process.env;
    if (env.CLAUDE_CODE_USE_BEDROCK === "1"
        && (env.AWS_BEARER_TOKEN_BEDROCK
            || env.AWS_ACCESS_KEY_ID
            || env.AWS_PROFILE
            || env.AWS_SESSION_TOKEN)) {
      return "bedrock";
    }
    if (env.CLAUDE_CODE_USE_VERTEX === "1") return "vertex";
    if (env.ANTHROPIC_API_KEY) return "api_key";
    if (env.ANTHROPIC_AUTH_TOKEN) return "auth_token";
    return null;
  }

  function checkClaude() {
    var provider = hasThirdPartyProviderAuth();
    if (provider) {
      console.log("[yoke] Claude auth via third-party provider: " + provider);
      return true;
    }

    try {
      var out = execSync("claude auth status --json", { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      var parsed = parseClaudeAuthStatusJson(out);
      if (parsed) return !!parsed.loggedIn;
      console.warn("[yoke] Claude auth status JSON parse failed; falling back to text output");
    } catch (e) {
      var stdout = e && e.stdout ? String(e.stdout) : "";
      if (stdout) {
        var parsedFallback = parseClaudeAuthStatusJson(stdout);
        if (parsedFallback) return !!parsedFallback.loggedIn;
      }
      console.warn("[yoke] Claude auth status JSON check failed; falling back to text output:", e.message);
    }

    try {
      var textOut = execSync("claude auth status --text", { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return isClaudeLoggedInText(textOut);
    } catch (e) {
      return false;
    }
  }

  function resolveCodexBinary() {
    var fs = require("fs");
    var findCodexPath = require("./codex-app-server").findCodexPath;

    try {
      var codexBin = findCodexPath();
      if (codexBin && fs.existsSync(codexBin)) return codexBin;
    } catch (e) {}

    return lookupBinary("codex");
  }

  function checkCodex() {
    try {
      var codexBin = resolveCodexBinary();
      if (!codexBin) return false;
      execFileSync(codexBin, ["login", "status"], { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return true;
    } catch (e) {
      return false;
    }
  }

  function resolveKiroBinary() {
    var fs = require("fs");
    try {
      var findKiroPath = require("./kiro-acp-server").findKiroPath;
      var kiroBin = findKiroPath();
      if (kiroBin && fs.existsSync(kiroBin)) return kiroBin;
    } catch (e) {}
    return lookupBinary("kiro-cli");
  }

  function checkKiro() {
    try {
      var kiroBin = resolveKiroBinary();
      if (!kiroBin) return false;
      // `kiro-cli whoami` exits 0 and prints account details when logged in,
      // and exits non-zero otherwise.
      execFileSync(kiroBin, ["whoami"], { timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return true;
    } catch (e) {
      return false;
    }
  }

  _authCache = {
    claude: checkClaude(),
    codex: checkCodex(),
    antigravity: !!lookupBinary("agy"),
    opencode: !!lookupBinary("opencode"),
    kimi: !!lookupBinary("kimi"),
    grok: !!lookupBinary("grok"),
    copilot: !!lookupBinary("copilot"),
    qwen: !!lookupBinary("qwen"),
    junie: !!lookupBinary("junie"),
    kiro: checkKiro(),
  };
  logAuthCheck(_authCache);
  return _authCache;
}

/**
 * Check which vendor binaries are installed (regardless of auth status).
 *
 * Result is cached at module scope because the check runs two execFileSync
 * calls per invocation and is triggered once per project context on daemon
 * startup. With N projects this used to cost ~2N synchronous subprocesses;
 * caching collapses it to two total. The cache is invalidated alongside
 * the auth cache (via invalidateAuthCache) since "just installed" is the
 * same situation as "just logged in" from the daemon's perspective.
 */
var _installedCache = null;

function checkInstalled() {
  if (_installedCache) return _installedCache;

  var fs = require("fs");
  var execFileSync = require("child_process").execFileSync;
  var result = { claude: false, codex: false, antigravity: false, opencode: false, kimi: false, grok: false, copilot: false, qwen: false, junie: false, kiro: false };
  try {
    if (process.platform === "win32") execFileSync("where", ["claude"], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
    else execFileSync("which", ["claude"], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
    result.claude = true;
  } catch (e) {}
  try {
    var findKiroPath = require("./kiro-acp-server").findKiroPath;
    var kiroBin = findKiroPath();
    if (kiroBin && fs.existsSync(kiroBin)) result.kiro = true;
  } catch (e) {}
  try {
    var codexBin = null;
    try {
      var findCodexPath = require("./codex-app-server").findCodexPath;
      codexBin = findCodexPath();
      if (codexBin && fs.existsSync(codexBin)) {
        result.codex = true;
      }
    } catch (e) {}

    if (!result.codex) {
      var whichOut = process.platform === "win32"
        ? execFileSync("where", ["codex"], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
        : execFileSync("which", ["codex"], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      if (whichOut.trim()) result.codex = true;
    }
  } catch (e) {}
  try {
    var antigravityBinary = process.platform === "win32"
      ? execFileSync("where", ["agy"], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
      : execFileSync("which", ["agy"], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    result.antigravity = !!antigravityBinary.trim();
  } catch (e) {}
  var acpVendorKeys = ["opencode", "kimi", "grok", "copilot", "qwen", "junie"];
  for (var acpIndex = 0; acpIndex < acpVendorKeys.length; acpIndex++) {
    try {
      var acpProfiles = require("./acp-agent-profiles");
      var acpVendor = acpVendorKeys[acpIndex];
      result[acpVendor] = !!acpProfiles.findAcpAgentPath(acpProfiles.getAcpAgentProfile(acpVendor));
    } catch (e) {}
  }
  _installedCache = result;
  return result;
}

function invalidateAuthCache() {
  _authCache = null;
  _installedCache = null;
}

/**
 * Create adapters for all authenticated vendors.
 * Claude may be shared across projects, but Codex is instantiated per project
 * so its app-server and bridge stay scoped to a single project slug.
 * Returns { adapters: { vendor: Adapter }, auth: { vendor: boolean } }
 */
var _sharedClaudeAdapter = null;

function createAdapters(opts) {
  opts = opts || {};
  // Gate adapter creation on binary installation, not OAuth auth status.
  // Claude Code supports multiple auth modes (OAuth, Bedrock, Vertex, API key)
  // that `claude auth status` does not always detect. Runtime auth failures are
  // handled downstream via query-level error detection.
  // Tests can supply a fixed installation snapshot without probing or spawning
  // vendor binaries; production callers always use the cached host scan.
  var installed = opts._installed || checkInstalled();
  var auth = { claude: false, codex: false, antigravity: false, opencode: false, kimi: false, grok: false, copilot: false, qwen: false, junie: false, kiro: false };
  var adapters = {};

  function supportsConfiguredIsolation(vendor) {
    var info = vendorRegistry.getVendorInfo(vendor);
    return !opts.osUsers || !info || info.osUserIsolation;
  }

  if (installed.claude && supportsConfiguredIsolation("claude")) {
    try {
      if (!_sharedClaudeAdapter) {
        _sharedClaudeAdapter = createAdapter({ vendor: "claude", cwd: opts.cwd });
        // This adapter instance is reused by every project. Mark it so
        // per-project teardown never shuts it down on behalf of one project
        // (see destroy() in lib/project.js).
        _sharedClaudeAdapter.shared = true;
        console.log("[yoke] Shared adapter created: claude");
      }
      adapters.claude = _sharedClaudeAdapter;
      auth.claude = true;
    } catch (e) {
      console.error("[yoke] Failed to create adapter for claude:", e.message);
    }
  }

  if (installed.codex && supportsConfiguredIsolation("codex")) {
    try {
      adapters.codex = createAdapter({
        vendor: "codex", cwd: opts.cwd, slug: opts.slug, osUsers: !!opts.osUsers,
        clayPort: opts.clayPort, clayTls: opts.clayTls,
        clayAuthToken: opts.clayAuthToken, clayBridgeToken: opts.clayBridgeToken,
      });
      auth.codex = true;
    } catch (e) {
      console.error("[yoke] Failed to create adapter for codex:", e.message);
    }
  }

  var subprocessVendors = ["antigravity", "opencode", "kimi", "grok", "copilot", "qwen", "junie"];
  for (var subprocessIndex = 0; subprocessIndex < subprocessVendors.length; subprocessIndex++) {
    var subprocessVendor = subprocessVendors[subprocessIndex];
    var subprocessInfo = vendorRegistry.getVendorInfo(subprocessVendor);
    if (installed[subprocessVendor] && supportsConfiguredIsolation(subprocessVendor)) {
      try {
        adapters[subprocessVendor] = createAdapter({ vendor: subprocessVendor, cwd: opts.cwd, slug: opts.slug });
        auth[subprocessVendor] = true;
      } catch (e) {
        console.error("[yoke] Failed to create adapter for " + subprocessVendor + ":", e.message);
      }
    } else if (installed[subprocessVendor] && opts.osUsers) {
      console.log("[yoke] " + subprocessInfo.displayName + " adapter disabled: OS-user isolation requires per-user spawning");
    }
  }

  var kiroInfo = vendorRegistry.getVendorInfo("kiro");
  if (installed.kiro && supportsConfiguredIsolation("kiro")) {
    try {
      adapters.kiro = createAdapter({ vendor: "kiro", cwd: opts.cwd, slug: opts.slug });
      auth.kiro = true;
    } catch (e) {
      console.error("[yoke] Failed to create adapter for kiro:", e.message);
    }
  } else if (installed.kiro && opts.osUsers) {
    console.log("[yoke] " + kiroInfo.displayName + " adapter disabled: OS-user isolation requires per-user spawning");
  }

  var registeredVendors = Object.keys(adapters);
  if (registeredVendors.length > 0) {
    var registrationScope = opts.slug ? " for " + opts.slug : "";
    console.log("[yoke] Adapters registered" + registrationScope + ": " + registeredVendors.join(", "));
  }

  return { adapters: adapters, auth: auth };
}

/**
 * Lazy-create an adapter for a vendor that wasn't available at startup.
 * Re-checks auth, creates adapter if now logged in.
 * Returns the adapter or null.
 */
async function lazyCreateAdapter(adapters, vendor, opts) {
  opts = opts || {};

  var vendorInfo = vendorRegistry.getVendorInfo(vendor);
  if (vendorInfo && !vendorInfo.osUserIsolation && (opts.osUsers || opts.linuxUser)) {
    console.log("[yoke] Refusing lazy " + vendorInfo.displayName + " adapter creation for OS-isolated user " + (opts.linuxUser || "unknown"));
    return null;
  }

  // Force re-check since user may have logged in after server start
  invalidateAuthCache();
  var installed = checkInstalled();
  if (!installed[vendor]) return null;

  try {
    var ad = createAdapter({
      vendor: vendor,
      cwd: opts.cwd,
      slug: opts.slug,
      osUsers: !!(opts.osUsers || opts.linuxUser),
    });
    if (typeof ad.init === "function") {
      await ad.init(opts || {});
    }
    console.log("[yoke] Lazy adapter created: " + vendor);
    adapters[vendor] = ad;
    return ad;
  } catch (e) {
    console.error("[yoke] Failed to lazy-create adapter for " + vendor + ":", e.message);
    return null;
  }
}

module.exports = {
  createAdapter: createAdapter,
  createAdapters: createAdapters,
  resolveDefaultVendor: resolveDefaultVendor,
  DEFAULT_VENDOR_ORDER: DEFAULT_VENDOR_ORDER,
  lazyCreateAdapter: lazyCreateAdapter,
  checkAuth: checkAuth,
  checkInstalled: checkInstalled,
  invalidateAuthCache: invalidateAuthCache,
  VENDOR_REGISTRY: vendorRegistry.VENDOR_REGISTRY,
  getVendorInfo: vendorRegistry.getVendorInfo,
  clampEffort: vendorRegistry.clampEffort,
  TOOL_POLICIES: iface.TOOL_POLICIES,
  validateAdapter: iface.validateAdapter,
  validateQueryHandle: iface.validateQueryHandle,
  completeOnce: completeOnce,
  userInput: userInput,
  sessionTools: sessionTools,
};
