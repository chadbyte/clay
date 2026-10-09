export function documentIdentity(file) {
  if (file && file.clientIdentity) return file.clientIdentity;
  var source = file && file.common ? "shared:" + encodeURIComponent(file.ownMateId || "unknown") : "local";
  return source + ":" + encodeURIComponent(file && file.id || file && file.name || "");
}

export function blankKnowledgeState() {
  return { files: [], searchFiles: [], searchTotal: 0, tabs: [], selected: null, drafts: {}, query: "", loading: false, searching: false,
    error: "", wide: false, fullscreen: false, explorerScroll: 0, selectionVersion: 0, latestReads: {}, syncRetry: null,
    navigationBack: [], navigationForward: [] };
}

function withDraft(state, id, draft) {
  var drafts = Object.assign({}, state.drafts);
  drafts[id] = draft;
  return Object.assign({}, state, { drafts: drafts });
}

export function selectKnowledgeDocument(state, id) {
  if (!state.drafts[id]) return state;
  var tabs = state.tabs.indexOf(id) === -1 ? state.tabs.concat([id]) : state.tabs.slice();
  return Object.assign({}, state, { tabs: tabs, selected: id, selectionVersion: (state.selectionVersion || 0) + 1, error: "" });
}

export function editKnowledgeDraft(state, id, patch) {
  var current = state.drafts[id];
  if (!current) return state;
  return withDraft(state, id, Object.assign({}, current, patch, { version: (current.version || 0) + 1 }));
}

export function failKnowledgeOffline(state, id, message) {
  var draft = id && state.drafts[id];
  if (!draft) return Object.assign({}, state, { error: message });
  return withDraft(state, id, Object.assign({}, draft, { savingRequest: null, error: message }));
}

export function closeKnowledgeTab(state, id) {
  var draft = state.drafts[id];
  if (draft && draft.dirty) return withDraft(state, id, Object.assign({}, draft, { error: "Save this draft before closing its tab." }));
  var tabs = state.tabs.filter(function (item) { return item !== id; });
  return Object.assign({}, state, { tabs: tabs, selected: state.selected === id ? tabs[tabs.length - 1] || null : state.selected,
    selectionVersion: (state.selectionVersion || 0) + 1 });
}

export function beginKnowledgeRead(state, file, requestId, replace) {
  var id = documentIdentity(file);
  var version = (state.selectionVersion || 0) + 1;
  var latestReads = Object.assign({}, state.latestReads);
  latestReads[id] = requestId;
  return {
    state: Object.assign({}, state, { loading: true, error: "", selectionVersion: version, latestReads: latestReads }),
    pending: { type: "knowledge_read", requestId: requestId, documentId: id, file: Object.assign({}, file), selectionVersion: version,
      draftVersion: state.drafts[id] ? state.drafts[id].version || 0 : null, replace: replace === true },
  };
}

export function applyKnowledgeRead(state, pending, msg) {
  if (!pending || state.latestReads[pending.documentId] !== pending.requestId) return state;
  var latestReads = Object.assign({}, state.latestReads);
  delete latestReads[pending.documentId];
  var existing = state.drafts[pending.documentId];
  var unchanged = !existing || (existing.version || 0) === pending.draftVersion;
  var mayReplace = !existing || ((!existing.dirty && !existing.savingRequest) || pending.replace) && unchanged;
  var next = Object.assign({}, state, { latestReads: latestReads });
  if (mayReplace) {
    var writable = !pending.file.common && msg.writable === true; var recovered = writable && msg.recoveredDraft || null;
    var file = Object.assign({}, pending.file, { id: msg.id || pending.file.id, name: msg.name || pending.file.name, itemType: msg.itemType || pending.file.itemType });
    var draft = { file: file, content: recovered ? recovered.content : msg.content || "", savedContent: msg.content || "",
      revision: msg.revision || null, dirty: false, writable: writable, newDocument: false, mode: writable ? "edit" : "read",
      version: Math.max(existing ? existing.version || 0 : 0, recovered ? recovered.clientVersion || 0 : 0), editScroll: existing ? existing.editScroll || 0 : 0,
      readScroll: existing ? existing.readScroll || 0 : 0, error: "", conflict: false, savingRequest: null, syncWarning: "",
      outline: msg.outline || [], outgoing: msg.outgoing || [], backlinks: msg.backlinks || [], properties: msg.properties || {}, tags: msg.tags || [],
      propertyErrors: msg.propertyErrors || [], cursor: recovered && recovered.cursor || null, draftSavedAt: recovered && recovered.savedAt || null,
      draftVersion: recovered && recovered.clientVersion || 0, indexComplete: msg.indexComplete !== false, indexErrors: msg.indexErrors || [],
      indexWarning: msg.indexComplete === false ? "Some workspace documents could not be indexed; links and backlinks may be incomplete." : "" };
    draft.mode = "read"; draft.dirty = !!recovered && recovered.content !== draft.savedContent;
    if (recovered && recovered.baseRevision !== draft.revision) { draft.conflict = true; draft.diskRevision = draft.revision; draft.conflictRevision = recovered.baseRevision || null; draft.error = "A recovered draft is based on an older disk version. Keep the draft or reload the disk version."; }
    next = withDraft(next, pending.documentId, draft);
  }
  var tabs = next.tabs.indexOf(pending.documentId) === -1 ? next.tabs.concat([pending.documentId]) : next.tabs.slice();
  var currentSelection = next.selectionVersion === pending.selectionVersion;
  return Object.assign({}, next, { tabs: tabs, selected: currentSelection ? pending.documentId : next.selected,
    loading: currentSelection ? false : next.loading, error: currentSelection ? "" : next.error });
}

export function beginKnowledgeSave(state, id, requestId, name) {
  var draft = state.drafts[id];
  var pending = { type: "knowledge_save", requestId: requestId, documentId: id, submittedContent: draft.content,
    submittedVersion: draft.version || 0, submittedRevision: draft.revision || null, draftVersion: draft.draftVersion || draft.version || 0, name: name };
  return { state: withDraft(state, id, Object.assign({}, draft, { savingRequest: requestId, error: "", conflict: false })), pending: pending };
}

export function applyKnowledgeSave(state, pending, msg) {
  var current = state.drafts[pending.documentId];
  if (!current) return state;
  var nextId = documentIdentity({ id: msg.id || current.file.id, name: msg.name, common: false });
  var laterEdits = (current.version || 0) !== pending.submittedVersion || current.content !== pending.submittedContent;
  var saved = Object.assign({}, current, { file: { id: msg.id || current.file.id, name: msg.name, common: false, itemType: "text" }, name: msg.name.replace(/\.md$/i, ""),
    revision: msg.revision, savedContent: pending.submittedContent, dirty: laterEdits, newDocument: false,
    savingRequest: current.savingRequest === pending.requestId ? null : current.savingRequest, error: "", conflict: false,
    syncWarning: msg.indexSyncPending ? (msg.syncError || "Saved on disk; Knowledge index synchronization is pending.") : "" });
  var drafts = Object.assign({}, state.drafts);
  delete drafts[pending.documentId];
  drafts[nextId] = saved;
  return Object.assign({}, state, { drafts: drafts,
    tabs: state.tabs.map(function (item) { return item === pending.documentId ? nextId : item; }),
    selected: state.selected === pending.documentId ? nextId : state.selected,
    syncRetry: msg.indexSyncPending ? { names: msg.syncNames || [msg.name], documentId: nextId } : state.syncRetry });
}

export function beginKnowledgeRename(state, id, requestId, name) {
  var draft = state.drafts[id];
  return { state: withDraft(state, id, Object.assign({}, draft, { savingRequest: requestId, error: "" })),
    pending: { type: "knowledge_rename", requestId: requestId, documentId: id, name: name, submittedRevision: draft.revision || null } };
}

export function applyKnowledgeRename(state, pending, msg) {
  var current = state.drafts[pending.documentId];
  if (!current) return state;
  var nextId = documentIdentity({ id: msg.id || current.file.id, name: msg.name, common: false });
  var moved = Object.assign({}, current, { file: { id: msg.id || current.file.id, name: msg.name, common: false, itemType: "text" }, name: msg.name.replace(/\.md$/i, ""),
    content: msg.content || current.content, savedContent: msg.content || current.savedContent, dirty: false,
    revision: msg.revision, savingRequest: current.savingRequest === pending.requestId ? null : current.savingRequest,
    error: msg.linkUpdateFailures && msg.linkUpdateFailures.length ? "Moved, but some linked documents could not be updated." : "",
    syncWarning: msg.indexSyncPending ? (msg.syncError || "Renamed on disk; Knowledge index synchronization is pending.") : "" });
  var drafts = Object.assign({}, state.drafts);
  delete drafts[pending.documentId];
  drafts[nextId] = moved;
  (msg.updatedDocuments || []).forEach(function (updated) {
    var id = documentIdentity({ id: updated.id, name: updated.name, common: false }); var open = drafts[id]; if (!open || id === nextId) return;
    drafts[id] = open.dirty ? Object.assign({}, open, { conflict: true, diskRevision: updated.revision, error: "This document was rewritten during the move. Reload it or deliberately keep your newer draft." }) :
      Object.assign({}, open, { content: updated.content, savedContent: updated.content, revision: updated.revision, dirty: false });
  });
  return Object.assign({}, state, { drafts: drafts,
    tabs: state.tabs.map(function (item) { return item === pending.documentId ? nextId : item; }),
    selected: state.selected === pending.documentId ? nextId : state.selected,
    syncRetry: msg.indexSyncPending ? { names: msg.syncNames || [msg.from, msg.name], documentId: nextId } : state.syncRetry });
}

export function applyKnowledgeDiscard(state, pending, msg) {
  var draft = state.drafts[pending.documentId]; if (!draft) return state;
  if ((draft.version || 0) !== pending.submittedVersion) return withDraft(state, pending.documentId, Object.assign({}, draft, { conflict: true, diskRevision: msg.revision, error: "The disk version loaded, but newer local edits were preserved." }));
  return withDraft(state, pending.documentId, Object.assign({}, draft, { content: msg.content, savedContent: msg.content, revision: msg.revision,
    dirty: false, conflict: false, error: "", draftState: "", draftVersion: 0, cursor: null }));
}

export function beginKnowledgeDelete(state, id, requestId, revision) {
  return { state: state, pending: { type: "knowledge_delete", requestId: requestId, documentId: id, submittedRevision: revision } };
}

export function applyKnowledgeDelete(state, pending, msg) {
  var drafts = Object.assign({}, state.drafts);
  delete drafts[pending.documentId];
  var remaining = state.tabs.filter(function (item) { return item !== pending.documentId; });
  var selected = state.selected === pending.documentId ? remaining[remaining.length - 1] || null : state.selected;
  return Object.assign({}, state, { drafts: drafts, tabs: remaining, selected: selected,
    syncRetry: msg.indexSyncPending ? { names: msg.syncNames || [msg.name], documentId: null } : state.syncRetry,
    error: msg.indexSyncPending ? (msg.syncError || "Deleted on disk; Knowledge index synchronization is pending.") : state.error });
}

export function failKnowledgeRequest(state, pending, msg) {
  if (!pending) return Object.assign({}, state, { loading: false, searching: false, error: msg.error || "Knowledge request failed." });
  if (pending.type === "knowledge_read") {
    var latestReads = Object.assign({}, state.latestReads);
    if (latestReads[pending.documentId] === pending.requestId) delete latestReads[pending.documentId];
    return Object.assign({}, state, { latestReads: latestReads, loading: false, error: msg.error || "Knowledge read failed." });
  }
  var draft = pending.documentId && state.drafts[pending.documentId];
  if (!draft) return Object.assign({}, state, { loading: false, searching: false, error: msg.error || "Knowledge request failed." });
  return withDraft(state, pending.documentId, Object.assign({}, draft, {
    savingRequest: draft.savingRequest === pending.requestId ? null : draft.savingRequest,
    error: msg.error || "Knowledge request failed.", conflict: msg.code === "STALE",
  }));
}
