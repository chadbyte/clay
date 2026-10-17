var z;
try { z = require("zod"); } catch (e) { z = null; }

function field(type, description, optional) {
  if (!z) return {};
  var value = type === "number" ? z.number() : z.string();
  if (description) value = value.describe(description);
  return optional ? value.optional() : value;
}

function shape(fields) {
  if (!z) return {};
  return fields;
}

function textResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function errorResult(error) {
  return Promise.resolve({
    content: [{ type: "text", text: "Error: " + (error && error.message ? error.message : String(error)) }],
    isError: true,
  });
}

function handler(bound, method) {
  return function (args) {
    if (!bound || typeof bound[method] !== "function") return errorResult(new Error("Workspace tools require an exact session-bound Mate query."));
    try { return textResult(bound[method](args || {})); }
    catch (e) { return errorResult(e); }
  };
}

var SESSION_CITATION = " Cite returned sessions as Markdown links: [short human label](session:OPAQUE_REFERENCE), replacing the entire target with the exact returned sessionRef. Do not prepend a project name, change the opaque reference, or wrap citations in backticks/code. For a specific returned entry, append #entry-<entryIndex> using its exact returned entry index. Legacy [clayos/<sessionRef> — short label] remains supported. Labels are presentation only; Clay Studio resolves the exact reference with the authenticated owner's permissions.";

function commonTools(bound) {
  return [
    {
      name: "list_projects",
      description: "List projects owned by the current user. Returns sanitized summaries only; use a project-specific tool to inspect sessions or history.",
      inputSchema: shape({
        query: field("string", "Optional project title or slug filter.", true),
        cursor: field("string", "Opaque pagination cursor from a previous response.", true),
        limit: field("number", "Page size, from 1 to 50.", true),
      }),
      handler: handler(bound, "listProjects"),
    },
    {
      name: "list_project_sessions",
      description: "List sanitized session summaries for one owned project, newest activity first." + SESSION_CITATION,
      inputSchema: shape({
        projectSlug: field("string", "Exact project slug."),
        cursor: field("string", "Opaque pagination cursor from a previous response.", true),
        limit: field("number", "Page size, from 1 to 50.", true),
      }),
      handler: handler(bound, "listProjectSessions"),
    },
    {
      name: "search_project_history",
      description: "Search canonical user and assistant text in one owned project. Tool inputs, tool results, hidden prompts, and internal paths are excluded." + SESSION_CITATION,
      inputSchema: shape({
        projectSlug: field("string", "Exact project slug."),
        query: field("string", "Search query."),
        cursor: field("string", "Opaque pagination cursor from a previous response.", true),
        limit: field("number", "Page size, from 1 to 50.", true),
      }),
      handler: handler(bound, "searchProjectHistory"),
    },
    {
      name: "read_project_session",
      description: "Read a bounded page of canonical user and assistant turns from one owned session using the opaque session reference returned by list or search." + SESSION_CITATION,
      inputSchema: shape({
        projectSlug: field("string", "Exact project slug."),
        sessionRef: field("string", "Opaque session reference returned by a workspace list or search tool."),
        cursor: field("string", "Opaque pagination cursor from a previous response.", true),
        limit: field("number", "Page size, from 1 to 50.", true),
      }),
      handler: handler(bound, "readProjectSession"),
    },
    {
      name: "propose_project_assignment",
      description: "Propose a new delegated session in an owned project. This posts a user-visible approval card and performs no target work until explicit approval.",
      inputSchema: shape({
        projectSlug: field("string", "Exact owned target project slug."),
        title: field("string", "Short delegated session title."),
        task: field("string", "Standalone bounded task without hidden source transcript."),
      }),
      handler: handler(bound, "proposeProjectAssignment"),
    },
    {
      name: "propose_project_follow_up",
      description: "Propose a bounded follow-up in an existing durable private session. This posts a user-visible approval card and performs no target work until explicit approval.",
      inputSchema: shape({
        projectSlug: field("string", "Exact owned target project slug."),
        targetSessionRef: field("string", "Durable opaque session reference returned by list_project_sessions."),
        title: field("string", "Short follow-up title."),
        task: field("string", "Standalone bounded follow-up without hidden source transcript."),
      }),
      handler: handler(bound, "proposeProjectFollowUp"),
    },
    {
      name: "get_assignment_status",
      description: "Read a new-session or follow-up assignment status for this exact Mate conversation.",
      inputSchema: shape({ assignmentId: field("string", "Assignment ID returned by propose_project_assignment.") }),
      handler: handler(bound, "getAssignmentStatus"),
    },
  ];
}

function globalTools(bound) {
  return [
    {
      name: "search_workspace_history",
      description: "Search canonical user and assistant text across every project owned by the current user. Available only to authoritative builtin Clay." + SESSION_CITATION,
      inputSchema: shape({
        query: field("string", "Search query."),
        cursor: field("string", "Opaque pagination cursor from a previous response.", true),
        limit: field("number", "Page size, from 1 to 50.", true),
      }),
      handler: handler(bound, "searchWorkspaceHistory"),
    },
    {
      name: "list_workspace_activity",
      description: "List recent session activity across every project owned by the current user. Available only to authoritative builtin Clay." + SESSION_CITATION,
      inputSchema: shape({
        status: field("string", "Optional status: idle, processing, or waiting_for_approval.", true),
        cursor: field("string", "Opaque pagination cursor from a previous response.", true),
        limit: field("number", "Page size, from 1 to 50.", true),
      }),
      handler: handler(bound, "listWorkspaceActivity"),
    },
  ];
}

function getToolDefs(bound, includeGlobal) {
  var tools = commonTools(bound);
  if (includeGlobal === true) tools = tools.concat(globalTools(bound));
  return tools;
}

function createMcpServer(adapter, bound, includeGlobal) {
  if (!adapter || typeof adapter.createToolServer !== "function") return null;
  return adapter.createToolServer({
    name: "clay-workspace",
    version: "1.0.0",
    tools: getToolDefs(bound, includeGlobal),
  });
}

module.exports = {
  createMcpServer: createMcpServer,
  getToolDefs: getToolDefs,
};
