var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var attachService = require("../lib/mate-knowledge-service").attachMateKnowledgeService;
var attachProjectMateKnowledge = require("../lib/project-mate-knowledge").attachProjectMateKnowledge;
var mateSync = require("../lib/mate-knowledge-sync");
var createKnowledgeDbService = require("../lib/knowledge-db-service").createKnowledgeDbService;

var operationSequence = 0;
function operation(prefix) { operationSequence++; return prefix + "_" + Date.now() + "_" + operationSequence; }
function call(attached, session, name, args) {
  var defs = attached.getToolDefs(session);
  for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i].handler(args || {});
  throw new Error("Tool not advertised: " + name);
}
async function json(result) {
  var value = await result;
  if (value.isError) throw new Error(value.content[0].text);
  return JSON.parse(value.content[0].text);
}

function fixture(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-knowledge-workflow-"));
  var mateDir = path.join(root, "mates", "alice", "mate_workflow");
  var baseDir = path.join(root, "record-store");
  fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  mateSync.reconcileMate({ mateDir: mateDir, baseDir: baseDir, actor: { type: "test" } });

  var session = { localId: 1, cliSessionId: "workflow", ownerId: "alice" };
  var outsider = { localId: 2, cliSessionId: "outsider", ownerId: "bob" };
  var sessions = new Map([[session.localId, session]]);
  function newDatabaseService() { return createKnowledgeDbService({ projectDir: mateDir, authorizeTextReference: function () { return false; } }); }
  var databaseService = newDatabaseService();
  var project = {
    getStatus: function () { return { isMate: true, mateId: "mate_workflow", projectOwnerId: "alice", path: mateDir }; },
    getSessionManager: function () { return { sessions: sessions }; },
    getKnowledgeDbService: function () { return databaseService; },
  };
  var projects = new Map([["mate-workflow", project]]);
  var registry = { id: "mate_workflow", name: "Workflow", createdBy: "alice", dir: mateDir };
  function buildService() {
    return attachService({
      baseDir: baseDir,
      getProjects: function () { return projects; },
      isMultiUser: function () { return true; },
      resolveMate: function (userId, mateId) { return mateId === registry.id && userId === registry.createdBy ? registry : null; },
      listMates: function (userId) { return userId === "alice" ? [registry] : []; },
    });
  }
  function attach(service) {
    return attachProjectMateKnowledge({
      service: service, sm: project.getSessionManager(), projectSlug: "mate-workflow", isMate: true,
      mateId: registry.id, getProjectOwnerId: function () { return "alice"; },
    });
  }
  var service = buildService();
  return { root: root, mateDir: mateDir, baseDir: baseDir, session: session, outsider: outsider, project: project, attach: function () { return attach(service); }, restart: function () { databaseService = newDatabaseService(); service = buildService(); return attach(service); } };
}

test("session-bound structured workflows use schema, references, typed filters, and scoped totals", async function (t) {
  var f = fixture(t);
  var tools = f.attach();
  var contacts = (await json(call(tools, f.session, "create_database", {
    name: "Contacts", operationId: operation("contacts"), schema: [
      { id: "fld_contact_title", name: "Name", type: "title", required: true },
      { id: "fld_cadence", name: "Cadence", type: "text" },
      { id: "fld_followup", name: "Next follow-up", type: "date" },
    ],
  }))).database;
  var contactTitle = contacts.schema[0].id;
  var contact = await json(call(tools, f.session, "create_database_record", {
    databaseId: contacts.id, expectedDatabaseRevision: contacts.revision, operationId: operation("contact"),
    values: (function () { var values = {}; values[contactTitle] = "Alex Example"; values.fld_cadence = "weekly"; values.fld_followup = "2026-10-20"; return values; })(),
  }));
  var transactions = (await json(call(tools, f.session, "create_database", {
    name: "Transactions", operationId: operation("transactions"), schema: [
      { id: "fld_tx_title", name: "Description", type: "title", required: true },
      { id: "fld_category", name: "Category", type: "text" },
      { id: "fld_amount", name: "Amount", type: "number" },
      { id: "fld_spender", name: "Spender", type: "reference", target: "record", targetDatabaseId: contacts.id },
    ],
  }))).database;
  var txTitle = transactions.schema[0].id;
  async function addTransaction(title, category, amount, label) {
    var current = (await json(call(tools, f.session, "read_database", { databaseId: transactions.id }))).database;
    var values = {}; values[txTitle] = title; values.fld_category = category; values.fld_amount = amount;
    values.fld_spender = { type: "record", databaseId: contacts.id, id: contact.record.id };
    return json(call(tools, f.session, "create_database_record", { databaseId: transactions.id, expectedDatabaseRevision: current.revision, operationId: operation(label), values: values }));
  }
  await addTransaction("Lunch", "food", 18, "lunch");
  await addTransaction("Train", "travel", 42, "train");
  await addTransaction("Hotel", "travel", 120, "hotel");
  var schemaRead = await json(call(tools, f.session, "read_database", { databaseId: transactions.id }));
  var query = await json(call(tools, f.session, "query_database", {
    databaseId: transactions.id,
    filters: [{ fieldId: "fld_category", op: "eq", value: "travel" }],
    sorts: [{ fieldId: "fld_amount", direction: "desc" }], limit: 1,
  }));
  assert.equal(schemaRead.database.schema.filter(function (field) { return field.id === "fld_amount"; })[0].type, "number");
  assert.equal(query.records.length, 1);
  assert.equal(query.totals.count, 2);
  assert.equal(query.totals.sums.fld_amount, 162);
  assert.equal(query.records[0].values.fld_amount, 120);
  assert.equal(query.records[0].references[0].status, "available");

  var followUp = await json(call(tools, f.session, "query_database", {
    databaseId: contacts.id,
    filters: [
      { fieldId: "fld_cadence", op: "eq", value: "weekly" },
      { fieldId: "fld_followup", op: "lte", value: "2026-10-21" },
    ], limit: 20,
  }));
  assert.equal(followUp.totals.count, 1, "the caller supplied the cadence/date cutoff");
  assert.equal(followUp.records[0].id, contact.record.id);
  var freshTools = f.restart();
  var freshQuery = await json(call(freshTools, f.session, "query_database", {
    databaseId: transactions.id, filters: [{ fieldId: "fld_category", op: "eq", value: "travel" }], limit: 20,
  }));
  assert.equal(freshQuery.totals.count, 2, "fresh service rebind retains structured records and totals");
  assert.deepEqual(f.attach().getToolDefs(f.outsider), []);
});

test("narrative and correction workflows preserve links, revisions, history, rebind state, and original text", async function (t) {
  var f = fixture(t);
  var tools = f.attach();
  var created = await json(call(tools, f.session, "create_knowledge_document", {
    name: "daily/2026-10-13.md", content: "# Daily capture\nSee [[projects/plan]].\nOriginal English word: accomodate.\n",
  }));
  var edited = await json(call(tools, f.session, "update_knowledge_document", {
    documentId: created.documentId, expectedRevision: created.revision,
    content: "# Daily capture\nSee [[projects/plan]].\nOriginal English word: accommodate.\n",
  }));
  var stale = await call(tools, f.session, "update_knowledge_document", {
    documentId: created.documentId, expectedRevision: created.revision, content: "lost correction",
  });
  assert.equal(stale.isError, true);
  var current = await json(call(tools, f.session, "read_knowledge_document", { documentId: created.documentId }));
  assert.match(current.content, /\[\[projects\/plan\]\]/);
  assert.match(current.content, /accommodate/);
  var history = await json(call(tools, f.session, "list_knowledge_document_history", { documentId: created.documentId }));
  assert.ok(history.versions.length >= 1);

  var restored = await json(call(tools, f.session, "restore_knowledge_document", {
    documentId: created.documentId, version: history.versions[0].version, expectedRevision: edited.revision,
  }));
  assert.ok(restored.revision);
  var restarted = f.restart();
  var afterRestart = await json(call(restarted, f.session, "read_knowledge_document", { documentId: created.documentId }));
  assert.match(afterRestart.content, /Original English word: accomodate/);
  assert.match(afterRestart.content, /\[\[projects\/plan\]\]/);
  assert.deepEqual(restarted.getToolDefs(f.outsider), [], "an outsider receives no Knowledge handler");
});

test("correction records retain original English text while query and update use stable ids", async function (t) {
  var f = fixture(t);
  var tools = f.attach();
  var made = (await json(call(tools, f.session, "create_database", {
    name: "Corrections", operationId: operation("corrections"), schema: [
      { id: "fld_word_title", name: "Word", type: "title", required: true },
      { id: "fld_original", name: "Original", type: "text" },
      { id: "fld_correction", name: "Correction", type: "text" },
    ],
  }))).database;
  var values = {}; values.fld_word_title = "accomodate"; values.fld_original = "The original English spelling was accomodate."; values.fld_correction = "accommodate";
  var created = await json(call(tools, f.session, "create_database_record", { databaseId: made.id, expectedDatabaseRevision: made.revision, operationId: operation("word"), values: values }));
  var found = await json(call(tools, f.session, "query_database", { databaseId: made.id, filters: [{ fieldId: "fld_word_title", op: "eq", value: "accomodate" }] }));
  assert.equal(found.totals.count, 1);
  var corrected = await json(call(tools, f.session, "update_database_record", { databaseId: made.id, recordId: created.record.id, expectedRevision: created.record.revision, operationId: operation("correct"), values: { fld_correction: "accommodate (corrected)" } }));
  var read = await json(call(tools, f.session, "read_database_record", { databaseId: made.id, recordId: corrected.record.id }));
  assert.equal(read.record.values.fld_original, "The original English spelling was accomodate.");
  assert.equal(read.record.values.fld_correction, "accommodate (corrected)");
});
