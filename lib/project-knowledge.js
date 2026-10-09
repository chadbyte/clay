var path = require("path");
var mateSync = require("./mate-knowledge-sync");
var knowledgeFiles = require("./knowledge-file-store");

var SEARCH_FILE_LIMIT = 100;
var SEARCH_BYTE_LIMIT = 4 * 1024 * 1024;

function attachKnowledge(ctx) {
  var cwd = ctx.cwd;
  var isMate = ctx.isMate;
  var sendTo = ctx.sendTo;
  var matesModule = ctx.matesModule;
  var getProjectOwnerId = ctx.getProjectOwnerId;
  var files = knowledgeFiles.createKnowledgeFileStore(cwd);

  function canWrite(ws) {
    if (typeof ctx.canManageKnowledge === "function") return ctx.canManageKnowledge(ws) === true;
    var ownerId = getProjectOwnerId();
    return !ownerId || !!(ws && ws._clayUser && ws._clayUser.id === ownerId);
  }

  function actor(ws) {
    var user = (ws && ws._clayUser) || null;
    return { type: user ? "user" : "system", userId: user ? user.id : null, displayName: user ? (user.displayName || user.username) : null };
  }

  function mirror(ws, name) {
    if (!isMate) return { ok: true, names: [] };
    var summary = mateSync.syncMateSource({ mateDir: cwd, fileName: name, baseDir: ctx.knowledgeBaseDir, actor: actor(ws) });
    return { ok: !!summary && summary.failed === 0, names: [name], error: summary && summary.errors[0] ? summary.errors[0].message : "Knowledge index synchronization failed." };
  }

  function mirrorMany(ws, names) {
    var failures = [];
    for (var i = 0; i < names.length; i++) {
      var mirrored = mirror(ws, names[i]);
      if (!mirrored.ok) failures.push(mirrored.error);
    }
    return { ok: failures.length === 0, names: names.slice(), error: failures[0] || null };
  }

  function addSyncState(payload, sync) {
    if (sync.ok) return payload;
    return Object.assign(payload, { indexSyncPending: true, syncNames: sync.names, syncError: sync.error });
  }

  function listKnowledgeFiles() {
    var listed = files.list();
    for (var i = 0; i < listed.length; i++) listed[i].common = false;
    if (!isMate) return listed;
    var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
    var thisMateId = path.basename(cwd);
    for (var p = 0; p < listed.length; p++) listed[p].promoted = matesModule.isPromoted(mateCtx, thisMateId, listed[p].name);
    var common = matesModule.getCommonKnowledgeForMate(mateCtx, thisMateId);
    for (var c = 0; c < common.length; c++) {
      if (common[c].ownMateId !== thisMateId) listed.push(Object.assign({}, common[c], { writable: false, revision: null }));
    }
    return listed;
  }

  function response(ws, msg, payload) {
    sendTo(ws, Object.assign({ requestId: msg.requestId || null }, payload));
  }

  function failure(ws, msg, error, extra) {
    response(ws, msg, Object.assign({ type: "knowledge_error", operation: msg.type, name: msg.name || msg.from || null,
      code: error.code || "FAILED", error: error.message || "Knowledge operation failed.", currentRevision: error.currentRevision || null }, extra || {}));
  }

  function requireWrite(ws, msg) {
    if (canWrite(ws)) return true;
    failure(ws, msg, Object.assign(new Error("Only the Mate owner can change Knowledge documents."), { code: "FORBIDDEN" }));
    return false;
  }

  function readEntry(file) {
    if (file.common && file.ownMateId && isMate) {
      var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
      return matesModule.readCommonKnowledgeFile(mateCtx, file.ownMateId, file.name);
    }
    return files.read(file.name).content;
  }

  function searchFiles(query) {
    var needle = String(query || "").trim().toLowerCase().slice(0, 200);
    if (!needle) return [];
    var listed = listKnowledgeFiles();
    var matches = [];
    var bytes = 0;
    for (var i = 0; i < listed.length && i < SEARCH_FILE_LIMIT && bytes < SEARCH_BYTE_LIMIT; i++) {
      var file = listed[i];
      if (file.name.toLowerCase().indexOf(needle) !== -1) { matches.push(file); continue; }
      try {
        var content = readEntry(file);
        var size = Buffer.byteLength(content, "utf8");
        bytes += size;
        if (bytes <= SEARCH_BYTE_LIMIT && content.toLowerCase().indexOf(needle) !== -1) matches.push(file);
      } catch (error) {}
    }
    return matches;
  }

  function handleKnowledgeMessage(ws, msg) {
    if (msg.type === "knowledge_list") {
      try { response(ws, msg, { type: "knowledge_list", files: listKnowledgeFiles() }); } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_search") {
      try { response(ws, msg, { type: "knowledge_search_results", query: String(msg.query || ""), files: searchFiles(msg.query) }); } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_read") {
      try {
        if (msg.common && msg.ownMateId && isMate) {
          if (!knowledgeFiles.validName(msg.name)) throw new Error("Invalid knowledge file name.");
          var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
          response(ws, msg, { type: "knowledge_content", name: msg.name, content: matesModule.readCommonKnowledgeFile(mateCtx, msg.ownMateId, msg.name), common: true, ownMateId: msg.ownMateId, writable: false, revision: null });
        } else {
          var item = files.read(msg.name);
          response(ws, msg, { type: "knowledge_content", name: item.name, content: item.content, revision: item.revision, writable: item.name.endsWith(".md") && canWrite(ws) });
        }
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_save") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var saved = files.save(msg.name, msg.content, msg.expectedRevision || null);
        var savedSync = mirror(ws, saved.name);
        response(ws, msg, addSyncState({ type: "knowledge_saved", name: saved.name, revision: saved.revision }, savedSync));
        sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_rename") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var renamed = files.rename(msg.from, msg.name, msg.expectedRevision || null);
        var renameSync = mirrorMany(ws, [msg.from, renamed.name]);
        response(ws, msg, addSyncState({ type: "knowledge_renamed", from: msg.from, name: renamed.name, revision: renamed.revision }, renameSync));
        sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_delete") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var removed = files.remove(msg.name, msg.expectedRevision || null);
        var deleteSync = mirror(ws, removed.name);
        response(ws, msg, addSyncState({ type: "knowledge_deleted", name: removed.name }, deleteSync));
        sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_sync") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var syncNames = Array.isArray(msg.names) ? msg.names.slice(0, 4) : [msg.name];
        if (!syncNames.length) throw new Error("A Knowledge source is required.");
        for (var n = 0; n < syncNames.length; n++) if (!knowledgeFiles.validName(syncNames[n])) throw new Error("Invalid knowledge file name.");
        var retrySync = mirrorMany(ws, syncNames);
        if (!retrySync.ok) throw Object.assign(new Error(retrySync.error), { code: "SYNC_FAILED" });
        response(ws, msg, { type: "knowledge_synced", names: syncNames });
      } catch (error) { failure(ws, msg, error, { diskCommitted: true, names: msg.names || [msg.name] }); }
      return true;
    }
    if (msg.type === "knowledge_promote" || msg.type === "knowledge_depromote") {
      if (!isMate || !requireWrite(ws, msg)) return true;
      try {
        if (!knowledgeFiles.validName(msg.name)) throw new Error("Invalid knowledge file name.");
        var promoteCtx = matesModule.buildMateCtx(getProjectOwnerId());
        var mateId = path.basename(cwd);
        if (msg.type === "knowledge_promote") {
          var mate = matesModule.getMate(promoteCtx, mateId);
          matesModule.promoteKnowledge(promoteCtx, mateId, mate && mate.name, msg.name);
        } else matesModule.depromoteKnowledge(promoteCtx, mateId, msg.name);
        response(ws, msg, { type: msg.type === "knowledge_promote" ? "knowledge_promoted" : "knowledge_depromoted", name: msg.name });
        sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    return false;
  }

  return { handleKnowledgeMessage: handleKnowledgeMessage, listKnowledgeFiles: listKnowledgeFiles };
}

module.exports = { attachKnowledge: attachKnowledge };
