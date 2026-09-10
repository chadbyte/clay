// Session Spawn MCP Server for Clay
// Provides SDK-free tool definitions for agent-driven session fan-out.

var z;
try { z = require("zod"); } catch (e) { z = null; }

function buildShape(props, required) {
  if (!z) return {};
  var shape = {};
  var keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var prop = props[key];
    var field;
    if (prop.schema) field = prop.schema;
    else if (prop.type === "number") field = z.number();
    else if (prop.type === "boolean") field = z.boolean();
    else if (prop.enum) field = z.enum(prop.enum);
    else field = z.string();
    if (prop.description) field = field.describe(prop.description);
    if (!required || required.indexOf(key) === -1) field = field.optional();
    shape[key] = field;
  }
  return shape;
}

function getToolDefs(handlers) {
  return [
    {
      name: "spawn_sessions",
      description: "Create ordinary sibling work sessions for background parallel work. This does not create a visible Driver/Split Worker pair and must not be used when the user asks for a Worker, paired pane, or split collaborator; use send_to_partner for that. Set forkFromCurrent to copy this session's full conversation context into every child. Children share the project's working directory, so prefer parallel analysis or other non-conflicting work over concurrent edits. Results can be polled with check_spawned_sessions; spawned children cannot spawn further sessions.",
      inputSchema: buildShape({
        sessions: { type: "string", description: "JSON array of objects: [{\"title\":\"Task title\",\"prompt\":\"Task instructions\"}]" },
        vendor: { type: "string", description: "Optional vendor id. Defaults to the parent session vendor, then the project default." },
        forkFromCurrent: { type: "boolean", description: "Children start with a copy of this session's full conversation context. Defaults to false." },
      }, ["sessions"]),
      handler: function (args) {
        return handlers.spawn(args || {});
      },
    },
    {
      name: "check_spawned_sessions",
      description: "Check the status of sessions spawned by this session. By default only direct children of the calling session are returned.",
      inputSchema: buildShape({
        parentOnly: { type: "boolean", description: "When false, return all spawned sessions in this project. Defaults to true." },
      }),
      handler: function (args) {
        return handlers.check(args || {});
      },
    },
  ];
}

module.exports = {
  buildShape: buildShape,
  getToolDefs: getToolDefs,
};
