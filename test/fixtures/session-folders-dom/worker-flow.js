import { createStore } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { renderWorkerProposal, updateWorkerProposal } from '/modules/worker-proposal.js';
import { addUserMessage } from '/modules/app-message-cards.js';
var source = await fetch('/index.html').then(function (response) { return response.text(); });
var shell = new DOMParser().parseFromString(source, 'text/html');
shell.querySelectorAll('script').forEach(function (script) { script.remove(); });
document.body.replaceChildren.apply(document.body, Array.from(shell.body.children));
document.body.className = 'wide-view';
document.documentElement.classList.toggle('light-theme', new URLSearchParams(location.search).get('theme') !== 'dark');
document.getElementById('connect-overlay').classList.add('hidden');
document.getElementById('header-title').textContent = 'Worker UI review';
createStore({activeSessionId: 1, currentVendor: 'codex', activeSessionMode: 'gui', connected: true, replayingHistory: true, myUserId: 'preview', cachedAllUsers: [], permissions: {}, splitPanes: null});
window.__sent = [];
setWs({readyState: 1, send: function (payload) { window.__sent.push(JSON.parse(payload)); }});
var proposal = {
  proposalId: 'preview', status: 'pending', recommendedVendor: 'codex', recommendedModel: 'gpt-5.6-luna', recommendedEffort: 'medium',
  summary: 'A Split Worker can implement the account controls while I review layout and interaction quality.',
  plan: '1. Refine the account panel and cursor control.\n2. Check keyboard navigation and saved state.\n3. Verify compact light and dark layouts.',
  recommendationRationale: 'Codex is available here. Luna fits this bounded UI change; medium reasoning gives it room to check interaction states.',
  options: {installedVendors: ['codex', 'claude'], modelsByVendor: {codex: [{value: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', supportedReasoningEfforts: ['low', 'medium', 'high']}], claude: [{value: 'sonnet', displayName: 'Sonnet'}]}, capabilitiesByVendor: {codex: {effort: true}, claude: {effort: false}}}
};
window.__render = function (overrides) { renderWorkerProposal(Object.assign({}, proposal, overrides)); };
window.__update = updateWorkerProposal;
window.__render({});
addUserMessage('## Account controls\nRefine the compact account panel using the existing Clay design language.\n\n- Preserve saved profile and cursor-sharing behavior.\n- Keep the project rail aligned in expanded and collapsed layouts.\n- Verify keyboard navigation, narrow screens, and both themes.\n\n**Handoff:** report changed files and observed test results. Do not commit.\n\n`long_identifier_that_should_wrap_without_widening_the_conversation_surface_1234567890`', null, null, null, null, {delegatedByTitle: 'Driver · Codex', delegatedByVendor: 'codex'});
document.getElementById('messages').scrollTop = 0;
window.__ready = true;
