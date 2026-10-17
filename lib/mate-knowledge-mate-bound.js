// Ordinary Mate Knowledge bindings. The service supplies live validation and
// the already-authorized scope; this module only exposes the Mate operations.

function createMateBound(options) {
  var settings = options || {};
  var revalidate = settings.revalidate;
  var initial = settings.initial;

  function ownScope() {
    return [revalidate().own];
  }
  function db(method, args) {
    var current = revalidate();
    if (!current.databaseService || typeof current.databaseService[method] !== "function") throw new Error("Knowledge databases are unavailable for this Mate.");
    return current.databaseService[method](Object.assign({}, args || {}, { actor: current.actor }));
  }
  function text(method, args) {
    var current = revalidate();
    return settings.textTools[method](current.own, args || {}, current.actor);
  }
  return {
    isClay: false,
    mateId: initial.own.mateId,
    scopeId: initial.own.scopeId,
    listKnowledge: function (args) { return settings.listFor(ownScope(), args || {}, false); },
    searchKnowledge: function (args) { return settings.searchFor(ownScope(), args || {}, false); },
    readKnowledge: function (args) { return settings.readFor(ownScope(), args || {}, false); },
    readKnowledgeDocument: function (args) { return text("read", args); },
    createKnowledgeDocument: function (args) { return text("create", args); },
    updateKnowledgeDocument: function (args) { return text("update", args); },
    listKnowledgeDocumentHistory: function (args) { return text("history", args); },
    restoreKnowledgeDocument: function (args) { return text("restore", args); },
    listDatabases: function (args) { return db("list", args); },
    createDatabase: function (args) { return db("create", args); },
    readDatabase: function (args) { return db("read", args); },
    renameDatabase: function (args) { return db("rename", args); },
    archiveDatabase: function (args) { return db("archive", args); },
    recoverDatabase: function (args) { return db("recover", args); },
    updateDatabaseSchema: function (args) { return db("updateSchema", args); },
    saveTableView: function (args) { return db("saveView", args); },
    queryDatabase: function (args) { return db("query", args); },
    createDatabaseRecord: function (args) { return db("createRecord", args); },
    readDatabaseRecord: function (args) { return db("readRecord", args); },
    updateDatabaseRecord: function (args) { return db("updateRecord", args); },
    archiveDatabaseRecord: function (args) { return db("archiveRecord", args); },
    recoverDatabaseRecord: function (args) { return db("recoverRecord", args); },
    retryDatabaseSync: function (args) { return db("retryProjection", args); },
    importDatabaseRecords: function (args) { return db("importRecords", args); },
    readDatabaseImportProgress: function (args) { return db("readImportProgress", args); },
  };
}

module.exports = { createMateBound: createMateBound };
