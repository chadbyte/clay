import { store } from './store.js';

export var SEARCH_HINT_INTERVAL = 180000;
export var SEARCH_HINT_QUESTIONS = Object.freeze([
  'What was I working on recently?',
  'Where did I leave off yesterday?',
  'What did I review recently?',
  "Find the session I said I'd return to.",
  'What work did I leave unfinished?',
  'What did we decide about this project?',
  'Why did we choose this approach?',
  'Find the conversation about this bug.',
  'Which sessions need my attention?',
  "What's happening across this view?",
  'What are my Workers doing?',
  'Which sessions are waiting for approval?'
]);
export function searchHintText(index) {
  return 'Search or ask Clay, like “' + SEARCH_HINT_QUESTIONS[index % SEARCH_HINT_QUESTIONS.length] + '”';
}

var trigger = null, input = null, timer = null, unsubscribe = null;
function relevantFocus(target) { return !!target && (target === input || trigger && trigger.contains(target)); }
function available() {
  return trigger && input && !document.hidden && !store.get('paneMode') && window === window.top &&
    !store.get('searchHintsPaletteOpen') && !store.get('searchHintsHovered') && !store.get('searchHintsFocused');
}
function cancelTimer() { if (timer !== null) { clearTimeout(timer); timer = null; } }
function paint() {
  var label = trigger.querySelector('.cmd-palette-searchbar-text');
  var text = searchHintText(store.get('searchHintIndex') || 0);
  if (label) label.textContent = text;
  input.placeholder = text;
}
function schedule() {
  if (!available()) { cancelTimer(); return; }
  if (timer !== null) return;
  timer = setTimeout(function () {
    timer = null;
    if (!available()) return;
    store.set({ searchHintIndex: ((store.get('searchHintIndex') || 0) + 1) % SEARCH_HINT_QUESTIONS.length });
    paint(); schedule();
  }, SEARCH_HINT_INTERVAL);
}
function visibilityChanged() { cancelTimer(); schedule(); }
function enter() { store.set({ searchHintsHovered: true }); }
function leave() { store.set({ searchHintsHovered: false }); }
function focusIn(event) { store.set({ searchHintsFocused: relevantFocus(event.target) }); }
function focusOut(event) { store.set({ searchHintsFocused: relevantFocus(event.relatedTarget) }); }
export function setSearchHintsPaletteOpen(open) { store.set({ searchHintsPaletteOpen: open === true }); }
export function disposeSearchHints() {
  cancelTimer();
  if (!trigger) return;
  trigger.removeEventListener('mouseenter', enter); trigger.removeEventListener('mouseleave', leave);
  document.removeEventListener('focusin', focusIn); document.removeEventListener('focusout', focusOut);
  document.removeEventListener('visibilitychange', visibilityChanged);
  if (unsubscribe) unsubscribe();
  trigger = null; input = null; unsubscribe = null;
}
export function initSearchHints(button, field) {
  if (button) button.removeAttribute('title');
  if (trigger === button && input === field) return;
  disposeSearchHints();
  if (!button || !field) return;
  trigger = button; input = field;
  store.set({ searchHintIndex: store.get('searchHintIndex') || 0, searchHintsPaletteOpen: false,
    searchHintsHovered: trigger.matches(':hover'), searchHintsFocused: relevantFocus(document.activeElement) });
  if (!store.get('searchHintsFocused')) paint();
  trigger.addEventListener('mouseenter', enter); trigger.addEventListener('mouseleave', leave);
  document.addEventListener('focusin', focusIn); document.addEventListener('focusout', focusOut);
  document.addEventListener('visibilitychange', visibilityChanged);
  unsubscribe = store.subscribe(function (state, previous) {
    if (state.paneMode !== previous.paneMode || state.searchHintsPaletteOpen !== previous.searchHintsPaletteOpen ||
        state.searchHintsHovered !== previous.searchHintsHovered || state.searchHintsFocused !== previous.searchHintsFocused) {
      cancelTimer(); schedule();
    }
  });
  schedule();
}
