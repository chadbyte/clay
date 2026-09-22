// Session-bound access to the source of a Clay session handoff.

var buildShape = require("./session-spawn-mcp-server").buildShape;

var TOOL_DESCRIPTION =
  "This session was continued from another agent's session via a context snapshot. " +
  "That snapshot omitted tool calls and older turns. Read the original Clay session record directly, including user messages, assistant text, and summarized tool calls, regardless of which vendor produced it.";
var BUDGET_DESCRIPTION =
  " Responses are capped at 15,000 serialized characters, 32,000 serialized characters and 8 calls per query. " +
  "After exhaustion, calls return one constant refusal; repeated refusals are outside the aggregate cap, so callers must stop.";

function getToolDefs(handlers) {
  var tools = [];
  if (handlers.read) tools.push(
    {
      name: "read_handoff_source",
      description: TOOL_DESCRIPTION + BUDGET_DESCRIPTION,
      inputSchema: buildShape({
        offset: {
          type: "number",
          description: "Skip the first N history entries. Omit to return the last limit entries.",
        },
        limit: {
          type: "number",
          description: "Maximum history entries to return. Defaults to 30 and is capped at 100.",
        },
        sourceSessionId: {
          type: "string",
          description: "Source session in this session's handoff chain. Omit to read the immediate source.",
        },
      }),
      handler: function (args) { return handlers.read(args || {}); },
    }
  );
  if (handlers.listOtherDrivers) tools.push({
    name: "list_other_driver_sessions",
    description: "List bounded metadata for other visible Driver sessions in this project. Shared-session access is checked at call time; cross-project discovery is unavailable." + BUDGET_DESCRIPTION,
    inputSchema: buildShape({ limit: { type: "number", description: "Ignored beyond the server cap of 20." } }),
    handler: function (args) { return handlers.listOtherDrivers(args || {}); },
  });
  if (handlers.searchOtherDrivers) tools.push({
    name: "search_other_driver_sessions",
    description: "Search user and assistant text in other visible Driver sessions in this project, returning bounded excerpts with session, entry, and date citations. Cross-project search is unavailable." + BUDGET_DESCRIPTION,
    inputSchema: buildShape({ query: { type: "string", description: "Keyword to search." } }),
    handler: function (args) { return handlers.searchOtherDrivers(args || {}); },
  });
  if (handlers.readOtherDriver) tools.push({
    name: "read_other_driver_session",
    description: "Read a bounded history window from one visible other Driver session by opaque session reference. Already returned entries are skipped without dropping unseen entries from the requested window. Cross-project reads are unavailable." + BUDGET_DESCRIPTION,
    inputSchema: buildShape({
      sessionRef: { type: "string", description: "Opaque session reference from discovery or search." },
      entryIndex: { type: "number", description: "Center a window near this cited history entry." },
      offset: { type: "number", description: "Start the window at this history entry when entryIndex is omitted." },
      limit: { type: "number", description: "History positions in the window. Defaults to 5 and is capped at 20." },
    }),
    handler: function (args) { return handlers.readOtherDriver(args || {}); },
  });
  return tools;
}

module.exports = {
  TOOL_DESCRIPTION: TOOL_DESCRIPTION,
  getToolDefs: getToolDefs,
};
