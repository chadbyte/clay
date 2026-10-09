export function documentIdentity(file) {
  var source = file && file.common ? "shared:" + encodeURIComponent(file.ownMateId || "unknown") : "local";
  return source + ":" + encodeURIComponent(file && file.name || "");
}

export function blankKnowledgeState() {
  return { files: [], searchFiles: [], tabs: [], selected: null, drafts: {}, query: "", loading: false, searching: false,
    error: "", wide: false, fullscreen: false, explorerScroll: 0, selectionVersion: 0, latestReads: {}, syncRetry: null };
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
    var writable = !pending.file.common && msg.writable === true;
    var draft = { file: Object.assign({}, pending.file), content: msg.content || "", savedContent: msg.content || "",
      revision: msg.revision || null, dirty: false, writable: writable, newDocument: false, mode: writable ? "edit" : "read",
      version: existing ? existing.version || 0 : 0, editScroll: existing ? existing.editScroll || 0 : 0,
      readScroll: existing ? existing.readScroll || 0 : 0, error: "", conflict: false, savingRequest: null, syncWarning: "" };
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
    submittedVersion: draft.version || 0, submittedRevision: draft.revision || null, name: name };
  return { state: withDraft(state, id, Object.assign({}, draft, { savingRequest: requestId, error: "", conflict: false })), pending: pending };
}

export function applyKnowledgeSave(state, pending, msg) {
  var current = state.drafts[pending.documentId];
  if (!current) return state;
  var nextId = documentIdentity({ name: msg.name, common: false });
  var laterEdits = (current.version || 0) !== pending.submittedVersion || current.content !== pending.submittedContent;
  var saved = Object.assign({}, current, { file: { name: msg.name, common: false }, name: msg.name.replace(/\.md$/i, ""),
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
  var nextId = documentIdentity({ name: msg.name, common: false });
  var moved = Object.assign({}, current, { file: { name: msg.name, common: false }, name: msg.name.replace(/\.md$/i, ""),
    revision: msg.revision, savingRequest: current.savingRequest === pending.requestId ? null : current.savingRequest,
    error: "", syncWarning: msg.indexSyncPending ? (msg.syncError || "Renamed on disk; Knowledge index synchronization is pending.") : "" });
  var drafts = Object.assign({}, state.drafts);
  delete drafts[pending.documentId];
  drafts[nextId] = moved;
  return Object.assign({}, state, { drafts: drafts,
    tabs: state.tabs.map(function (item) { return item === pending.documentId ? nextId : item; }),
    selected: state.selected === pending.documentId ? nextId : state.selected,
    syncRetry: msg.indexSyncPending ? { names: msg.syncNames || [msg.from, msg.name], documentId: nextId } : state.syncRetry });
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
