import { samePaneBinding } from './pane-binding.js';

function acceptsPaneSearchResults(state, msg) {
  var binding = state.paneCommittedBinding;
  var receipt = state.paneSearchReceipt;
  return !!(state.paneReady && !state.panePendingBinding && !state.paneSuspended && binding && receipt &&
    receipt.epoch === state.paneSearchEpoch && samePaneBinding(receipt.binding, binding) &&
    Number(binding.sessionId) === Number(msg.sessionId) && Number(binding.sessionId) === Number(state.activeSessionId) &&
    receipt.query === msg.query);
}

export { acceptsPaneSearchResults };
