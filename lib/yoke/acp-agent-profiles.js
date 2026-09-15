// ACP Agent Drivers
// -----------------
// Vendor-specific facts and optional hooks for agents that implement ACP.
// Static profiles are sufficient for standard agents; richer runtimes can add
// hooks without forcing YOKE down to ACP's least-common-denominator feature set.

var fs = require("fs");
var execFile = require("child_process").execFile;
var execFileSync = require("child_process").execFileSync;

function findOnPath(binaryName, overrideName) {
  var overridePath = overrideName && process.env[overrideName];
  if (overridePath && fs.existsSync(overridePath)) return overridePath;
  try {
    var command = process.platform === "win32" ? "where" : "which";
    var out = execFileSync(command, [binaryName], {
      timeout: 3000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out.trim().split(/\r?\n/)[0] || null;
  } catch (e) {
    return null;
  }
}

function fetchOpenCodeModels(binaryPath, cwd) {
  return new Promise(function(resolve) {
    execFile(binaryPath, ["models"], {
      cwd: cwd || process.cwd(),
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
    }, function(err, stdout) {
      if (err || !stdout) { resolve([]); return; }
      var seen = {};
      var models = [];
      var lines = String(stdout).split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var value = lines[i].trim();
        if (!value || seen[value]) continue;
        seen[value] = true;
        models.push(value);
      }
      resolve(models);
    });
  });
}

function fetchOpenCodeResolvedConfig(binaryPath, cwd, env) {
  return new Promise(function(resolve, reject) {
    execFile(binaryPath, ["debug", "config"], {
      cwd: cwd || process.cwd(),
      env: Object.assign({}, process.env, env || {}),
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    }, function(err, stdout) {
      if (err) { reject(err); return; }
      try {
        resolve(JSON.parse(String(stdout || "{}")));
      } catch (e) {
        reject(new Error("OpenCode returned invalid resolved configuration"));
      }
    });
  });
}

function fetchOpenCodeAgentNames(binaryPath, cwd, env) {
  return fetchOpenCodeResolvedConfig(binaryPath, cwd, env).then(function(config) {
    return Object.keys(config.agent || {});
  });
}

function isSafeOpenCodePermission(value) {
  if (value === "ask" || value === "deny") return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  var keys = Object.keys(value);
  if (!keys.length) return false;
  for (var i = 0; i < keys.length; i++) {
    if (!isSafeOpenCodePermission(value[keys[i]])) return false;
  }
  return true;
}

function validateOpenCodeConfig(config) {
  if (!config || !isSafeOpenCodePermission(config.permission)) {
    throw new Error("OpenCode resolved configuration does not preserve global ask permissions");
  }
  var agents = config.agent || {};
  var names = Object.keys(agents);
  for (var i = 0; i < names.length; i++) {
    var agent = agents[names[i]] || {};
    if (agent.permission === undefined) continue;
    if (!isSafeOpenCodePermission(agent.permission)) {
      throw new Error("OpenCode agent has unsafe resolved permissions: " + names[i]);
    }
  }
}

function trustDefaultWhenModeIsNotExposed(ctx, next) {
  var options = ctx.state && ctx.state.configOptions;
  for (var i = 0; i < (options || []).length; i++) {
    if (options[i].category === "mode" || options[i].id === "mode") return next();
  }
  if (ctx.state && ctx.state.modes) return next();
  return Promise.resolve();
}

var ACP_AGENT_PROFILES = {
  opencode: {
    vendor: "opencode",
    displayName: "OpenCode",
    binaryName: "opencode",
    overrideName: "OPENCODE_CLI_PATH",
    args: ["acp"],
    defaultModels: ["auto"],
    defaultModel: "auto",
    sessionResume: null,
    fetchModels: fetchOpenCodeModels,
    permissionModeGuaranteed: true,
    prepare: function(ctx) {
      var injected = ctx.initOpts && ctx.initOpts._openCodeAgentNames;
      if (Array.isArray(injected)) {
        ctx.driverState.agentNames = injected.slice();
        return;
      }
      return fetchOpenCodeAgentNames(ctx.binaryPath, ctx.cwd, ctx.initOpts && ctx.initOpts.env).then(function(names) {
        ctx.driverState.agentNames = names;
      });
    },
    buildProcessOptions: function(ctx, base) {
      var existing = (base.env && base.env.OPENCODE_CONFIG_CONTENT) || process.env.OPENCODE_CONFIG_CONTENT;
      var config = {};
      if (existing) config = JSON.parse(existing);
      var agent = Object.assign({}, config.agent || {});
      var names = ["build", "plan"].concat(ctx.driverState.agentNames || []);
      for (var i = 0; i < names.length; i++) {
        agent[names[i]] = Object.assign({}, agent[names[i]] || {}, { permission: "ask" });
      }
      base.env = Object.assign({}, base.env || {}, {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(Object.assign({}, config, { permission: "ask", agent: agent })),
      });
      return base;
    },
    validateProcessOptions: function(ctx) {
      var injected = ctx.initOpts && ctx.initOpts._openCodeResolvedConfig;
      var resolved = injected
        ? Promise.resolve(injected)
        : fetchOpenCodeResolvedConfig(ctx.binaryPath, ctx.cwd, ctx.processOptions.env);
      return resolved.then(function(config) {
        validateOpenCodeConfig(config);
      });
    },
    ensureSafePermissionMode: function() {
      // OpenCode ACP modes select agents, not approval policy. The process
      // configuration above enforces ask at both global and effective-agent levels.
      return Promise.resolve();
    },
  },
  kimi: {
    vendor: "kimi",
    displayName: "Kimi Code",
    binaryName: "kimi",
    overrideName: "KIMI_CLI_PATH",
    args: ["acp"],
    defaultModels: ["auto"],
    defaultModel: "auto",
    sessionResume: null,
    ensureSafePermissionMode: trustDefaultWhenModeIsNotExposed,
  },
  grok: {
    vendor: "grok",
    displayName: "Grok Build",
    binaryName: "grok",
    overrideName: "GROK_CLI_PATH",
    args: ["--no-auto-update", "--permission-mode", "ask", "agent", "stdio"],
    defaultModels: ["auto"],
    defaultModel: "auto",
    sessionResume: null,
    permissionModeGuaranteed: true,
  },
  copilot: {
    vendor: "copilot",
    displayName: "GitHub Copilot CLI",
    binaryName: "copilot",
    overrideName: "COPILOT_CLI_PATH",
    args: ["--acp"],
    defaultModels: ["auto"],
    defaultModel: "auto",
    sessionResume: null,
    ensureSafePermissionMode: trustDefaultWhenModeIsNotExposed,
  },
  qwen: {
    vendor: "qwen",
    displayName: "Qwen Code",
    binaryName: "qwen",
    overrideName: "QWEN_CLI_PATH",
    args: ["--acp", "--approval-mode", "default"],
    defaultModels: ["auto"],
    defaultModel: "auto",
    sessionResume: null,
    permissionModeGuaranteed: true,
  },
  junie: {
    vendor: "junie",
    displayName: "Junie CLI",
    binaryName: "junie",
    overrideName: "JUNIE_CLI_PATH",
    args: ["--acp", "true"],
    defaultModels: ["auto"],
    defaultModel: "auto",
    sessionResume: null,
    ensureSafePermissionMode: trustDefaultWhenModeIsNotExposed,
  },
};

function getAcpAgentProfile(vendor) {
  return ACP_AGENT_PROFILES[vendor] || null;
}

function getAcpAgentDriver(vendor) {
  return getAcpAgentProfile(vendor);
}

function findAcpAgentPath(profile) {
  if (!profile) return null;
  return findOnPath(profile.binaryName, profile.overrideName);
}

module.exports = {
  ACP_AGENT_PROFILES: ACP_AGENT_PROFILES,
  getAcpAgentProfile: getAcpAgentProfile,
  getAcpAgentDriver: getAcpAgentDriver,
  findAcpAgentPath: findAcpAgentPath,
  fetchOpenCodeModels: fetchOpenCodeModels,
  fetchOpenCodeAgentNames: fetchOpenCodeAgentNames,
  fetchOpenCodeResolvedConfig: fetchOpenCodeResolvedConfig,
  validateOpenCodeConfig: validateOpenCodeConfig,
};
