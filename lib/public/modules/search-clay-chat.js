// Search is an entry point. The sole chat renderer is the contextual Mate pane.
import { startContextualSearch, handleContextualSearchMessage, retryContextualSearch } from './contextual-search.js';
export function startSearchClayChat(query) { return startContextualSearch(query); }
export function handleSearchClayMessage(message) { return handleContextualSearchMessage(message); }
export function retrySearchClayAsk() { return retryContextualSearch(); }
