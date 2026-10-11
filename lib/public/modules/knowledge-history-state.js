export function liveHistoryTarget(documentKey, draft) {
  if (!draft || draft.newDocument || !draft.file || !draft.file.id) return null;
  return { documentId: draft.file.id, documentKey: documentKey, name: draft.file.name, revision: draft.revision || null, deleted: false };
}

export function deletedHistoryTarget(documentId, name) {
  if (!documentId || !name) return null;
  return { documentId: documentId, documentKey: null, name: name, revision: null, deleted: true };
}

export function beginHistoryRequest(state, target, requestId) {
  return Object.assign({}, state, { historyRequestId: requestId,
    historyView: Object.assign({}, target, { versions: [], preview: null, loading: true }) });
}

export function receiveHistoryVersions(state, tracked, versions) {
  if (!tracked || state.historyRequestId !== tracked.requestId) return state;
  return Object.assign({}, state, { historyRequestId: null,
    historyView: Object.assign({}, tracked.historyTarget, { versions: versions || [], preview: null, loading: false }) });
}

export function beginHistoryPreview(state, requestId) {
  if (!state.historyView) return state;
  return Object.assign({}, state, { historyPreviewRequestId: requestId,
    historyView: Object.assign({}, state.historyView, { preview: null, loading: true }) });
}

export function receiveHistoryPreview(state, tracked, selected) {
  if (!tracked || state.historyPreviewRequestId !== tracked.requestId) return state;
  return Object.assign({}, state, { historyPreviewRequestId: null,
    historyView: Object.assign({}, tracked.historyTarget, { versions: state.historyView && state.historyView.versions || [], preview: selected, loading: false }) });
}

export function clearHistoryView(state) {
  return Object.assign({}, state, { historyRequestId: null, historyPreviewRequestId: null, historyView: null });
}

function escapeText(value) {
  var span = document.createElement('span'); span.textContent = String(value || ''); return span.innerHTML;
}

export function historyToolbarHtml(history, fullscreen) {
  return '<strong class="knowledge-preview-name">' + escapeText(history.name) + '</strong><span class="knowledge-readonly">History preview · read only</span>' +
    (fullscreen ? '<button type="button" data-history-restore="' + escapeText(history.preview.version) + '">Restore this version</button>' : '<button type="button" data-history-review>Review restore fullscreen</button>') +
    '<button type="button" data-document-action="history-exit">Exit preview</button>';
}

export function historyVersionsHtml(history) {
  if (!history) return '';
  if (history.loading) return '<p>Loading history…</p>';
  if (!history.versions || !history.versions.length) return '';
  return '<small>VERSIONS OF ' + escapeText(history.name) + '</small>' + history.versions.map(function (item) {
    return '<button type="button" class="knowledge-link-item" data-history-preview="' + escapeText(item.version) + '">' + escapeText(new Date(Number(item.version.split('-')[0])).toLocaleString()) + '</button>';
  }).join('');
}
