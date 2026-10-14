import { initPersonalIntegrations, loadPersonalIntegrations } from './user-settings-integrations.js';
import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { closeSpeechPicker } from './stt-picker.js';
import { loadSpeechSettings } from './stt-settings.js';
import { mountDefaultAi, unmountDefaultAi, requestDefaultAi } from './default-ai.js';
import { confirmSettingsAction as showConfirmDialog } from './server-settings-state.js';

export var USER_SETTINGS_PAGES = [
  ['us-account', 'Account'], ['us-appearance', 'Appearance'], ['us-chat', 'Conversation'],
  ['us-notifications', 'Notifications'], ['us-ai', 'AI preferences'], ['us-integrations', 'Integrations']
];
export function resolveUserSettingsPage(id) {
  return ({'us-mates':'us-chat','us-experimental':'us-chat','us-connections':'us-integrations','us-email':'us-integrations','us-logout':'us-account'})[id] || id;
}
function section(id) { return document.querySelector('#user-settings .us-section[data-section="' + id + '"]'); }
function heading(target, text, copy) {
  var title = document.createElement('h3'); title.textContent = text; target.appendChild(title);
  if (copy) { var p = document.createElement('p'); p.className = 'settings-hint'; p.textContent = copy; target.appendChild(p); }
}
export function buildUserSettingsLayout() {
  var root = document.getElementById('user-settings');
  root.querySelector('.us-modal').setAttribute('role','dialog');root.querySelector('.us-modal').setAttribute('aria-modal','true');root.querySelector('.us-modal').setAttribute('aria-label','User settings');
  var nav = root.querySelector('.us-modal-nav-items'); nav.replaceChildren();
  var dropdown = document.getElementById('user-settings-nav-dropdown'); dropdown.replaceChildren();
  USER_SETTINGS_PAGES.forEach(function (page) {
    var button = document.createElement('button'); button.className = 'us-nav-item'; button.dataset.section = page[0]; button.textContent = page[1]; button.type = 'button'; nav.appendChild(button);
    var option = document.createElement('option'); option.value = page[0]; option.textContent = page[1]; dropdown.appendChild(option);
  });
  dropdown.setAttribute('aria-label', 'Personal settings page');
  root.querySelector('.us-modal-nav').setAttribute('aria-label', 'Personal settings pages');
  var notifications=section('us-notifications');
  var push=document.getElementById('settings-notif-push').closest('label');
  heading(notifications,'This device','Browser permission and push delivery are configured separately on each browser.');notifications.appendChild(push);
  var accountNotifications=document.createElement('h3');accountNotifications.textContent='Account preferences';notifications.querySelector('.settings-card').before(accountNotifications);
  var chat = section('us-chat'); chat.querySelector('h2').textContent = 'Conversation';
  var voice = document.getElementById('us-lang-select').closest('.settings-card');
  voice.innerHTML = '<div id="us-voice-settings"></div>';
  var ai = document.createElement('div'); ai.className = 'us-section'; ai.dataset.section = 'us-ai';
  ai.innerHTML = '<h2>AI preferences</h2><p class="settings-hint">Defaults for new Clay interviews and built-in AI assistance. Project defaults, individual Mates and existing conversation runtimes stay separate.</p><div id="us-default-ai"></div>';
  root.querySelector('.us-modal-content').appendChild(ai);
  heading(ai, 'Execution behavior');
  ['us-auto-continue'].forEach(function (id) {ai.appendChild(document.getElementById(id).closest('.settings-card'));});
  document.getElementById('us-auto-continue').closest('label').querySelector('.settings-hint').textContent = 'When a rate-limited conversation becomes eligible to retry, Clay can send a continuation automatically. This may resume work and consume usage without another message from you.';
  heading(ai, 'Command permissions', 'These are personal Claude CLI allow rules, separate from model selection and Clay session approval modes. Managed defaults are shown for reference. Server access restrictions still apply. On an OS-user server these install in your OS home; otherwise they install in the shared server process home and can affect other Claude CLI launches there.');
  ai.appendChild(document.getElementById('us-claude-allow-list').closest('.settings-card'));
  section('us-mates').remove();
  var experiments = document.createElement('details'); experiments.className = 'us-experiments'; experiments.innerHTML = '<summary>Experimental features</summary><p class="settings-hint">Personal opt-ins for features that may change.</p>';
  experiments.appendChild(document.getElementById('us-capsules-enabled').closest('.settings-card'));chat.appendChild(experiments);section('us-experimental').remove();
  section('us-email').remove();
  initPersonalIntegrations();
  var account = section('us-account');heading(account, 'Sign out');account.appendChild(document.getElementById('us-logout-btn').closest('.settings-card'));section('us-logout').remove();
  document.getElementById('us-logout-btn').textContent = 'Sign out';
  document.getElementById('us-logout-btn').closest('.settings-card').classList.remove('settings-card-danger');
  document.getElementById('us-pin-set-btn').parentElement.querySelector('.settings-hint').textContent = 'Change your personal account PIN. Server sign-in policy is managed separately by an administrator.';
  root.querySelectorAll('.layout-option-icon').forEach(function (el) {el.remove();});
  var back = document.createElement('button');back.type = 'button';back.className = 'settings-btn-sm us-back';back.textContent = '← Settings';root.querySelector('.us-modal-content').prepend(back);
  back.onclick = function () {root.classList.add('us-show-navigation');nav.querySelector('.active').focus();};
  nav.addEventListener('keydown', function (event) {
    if (['ArrowDown','ArrowUp','Home','End'].indexOf(event.key) < 0) return;
    var items = Array.from(nav.querySelectorAll('button'));var index = items.indexOf(document.activeElement);if(index < 0)return;
    event.preventDefault();index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index+(event.key === 'ArrowDown'?1:-1)+items.length)%items.length;items[index].focus();
  });
}
export function loadUserSettingsExtras(page) {
  document.getElementById('user-settings').classList.remove('us-show-navigation');
  if (page === 'us-integrations') loadPersonalIntegrations();
  if (page === 'us-chat') loadSpeechSettings();
  if (page === 'us-ai') { mountDefaultAi(document.getElementById('us-default-ai')); requestDefaultAi(); var ws=getWs();if(ws && ws.readyState===1)ws.send(JSON.stringify({type:'get_claude_allow_list'})); }
}
export function finishUserSettingsExtras() {closeSpeechPicker();unmountDefaultAi(document.getElementById('us-default-ai'));}
export function guardUserSettingsLeave(done, destination) {
  var active = document.querySelector('#user-settings .us-section.active');
  var page = active && active.dataset.section;
  if (destination && resolveUserSettingsPage(destination) === page) {done();return;}
  function leaving(id) {return !destination || page === id;}
  var pin = document.getElementById('us-pin-form');
  var pinDirty = pin && !pin.classList.contains('hidden') && Array.from(pin.querySelectorAll('input')).some(function (input) {return !!input.value;});
  var key = document.getElementById('us-linear-key');
  if(store.get('speechPopup'))return;
  var dirty = leaving('us-integrations') && (store.get('personalEmailDirty') || store.get('personalLinearDirty') || key && key.value) ||
    leaving('us-chat') && store.get('userVoiceDirty') ||
    leaving('us-notifications') && store.get('notificationDraft') ||
    leaving('us-appearance') && (store.get('appearanceDraft') || store.get('userTerminalDirty')) ||
    leaving('us-account') && (store.get('userProfileDirty') || pinDirty) ||
    leaving('us-ai') && (store.get('defaultAiDraftDirty') || store.get('userAllowDirty'));
  if (!dirty) {done();return;}
  showConfirmDialog('Your unsaved changes will remain in this tab. Leave this editor and keep the draft?', 'Keep draft and leave', done);
}
