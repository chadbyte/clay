// SDK-free `clay-knowledge` MCP tool definitions for Mate Knowledge.
//
// Two disjoint tool sets. An ordinary Mate gets tools with no mateId, owner, or
// scope argument at all, because the binding decides the scope and a tool
// argument must never be able to widen it or reveal that other Mates exist.
// Authoritative builtin Clay gets same-user cross-Mate read tools that may name
// a mateId for list and search, while read resolves an opaque reference inside
// the authorized user's Mate scopes only.

var buildShape = require("./session-spawn-mcp-server").buildShape;
var service = require("./mate-knowledge-service");

var MATE_CONTRACT =
  "Your Knowledge is the durable personal and expertise context you own: what you have learned, the material you keep, and your accumulated observations. " +
  "It is yours alone. There are no other Knowledge collections available to you here, and project Logs are a separate, unrelated surface. " +
  "Search it when recalling something specific would genuinely change your answer, and read only the records you actually need. " +
  "Do not enumerate or restate your Knowledge to the user unasked, and never reproduce whole records as filler.";

var CLAY_CONTRACT =
  "You may read the Knowledge of Mates belonging to the current user in order to coordinate between them, and only for that user. " +
  "Use it to find who holds relevant expertise or context, and to answer with that context attributed to the Mate that owns it. " +
  "Search first, read narrowly, and cite the owning Mate. Never reproduce a Mate's Knowledge wholesale, and never present it as your own.";

var REF_DESCRIPTION = "Opaque knowledge reference returned by a list or search tool.";
var PAGE_DESCRIPTION = "Page size, from 1 to " + service.MAX_PAGE + ".";
var CURSOR_DESCRIPTION = "Opaque pagination cursor from a previous response.";
var OFFSET_DESCRIPTION = "Character offset to start from. Omit for the beginning; pass the previous response's nextOffset to continue.";
var MAX_CHARS_DESCRIPTION = "Characters to return, from 1 to " + service.MAX_READ_CHARS + ". Defaults to " + service.DEFAULT_READ_CHARS + ".";
var READ_RESULT = " The whole record is reassembled and verified before any slice is returned. The response carries offset, totalChars, nextOffset, and complete; when nextOffset is not null, call again with it to continue.";

function textResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function errorResult(error) {
  return Promise.resolve({
    content: [{ type: "text", text: "Error: " + (error && error.message ? error.message : String(error)) }],
    isError: true,
  });
}

// An unbound descriptor exists only so a tool list can be advertised before a
// session is known. Every call against it fails closed.
function handler(bound, method) {
  return function (args) {
    if (!bound || typeof bound[method] !== "function") {
      return errorResult(new Error("Knowledge tools require an exact session-bound Mate."));
    }
    try { return Promise.resolve(bound[method](args || {})).then(textResult, errorResult); } catch (e) { return errorResult(e); }
  };
}

var ID = { type: "string", description: "Stable opaque id returned by a Knowledge database tool." };
var REVISION = { type: "number", description: "Revision returned by the most recent read or mutation; stale revisions are rejected." };
var OPERATION = { type: "string", description: "Stable retry id formatted label_<current epoch milliseconds>_<unique suffix>. Reuse the exact id and payload after an uncertain response; receipts are retained for the documented 24-hour retry window." };
var FIELD = { type: "object", description: "Field with stable id, name, type, required, and type-specific options or reference target." };
var FILTER = { type: "object", description: "Validated filter: fieldId, op, and value. Supported ops are eq, neq, contains, gt, gte, lt, lte, empty, not-empty." };
var SORT = { type: "object", description: "Validated sort with fieldId and asc or desc direction." };

function databaseTools(bound) {
  return [
    { name: "list_databases", description: "List canonical Knowledge databases, including archived databases when requested, so the Mate can discover and recover them without relying on summary projection.", inputSchema: buildShape({ archived: { type: "boolean" } }, []), handler: handler(bound, "listDatabases") },
    { name: "create_database", description: "Create a first-class database in this Mate's Knowledge. Defaults to one required title field and a Table view.", inputSchema: buildShape({ name: { type: "string" }, schema: { type: "array", items: FIELD }, operationId: OPERATION }, ["name", "operationId"]), handler: handler(bound, "createDatabase") },
    { name: "read_database", description: "Read one Knowledge database's current schema, views, revision, and record count.", inputSchema: buildShape({ databaseId: ID, includeArchived: { type: "boolean" } }, ["databaseId"]), handler: handler(bound, "readDatabase") },
    { name: "rename_database", description: "Rename a Knowledge database with optimistic revision checking.", inputSchema: buildShape({ databaseId: ID, name: { type: "string" }, expectedRevision: REVISION, operationId: OPERATION }, ["databaseId", "name", "expectedRevision", "operationId"]), handler: handler(bound, "renameDatabase") },
    { name: "archive_database", description: "Recoverably archive a Knowledge database.", inputSchema: buildShape({ databaseId: ID, expectedRevision: REVISION, operationId: OPERATION }, ["databaseId", "expectedRevision", "operationId"]), handler: handler(bound, "archiveDatabase") },
    { name: "recover_database", description: "Recover an archived Knowledge database.", inputSchema: buildShape({ databaseId: ID, expectedRevision: REVISION, operationId: OPERATION }, ["databaseId", "expectedRevision", "operationId"]), handler: handler(bound, "recoverDatabase") },
    { name: "update_database_schema", description: "Replace the schema using stable field ids. Exactly one active title field is required; populated fields cannot be removed or change type and should be archived instead.", inputSchema: buildShape({ databaseId: ID, schema: { type: "array", items: FIELD }, expectedRevision: REVISION, operationId: OPERATION }, ["databaseId", "schema", "expectedRevision", "operationId"]), handler: handler(bound, "updateDatabaseSchema") },
    { name: "save_table_view", description: "Create or revise a persisted Table view with selected columns, validated filters, and deterministic sorts.", inputSchema: buildShape({ databaseId: ID, view: { type: "object", description: "View with stable id, name, columns, filters, and sorts." }, expectedRevision: REVISION, operationId: OPERATION }, ["databaseId", "view", "expectedRevision", "operationId"]), handler: handler(bound, "saveTableView") },
    { name: "query_database", description: "Query a bounded deterministic page of records using a saved view or explicit validated filters and sorts. Returns count and numeric sums.", inputSchema: buildShape({ databaseId: ID, viewId: ID, filters: { type: "array", items: FILTER }, sorts: { type: "array", items: SORT }, cursor: { type: "string" }, limit: { type: "number" }, archived: { type: "boolean" } }, ["databaseId"]), handler: handler(bound, "queryDatabase") },
    { name: "create_database_record", description: "Create a typed record. Values are keyed by stable field id; unknown fields and unsafe keys are rejected.", inputSchema: buildShape({ databaseId: ID, values: { type: "object" }, expectedDatabaseRevision: REVISION, operationId: OPERATION }, ["databaseId", "values", "expectedDatabaseRevision", "operationId"]), handler: handler(bound, "createDatabaseRecord") },
    { name: "read_database_record", description: "Read one record with its values, revision, attribution, archive state, and bounded history.", inputSchema: buildShape({ databaseId: ID, recordId: ID }, ["databaseId", "recordId"]), handler: handler(bound, "readDatabaseRecord") },
    { name: "update_database_record", description: "Update selected typed values using the record revision. Edits to other fields made since a prior save are not overwritten.", inputSchema: buildShape({ databaseId: ID, recordId: ID, values: { type: "object" }, expectedRevision: REVISION, operationId: OPERATION }, ["databaseId", "recordId", "values", "expectedRevision", "operationId"]), handler: handler(bound, "updateDatabaseRecord") },
    { name: "archive_database_record", description: "Recoverably archive one record using its current revision.", inputSchema: buildShape({ databaseId: ID, recordId: ID, expectedRevision: REVISION, operationId: OPERATION }, ["databaseId", "recordId", "expectedRevision", "operationId"]), handler: handler(bound, "archiveDatabaseRecord") },
    { name: "recover_database_record", description: "Recover one archived record using its current revision.", inputSchema: buildShape({ databaseId: ID, recordId: ID, expectedRevision: REVISION, operationId: OPERATION }, ["databaseId", "recordId", "expectedRevision", "operationId"]), handler: handler(bound, "recoverDatabaseRecord") },
    { name: "retry_database_sync", description: "Retry the shared append-only Knowledge summary projection after a canonical database mutation reported projectionPending.", inputSchema: buildShape({ databaseId: ID }, ["databaseId"]), handler: handler(bound, "retryDatabaseSync") },
  ].map(function (tool) { tool.description = MATE_CONTRACT + " " + tool.description; return tool; });
}

function mateTools(bound) {
  return [
    {
      name: "list_knowledge",
      description: MATE_CONTRACT + " List your own Knowledge records, most recently updated first. Returns summaries with a short preview, not full records.",
      inputSchema: buildShape({
        kind: { type: "string", description: "Optional record kind filter, such as knowledge-file, memory-summary, session-digest, or user-observation." },
        cursor: { type: "string", description: CURSOR_DESCRIPTION },
        limit: { type: "number", description: PAGE_DESCRIPTION },
      }),
      handler: handler(bound, "listKnowledge"),
    },
    {
      name: "search_knowledge",
      description: MATE_CONTRACT + " Search your own Knowledge by relevance. Returns ranked summaries with a matching snippet.",
      inputSchema: buildShape({
        query: { type: "string", description: "Search query." },
        kind: { type: "string", description: "Optional record kind filter." },
        cursor: { type: "string", description: CURSOR_DESCRIPTION },
        limit: { type: "number", description: PAGE_DESCRIPTION },
      }, ["query"]),
      handler: handler(bound, "searchKnowledge"),
    },
    {
      name: "read_knowledge",
      description: MATE_CONTRACT + " Read one of your own Knowledge records. Read only what you need." + READ_RESULT,
      inputSchema: buildShape({
        ref: { type: "string", description: REF_DESCRIPTION },
        offset: { type: "number", description: OFFSET_DESCRIPTION },
        maxChars: { type: "number", description: MAX_CHARS_DESCRIPTION },
      }, ["ref"]),
      handler: handler(bound, "readKnowledge"),
    },
  ].concat(databaseTools(bound));
}

function clayTools(bound) {
  return [
    {
      name: "list_mate_knowledge",
      description: CLAY_CONTRACT + " List Knowledge records across the current user's Mates, or one named Mate. Available only to authoritative builtin Clay.",
      inputSchema: buildShape({
        mateId: { type: "string", description: "Optional exact Mate id belonging to the current user. Omit to span all of them." },
        kind: { type: "string", description: "Optional record kind filter." },
        cursor: { type: "string", description: CURSOR_DESCRIPTION },
        limit: { type: "number", description: PAGE_DESCRIPTION },
      }),
      handler: handler(bound, "listMateKnowledge"),
    },
    {
      name: "search_mate_knowledge",
      description: CLAY_CONTRACT + " Search Knowledge across the current user's Mates, or one named Mate. Results identify the owning Mate. Available only to authoritative builtin Clay.",
      inputSchema: buildShape({
        query: { type: "string", description: "Search query." },
        mateId: { type: "string", description: "Optional exact Mate id belonging to the current user." },
        kind: { type: "string", description: "Optional record kind filter." },
        cursor: { type: "string", description: CURSOR_DESCRIPTION },
        limit: { type: "number", description: PAGE_DESCRIPTION },
      }, ["query"]),
      handler: handler(bound, "searchMateKnowledge"),
    },
    {
      name: "read_mate_knowledge",
      description: CLAY_CONTRACT + " Read one Knowledge record using the opaque reference returned by a list or search tool. The reference resolves only inside the current user's Mate Knowledge. Available only to authoritative builtin Clay." + READ_RESULT,
      inputSchema: buildShape({
        ref: { type: "string", description: REF_DESCRIPTION },
        offset: { type: "number", description: OFFSET_DESCRIPTION },
        maxChars: { type: "number", description: MAX_CHARS_DESCRIPTION },
      }, ["ref"]),
      handler: handler(bound, "readMateKnowledge"),
    },
  ];
}

// A binding is either one Mate's own scope or Clay's cross-Mate read view. The
// two sets are never advertised together, so no tool name is duplicated.
function getToolDefs(bound, includeClay) {
  return includeClay === true ? clayTools(bound) : mateTools(bound);
}

function createMcpServer(adapter, bound, includeClay) {
  if (!adapter || typeof adapter.createToolServer !== "function") return null;
  return adapter.createToolServer({
    name: "clay-knowledge",
    version: "1.0.0",
    tools: getToolDefs(bound, includeClay),
  });
}

module.exports = {
  MATE_CONTRACT: MATE_CONTRACT,
  CLAY_CONTRACT: CLAY_CONTRACT,
  getToolDefs: getToolDefs,
  createMcpServer: createMcpServer,
};
