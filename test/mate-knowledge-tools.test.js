var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var attachService = require("../lib/mate-knowledge-service").attachMateKnowledgeService;
var attachProjectMateKnowledge = require("../lib/project-mate-knowledge").attachProjectMateKnowledge;
var knowledgeMcp = require("../lib/mate-knowledge-mcp-server");
var knowledgeSearch = require("../lib/knowledge-search");
var knowledgeImport = require("../lib/knowledge-import");
var mateSync = require("../lib/mate-knowledge-sync");
var createKnowledgeDbService = require("../lib/knowledge-db-service").createKnowledgeDbService;

var MATE_TOOLS = ["list_knowledge", "search_knowledge", "read_knowledge", "list_databases", "create_database", "read_database", "rename_database", "archive_database", "recover_database", "update_database_schema", "save_table_view", "query_database", "create_database_record", "read_database_record", "update_database_record", "archive_database_record", "recover_database_record", "retry_database_sync"];
var CLAY_TOOLS = ["list_mate_knowledge", "search_mate_knowledge", "read_mate_knowledge"];
var databaseOperationSequence = 0;
function databaseOperation(prefix) { databaseOperationSequence++; return prefix + "_" + Date.now() + "_" + databaseOperationSequence; }

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clay-mk-" + label + "-"));
}

function write(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function handle(status, sessions, databaseService) {
  var manager = { sessions: new Map() };
  for (var i = 0; i < (sessions || []).length; i++) manager.sessions.set(sessions[i].localId, sessions[i]);
  return { getStatus: function () { return status; }, getSessionManager: function () { return manager; }, getKnowledgeDbService: function () { return databaseService || null; } };
}

// Two users, each with two Mates, plus a plain Project Driver project.
function workspace(opts) {
  var options = opts || {};
  var home = tmp("ws");
  var baseDir = path.join(home, "knowledge");
  var roots = {
    alice: path.join(home, "mates", "alice"),
    bob: path.join(home, "mates", "bob"),
  };

  function seed(owner, mateId, files) {
    var mateDir = path.join(roots[owner], mateId);
    var names = Object.keys(files);
    for (var i = 0; i < names.length; i++) write(path.join(mateDir, "knowledge", names[i]), files[names[i]]);
    // Identity must never reach Knowledge.
    write(path.join(mateDir, "CLAUDE.md"), "# Identity\nYou are " + mateId + ".\n");
    write(path.join(mateDir, "knowledge", "identity-backup.md"), "# secret identity backup\n");
    mateSync.reconcileMate({ mateDir: mateDir, baseDir: baseDir, actor: { type: "migration" } });
    return mateDir;
  }

  var arch = seed("alice", "mate_arch", {
    "architecture.md": "# Architecture\nWe chose an append-only journal for durability and replay.\n",
    "session-digests.jsonl": JSON.stringify({ date: "2026-04-01", topic: "caching", summary: "decided to memoize the index" }) + "\n"
      + JSON.stringify({ date: "2026-04-02", topic: "재고 관리", summary: "재고 관리 시스템 설계를 논의했다" }) + "\n",
  });
  var scribe = seed("alice", "mate_scribe", {
    "style-guide.md": "# Style\nShort sentences. No exclamation marks.\n",
  });
  var clayDir = seed("alice", "mate_clay", {
    "coordination.md": "# Coordination\nClay routes work between Mates.\n",
  });
  var bobMate = seed("bob", "mate_bobmate", {
    "private.md": "# Bob private\nBob's confidential roadmap for the acquisition.\n",
  });

  var sessions = {
    arch: { localId: 1, cliSessionId: "cli-arch", ownerId: "alice" },
    scribe: { localId: 2, cliSessionId: "cli-scribe", ownerId: "alice" },
    clay: { localId: 3, cliSessionId: "cli-clay", ownerId: "alice" },
    bob: { localId: 4, cliSessionId: "cli-bob", ownerId: "bob" },
    driver: { localId: 5, cliSessionId: "cli-driver", ownerId: "alice" },
  };

  var projects = new Map();
  projects.set("mate-arch", handle({ slug: "mate-arch", path: arch, projectOwnerId: "alice", isMate: true, mateId: "mate_arch" }, [sessions.arch], createKnowledgeDbService({ projectDir: arch, authorizeTextReference: function () { return false; } })));
  projects.set("mate-scribe", handle({ slug: "mate-scribe", path: scribe, projectOwnerId: "alice", isMate: true, mateId: "mate_scribe" }, [sessions.scribe], createKnowledgeDbService({ projectDir: scribe, authorizeTextReference: function () { return false; } })));
  projects.set("mate-clay", handle({ slug: "mate-clay", path: clayDir, projectOwnerId: "alice", isMate: true, mateId: "mate_clay" }, [sessions.clay], createKnowledgeDbService({ projectDir: clayDir, authorizeTextReference: function () { return false; } })));
  projects.set("mate-bob", handle({ slug: "mate-bob", path: bobMate, projectOwnerId: "bob", isMate: true, mateId: "mate_bobmate" }, [sessions.bob], createKnowledgeDbService({ projectDir: bobMate, authorizeTextReference: function () { return false; } })));
  projects.set("app", handle({ slug: "app", path: "/srv/app", projectOwnerId: "alice" }, [sessions.driver]));

  var registry = {
    mate_arch: { id: "mate_arch", name: "Arch", createdBy: "alice", builtinKey: null, dir: arch },
    mate_scribe: { id: "mate_scribe", name: "Scribe", createdBy: "alice", builtinKey: null, dir: scribe },
    mate_clay: { id: "mate_clay", name: "Clay", createdBy: "alice", builtinKey: options.clayKey === undefined ? "clay" : options.clayKey, dir: clayDir },
    mate_bobmate: { id: "mate_bobmate", name: "BobMate", createdBy: "bob", builtinKey: null, dir: bobMate },
  };

  var service = attachService({
    baseDir: baseDir,
    getProjects: function () { return projects; },
    isMultiUser: function () { return options.multiUser !== false; },
    resolveMate: function (userId, mateId) {
      var mate = registry[mateId];
      if (!mate) return null;
      if (options.multiUser !== false && mate.createdBy !== userId) return null;
      return mate;
    },
    listMates: function (userId) {
      var out = [];
      var keys = Object.keys(registry);
      for (var i = 0; i < keys.length; i++) {
        if (registry[keys[i]].createdBy !== userId) continue;
        out.push(registry[keys[i]]);
      }
      return out;
    },
  });

  function attach(slug, mateId, owner) {
    return attachProjectMateKnowledge({
      service: service,
      sm: projects.get(slug).getSessionManager(),
      projectSlug: slug,
      getProjectOwnerId: function () { return owner; },
      isMate: mateId !== null,
      mateId: mateId,
    });
  }

  return {
    home: home, baseDir: baseDir, service: service, projects: projects, sessions: sessions, registry: registry,
    dirs: { arch: arch, scribe: scribe, clay: clayDir, bob: bobMate },
    arch: attach("mate-arch", "mate_arch", "alice"),
    scribe: attach("mate-scribe", "mate_scribe", "alice"),
    clay: attach("mate-clay", "mate_clay", "alice"),
    bob: attach("mate-bob", "mate_bobmate", "bob"),
    driver: attach("app", null, "alice"),
  };
}

function call(attached, session, name, args) {
  var defs = attached.getToolDefs(session);
  for (var i = 0; i < defs.length; i++) {
    if (defs[i].name === name) return defs[i].handler(args || {});
  }
  throw new Error("tool not advertised: " + name);
}

async function json(promise) {
  var result = await promise;
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

// --- Search engine ------------------------------------------------------

test("ranking uses the shared BM25 engine and handles CJK bigrams", function () {
  var items = [
    { id: "a", name: "architecture.md", body: "append only journal durability replay" },
    { id: "b", name: "notes.md", body: "a passing mention of journal" },
    { id: "c", name: "styles.md", body: "unrelated prose about typography" },
    { id: "d", name: "korean.md", body: "재고 관리 시스템 설계를 논의했다" },
  ];
  function project(item) {
    return { id: item.id, fields: [{ text: item.name, weight: 3 }, { text: item.body, weight: 1 }], meta: item };
  }

  var ranked = knowledgeSearch.rank(items, "journal durability", project, 10);
  assert.equal(ranked[0].id, "a", "the denser match outranks the passing mention");
  assert.ok(ranked.length >= 2);
  assert.ok(ranked[0].score > ranked[1].score, "BM25 produces distinct scores, not a flat count");
  assert.equal(ranked.filter(function (r) { return r.id === "c"; }).length, 0, "non-matching documents score nothing");

  // Field weighting is by controlled repetition, so a title hit outranks a body hit.
  var byTitle = knowledgeSearch.rank(items, "architecture", project, 10);
  assert.equal(byTitle[0].id, "a");

  // CJK: no spaces between terms, matched through the shared tokenizer's bigrams.
  var cjk = knowledgeSearch.rank(items, "재고 관리", project, 10);
  assert.equal(cjk[0].id, "d");
  assert.ok(knowledgeSearch.tokenize("재고 관리").length > 2, "CJK input produces bigram tokens");
  assert.deepEqual(knowledgeSearch.rank(items, "   ", project, 10), [], "an empty query ranks nothing");

  // Snippets centre on the matched term.
  var snippet = knowledgeSearch.snippet("aaa bbb ccc durability ddd eee", "durability", 40);
  assert.ok(snippet.indexOf("durability") !== -1);
});

// --- Ordinary Mate isolation -------------------------------------------

test("an ordinary Mate sees only its own Knowledge and cannot express another scope", async function () {
  var w = workspace();
  var defs = w.arch.getToolDefs(w.sessions.arch);
  assert.deepEqual(defs.map(function (d) { return d.name; }), MATE_TOOLS);

  // No tool accepts an identity, owner, or scope argument.
  for (var i = 0; i < defs.length; i++) {
    var keys = Object.keys(defs[i].inputSchema);
    assert.equal(keys.indexOf("mateId"), -1, defs[i].name);
    assert.equal(keys.indexOf("ownerId"), -1, defs[i].name);
    assert.equal(keys.indexOf("userId"), -1, defs[i].name);
    assert.equal(keys.indexOf("scopeId"), -1, defs[i].name);
    assert.equal(keys.indexOf("projectSlug"), -1, defs[i].name);
  }

  var listed = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(listed.total, 3, "one markdown file and two digest lines");
  for (var j = 0; j < listed.entries.length; j++) {
    assert.equal(listed.entries[j].mateId, undefined, "a Mate is never told which Mate it is reading");
    assert.equal(listed.entries[j].mateName, undefined);
    assert.doesNotMatch(listed.entries[j].name || "", /identity/i);
  }

  // Forged arguments cannot widen the scope or reveal another Mate.
  var forged = await json(call(w.arch, w.sessions.arch, "list_knowledge", {
    mateId: "mate_scribe", ownerId: "bob", userId: "bob", scopeId: "mate/u-bob/mate_bobmate", projectSlug: "mate-bob",
  }));
  assert.equal(forged.total, 3, "forged arguments are ignored entirely");
  var serialized = JSON.stringify(forged);
  assert.equal(serialized.indexOf("Style"), -1);
  assert.equal(serialized.indexOf("Bob"), -1);
  assert.equal(serialized.indexOf("mate_scribe"), -1);

  var found = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "exclamation marks" }));
  assert.equal(found.total, 0, "another Mate's content is not searchable");

  // Clay's cross-Mate tools are not advertised to an ordinary Mate.
  for (var c = 0; c < CLAY_TOOLS.length; c++) {
    assert.equal(defs.filter(function (d) { return d.name === CLAY_TOOLS[c]; }).length, 0);
  }
  assert.throws(function () { call(w.arch, w.sessions.arch, "list_mate_knowledge", {}); }, /not advertised/);
});

test("an ordinary Mate cannot read another Mate's record by its opaque ref", async function () {
  var w = workspace();
  var scribeList = await json(call(w.scribe, w.sessions.scribe, "list_knowledge", {}));
  var foreignRef = scribeList.entries[0].ref;
  assert.match(foreignRef, /^know:/);

  var denied = await call(w.arch, w.sessions.arch, "read_knowledge", { ref: foreignRef });
  assert.equal(denied.isError, true, "a ref from another scope simply does not resolve");
  assert.match(denied.content[0].text, /not found/i);

  var own = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  var mine = await json(call(w.arch, w.sessions.arch, "read_knowledge", { ref: own.entries[0].ref }));
  assert.ok(mine.content.length > 0);
  assert.equal(mine.preview, undefined, "read returns the record, not a preview");

  var badRef = await call(w.arch, w.sessions.arch, "read_knowledge", { ref: "know:../../etc/passwd" });
  assert.equal(badRef.isError, true);
});

test("session-bound native Knowledge tools create and operate only the owning Mate database", async function () {
  var w = workspace();
  var createOperation = databaseOperation("create-cases");
  var recordOperation = databaseOperation("create-record");
  var created = await json(call(w.arch, w.sessions.arch, "create_database", { name: "Cases", operationId: createOperation }));
  assert.match(created.database.id, /^db_/); var database = created.database; var title = database.schema[0].id;
  var discovered = await json(call(w.arch, w.sessions.arch, "list_databases", {})); assert.equal(discovered.databases[0].id, database.id);
  var record = await json(call(w.arch, w.sessions.arch, "create_database_record", { databaseId: database.id, expectedDatabaseRevision: database.revision, operationId: recordOperation, values: (function () { var values = {}; values[title] = "Alpha"; return values; })() }));
  var queried = await json(call(w.arch, w.sessions.arch, "query_database", { databaseId: database.id })); assert.equal(queried.records[0].id, record.record.id);
  var foreign = await call(w.scribe, w.sessions.scribe, "read_database", { databaseId: database.id }); assert.equal(foreign.isError, true); assert.match(foreign.content[0].text, /not found/i);
  var duplicate = await json(call(w.arch, w.sessions.arch, "create_database_record", { databaseId: database.id, expectedDatabaseRevision: database.revision, operationId: recordOperation, values: (function () { var values = {}; values[title] = "Alpha"; return values; })() })); assert.equal(duplicate.record.id, record.record.id);
  var retried = await json(call(w.arch, w.sessions.arch, "retry_database_sync", { databaseId: database.id })); assert.equal(retried.database.id, database.id);
});

test("static and stale-session descriptors fail closed", async function () {
  var w = workspace();
  var adapter = { createToolServer: function (definition) { return definition; } };

  var staticServer = w.arch.createMcpServer(adapter, null);
  assert.equal(staticServer.name, "clay-knowledge");
  assert.equal(staticServer.tools.length, MATE_TOOLS.length);
  for (var i = 0; i < staticServer.tools.length; i++) {
    assert.equal((await staticServer.tools[i].handler({})).isError, true, staticServer.tools[i].name);
  }

  // An impostor object with a matching localId is not the live session.
  var impostor = { localId: 1, cliSessionId: "cli-arch", ownerId: "alice" };
  assert.deepEqual(w.arch.getToolDefs(impostor), []);
  assert.equal((await w.arch.createMcpServer(adapter, impostor).tools[0].handler({})).isError, true);

  // A session that was live at bind time but has since been dropped.
  w.projects.get("mate-arch").getSessionManager().sessions.delete(1);
  assert.deepEqual(w.arch.getToolDefs(w.sessions.arch), []);
  assert.equal(w.arch.getSystemPrompt(w.sessions.arch), "");
});

// --- Clay cross-Mate ----------------------------------------------------

test("authoritative Clay reads across the same user's Mates and never across users", async function () {
  var w = workspace();
  var defs = w.clay.getToolDefs(w.sessions.clay);
  assert.deepEqual(defs.map(function (d) { return d.name; }), CLAY_TOOLS);
  for (var i = 0; i < defs.length; i++) {
    assert.equal(MATE_TOOLS.indexOf(defs[i].name), -1, "no tool name is advertised by both sets");
  }
  assert.equal(Object.keys(defs[0].inputSchema).indexOf("mateId") !== -1, true, "list accepts an explicit mateId");
  assert.equal(Object.keys(defs[2].inputSchema).indexOf("mateId"), -1, "read resolves an opaque ref, not a mateId");

  var all = await json(call(w.clay, w.sessions.clay, "list_mate_knowledge", { limit: 50 }));
  var mateIds = {};
  for (var j = 0; j < all.entries.length; j++) {
    assert.ok(all.entries[j].mateId, "Clay sees which Mate owns each record");
    mateIds[all.entries[j].mateId] = true;
  }
  assert.ok(mateIds.mate_arch && mateIds.mate_scribe, "Clay spans the user's Mates");
  assert.equal(mateIds.mate_bobmate, undefined, "another user's Mate is never included");
  assert.equal(JSON.stringify(all).indexOf("acquisition"), -1, "no cross-user content leaks");

  var scoped = await json(call(w.clay, w.sessions.clay, "list_mate_knowledge", { mateId: "mate_scribe" }));
  assert.equal(scoped.entries.length, 1);
  assert.equal(scoped.entries[0].mateName, "Scribe");

  var hits = await json(call(w.clay, w.sessions.clay, "search_mate_knowledge", { query: "exclamation marks" }));
  assert.equal(hits.total, 1);
  assert.equal(hits.results[0].mateId, "mate_scribe");
  assert.ok(hits.results[0].score > 0);
  assert.ok(hits.results[0].snippet.indexOf("exclamation") !== -1);

  var read = await json(call(w.clay, w.sessions.clay, "read_mate_knowledge", { ref: hits.results[0].ref }));
  assert.match(read.content, /No exclamation marks/);
  assert.equal(read.mateId, "mate_scribe");

  // Naming another user's Mate is refused, and its refs do not resolve.
  var crossUser = await call(w.clay, w.sessions.clay, "list_mate_knowledge", { mateId: "mate_bobmate" });
  assert.equal(crossUser.isError, true);
  assert.match(crossUser.content[0].text, /not found/i);

  var bobList = await json(call(w.bob, w.sessions.bob, "list_knowledge", {}));
  var bobRef = bobList.entries[0].ref;
  var stolen = await call(w.clay, w.sessions.clay, "read_mate_knowledge", { ref: bobRef });
  assert.equal(stolen.isError, true, "a ref resolves only inside the authorized user's Mate scopes");
});

test("a Mate that is not authoritative builtin Clay gets only its own scope", async function () {
  // Same Mate id and project, but the registry says it is not builtin Clay.
  var notClay = workspace({ clayKey: null });
  var defs = notClay.clay.getToolDefs(notClay.sessions.clay);
  assert.deepEqual(defs.map(function (d) { return d.name; }), MATE_TOOLS);
  var listed = await json(call(notClay.clay, notClay.sessions.clay, "list_knowledge", {}));
  assert.equal(listed.total, 1, "only its own record");
  assert.equal(listed.entries[0].mateId, undefined);

  // A non-host builtin is equally not Clay.
  var otherBuiltin = workspace({ clayKey: "researcher" });
  assert.deepEqual(otherBuiltin.clay.getToolDefs(otherBuiltin.sessions.clay).map(function (d) { return d.name; }), MATE_TOOLS);
});

// --- Project Driver -----------------------------------------------------

test("a non-Mate Project Driver session gets no Mate Knowledge at all", function () {
  var w = workspace();
  var adapter = { createToolServer: function (definition) { return definition; } };
  assert.deepEqual(w.driver.getToolDefs(w.sessions.driver), []);
  assert.deepEqual(w.driver.getToolDefs(null), []);
  assert.equal(w.driver.createMcpServer(adapter, w.sessions.driver), null);
  assert.equal(w.driver.createMcpServer(adapter, null), null, "no descriptor is advertised either");
  assert.deepEqual(w.driver.getBridgeTools(w.sessions.driver, function () { return {}; }), []);
  assert.equal(w.driver.getSystemPrompt(w.sessions.driver), "");
});

// --- Degraded content ---------------------------------------------------

test("an unreadable record is refused on read and excluded from ranking", async function () {
  var w = workspace();
  var scope = mateSync.scopeForMateDir(w.dirs.arch);
  var importer = knowledgeImport.createKnowledgeImporter({ scopeId: scope.scopeId, baseDir: w.baseDir });

  // A chunked record whose chunk is then tombstoned behind the reader's back.
  var big = new Array(30000).join("z");
  write(path.join(w.dirs.arch, "knowledge", "big.md"), big);
  mateSync.syncMateSource({ mateDir: w.dirs.arch, fileName: "big.md", baseDir: w.baseDir, actor: { type: "user" } });

  var before = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(before.total, 4);
  assert.equal(before.degraded, 0);

  importer.removeRecord(knowledgeImport.chunkKey("file:big.md", 1), { actor: { type: "system" } });

  var after = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(after.total, 3, "the damaged record is excluded, not half-listed");
  assert.equal(after.degraded, 1, "and the exclusion is reported, not silent");

  var searched = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "zzz" }));
  assert.equal(searched.degraded, 1);
  assert.equal(searched.results.filter(function (r) { return r.name === "big.md"; }).length, 0);
});

// --- Bounds and MCP wiring ---------------------------------------------

test("list, search, and read limits are enforced server-side", async function () {
  var w = workspace();
  var lines = [];
  for (var i = 0; i < 80; i++) lines.push(JSON.stringify({ date: "2026-05-01", topic: "topic " + i, summary: "bounded corpus entry " + i }));
  write(path.join(w.dirs.arch, "knowledge", "session-digests.jsonl"), lines.join("\n") + "\n");
  mateSync.syncMateSource({ mateDir: w.dirs.arch, fileName: "session-digests.jsonl", baseDir: w.baseDir, actor: { type: "agent" } });

  var huge = await json(call(w.arch, w.sessions.arch, "list_knowledge", { limit: 9999 }));
  assert.equal(huge.entries.length, 50, "the page size is clamped, not honoured verbatim");
  assert.ok(huge.total > 50);
  assert.ok(huge.nextCursor);

  var next = await json(call(w.arch, w.sessions.arch, "list_knowledge", { limit: 50, cursor: huge.nextCursor }));
  assert.notEqual(next.entries[0].ref, huge.entries[0].ref);

  var defaulted = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(defaulted.entries.length, 20, "the default page size is bounded too");

  var searched = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "bounded corpus", limit: 9999 }));
  assert.equal(searched.results.length, 50);
  assert.equal((await call(w.arch, w.sessions.arch, "search_knowledge", { query: "   " })).isError, true);

  // A read is clamped, not refused.
  var readAll = await json(call(w.arch, w.sessions.arch, "read_knowledge", { ref: huge.entries[0].ref, maxChars: 9999999 }));
  assert.ok(readAll.content.length <= 40000);
});

test("a large record reads back completely through continuable slices", async function () {
  var w = workspace();
  var body = "";
  for (var i = 0; i < 3000; i++) body += "paragraph " + i + " with ünïcode 漢字 🎉 content\n";
  assert.ok(body.length > 60000);
  write(path.join(w.dirs.scribe, "knowledge", "huge.md"), body);

  var listed = await json(call(w.scribe, w.sessions.scribe, "list_knowledge", {}));
  var ref = listed.entries.filter(function (e) { return e.name === "huge.md"; })[0].ref;

  var first = await json(call(w.scribe, w.sessions.scribe, "read_knowledge", { ref: ref }));
  assert.equal(first.offset, 0);
  assert.equal(first.totalChars, body.length);
  assert.equal(first.complete, false, "one response did not carry the whole record");
  assert.ok(first.nextOffset > 0);
  assert.equal(first.content.length, first.nextOffset, "the default slice is bounded");
  assert.equal(first.preview, undefined);

  // Page to the end and reassemble byte-exactly.
  var assembled = first.content;
  var offset = first.nextOffset;
  var pages = 1;
  while (offset !== null && pages < 200) {
    var next = await json(call(w.scribe, w.sessions.scribe, "read_knowledge", { ref: ref, offset: offset, maxChars: 20000 }));
    assert.equal(next.offset, offset);
    assert.equal(next.totalChars, body.length);
    assert.equal(next.complete, false, "a continuation is never reported as complete");
    assembled += next.content;
    offset = next.nextOffset;
    pages++;
  }
  assert.equal(offset, null, "paging terminates");
  assert.equal(assembled, body, "the slices reassemble exactly");
  assert.ok(pages > 2);

  // A small record is complete in one call.
  var small = listed.entries.filter(function (e) { return e.name === "style-guide.md"; })[0];
  var whole = await json(call(w.scribe, w.sessions.scribe, "read_knowledge", { ref: small.ref }));
  assert.equal(whole.complete, true);
  assert.equal(whole.nextOffset, null);
  assert.equal(whole.offset, 0);
  assert.match(whole.content, /No exclamation marks/);

  // Bounds are clamped server-side and a bad offset is refused.
  var clamped = await json(call(w.scribe, w.sessions.scribe, "read_knowledge", { ref: ref, maxChars: 9999999 }));
  assert.equal(clamped.content.length, 40000);
  var negative = await json(call(w.scribe, w.sessions.scribe, "read_knowledge", { ref: ref, offset: -5, maxChars: -1 }));
  assert.equal(negative.offset, 0);
  assert.equal(negative.content.length, 1, "maxChars is clamped to at least one character");
  var past = await call(w.scribe, w.sessions.scribe, "read_knowledge", { ref: ref, offset: body.length + 10 });
  assert.equal(past.isError, true);
  assert.match(past.content[0].text, /beyond the end/);

  // No slice ever ends inside a surrogate pair.
  for (var probe = 0; probe < 6; probe++) {
    var at = 8000 + probe;
    var sliced = await json(call(w.scribe, w.sessions.scribe, "read_knowledge", { ref: ref, offset: 0, maxChars: at }));
    var last = sliced.content.charCodeAt(sliced.content.length - 1);
    assert.equal(last >= 0xd800 && last <= 0xdbff, false, "a slice never ends on a lone high surrogate");
  }

  // Clay's cross-Mate read is continuable in the same way.
  var clayHits = await json(call(w.clay, w.sessions.clay, "search_mate_knowledge", { query: "paragraph" }));
  var clayRead = await json(call(w.clay, w.sessions.clay, "read_mate_knowledge", { ref: clayHits.results[0].ref, maxChars: 100 }));
  assert.equal(clayRead.complete, false);
  assert.equal(clayRead.nextOffset, 100);
  assert.equal(clayRead.totalChars, body.length);
  assert.equal(clayRead.mateId, "mate_scribe");
});

test("bridge advertising mirrors the adapter path without duplicates", async function () {
  var w = workspace();
  var normalize = function () { return { type: "object", properties: {} }; };

  var mateBridge = w.arch.getBridgeTools(w.sessions.arch, normalize);
  assert.equal(mateBridge.length, MATE_TOOLS.length);
  var seen = {};
  for (var i = 0; i < mateBridge.length; i++) {
    assert.equal(mateBridge[i].server, "clay-knowledge");
    assert.equal(seen[mateBridge[i].name], undefined, "no duplicate advertised tool");
    seen[mateBridge[i].name] = true;
  }
  assert.deepEqual(Object.keys(seen), MATE_TOOLS);
  assert.deepEqual(w.arch.getBridgeTools(null, normalize), []);

  var clayBridge = w.clay.getBridgeTools(w.sessions.clay, normalize);
  assert.deepEqual(clayBridge.map(function (t) { return t.name; }), CLAY_TOOLS);

  var listed = JSON.parse((await w.arch.callBridgeTool(w.sessions.arch, "list_knowledge", {})).content[0].text);
  assert.equal(listed.total, 3);
  await assert.rejects(function () { return w.arch.callBridgeTool(w.sessions.arch, "list_mate_knowledge", {}); }, /not found/);
  await assert.rejects(function () { return w.arch.callBridgeTool(null, "list_knowledge", {}); }, /valid Mate session/);

  var dynamic = w.arch.getDynamicToolDefs(w.sessions.arch);
  for (var d = 0; d < dynamic.length; d++) {
    assert.equal(dynamic[d].permissionName, "mcp__clay-knowledge__" + dynamic[d].name);
  }
});

test("system prompt guidance is scoped and carries no record dump", function () {
  var w = workspace();
  var matePrompt = w.arch.getSystemPrompt(w.sessions.arch);
  assert.match(matePrompt, /durable personal and expertise context you own/);
  assert.match(matePrompt, /project Logs are a separate, unrelated surface/);
  assert.match(matePrompt, /Do not enumerate or restate your Knowledge/);
  assert.equal(matePrompt.indexOf("append-only journal"), -1, "no record content is dumped into the prompt");
  assert.equal(matePrompt.indexOf("Scribe"), -1, "no other Mate is named");

  var clayPrompt = w.clay.getSystemPrompt(w.sessions.clay);
  assert.match(clayPrompt, /Mates belonging to the current user/);
  assert.match(clayPrompt, /cite the owning Mate/);
  assert.equal(clayPrompt.indexOf("exclamation"), -1);
  assert.notEqual(clayPrompt, matePrompt);
});

test("the two MCP tool sets are disjoint and unbound defs fail closed", async function () {
  var mate = knowledgeMcp.getToolDefs(null, false);
  var clay = knowledgeMcp.getToolDefs(null, true);
  assert.deepEqual(mate.map(function (d) { return d.name; }), MATE_TOOLS);
  assert.deepEqual(clay.map(function (d) { return d.name; }), CLAY_TOOLS);
  for (var i = 0; i < mate.length; i++) {
    assert.ok(mate[i].description.indexOf(knowledgeMcp.MATE_CONTRACT) === 0);
    assert.equal((await mate[i].handler({})).isError, true);
  }
  for (var j = 0; j < clay.length; j++) {
    assert.ok(clay[j].description.indexOf(knowledgeMcp.CLAY_CONTRACT) === 0);
    assert.equal((await clay[j].handler({})).isError, true);
  }
  assert.equal(knowledgeMcp.createMcpServer(null, null, false), null);
});

// --- Tail search beyond the old truncation limit ------------------------

test("a match far beyond 20k characters is still found, including CJK", async function () {
  var w = workspace();
  // Filler that must not match, then the only occurrence of the needles well
  // past the old 20000-character field truncation limit.
  var filler = "";
  for (var i = 0; i < 4000; i++) filler += "routine filler paragraph number " + i + " about nothing in particular\n";
  assert.ok(filler.length > 60000);
  var body = filler + "\nThe hexokinase pathway note lives here.\n재고 관리 시스템 설계를 논의했다\n";
  var needleAt = body.indexOf("hexokinase");
  assert.ok(needleAt > 60000, "the needle sits far past the old truncation point");

  write(path.join(w.dirs.arch, "knowledge", "long-notes.md"), body);

  var hits = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "hexokinase" }));
  assert.equal(hits.total, 1, "a tail-only match is findable");
  assert.equal(hits.results[0].name, "long-notes.md");
  assert.ok(hits.results[0].score > 0);
  assert.ok(hits.results[0].snippet.indexOf("hexokinase") !== -1, "the snippet centres on the tail match");

  // CJK tail content routes through the shared tokenizer's bigrams.
  var cjk = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "재고 관리" }));
  var names = cjk.results.map(function (r) { return r.name; });
  assert.ok(names.indexOf("long-notes.md") !== -1, "a CJK tail match is findable");

  // One item yields one result, however many segments it was indexed as.
  assert.equal(hits.results.filter(function (r) { return r.name === "long-notes.md"; }).length, 1);

  // Clay finds the same tail content across the user's Mates.
  var clayHits = await json(call(w.clay, w.sessions.clay, "search_mate_knowledge", { query: "hexokinase" }));
  assert.equal(clayHits.total, 1);
  assert.equal(clayHits.results[0].mateId, "mate_arch");
});

test("segmentation preserves anchor weighting and collapses to best segment", function () {
  var tail = "";
  for (var i = 0; i < 4000; i++) tail += "filler line " + i + "\n";
  var items = [
    { id: "titled", name: "durability.md", body: "unrelated body" },
    { id: "tail", name: "misc.md", body: tail + "\ndurability appears only at the very end\n" },
    { id: "none", name: "other.md", body: "nothing relevant" },
  ];
  function project(item) {
    return { id: item.id, fields: [{ text: item.name, weight: 3 }, { text: item.body, weight: 1 }], meta: item };
  }

  var segments = knowledgeSearch.segmentTexts(project(items[1]).fields);
  assert.ok(segments.length > 1, "a long body is segmented, not truncated");
  for (var s = 0; s < segments.length; s++) {
    assert.ok(segments[s].indexOf("misc.md") !== -1, "the name anchors every segment");
    assert.ok(segments[s].split("misc.md").length - 1 >= 3, "anchor weighting is identical in each segment");
  }

  var ranked = knowledgeSearch.rank(items, "durability", project, 10);
  var ids = ranked.map(function (r) { return r.id; });
  assert.ok(ids.indexOf("tail") !== -1, "the tail match is ranked at all");
  assert.equal(ids.indexOf("none"), -1);
  assert.equal(ids.filter(function (id) { return id === "tail"; }).length, 1, "segments collapse to one result");
  assert.equal(ids[0], "titled", "a name hit still outranks a body-tail hit");

  // Deterministic and stable across repeated runs.
  assert.deepEqual(knowledgeSearch.rank(items, "durability", project, 10).map(function (r) { return r.id; }), ids);
  assert.equal(knowledgeSearch.rank(items, "durability", project, 1).length, 1, "maxResults applies after collapsing");
});

// --- Direct filesystem divergence --------------------------------------

test("a direct filesystem edit is visible on the next tool call", async function () {
  var w = workspace();
  var before = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(before.total, 3);
  assert.equal((await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "phosphorylase" }))).total, 0);

  // Written straight to disk, exactly as a Bash tool call would.
  write(path.join(w.dirs.arch, "knowledge", "bash-written.md"), "# Added out of band\nphosphorylase kinetics summary\n");

  var after = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(after.total, 4, "the new file is visible without a daemon restart");
  var found = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "phosphorylase" }));
  assert.equal(found.total, 1);
  var read = await json(call(w.arch, w.sessions.arch, "read_knowledge", { ref: found.results[0].ref }));
  assert.match(read.content, /phosphorylase kinetics/);

  // An edit to an existing file is picked up too.
  write(path.join(w.dirs.arch, "knowledge", "bash-written.md"), "# Added out of band\nrevised kinetics summary\n");
  assert.equal((await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "phosphorylase" }))).total, 0);
  assert.equal((await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "revised kinetics" }))).total, 1);

  // A deletion is reflected immediately, not left as a stale live record.
  fs.unlinkSync(path.join(w.dirs.arch, "knowledge", "bash-written.md"));
  var afterDelete = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(afterDelete.total, 3);
  assert.equal(afterDelete.entries.filter(function (e) { return e.name === "bash-written.md"; }).length, 0);
  var gone = await call(w.arch, w.sessions.arch, "read_knowledge", { ref: found.results[0].ref });
  assert.equal(gone.isError, true, "a deleted record no longer resolves");

  // Repeated no-op calls append nothing to the record store.
  var scope = mateSync.scopeForMateDir(w.dirs.arch);
  var importer = knowledgeImport.createKnowledgeImporter({ scopeId: scope.scopeId, baseDir: w.baseDir });
  var records = importer.stats().records;
  await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "architecture" }));
  await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(importer.stats().records, records, "an idempotent refresh appends nothing");
});

test("reconciliation never reaches outside the authorized scopes", async function () {
  var w = workspace();
  var bobScope = mateSync.scopeForMateDir(w.dirs.bob);
  var bobImporter = knowledgeImport.createKnowledgeImporter({ scopeId: bobScope.scopeId, baseDir: w.baseDir });
  var bobBefore = bobImporter.stats().records;

  // Bob writes directly to disk. Alice's Mates and Clay must not touch it.
  write(path.join(w.dirs.bob, "knowledge", "bob-secret.md"), "# Secret\nacquisition target shortlist\n");

  await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  await json(call(w.clay, w.sessions.clay, "list_mate_knowledge", { limit: 50 }));
  await json(call(w.clay, w.sessions.clay, "search_mate_knowledge", { query: "acquisition" }));

  assert.equal(bobImporter.stats().records, bobBefore, "another user's scope is never reconciled");
  var clayView = await json(call(w.clay, w.sessions.clay, "search_mate_knowledge", { query: "acquisition" }));
  assert.equal(clayView.total, 0, "and its content is never visible");

  // Bob's own session does see it, through his own authorized scope.
  var bobView = await json(call(w.bob, w.sessions.bob, "search_knowledge", { query: "shortlist" }));
  assert.equal(bobView.total, 1);
  assert.equal(bobView.results[0].name, "bob-secret.md");
  assert.ok(bobImporter.stats().records > bobBefore, "reconciled only by its own owner");
});

// --- Captured handler identity -----------------------------------------

test("a captured tool handler stops working when its exact session goes away", async function () {
  var w = workspace();
  var defs = w.arch.getToolDefs(w.sessions.arch);
  var listTool = defs[0];
  assert.equal((await json(listTool.handler({}))).total, 3, "valid while the session is live");

  // The exact session object is dropped from the manager after the handler
  // was created. The captured handler must not keep working.
  w.projects.get("mate-arch").getSessionManager().sessions.delete(1);
  var afterDrop = await listTool.handler({});
  assert.equal(afterDrop.isError, true, "identity is re-derived on every call");
  assert.match(afterDrop.content[0].text, /no longer valid/);

  // Restoring the exact same object restores the capability.
  w.projects.get("mate-arch").getSessionManager().sessions.set(1, w.sessions.arch);
  assert.equal((await json(listTool.handler({}))).total, 3);

  // A registry change that would alter the tool set also invalidates.
  var clayDefs = w.clay.getToolDefs(w.sessions.clay);
  assert.equal((await json(clayDefs[0].handler({ limit: 50 }))).entries.length > 0, true);
  w.registry.mate_clay.builtinKey = null;
  var demoted = await clayDefs[0].handler({ limit: 50 });
  assert.equal(demoted.isError, true, "a Mate that is no longer Clay loses the cross-Mate view");
});

// --- Fail-closed refresh -------------------------------------------------

// Reconciliation reports a failure for exactly one source, leaving its previous
// record in place. That record must not be served.
function breakSource(mateDir, fileName, options) {
  var settings = options || {};
  var real = mateSync.reconcileMate;
  mateSync.reconcileMate = function (opts) {
    var summary = real(opts);
    // Only the named Mate fails, so the blast radius of a failure is exactly
    // what the test is asserting about.
    if (opts && opts.mateDir === mateDir) {
      summary.failed++;
      summary.errors.push(settings.unattributable
        ? { scopeId: "x", message: "something went wrong" }
        : { scopeId: "x", file: fileName, message: "Unreadable source" });
    }
    return summary;
  };
  return function () { mateSync.reconcileMate = real; };
}

test("a source that fails to reconcile is withheld, not served from stale content", async function () {
  var w = workspace();
  var before = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(before.total, 3);
  var stale = before.entries.filter(function (e) { return e.name === "architecture.md"; })[0];
  assert.ok(stale, "the record exists while reconciliation succeeds");
  assert.equal((await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "append-only journal" }))).total, 1);

  var restore = breakSource(w.dirs.arch, "architecture.md");
  try {
    var listed = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
    assert.equal(listed.entries.filter(function (e) { return e.name === "architecture.md"; }).length, 0,
      "the failed source is absent, not stale");
    assert.equal(listed.total, 2, "unaffected sources remain when attribution is exact");
    assert.equal(listed.degraded, 1, "and the exclusion is reported");
    assert.equal(listed.degradedScopes, 0);

    var searched = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "append-only journal" }));
    assert.equal(searched.total, 0, "stale content is not searchable either");
    assert.equal(searched.degraded, 1);

    var read = await call(w.arch, w.sessions.arch, "read_knowledge", { ref: stale.ref });
    assert.equal(read.isError, true, "the previous content is refused, not returned");
    assert.match(read.content[0].text, /could not be brought up to date/);

    // The digest lines from an unaffected source still read normally.
    var other = listed.entries.filter(function (e) { return e.kind === "session-digest"; })[0];
    assert.ok(other);
    assert.equal((await json(call(w.arch, w.sessions.arch, "read_knowledge", { ref: other.ref }))).complete, true);
  } finally {
    restore();
  }

  // Once reconciliation succeeds again, the source comes back.
  var after = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  assert.equal(after.total, 3);
  assert.equal(after.degraded, 0);
  assert.equal((await json(call(w.arch, w.sessions.arch, "read_knowledge", { ref: stale.ref }))).complete, true);
});

test("an unattributable refresh failure withholds the whole scope for that call", async function () {
  var w = workspace();
  var before = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  var anyRef = before.entries[0].ref;

  var restore = breakSource(w.dirs.arch, null, { unattributable: true });
  try {
    var listed = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
    assert.equal(listed.total, 0, "no record is served when the stale one cannot be identified");
    assert.equal(listed.degradedScopes, 1);
    assert.ok(listed.degraded > 0);

    var searched = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "journal" }));
    assert.equal(searched.total, 0);
    assert.equal(searched.degradedScopes, 1);

    var read = await call(w.arch, w.sessions.arch, "read_knowledge", { ref: anyRef });
    assert.equal(read.isError, true);
    assert.match(read.content[0].text, /withheld/);

    // Clay spanning several Mates loses only the failing scope.
    var clayView = await json(call(w.clay, w.sessions.clay, "list_mate_knowledge", { limit: 50 }));
    assert.equal(clayView.entries.filter(function (e) { return e.mateId === "mate_arch"; }).length, 0);
    assert.ok(clayView.entries.filter(function (e) { return e.mateId === "mate_scribe"; }).length > 0,
      "other Mates are unaffected");
    assert.equal(clayView.degradedScopes, 1);
  } finally {
    restore();
  }

  assert.equal((await json(call(w.arch, w.sessions.arch, "list_knowledge", {}))).total, before.total);
});

// --- Honest search coverage ---------------------------------------------

test("search reports incomplete index coverage instead of implying completeness", async function () {
  var w = workspace();
  var small = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "journal" }));
  assert.equal(small.incompleteCoverage, 0, "an ordinary corpus is fully covered");
  assert.equal(small.coveredCharsPerRecord, knowledgeSearch.MAX_INDEXED_CHARS);

  // A record whose searchable text runs past the indexed bound.
  var unit = "filler segment text abcdef\n";
  var body = "";
  while (body.length < knowledgeSearch.MAX_INDEXED_CHARS + 40000) body += unit;
  var needle = "pyrophosphatase";
  body += "\n" + needle + " appears only past the indexed bound\n";
  assert.ok(body.indexOf(needle) > knowledgeSearch.MAX_INDEXED_CHARS);
  write(path.join(w.dirs.arch, "knowledge", "enormous.md"), body);

  var hits = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: "filler segment" }));
  assert.equal(hits.incompleteCoverage, 1, "the partially indexed record is counted");
  assert.equal(hits.coveredCharsPerRecord, knowledgeSearch.MAX_INDEXED_CHARS);
  assert.ok(hits.results.length > 0);

  // The tail term cannot be ranked, and the response says coverage was partial
  // rather than implying the term is absent.
  var tail = await json(call(w.arch, w.sessions.arch, "search_knowledge", { query: needle }));
  assert.equal(tail.total, 0);
  assert.equal(tail.incompleteCoverage, 1, "an empty result is qualified, not silent");

  // Ordinary Mate results still expose no other Mate identity.
  assert.equal(JSON.stringify(hits).indexOf("mate_"), -1);
  assert.equal(JSON.stringify(tail).indexOf("mate_"), -1);
  for (var i = 0; i < hits.results.length; i++) {
    assert.equal(hits.results[i].mateId, undefined);
    assert.equal(hits.results[i].mateName, undefined);
  }

  // Clay sees the same honest accounting, with owner attribution.
  var clayHits = await json(call(w.clay, w.sessions.clay, "search_mate_knowledge", { query: "filler segment" }));
  assert.equal(clayHits.incompleteCoverage, 1);
  assert.equal(clayHits.results[0].mateId, "mate_arch");

  // The full record is still readable in full, even though it is not fully indexed.
  var listed = await json(call(w.arch, w.sessions.arch, "list_knowledge", {}));
  var ref = listed.entries.filter(function (e) { return e.name === "enormous.md"; })[0].ref;
  var read = await json(call(w.arch, w.sessions.arch, "read_knowledge", { ref: ref, maxChars: 40000 }));
  assert.equal(read.totalChars, body.length);
  assert.equal(read.complete, false);
});

test("coverage accounting is deterministic and matches what is indexed", function () {
  var short = [{ text: "title.md", weight: 3 }, { text: "small body", weight: 1 }];
  var shortCoverage = knowledgeSearch.coverage(short);
  assert.equal(shortCoverage.complete, true);
  assert.equal(shortCoverage.indexedChars, shortCoverage.totalChars);

  var body = new Array(knowledgeSearch.MAX_INDEXED_CHARS + 50000).join("a");
  var long = [{ text: "title.md", weight: 3 }, { text: body, weight: 1 }];
  var longCoverage = knowledgeSearch.coverage(long);
  assert.equal(longCoverage.complete, false);
  assert.equal(longCoverage.totalChars, "title.md".length + body.length);
  assert.equal(longCoverage.indexedChars, "title.md".length + knowledgeSearch.MAX_INDEXED_CHARS);
  assert.equal(knowledgeSearch.segmentTexts(long).length, knowledgeSearch.MAX_SEGMENTS_PER_ITEM,
    "the segment cap is respected");
  assert.deepEqual(knowledgeSearch.coverage(long), longCoverage, "repeated accounting is identical");

  // Exactly at the bound is complete.
  var exact = [{ text: new Array(knowledgeSearch.MAX_INDEXED_CHARS + 1).join("b"), weight: 1 }];
  assert.equal(knowledgeSearch.coverage(exact).complete, true);
});
