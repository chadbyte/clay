// claude-hook-installer.js
//
// Registers Clay's notification webhook in `~/.claude/settings.json` so the
// `claude` CLI fires a request to the Clay daemon whenever it surfaces a
// Notification (permission requests, idle prompts, etc.). This is what makes
// TUI sessions feel like first-class Clay sessions: the user gets the same
// toasts and push notifications they would in GUI mode.
//
// Design notes:
//   - Settings merge is idempotent: existing hooks are preserved, ours are
//     identified by a marker substring so re-runs don't duplicate them.
//   - The hook command uses curl with --max-time / --connect-timeout so that
//     a downed daemon can't stall claude's UI for more than ~1s.
//   - Multi-user mode: caller passes one home directory per OS user; we
//     write each user's own settings.json so per-user filtering works.

var fs = require("fs");
var path = require("path");
var { buildClayBashAllowPatterns, isClayManagedBashPattern } = require("../safe-bash-commands");

// Substring that uniquely identifies a Clay-installed hook entry so we can
// safely remove/replace it without touching user-authored hooks.
var CLAY_HOOK_MARKER = "clay:tui-notify";

// Allow-patterns Clay manages in ~/.claude/settings.json `permissions.allow`.
// The Bash(...) patterns are GENERATED from safe-bash-commands.js so this
// list and sdk-bridge.js `checkToolWhitelist` can never drift - there is one
// source of truth for which bash commands Clay auto-approves.
//
// Pattern syntax note: claude 2.x uses the space-wildcard form `Bash(cmd *)`
// for prefix matching. The older colon form `Bash(cmd:*)` is flagged as
// legacy in the CLI and no longer reliably matches argument-bearing commands
// (the TUI kept prompting for read-only invocations like `ls -la`). The
// generator emits the modern form plus a bare `Bash(cmd)` for zero-arg use.
//
// User-authored entries are preserved -- on re-install we only strip patterns
// that are Clay-managed (current generated list or the legacy colon shape).
var CLAY_MANAGED_ALLOW = [
  // Read-only built-in tools (no side effects).
  "Read", "Glob", "Grep", "WebFetch", "WebSearch",

  // Clay's own MCP servers. Strictly read/safe by design.
  "mcp__clay-browser__browser_watch_tab",
  "mcp__clay-browser__browser_unwatch_tab",
  "mcp__clay-debate__propose_debate",
  "mcp__clay-mate-creation__propose_mate",
  "mcp__clay-history__*",
  "mcp__clay-workspace__read_current_context",
  "mcp__clay-workspace__read_selected_context",
  "mcp__clay-workspace__open_context_conversation",
  "mcp__clay-workspace__read_context_navigation_receipt",
  "mcp__clay-workspace__read_owner_screen",
  "mcp__clay-workspace__inspect_owner_screen_change",
  "mcp__clay-workspace__control_owner_screen",
  "mcp__clay-workspace__inspect_project_control",
  "mcp__clay-workspace__control_project_lifecycle",
  "mcp__clay-workspace__discover_product_controls",
  "mcp__clay-workspace__list_owned_mates",
  "mcp__clay-workspace__begin_schedule_control_interview",
  "mcp__clay-workspace__read_schedule_controls",
  "mcp__clay-workspace__inspect_schedule_change",
  "mcp__clay-workspace__control_schedules",
  "mcp__clay-workspace__read_mate_chat_control",
  "mcp__clay-workspace__inspect_mate_chat_change",
  "mcp__clay-workspace__control_mate_chat",
  "mcp__clay-workspace__read_project_workspace",
  "mcp__clay-workspace__read_workspace_receipt",
  "mcp__clay-workspace__inspect_workspace_change",
  "mcp__clay-workspace__control_project_workspace",
  "mcp__clay-workspace__read_vendor_usage",
  "mcp__clay-workspace__read_project_records",
  "mcp__clay-workspace__inspect_project_record_change",
  "mcp__clay-workspace__control_project_records",
  "mcp__clay-workspace__read_mate_knowledge_control",
  "mcp__clay-workspace__inspect_mate_knowledge_change",
  "mcp__clay-workspace__control_mate_knowledge",
  "mcp__clay-workspace__inspect_mate_control",
  "mcp__clay-workspace__control_mate_lifecycle",
  "mcp__clay-workspace__inspect_session_control",
  "mcp__clay-workspace__control_project_session",
  "mcp__clay-workspace__list_projects",
  "mcp__clay-workspace__list_project_sessions",
  "mcp__clay-workspace__search_project_history",
  "mcp__clay-workspace__read_project_session",
  "mcp__clay-workspace__search_workspace_history",
  "mcp__clay-workspace__list_workspace_activity",
  "mcp__clay-workspace__propose_project_assignment",
  "mcp__clay-workspace__propose_project_follow_up",
  "mcp__clay-workspace__get_assignment_status",
  "mcp__clay-tools__clay_tool_list",
  "mcp__clay-tools__clay_tool_snapshot",
  "mcp__clay-tools__clay_tool_act",
  "mcp__clay-tools__clay_tool_set",
  "mcp__clay-tools__clay_tool_source",
  // Email: read-side only. Send / reply / mark_read still prompt.
  "mcp__clay-email__clay_read_email",
  "mcp__clay-email__clay_read_email_body",
  "mcp__clay-email__clay_search_email",
  "mcp__clay-email__clay_list_labels",
].concat(buildClayBashAllowPatterns());

function buildHookCommand(notifyUrl) {
  // Read stdin once (the JSON Claude Code pipes in), then post it. --max-time
  // and --connect-timeout cap total hook latency around ~1s even if the
  // daemon is down. --insecure (-k) is needed because Clay's optional TLS
  // mode uses a locally generated CA that curl won't trust by default;
  // safe to skip verification since we're going to 127.0.0.1. Output is
  // silenced so it doesn't leak into the TUI. The marker comment keeps the
  // entry recognizable when we re-merge.
  var insecure = notifyUrl.indexOf("https://") === 0 ? " --insecure" : "";
  return "curl --silent --show-error --max-time 1 --connect-timeout 1" + insecure +
    " -X POST -H 'Content-Type: application/json' --data-binary @- " +
    JSON.stringify(notifyUrl) + " > /dev/null 2>&1 # " + CLAY_HOOK_MARKER;
}

function readSettings(settingsPath) {
  try {
    var raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function writeSettings(settingsPath, data) {
  var dir = path.dirname(settingsPath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + "\n");
}

// Merge our Notification hook into the user's settings.json without
// clobbering anything else. Returns true if the file changed.
function mergeHook(settingsPath, command) {
  var data = readSettings(settingsPath);
  if (!data.hooks || typeof data.hooks !== "object") data.hooks = {};
  if (!Array.isArray(data.hooks.Notification)) data.hooks.Notification = [];

  // Strip any prior Clay entries before inserting the fresh one so port /
  // URL changes propagate cleanly.
  var before = JSON.stringify(data.hooks.Notification);
  var cleaned = [];
  for (var i = 0; i < data.hooks.Notification.length; i++) {
    var group = data.hooks.Notification[i];
    if (!group || !Array.isArray(group.hooks)) { cleaned.push(group); continue; }
    var filtered = group.hooks.filter(function (h) {
      return !(h && typeof h.command === "string" && h.command.indexOf(CLAY_HOOK_MARKER) !== -1);
    });
    if (filtered.length > 0) cleaned.push({ matcher: group.matcher || "", hooks: filtered });
    else if (group.matcher) cleaned.push(group);
  }
  data.hooks.Notification = cleaned;

  data.hooks.Notification.push({
    matcher: "",
    hooks: [{ type: "command", command: command }],
  });

  var after = JSON.stringify(data.hooks.Notification);
  if (before === after) return false;
  writeSettings(settingsPath, data);
  return true;
}

/**
 * Install (or refresh) the Notification hook in one or more user home dirs.
 *
 * opts:
 *   notifyUrl  -- full URL Clay listens on, e.g. "http://127.0.0.1:2633/api/tui-notify".
 *   homeDirs   -- array of absolute paths to user home directories. Each one
 *                 gets its own settings.json updated. Defaults to [os.homedir()].
 *
 * Returns { installed: [paths], errors: [{path, error}] } so the caller can log.
 */
function installNotificationHook(opts) {
  opts = opts || {};
  var os = require("os");
  var homes = opts.homeDirs && opts.homeDirs.length ? opts.homeDirs : [os.homedir()];
  var notifyUrl = opts.notifyUrl;
  if (!notifyUrl) throw new Error("installNotificationHook: notifyUrl is required");

  var command = buildHookCommand(notifyUrl);
  var installed = [];
  var errors = [];
  for (var i = 0; i < homes.length; i++) {
    var home = homes[i];
    if (!home) continue;
    var settingsPath = path.join(home, ".claude", "settings.json");
    try {
      var changed = mergeHook(settingsPath, command);
      if (changed) installed.push(settingsPath);
    } catch (e) {
      errors.push({ path: settingsPath, error: e && e.message ? e.message : String(e) });
    }
  }
  return { installed: installed, errors: errors };
}

// Old colon-prefix Bash patterns Clay wrote before claude 2.x: Bash(ls:*),
// Bash(git status:*), etc. Stripped on upgrade so they don't linger next to
// the modern space-wildcard form. Modern Clay patterns never contain ":)" so
// this only catches the deprecated shape; it can't tell a user-authored colon
// pattern apart, but claude is phasing the colon form out anyway.
function isLegacyClayPattern(p) {
  if (typeof p !== "string") return false;
  if (p.indexOf("Bash(") === 0 && p.indexOf(":*)") !== -1) return true;
  return false;
}

// Merge Clay's managed allow-list into permissions.allow without disturbing
// the user's own entries. "Ours" = exact membership in CLAY_MANAGED_ALLOW
// (the non-Bash built-in / MCP entries) OR isClayManagedBashPattern (any
// shape of a bash command we own, so stale variants from older versions get
// swept) OR the legacy colon shape. Everything else is preserved, then the
// fresh list is appended. Because the Bash patterns are generated from
// safe-bash-commands.js, a re-install always writes the current set and can
// never leave a stale Clay block behind.
function mergeAllowList(settingsPath, patterns) {
  var data = readSettings(settingsPath);
  if (!data.permissions || typeof data.permissions !== "object") data.permissions = {};
  var allow = Array.isArray(data.permissions.allow) ? data.permissions.allow : [];

  var managedSet = {};
  for (var i = 0; i < CLAY_MANAGED_ALLOW.length; i++) managedSet[CLAY_MANAGED_ALLOW[i]] = true;

  var preserved = allow.filter(function (p) {
    if (managedSet[p]) return false;
    if (isClayManagedBashPattern(p)) return false;
    if (isLegacyClayPattern(p)) return false;
    return true;
  });
  var next = preserved.concat(patterns);

  var before = JSON.stringify(allow);
  var after = JSON.stringify(next);
  if (before === after) return false;

  data.permissions.allow = next;
  writeSettings(settingsPath, data);
  return true;
}

/**
 * Install (or refresh) Clay's auto-approve patterns into permissions.allow
 * for one or more user home dirs. Mirrors installNotificationHook's API.
 */
function installAllowList(opts) {
  opts = opts || {};
  var os = require("os");
  var homes = opts.homeDirs && opts.homeDirs.length ? opts.homeDirs : [os.homedir()];
  var patterns = (opts.patterns && opts.patterns.length) ? opts.patterns : CLAY_MANAGED_ALLOW;
  var installed = [];
  var errors = [];
  for (var i = 0; i < homes.length; i++) {
    var home = homes[i];
    if (!home) continue;
    var settingsPath = path.join(home, ".claude", "settings.json");
    try {
      var changed = mergeAllowList(settingsPath, patterns);
      if (changed) installed.push(settingsPath);
    } catch (e) {
      errors.push({ path: settingsPath, error: e && e.message ? e.message : String(e) });
    }
  }
  return { installed: installed, errors: errors };
}

module.exports = {
  installNotificationHook: installNotificationHook,
  installAllowList: installAllowList,
  CLAY_HOOK_MARKER: CLAY_HOOK_MARKER,
  CLAY_MANAGED_ALLOW: CLAY_MANAGED_ALLOW,
};
