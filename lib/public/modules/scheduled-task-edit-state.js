export function reconcileScheduledTaskEdit(editState, serverRecord) {
  if (!editState || !serverRecord || editState.id !== serverRecord.id) return editState || null;
  if (Number(editState.revision) === Number(serverRecord.revision)) return editState;
  return Object.assign({}, editState, {
    conflict: "This task changed while you were editing. Your text is preserved; reopen or reconcile it before saving.",
  });
}
