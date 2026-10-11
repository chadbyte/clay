export function isRecordEdit(edit) {
  return !!(edit && !edit.schema && !edit.view && !edit.settings && !edit.recover);
}

export function buildRecordAttempt(edit, databaseId, databaseRevision, values) {
  if (edit.attempt) return edit.attempt;
  var creating = edit.creating === true;
  var payload = { databaseId: databaseId, values: JSON.parse(JSON.stringify(values)), operationId: edit.operationId };
  if (creating) payload.expectedDatabaseRevision = databaseRevision;
  else { payload.recordId = edit.recordId; payload.expectedRevision = edit.baseVersion; }
  return { type: creating ? 'knowledge_db_record_create' : 'knowledge_db_record_update', payload: payload, creating: creating, recordId: edit.recordId || null, submittedVersion: edit.version || 0 };
}

export function buildCreateAttempt(draft, name) {
  if (draft.attempt) return draft.attempt;
  return { operationId: draft.operationId, name: name };
}

export function isCurrentAttempt(edit, attempt) {
  return !!(edit && edit.attempt && attempt && edit.attempt.payload.operationId === attempt.payload.operationId);
}

export function applyRecordSave(edit, record, newOperationId, acknowledgedAttempt) {
  if (!isCurrentAttempt(edit, acknowledgedAttempt)) return { edit: edit, later: false, stale: true };
  var later = (edit.version || 0) > acknowledgedAttempt.submittedVersion;
  if (!later) return { edit: null, later: false };
  return { later: true, edit: Object.assign({}, edit, { creating: false, recordId: record.id, baseVersion: record.revision, saving: false, retryPending: false, attempt: null, operationId: newOperationId, error: '' }) };
}

export function updateViewPresentation(view, values) {
  var next = Object.assign({}, view, { name: values.name, columns: values.columns });
  if (view.filters.length <= 1) next.filters = values.filters;
  if (view.sorts.length <= 1) next.sorts = values.sorts;
  return next;
}
