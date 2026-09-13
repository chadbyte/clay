// Shared production transport facts for query-bound Clay tools.

var vendorRegistry = require("./vendor-registry");
var CODEX_CATALOG_VERSION = 5;
var SCHEDULE_TOOLS = ["begin_scheduled_task_interview", "propose_scheduled_task", "list_scheduled_tasks", "read_scheduled_task", "update_scheduled_task", "report_scheduled_task_outcome"];

function capability(vendor) {
  if (vendor === "claude") return { supported: true, kind: "sdk-mcp" };
  if (vendor === "codex") return { supported: true, kind: "dynamic" };
  var info = vendorRegistry.getVendorInfo(vendor);
  if (info && info.sessionBoundTools === true) return { supported: true, kind: "stdio-mcp" };
  return { supported: false, kind: "none" };
}

function availableForSession(session) {
  var vendor = session && (session.vendor || "claude");
  var transport = capability(vendor);
  if (!transport.supported) return { available: false, reason: "This provider's current Clay adapter does not deliver custom session tools." };
  if (vendor === "codex" && session.cliSessionId && Number(session.codexDynamicToolCatalogVersion || 0) < CODEX_CATALOG_VERSION) {
    return { available: false, reason: "This Codex conversation predates Clay's scheduled-task tool catalog. Start a new conversation to use the assisted interview; manual task creation remains available here." };
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
  if (SCHEDULE_TOOLS.indexOf(name) !== -1) return "clay-scheduled-tasks";
  return null;
}

module.exports = {
  capability: capability,
  availableForSession: availableForSession,
  CODEX_CATALOG_VERSION: CODEX_CATALOG_VERSION,
  scheduleToolName: scheduleToolName,
  questionToolName: questionToolName,
  bridgeServerForTool: bridgeServerForTool,
  SCHEDULE_TOOLS: SCHEDULE_TOOLS,
};
