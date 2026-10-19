import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { showToast } from './utils.js';
import { ensurePaneFeatureAssets } from './pane-feature-assets.js';

var knowledgeWorkbenchModule = null;

export function ensureKnowledgeButton() {
  var button = document.getElementById('knowledge-workbench-btn'); if (button) return button;
  var tools = document.getElementById('session-actions'); if (!tools) return null;
  button = document.createElement('button'); button.id = 'knowledge-workbench-btn'; button.type = 'button'; button.className = 'palette-tile'; button.title = 'Knowledge'; button.setAttribute('aria-label', 'Knowledge'); button.innerHTML = '<i data-lucide="book-open"></i><span class="tool-btn-label">Knowledge</span>';
  var fixed = tools.querySelector('[data-fixed="true"]');
  tools.insertBefore(button, fixed ? fixed.nextSibling : tools.firstChild); refreshIcons(button); return button;
}
function sameContext(receipt) {
  var state = store.snap();
  return receipt.owner === state.myUserId && receipt.slug === state.currentSlug && receipt.socket === getWs() &&
    receipt.generation === state.projectSplitViewSocketGeneration && receipt.binding === state.paneCommittedBinding && state.connected;
}
export function initMateKnowledgeWorkbench() {
  var button = ensureKnowledgeButton(); if (!button || store.get('knowledgeWorkbenchEntryInitialized')) return;
  store.set({ knowledgeWorkbenchEntryInitialized: true });
  button.addEventListener('click', open);
  function open(event) {
    event.stopImmediatePropagation();
    if (button.disabled) return;
    var state = store.snap(), receipt = { owner: state.myUserId, slug: state.currentSlug, socket: getWs(), generation: state.projectSplitViewSocketGeneration, binding: state.paneCommittedBinding };
    button.disabled = true;
    Promise.all([import('./mate-knowledge-workbench.js'), ensurePaneFeatureAssets('editor')]).then(function (loaded) {
      var module = loaded[0];
      if (!knowledgeWorkbenchModule) {
        module.initMateKnowledgeWorkbench(); knowledgeWorkbenchModule = module;
        button.removeEventListener('click', open);
      }
      if (sameContext(receipt)) module.openKnowledgeWorkbench();
    }).catch(function (error) { if (sameContext(receipt)) showToast(error.message, 'error'); }).finally(function () { button.disabled = false; });
  }
}
export function handleKnowledgeWorkbenchMessage(message) {
  var module = knowledgeWorkbenchModule;
  return module ? module.handleKnowledgeWorkbenchMessage(message) : false;
}
