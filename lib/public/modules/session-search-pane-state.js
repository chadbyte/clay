import { store } from './store.js';
import { paneMessageBinding } from './pane-binding.js';
import { acceptsPaneSearchResults } from './pane-search-receipt.js';

function publishPaneSearchStatus(query, status) {
  if (!store.get('paneMode') || window.parent === window) return;
  window.parent.postMessage({ type: "clay-pane-search-status", paneBinding: paneMessageBinding(), query: query,
    status: status, open: store.get('paneSearchOpen') === true }, window.location.origin);
}

function updatePaneSearchStatus(countElement, query, status) {
  if (countElement) countElement.textContent = status;
  publishPaneSearchStatus(query, status);
}

function beginPaneSearch(query) {
  var binding = paneMessageBinding(), epoch = (Number(store.get('paneSearchEpoch')) || 0) + 1;
  store.set({ paneSearchEpoch: epoch, paneSearchReceipt: binding ? { binding: binding, epoch: epoch, query: query } : null });
}

function endPaneSearch() {
  store.set({ paneSearchOpen: false, paneSearchReceipt: null, paneSearchEpoch: (Number(store.get('paneSearchEpoch')) || 0) + 1 });
}

function acceptsSessionSearchResults(state, msg, query) {
  if (state.paneMode && (!state.paneSearchOpen || !acceptsPaneSearchResults(state, msg))) return false;
  return msg.query === query;
}

export { updatePaneSearchStatus, beginPaneSearch, endPaneSearch, acceptsSessionSearchResults };
