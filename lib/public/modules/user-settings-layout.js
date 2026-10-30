import { loadGithubIntegration, leaveGithubIntegration } from './user-settings-github.js';
import { initPersonalProviders, loadPersonalProviders, leavePersonalProviders } from './user-settings-providers.js';
import { initPersonalIntegrations, loadPersonalIntegrations } from './user-settings-integrations.js';
import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { closeSpeechPicker } from './stt-picker.js';
import { loadSpeechSettings } from './stt-settings.js';
import { mountDefaultAi, unmountDefaultAi, requestDefaultAi } from './default-ai.js';
import { mountAgentBehavior, unmountAgentBehavior } from './agent-behavior-view.js';
import { resetAgentBehavior } from './agent-behavior.js';
import { resolvePage } from './settings-shell-registry.js';

export function resolveUserSettingsPage(id) { return resolvePage('personal', id); }
function section(id) { return document.querySelector('#user-settings .us-section[data-section="' + id + '"]'); }
function heading(target, text, copy) {
  var title = document.createElement('h3'); title.textContent = text; target.appendChild(title);
  if (copy) { var p = document.createElement('p'); p.className = 'settings-hint'; p.textContent = copy; target.appendChild(p); }
}
export function buildUserSettingsLayout() {
  var root = document.getElementById('user-settings');
  var notifications=section('us-notifications');
  var push=document.getElementById('settings-notif-push').closest('label');
  heading(notifications,'This device','Browser permission and push delivery are configured separately on each browser.');notifications.appendChild(push);
  var accountNotifications=document.createElement('h3');accountNotifications.textContent='Account preferences';notifications.querySelector('.settings-card').before(accountNotifications);
  var chat = section('us-chat');
  var providers = document.createElement('div'); providers.className = 'us-section'; providers.dataset.section = 'us-providers';
  providers.innerHTML = '<h2>AI providers</h2><p class="settings-hint">Set up coding agents, choose AI defaults and execution preferences, and manage your personal audio transcription API keys.</p><section class="settings-section-group"><div class="settings-section-heading"><h3 id="coding-agents" data-settings-section>Coding agents</h3><span id="us-provider-refresh"></span></div><div id="us-coding-agents"></div></section><section class="settings-section-group"><h3 id="ai-defaults" data-settings-section>AI defaults</h3><p class="settings-hint">Defaults for new Clay interviews and built-in AI assistance. Project defaults, individual Mates and existing conversation runtimes stay separate.</p><div id="us-default-ai"></div></section><section class="settings-section-group" id="us-execution-settings"><h3 id="execution-behavior" data-settings-section>Execution &amp; permissions</h3></section><section class="settings-section-group"><h3 id="api-connections" data-settings-section>API connections</h3><div id="us-voice-settings"></div></section><section class="settings-section-group" id="us-experimental-settings"><h3 id="experimental-features" data-settings-section>Experimental features</h3></section>';
  root.querySelector('.us-modal-content').appendChild(providers);
  var execution = document.getElementById('us-execution-settings');
  execution.appendChild(document.getElementById('us-auto-continue').closest('.settings-card'));
  document.getElementById('us-auto-continue').closest('label').querySelector('.settings-hint').textContent = 'When a rate-limited conversation becomes eligible to retry, Clay can send a continuation automatically. This may resume work and consume usage without another message from you.';
  heading(execution, 'Command permissions', 'These are personal Claude CLI allow rules, separate from model selection and Clay session approval modes. Managed defaults are shown for reference. Server access restrictions still apply. On an OS-user server these install in your OS home; otherwise they install in the shared server process home and can affect other Claude CLI launches there.');
  execution.appendChild(document.getElementById('us-claude-allow-list').closest('.settings-card'));
  var agent = document.createElement('div'); agent.className = 'us-section'; agent.dataset.section = 'us-agent';
  agent.innerHTML = '<h2>Agent behavior</h2><p class="settings-hint">Choose how your Project Drivers use Clay memory, context, tools and connections. These choices apply to your own Driver conversations.</p><div id="us-agent-behavior"></div>';
  root.querySelector('.us-modal-content').appendChild(agent);
  section('us-mates').remove();
  var experiments = document.createElement('details'); experiments.className = 'us-experiments'; experiments.innerHTML = '<summary>Capsules</summary><p class="settings-hint">Personal opt-ins for features that may change.</p>';
  experiments.appendChild(document.getElementById('us-capsules-enabled').closest('.settings-card'));document.getElementById('us-experimental-settings').appendChild(experiments);section('us-experimental').remove();chat.remove();
  initPersonalProviders();
  section('us-email').remove();
  initPersonalIntegrations();
  var account = section('us-account');heading(account, 'Sign out');account.appendChild(document.getElementById('us-logout-btn').closest('.settings-card'));section('us-logout').remove();
  document.getElementById('us-logout-btn').textContent = 'Sign out';
  document.getElementById('us-logout-btn').closest('.settings-card').classList.remove('settings-card-danger');
  document.getElementById('us-pin-set-btn').parentElement.querySelector('.settings-hint').textContent = 'Change your personal account PIN. Server sign-in policy is managed separately by an administrator.';
  root.querySelectorAll('.layout-option-icon').forEach(function (el) {el.remove();});
}
export function loadUserSettingsExtras(page) {
  if (page === 'us-integrations') { loadPersonalIntegrations(); loadGithubIntegration(); }
  else leaveGithubIntegration();
  if (page === 'us-providers' && !store.get('personalAiSettingsMounted')) {
    store.set({ personalAiSettingsMounted: true });
    loadSpeechSettings(); loadPersonalProviders();
    mountDefaultAi(document.getElementById('us-default-ai')); requestDefaultAi();
    var ws = getWs(); if (ws && ws.readyState === 1) ws.send(JSON.stringify({type:'get_claude_allow_list'}));
  } else if (page !== 'us-providers') leavePersonalAiPage();
  if (page === 'us-agent') mountAgentBehavior(document.getElementById('us-agent-behavior'));
}
export function leaveAgentBehaviorPage() {unmountAgentBehavior();resetAgentBehavior();}
function leavePersonalAiPage() {leavePersonalProviders();closeSpeechPicker();unmountDefaultAi(document.getElementById('us-default-ai'));store.set({personalAiSettingsMounted:false});}
export function finishUserSettingsExtras() {leaveGithubIntegration();leavePersonalAiPage();leaveAgentBehaviorPage();}
// Returns the draft prompt for leaving one personal page (or every page when
// pageId is omitted); the shell shows it with the shared confirmation.
export function personalLeavePrompt(pageId) {
  function leaving(id) {return !pageId || pageId === id;}
  var pin = document.getElementById('us-pin-form');
  var pinDirty = pin && !pin.classList.contains('hidden') && Array.from(pin.querySelectorAll('input')).some(function (input) {return !!input.value;});
  // A value left in the hidden key field (browser autofill or form restore) is
  // not an edit; only an open connection editor can hold a draft key.
  var key = document.getElementById('us-linear-key');
  var keyDraft = key && key.value && store.get('personalLinearEditing') && !(key.form && key.form.hidden);
  var dirty = leaving('us-integrations') && (store.get('personalEmailDirty') || store.get('personalLinearDirty') || keyDraft) ||
    leaving('us-providers') && (store.get('userVoiceDirty') || store.get('defaultAiDraftDirty') || store.get('userAllowDirty')) ||
    leaving('us-notifications') && store.get('notificationDraft') ||
    leaving('us-appearance') && (store.get('appearanceDraft') || store.get('appearanceColorEditor') || store.get('userTerminalDirty')) ||
    leaving('us-account') && (store.get('userProfileDirty') || pinDirty);
  if (!dirty) return null;
  return { message: 'Your unsaved changes will remain in this tab. Leave this editor and keep the draft?', action: 'Keep draft and leave' };
}
