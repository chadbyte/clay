var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var zod = require("zod");

var attachService = require("../lib/mate-knowledge-service").attachMateKnowledgeService;
var attachProjectMateKnowledge = require("../lib/project-mate-knowledge").attachProjectMateKnowledge;
var createKnowledgeDbService = require("../lib/knowledge-db-service").createKnowledgeDbService;
var importLimits = require("../lib/knowledge-db-import");

var sequence = 0;
function operation(prefix) { sequence++; return prefix + "_" + Date.now() + "_" + sequence; }
function call(attached, session, name, args) {
  var defs = attached.getToolDefs(session);
  for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i].handler(args || {});
  throw new Error("Tool not advertised: " + name);
}
function validate(attached, session, name, args) {
  var defs = attached.getToolDefs(session);
  for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return zod.object(defs[i].inputSchema).parse(args || {});
  throw new Error("Tool not advertised: " + name);
}
function callParsed(attached, session, name, args) {
  return call(attached, session, name, validate(attached, session, name, args));
}
function definition(attached, session, name) {
  var defs = attached.getToolDefs(session);
  for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i];
  throw new Error("Tool not advertised: " + name);
}
async function json(result) {
  var value = await result;
  if (value.isError) throw new Error(value.content[0].text);
  return JSON.parse(value.content[0].text);
}
async function error(result, pattern) {
  var value = await result;
  assert.equal(value.isError, true);
  if (pattern) assert.match(value.content[0].text, pattern);
  return value;
}

function fixture(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-knowledge-import-tools-"));
  var mateDir = path.join(root, "mates", "alice", "mate_import");
  fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var session = { localId: 1, cliSessionId: "import", ownerId: "alice" };
  var foreign = { localId: 2, cliSessionId: "foreign", ownerId: "bob" };
  var sessions = new Map([[session.localId, session]]);
  var databaseService;
  function newDatabaseService() { databaseService = createKnowledgeDbService({ projectDir: mateDir, authorizeTextReference: function () { return false; } }); }
  newDatabaseService();
  var project = {
    getStatus: function () { return { isMate: true, mateId: "mate_import", projectOwnerId: "alice", path: mateDir }; },
    getSessionManager: function () { return { sessions: sessions }; },
    getKnowledgeDbService: function () { return databaseService; },
  };
  var projects = new Map([["mate-import", project]]);
  var mate = { id: "mate_import", name: "Import", createdBy: "alice", dir: mateDir };
  function service() {
    return attachService({
      baseDir: path.join(root, "record-store"), getProjects: function () { return projects; },
      isMultiUser: function () { return true; },
      resolveMate: function (userId, mateId) { return userId === "alice" && mateId === mate.id ? mate : null; },
      listMates: function (userId) { return userId === "alice" ? [mate] : []; },
    });
  }
  var boundService = service();
  function attach() { return attachProjectMateKnowledge({ service: boundService, sm: project.getSessionManager(), projectSlug: "mate-import", isMate: true, mateId: mate.id, getProjectOwnerId: function () { return "alice"; } }); }
  return {
    root: root, mateDir: mateDir, session: session, foreign: foreign, project: project, attach: attach,
    rebind: function () { newDatabaseService(); boundService = service(); return attach(); },
  };
}

test("ordinary Mate import tools register across native MCP bridge and preserve source mappings", async function (t) {
  var f = fixture(t); var tools = f.attach();
  var toolDefinitions = tools.getToolDefs(f.session);
  var importDefinition = toolDefinitions.filter(function (tool) { return tool.name === "import_database_records"; })[0];
  var definitions = toolDefinitions.map(function (tool) { return tool.name; });
  assert.ok(definitions.indexOf("import_database_records") !== -1);
  assert.ok(definitions.indexOf("read_database_import_progress") !== -1);
  assert.equal(importDefinition.inputSchema.rows.type, "array");
  var bridgeDefinitions = tools.getBridgeTools(f.session, function (schema) { return schema; });
  var bridge = bridgeDefinitions.map(function (tool) { return tool.name; });
  assert.ok(bridge.indexOf("import_database_records") !== -1);
  assert.equal(bridgeDefinitions.filter(function (tool) { return tool.name === "import_database_records"; })[0].inputSchema.rows.type, "array");
  var server = tools.createMcpServer({ createToolServer: function (definition) { return definition; } }, f.session);
  assert.ok(server.tools.some(function (tool) { return tool.name === "read_database_import_progress"; }));

  var importJsonSchema = zod.toJSONSchema(zod.object(importDefinition.inputSchema));
  assert.equal(importJsonSchema.properties.rows.type, "array");
  assert.ok(importJsonSchema.properties.rows.items.required.indexOf("sourcePayload") !== -1);
  assert.equal(zod.toJSONSchema(zod.object(definition(tools, f.session, "create_database").inputSchema)).properties.schema.type, "array");
  assert.equal(zod.toJSONSchema(zod.object(definition(tools, f.session, "query_database").inputSchema)).properties.filters.type, "array");
  assert.equal(zod.toJSONSchema(zod.object(definition(tools, f.session, "query_database").inputSchema)).properties.sorts.type, "array");
  assert.equal(zod.toJSONSchema(zod.object(definition(tools, f.session, "create_database_record").inputSchema)).properties.values.type, "object");
  assert.equal(zod.toJSONSchema(zod.object(definition(tools, f.session, "save_table_view").inputSchema)).properties.view.type, "object");

  var createDatabaseArgs = {
    name: "Imported vocabulary", operationId: operation("db"), schema: [
      { id: "fld_title", name: "Word", type: "title", required: true },
      { id: "fld_notes", name: "Notes", type: "text" },
      { id: "fld_related", name: "Related", type: "reference", target: "record" },
    ],
  };
  assert.doesNotThrow(function () { validate(tools, f.session, "create_database", createDatabaseArgs); });
  var db = (await json(callParsed(tools, f.session, "create_database", createDatabaseArgs))).database;
  var rows = [
    { sourceKey: "one", sourcePayload: { source: "one", original: "alpha" }, values: { fld_title: "Alpha", fld_notes: "Original alpha" } },
    { sourceKey: "two", sourcePayload: { source: "two", original: "beta" }, values: { fld_title: "Beta", fld_notes: "Original beta", fld_related: { type: "record", sourceNamespace: "vocabulary", sourceKey: "one" } } },
  ];
  var request = { databaseId: db.id, expectedDatabaseRevision: db.revision, operationId: operation("import"), sourceNamespace: "vocabulary", rows: rows };
  assert.doesNotThrow(function () { validate(tools, f.session, "import_database_records", request); });
  var imported = await json(callParsed(tools, f.session, "import_database_records", request));
  assert.equal(imported.createdCount, 2);
  assert.equal(imported.replayedCount, 0);
  assert.equal(imported.mappings[0].created, true);
  assert.equal(imported.projectionPending, false);
  var record = await json(call(tools, f.session, "read_database_record", { databaseId: db.id, recordId: imported.mappings[1].recordId }));
  assert.equal(record.record.values.fld_related.id, imported.mappings[0].recordId);
  assert.equal(record.record.createdBy.userId, "alice");
  var correctionArgs = { databaseId: db.id, recordId: record.record.id, values: { fld_notes: "Human correction\nkept" }, expectedRevision: record.record.revision, operationId: operation("correction") };
  assert.doesNotThrow(function () { validate(tools, f.session, "update_database_record", correctionArgs); });
  await json(callParsed(tools, f.session, "update_database_record", correctionArgs));
  var currentDatabase = (await json(call(tools, f.session, "read_database", { databaseId: db.id }))).database;
  var expandedSchema = currentDatabase.schema.concat([{ id: "fld_extra", name: "Extra", type: "text" }]);
  var schemaArgs = { databaseId: db.id, schema: expandedSchema, expectedRevision: currentDatabase.revision, operationId: operation("schema") };
  assert.doesNotThrow(function () { validate(tools, f.session, "update_database_schema", schemaArgs); });
  var expanded = (await json(callParsed(tools, f.session, "update_database_schema", schemaArgs))).database;
  var viewArgs = { databaseId: db.id, view: { id: "view_imported", name: "Imported notes", columns: expanded.schema.map(function (field) { return field.id; }), filters: [{ fieldId: "fld_notes", op: "contains", value: "Original" }], sorts: [{ fieldId: "fld_title", direction: "asc" }] }, expectedRevision: expanded.revision, operationId: operation("view") };
  assert.doesNotThrow(function () { validate(tools, f.session, "save_table_view", viewArgs); });
  await json(callParsed(tools, f.session, "save_table_view", viewArgs));
  var progress = await json(call(tools, f.session, "read_database_import_progress", { databaseId: db.id, sourceNamespace: "vocabulary", limit: 1 }));
  assert.equal(progress.total, 2);
  assert.equal(progress.mappings.length, 1);
  assert.equal(progress.nextOffset, 1);

  var exact = await json(callParsed(tools, f.session, "import_database_records", request));
  assert.equal(exact.createdCount, 2);
  assert.equal(exact.databaseRevision, imported.databaseRevision);
  var latestDatabase = (await json(call(tools, f.session, "read_database", { databaseId: db.id }))).database;
  var freshReplay = Object.assign({}, request, { expectedDatabaseRevision: latestDatabase.revision, operationId: operation("fresh-replay") });
  var replay = await json(callParsed(tools, f.session, "import_database_records", freshReplay));
  assert.equal(replay.createdCount, 0);
  assert.equal(replay.replayedCount, 2);
  assert.equal(replay.databaseRevision, latestDatabase.revision);

  var queryArgs = { databaseId: db.id, viewId: "view_imported", filters: [{ fieldId: "fld_notes", op: "contains", value: "Original" }], sorts: [{ fieldId: "fld_title", direction: "asc" }], limit: 20 };
  assert.doesNotThrow(function () { validate(tools, f.session, "query_database", queryArgs); });
  var queried = await json(callParsed(tools, f.session, "query_database", queryArgs));
  assert.equal(queried.totals.count, 1);
  var changed = Object.assign({}, freshReplay, { operationId: operation("changed-source"), rows: [{ sourceKey: "one", sourcePayload: { source: "one", changed: true }, values: { fld_title: "Changed" } }] });
  await error(call(tools, f.session, "import_database_records", changed), /already imported with a different payload|conflict/i);
  var stale = Object.assign({}, request, { operationId: operation("stale"), rows: [{ sourceKey: "three", sourcePayload: { source: "three" }, values: { fld_title: "Three" } }] });
  await error(call(tools, f.session, "import_database_records", stale), /revision|changed/i);

  var invalidRows = [];
  for (var i = 0; i < importLimits.MAX_BATCH_ROWS + 1; i++) invalidRows.push({ sourceKey: "overflow-" + i, sourcePayload: { i: i }, values: { fld_title: "Overflow " + i } });
  await error(call(tools, f.session, "import_database_records", Object.assign({}, freshReplay, { operationId: operation("overflow"), rows: invalidRows })), /100|batch|limit/i);
  await error(call(tools, f.session, "read_database_import_progress", { databaseId: db.id, sourceNamespace: "vocabulary", limit: 101 }), /limit|between/i);

  var freshTools = f.rebind();
  var freshProgress = await json(call(freshTools, f.session, "read_database_import_progress", { databaseId: db.id, sourceNamespace: "vocabulary" }));
  assert.equal(freshProgress.total, 2);
  assert.deepEqual(freshTools.getToolDefs(f.foreign), []);
});

test("raw forged actors cannot override server attribution", async function (t) {
  var f = fixture(t); var tools = f.attach();
  var db = (await json(callParsed(tools, f.session, "create_database", { name: "Attribution", operationId: operation("actor-db"), schema: [{ id: "fld_title", name: "Title", type: "title" }] }))).database;
  var rawRequest = { databaseId: db.id, expectedDatabaseRevision: db.revision, operationId: operation("forged-actor"), sourceNamespace: "actor", rows: [{ sourceKey: "one", sourcePayload: { original: "one" }, values: { fld_title: "One" } }], actor: { type: "user", userId: "bob" } };
  var imported = await json(call(tools, f.session, "import_database_records", rawRequest));
  var record = await json(call(tools, f.session, "read_database_record", { databaseId: db.id, recordId: imported.mappings[0].recordId }));
  assert.equal(record.record.createdBy.userId, "alice");
});

test("captured import handlers reject live owner mutation and session removal", async function (t) {
  var f = fixture(t); var tools = f.attach();
  var db = (await json(callParsed(tools, f.session, "create_database", { name: "Guarded", operationId: operation("guarded-db"), schema: [{ id: "fld_title", name: "Title", type: "title" }] }))).database;
  var captured = definition(tools, f.session, "import_database_records");
  var request = { databaseId: db.id, expectedDatabaseRevision: db.revision, operationId: operation("captured"), sourceNamespace: "guarded", rows: [{ sourceKey: "one", sourcePayload: { original: "one" }, values: { fld_title: "One" } }] };
  f.session.ownerId = "bob";
  await error(captured.handler(request), /owner|authorized|session/i);
  f.session.ownerId = "alice";
  f.project.getSessionManager().sessions.delete(f.session.localId);
  await error(captured.handler(request), /session|authorized|owner/i);
  f.project.getSessionManager().sessions.set(f.session.localId, f.session);
  var query = await json(callParsed(tools, f.session, "query_database", { databaseId: db.id, limit: 20 }));
  assert.equal(query.totals.count, 0);
  assert.deepEqual(tools.getToolDefs(f.foreign), []);
});
