var path = require("path");
var crypto = require("crypto");
var mateSync = require("./mate-knowledge-sync");
var knowledgeFiles = require("./knowledge-file-store");
var markdown = require("./knowledge-markdown");
var draftStore = require("./knowledge-draft-store");
var documentIndexModule = require("./knowledge-document-index");

function attachKnowledge(ctx) {
  var cwd = ctx.cwd;
  var isMate = ctx.isMate;
  var sendTo = ctx.sendTo;
  var matesModule = ctx.matesModule;
  var getProjectOwnerId = ctx.getProjectOwnerId;
  var metadataKey = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 24);
  var metadataRoot = path.join(ctx.knowledgeBaseDir || path.join(cwd, ".clay"), "knowledge-documents", metadataKey);
  var files = knowledgeFiles.createKnowledgeFileStore(cwd, { metaDir: metadataRoot });
  var drafts = draftStore.createKnowledgeDraftStore(ctx.knowledgeBaseDir || path.join(cwd, ".clay"), path.resolve(cwd));
  var indexer = documentIndexModule.createKnowledgeDocumentIndex({ list: listKnowledgeFiles, read: readEntry, maxDocumentBytes: knowledgeFiles.MAX_CONTENT_BYTES });

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
      if (common[c].ownMateId !== thisMateId) listed.push(Object.assign({}, common[c], { id: "shared:" + common[c].ownMateId + ":" + common[c].name,
        itemType: /\.jsonl$/i.test(common[c].name) ? "db" : "text", writable: false, revision: null }));
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

  function documentIndex() {
    return indexer.reconcile();
  }

  function findDocument(index, name, id) {
    var matches;
    if (id) { matches = index.filter(function (item) { return item.id === id; }); return matches.length === 1 ? matches[0] : null; }
    matches = index.filter(function (item) { return item.name === name; });
    return matches.length === 1 ? matches[0] : null;
  }

  function linksFor(index, target) {
    var outgoing = []; var backlinks = [];
    for (var i = 0; i < target.parsed.links.length; i++) {
      var link = target.parsed.links[i]; var resolved = markdown.resolveLink(target.name, link, index, target.id);
      var headingValid = !link.heading || !!(resolved && resolved.parsed.headings.some(function (heading) { return heading.slug === markdown.slug(link.heading); }));
      outgoing.push({ kind: link.kind, raw: link.raw, label: link.alias || link.target || link.heading, target: link.target, heading: link.heading,
        headingValid: headingValid, documentId: resolved && resolved.id || null, documentKey: resolved && resolved.key || null,
        name: resolved && resolved.name || null, external: link.external === true, self: !link.target && !!link.heading, unresolved: !resolved && !link.external });
    }
    for (var d = 0; d < index.length; d++) {
      if (index[d] === target) continue;
      for (var l = 0; l < index[d].parsed.links.length; l++) {
        var resolvedTarget = markdown.resolveLink(index[d].name, index[d].parsed.links[l], index, index[d].id);
        if (resolvedTarget && resolvedTarget.id === target.id) {
          backlinks.push({ documentId: index[d].id, documentKey: index[d].key, name: index[d].name, heading: index[d].parsed.links[l].heading,
            snippet: markdown.snippet(index[d].content, index[d].parsed.links[l].start) }); break;
        }
      }
    }
    return { outgoing: outgoing, backlinks: backlinks };
  }

  function relativeLink(from, to, withExtension) {
    var value = path.posix.relative(path.posix.dirname(from), to) || path.posix.basename(to);
    if (withExtension === false) value = value.replace(/\.md$/i, "");
    return value;
  }

  function rewriteMoveLinks(index, target, nextName) {
    var changes = [];
    for (var i = 0; i < index.length; i++) {
      var source = index[i];
      if (source.common || source.itemType === "db" || !source.writable) continue;
      var replacements = [];
      for (var l = 0; l < source.parsed.links.length; l++) {
        var link = source.parsed.links[l]; var resolved = markdown.resolveLink(source.name, link, index, source.id);
        if (!resolved || source.id !== target.id && resolved.id !== target.id) continue;
        var sourceAfter = source.id === target.id ? nextName : source.name;
        var targetAfter = resolved.id === target.id ? nextName : resolved.name;
        var nextTarget = relativeLink(sourceAfter, targetAfter, link.kind === "markdown" || link.kind === "image");
        var suffix = link.heading ? "#" + link.heading : ""; var replacement;
        if (link.kind === "wiki" || link.kind === "embed") replacement = (link.kind === "embed" ? "!" : "") + "[[" + nextTarget + suffix + (link.alias ? "|" + link.alias : "") + "]]";
        else replacement = (link.kind === "image" ? "!" : "") + "[" + link.alias + "](" + nextTarget + suffix + ")";
        replacements.push({ start: link.start, end: link.end, value: replacement });
      }
      if (!replacements.length) continue;
      var content = source.content;
      for (var r = replacements.length - 1; r >= 0; r--) content = content.slice(0, replacements[r].start) + replacements[r].value + content.slice(replacements[r].end);
      changes.push({ id: source.id, name: source.name, revision: source.revision, content: content, count: replacements.length });
    }
    return changes;
  }

  function searchFiles(query, offset, limit) {
    return indexer.search(query, offset, limit);
  }

  function handleKnowledgeMessage(ws, msg) {
    if (msg.type === "knowledge_list") {
      try { response(ws, msg, { type: "knowledge_list", files: listKnowledgeFiles(), drafts: drafts.list(ws && ws._clayUser && ws._clayUser.id || "system") }); } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_search") {
      try { response(ws, msg, Object.assign({ type: "knowledge_search_results", query: String(msg.query || "") }, searchFiles(msg.query, msg.offset, msg.limit))); } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_read") {
      try {
        if (msg.common && msg.ownMateId && isMate) {
          if (!knowledgeFiles.validName(msg.name)) throw new Error("Invalid knowledge file name.");
          var mateCtx = matesModule.buildMateCtx(getProjectOwnerId());
          var sharedContent = matesModule.readCommonKnowledgeFile(mateCtx, msg.ownMateId, msg.name);
          var sharedParsed = markdown.parse(sharedContent); var sharedIndexState = documentIndex();
          var sharedIndexed = findDocument(sharedIndexState.documents, msg.name, msg.documentId); var sharedRelations = sharedIndexed ? linksFor(sharedIndexState.documents, sharedIndexed) : { outgoing: [], backlinks: [] };
          response(ws, msg, { type: "knowledge_content", name: msg.name, content: sharedContent, common: true, ownMateId: msg.ownMateId, writable: false, revision: null,
            outline: sharedParsed.headings, outgoing: sharedRelations.outgoing, backlinks: sharedRelations.backlinks,
            properties: sharedParsed.properties, tags: sharedParsed.tags, propertyErrors: sharedParsed.propertyErrors,
            indexComplete: sharedIndexState.complete, indexErrors: sharedIndexState.errors });
        } else {
          var item = files.read(msg.name);
          var indexState = documentIndex(); var indexed = findDocument(indexState.documents, item.name, msg.documentId || item.id); var relations = indexed ? linksFor(indexState.documents, indexed) : { outgoing: [], backlinks: [] };
          var parsed = indexed ? indexed.parsed : markdown.parse(item.content);
          var userId = ws && ws._clayUser && ws._clayUser.id || "system"; var recovered = drafts.read(userId, item.id);
          response(ws, msg, { type: "knowledge_content", id: item.id, name: item.name, content: item.content, revision: item.revision, itemType: item.itemType,
            writable: item.itemType === "text" && canWrite(ws), outline: parsed.headings, outgoing: relations.outgoing, backlinks: relations.backlinks,
            properties: parsed.properties, tags: parsed.tags, propertyErrors: parsed.propertyErrors, recoveredDraft: recovered,
            indexComplete: indexState.complete, indexErrors: indexState.errors });
        }
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_save") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var saved = files.save(msg.name, msg.content, msg.expectedRevision || null);
        var savedSync = mirror(ws, saved.name);
        if (msg.documentId) drafts.remove(ws._clayUser && ws._clayUser.id || "system", msg.documentId, msg.draftVersion);
        response(ws, msg, addSyncState({ type: "knowledge_saved", id: saved.id, name: saved.name, revision: saved.revision }, savedSync));
        sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_rename") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var beforeMoveState = documentIndex(); var beforeMove = beforeMoveState.documents; var moveTarget = findDocument(beforeMove, msg.from, msg.documentId); var linkChanges = moveTarget ? rewriteMoveLinks(beforeMove, moveTarget, msg.name) : [];
        var renamed = files.rename(msg.from, msg.name, msg.expectedRevision || null); var linkUpdateFailures = []; var updatedLinks = 0;
        var updatedDocuments = []; var mirrorNames = [msg.from, renamed.name];
        for (var u = 0; u < linkChanges.length; u++) {
          var change = linkChanges[u]; var writeName = change.id === renamed.id ? renamed.name : change.name; var expected = change.id === renamed.id ? renamed.revision : change.revision;
          try { var rewritten = files.save(writeName, change.content, expected); updatedLinks += change.count; updatedDocuments.push(rewritten); mirrorNames.push(rewritten.name); }
          catch (linkError) { linkUpdateFailures.push({ name: writeName, error: linkError.message }); }
        }
        renamed = files.read(renamed.name);
        var uniqueMirrorNames = mirrorNames.filter(function (name, at) { return mirrorNames.indexOf(name) === at; }); var renameSync = mirrorMany(ws, uniqueMirrorNames);
        response(ws, msg, addSyncState({ type: "knowledge_renamed", id: renamed.id, from: msg.from, name: renamed.name, revision: renamed.revision,
          content: renamed.content, updatedLinks: updatedLinks, linkUpdateFailures: linkUpdateFailures,
          updatedDocuments: updatedDocuments.map(function (item) { return { id: item.id, name: item.name, content: item.content, revision: item.revision }; }) }, renameSync));
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
    if (msg.type === "knowledge_draft_save") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var savedDraft = drafts.save(ws._clayUser && ws._clayUser.id || "system", msg.documentId, { name: msg.name, content: msg.content, baseRevision: msg.baseRevision,
          cursor: msg.cursor, clientVersion: msg.clientVersion, newDocument: msg.newDocument });
        response(ws, msg, { type: "knowledge_draft_saved", documentId: msg.documentId, savedAt: savedDraft.savedAt, clientVersion: savedDraft.clientVersion });
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_draft_delete") {
      if (!requireWrite(ws, msg)) return true;
      try { var removedDraft = drafts.remove(ws._clayUser && ws._clayUser.id || "system", msg.documentId, msg.throughVersion); response(ws, msg, { type: "knowledge_draft_deleted", documentId: msg.documentId, removed: removedDraft }); }
      catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_discard_draft") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var disk = files.read(msg.name); if (msg.expectedRevision && disk.revision !== msg.expectedRevision) throw Object.assign(new Error("The disk version changed again."), { code: "STALE", currentRevision: disk.revision });
        var removed = drafts.remove(ws._clayUser && ws._clayUser.id || "system", msg.documentId, msg.throughVersion);
        response(ws, msg, { type: "knowledge_draft_discarded", documentId: msg.documentId, removed: removed, id: disk.id, name: disk.name, content: disk.content, revision: disk.revision });
      } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_history") {
      try { response(ws, msg, { type: "knowledge_history", documentId: msg.documentId, versions: files.history(msg.documentId) }); }
      catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_history_read") {
      try { response(ws, msg, Object.assign({ type: "knowledge_history_version", documentId: msg.documentId }, files.readHistory(msg.documentId, msg.version))); }
      catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_deleted_list") {
      try { response(ws, msg, { type: "knowledge_deleted_list", files: files.deleted() }); } catch (error) { failure(ws, msg, error); }
      return true;
    }
    if (msg.type === "knowledge_restore") {
      if (!requireWrite(ws, msg)) return true;
      try {
        var restored = files.restore(msg.documentId, msg.version, msg.name, msg.expectedRevision || null); var restoreSync = mirror(ws, restored.name);
        response(ws, msg, addSyncState({ type: "knowledge_restored", id: restored.id, name: restored.name, revision: restored.revision }, restoreSync));
        sendTo(ws, { type: "knowledge_list", files: listKnowledgeFiles() });
      } catch (error) { failure(ws, msg, error); }
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
