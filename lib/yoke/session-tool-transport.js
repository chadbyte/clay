// Shared production transport facts for query-bound Clay tools.

var vendorRegistry = require("./vendor-registry");
var SCHEDULE_CATALOG_VERSION = 5;
var MATE_SCHEDULE_TOOLS = ["begin_mate_schedule_interview", "propose_mate_schedule", "list_mate_schedules", "read_mate_schedule", "update_mate_schedule", "cancel_mate_schedule"];
var SCHEDULE_TOOLS = ["begin_scheduled_task_interview", "propose_scheduled_task", "list_scheduled_tasks", "read_scheduled_task", "update_scheduled_task", "report_scheduled_task_outcome"];

// Accept an adapter as well as a registry key. Live adapters can implement the
// same semantics independently of their name; unknown providers fail closed.
function contract(provider) {
  if (provider && typeof provider === "object" && provider.queryContract) return provider.queryContract;
  var info = vendorRegistry.getVendorInfo(typeof provider === "string" ? provider : provider && provider.vendor);
  if (info && info.queryContract) return info.queryContract;
  return info && info.sessionBoundTools === true ? { toolTransport: "stdio-mcp", catalogLifetime: "query" } : {};
}

function capability(provider) {
  var kind = contract(provider).toolTransport || "none";
  if (["sdk-mcp", "dynamic", "stdio-mcp"].indexOf(kind) === -1) kind = "none";
  return { supported: kind !== "none", kind: kind };
}

function needsRecovery(provider, session, family, version) {
  var policy = contract(provider);
  if (!session.cliSessionId || policy.catalogLifetime !== "conversation") return false;
  if (!family) return true;
  if (typeof policy.catalogVersion !== "function") return true;
  var recorded = policy.catalogVersion(session, family);
  return !Number.isFinite(recorded) || recorded < version;
}

function availableForSession(session) {
  var provider = session && (session.vendor || "claude");
  if (!capability(provider).supported) return { available: false, reason: "This provider's current Clay adapter does not deliver custom session tools." };
  if (needsRecovery(provider, session, "schedules", SCHEDULE_CATALOG_VERSION)) {
    return { available: false, reason: contract(provider).staleCatalogReason || "This conversation's persisted tool catalog is outdated. Start a new conversation to use the assisted interview." };
  }
  return { available: true, reason: null };
}

function scheduleToolName(vendor, name) {
  var kind = capability(vendor).kind;
  if (kind === "sdk-mcp") return "mcp__clay-scheduled-tasks__" + name;
  if (kind === "stdio-mcp") return "clay-scheduled-tasks__" + name;
  return name;
}

function questionToolName(vendor) {
  var kind = capability(vendor).kind;
  if (kind === "sdk-mcp") return "mcp__yoke-user-input__ask_user_questions";
  if (kind === "stdio-mcp") return "yoke-user-input__ask_user_questions";
  return "ask_user_questions";
}

function bridgeServerForTool(name) {
  if (name === "ask_user_questions") return "yoke-user-input";
  if (MATE_SCHEDULE_TOOLS.indexOf(name) !== -1) return "clay-mate-schedules";
  if (SCHEDULE_TOOLS.indexOf(name) !== -1) return "clay-scheduled-tasks";
  return null;
}

module.exports = {
  contract: contract,
  needsRecovery: needsRecovery,
  capability: capability,
  availableForSession: availableForSession,
  SCHEDULE_CATALOG_VERSION: SCHEDULE_CATALOG_VERSION,
  CODEX_CATALOG_VERSION: SCHEDULE_CATALOG_VERSION, // Legacy export for existing consumers.
  scheduleToolName: scheduleToolName,
  questionToolName: questionToolName,
  bridgeServerForTool: bridgeServerForTool,
  SCHEDULE_TOOLS: SCHEDULE_TOOLS,
  MATE_SCHEDULE_TOOLS: MATE_SCHEDULE_TOOLS,
};
