import { store } from './store.js';
import { takeComposerDraft, restoreComposerDraft } from './input.js';

function key() { return [store.get('myUserId') || '', store.get('currentSlug') || '', store.get('sessionOriginId') || ''].join(':'); }
export function checkComposerDeparture() {
  var draft = takeComposerDraft();
  restoreComposerDraft(draft);
}
export function saveSessionRichDraft() {
  if (store.get('activeProjectMateId') || !store.get('sessionOriginId') || store.get('panePendingBinding')) return;
  var drafts = Object.assign({}, store.get('sessionRichDrafts') || {});
  var draft = takeComposerDraft();
  drafts[key()] = draft;
  restoreComposerDraft(draft);
  store.set({ sessionRichDrafts: drafts });
}
export function restoreSessionRichDraft() {
  if (store.get('activeProjectMateId') || store.get('panePendingBinding')) return;
  var draft = (store.get('sessionRichDrafts') || {})[key()];
  restoreComposerDraft(draft || { text: (store.get('sessionDrafts') || {})[store.get('activeSessionId')] || '', start: 0, end: 0 });
}
