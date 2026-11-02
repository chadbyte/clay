import { selectIntegrationEditor } from './personal-integration-editor.js';
import { refreshIcons } from './icons.js';
import { resetAccountSessions } from './user-settings-sessions.js';
import { confirmSettingsAction as showConfirmDialog } from './server-settings-state.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { getChatLayout, setChatLayout } from './theme.js';
import { applyTerminalFont } from './terminal-prefs.js';
import { userAvatarUrl } from './avatar.js';
import { syncCapsulePreference } from './capsule-preference.js';
import { getEmailAccountListCache } from './context-sources.js';
function applyProjectMateDmsClass(enabled) { document.body.classList.toggle('project-mate-dms-disabled', !enabled); }
export function showPinForm() {
  if (store.get('userPasswordEnabled')) { window.location.href = '/account/password'; return; }
  var pinForm = document.getElementById('us-pin-form');
  if (!pinForm) return;
  if(!pinForm.classList.contains('hidden'))return;
  pinForm.classList.remove('hidden');
  var pinCurrentRow = document.getElementById('us-pin-current-row');
  var pinInput = document.getElementById('us-pin-input');
  var pinConfirmInput = document.getElementById('us-pin-confirm-input');
  var pinCurrentInput = document.getElementById('us-pin-current-input');
  var pinSave = document.getElementById('us-pin-save');
  var pinMsg = document.getElementById('us-pin-msg');
  var pinFormTitle = document.getElementById('us-pin-form-title');
  if (pinFormTitle) {
    pinFormTitle.textContent = store.get('userPinEnabled') ? 'Change PIN' : 'Set PIN';
  }
  if (pinCurrentRow) {
    pinCurrentRow.classList.toggle('hidden', !store.get('userPinEnabled'));
  }
  if (pinInput) {
    pinInput.value = '';
  }
  if (pinConfirmInput) pinConfirmInput.value = '';
  if (pinCurrentInput) pinCurrentInput.value = '';
  if (pinSave) pinSave.disabled = true;
  if (pinSave) pinSave.textContent = 'Save';
  if (pinMsg) {
    pinMsg.textContent = '';
    pinMsg.className = 'settings-hint settings-pin-error hidden';
  }
  if (store.get('userPinEnabled') && pinCurrentInput) {
    pinCurrentInput.focus();
  } else if (pinInput) {
    pinInput.focus();
  }
}

export function hidePinForm(force) {
  var fields = document.querySelectorAll('#us-pin-form input');
  if (!force && Array.from(fields).some(function (input) {return !!input.value;})) {
    showConfirmDialog('Discard the unsaved PIN change?', 'Discard', function () {hidePinForm(true);});return;
  }
  var pinForm = document.getElementById('us-pin-form');
  if (!pinForm) return;
  pinForm.classList.add('hidden');
  var pinCurrentRow = document.getElementById('us-pin-current-row');
  var pinInput = document.getElementById('us-pin-input');
  var pinConfirmInput = document.getElementById('us-pin-confirm-input');
  var pinCurrentInput = document.getElementById('us-pin-current-input');
  var pinSave = document.getElementById('us-pin-save');
  var pinMsg = document.getElementById('us-pin-msg');
  if (pinCurrentRow) {
    pinCurrentRow.classList.remove('hidden');
  }
  if (pinInput) pinInput.value = '';
  if (pinConfirmInput) pinConfirmInput.value = '';
  if (pinCurrentInput) pinCurrentInput.value = '';
  if (pinSave) pinSave.disabled = true;
  if (pinSave) pinSave.textContent = 'Save';
  if (pinMsg) {
    pinMsg.textContent = '';
    pinMsg.className = 'settings-hint settings-pin-error hidden';
  }
}

// --- Account population ---

export function populateAccount() {
  resetAccountSessions();
  fetch('/api/profile').then(function (r) {
    if (!r.ok) return null;
    return r.json();
  }).then(function (data) {
    if (!data) return;
    var displayName = data.name || data.displayName || data.username || 'Clay User';
    var avatarImg = document.getElementById('us-account-avatar-img');
    var avatarFallback = document.getElementById('us-account-avatar-fallback');
    var accountName = document.getElementById('us-account-name');
    var accountSubline = document.getElementById('us-account-subline');
    var langSelect = document.getElementById('us-lang-select');
    var pinSetBtnEl = document.getElementById('us-pin-set-btn');
    var pinFormTitle = document.getElementById('us-pin-form-title');
    if (accountName) {
      accountName.textContent = displayName;
    }
    if (accountSubline) {
      var parts = [];
      if (data.username) parts.push('@' + data.username);
      if (data.role) parts.push(data.role.charAt(0).toUpperCase() + data.role.slice(1));
      accountSubline.textContent = parts.length ? parts.join(' · ') : 'Local profile';
    }
    store.set({userPinEnabled:!!data.pinEnabled, userPasswordEnabled:!!data.passwordEnabled});
    var passkeyRow = document.getElementById('us-passkey-row');
    if (passkeyRow) passkeyRow.hidden = !data.passwordEnabled;
    var sessionsRow = document.getElementById('us-sessions-row');
    if (sessionsRow) sessionsRow.hidden = !data.passwordEnabled && !data.pinEnabled;
    if (pinSetBtnEl) {
      pinSetBtnEl.textContent = store.get('userPinEnabled') ? 'Change PIN' : 'Set PIN';
      if (data.passwordEnabled) pinSetBtnEl.textContent = 'Change password';
      var row = pinSetBtnEl.closest('.settings-field-row');
      if (row) {
        row.querySelector('.settings-label').textContent = data.passwordEnabled ? 'Password' : 'Account PIN';
        row.querySelector('.settings-hint').textContent = data.passwordEnabled ? 'Change your account password or passphrase.' : 'Manage your account PIN.';
      }
    }
    if (pinFormTitle) {
      pinFormTitle.textContent = store.get('userPinEnabled') ? 'Change PIN' : 'Set PIN';
    }
    if (langSelect) {
      langSelect.value = store.get('speechLang') || 'en-US';
      langSelect.dispatchEvent(new Event('settings-sync'));
    }
    if (avatarImg && avatarFallback) {
      var avatarUrl = getCurrentUserAvatarSrc(data);
      avatarImg.alt = displayName;
      avatarImg.classList.remove('hidden');
      avatarFallback.classList.remove('hidden');
      avatarFallback.textContent = avatarInitials(displayName);
      avatarImg.onload = function () {
        avatarFallback.classList.add('hidden');
      };
      avatarImg.onerror = function () {
        avatarFallback.classList.remove('hidden');
      };
      avatarImg.src = avatarUrl;
      if (avatarImg.complete && avatarImg.naturalWidth > 0) {
        avatarFallback.classList.add('hidden');
      }
    }
    // Hide account section in single-user mode (no username)
    var accountNav = document.getElementById('user-settings').querySelector('[data-section="us-account"]');
    if (accountNav) accountNav.style.display = '';
    if (pinSetBtnEl) pinSetBtnEl.disabled = !data.username;
    document.getElementById('us-claude-allow-save').disabled=!data.username;
    if(!data.username)document.getElementById('us-claude-allow-status').textContent='Personal command rules require a signed-in account.';
    // Terminal font: seed in-memory prefs from server. Header-mounted
    // controls (header-tui-font.js) listen to applyTerminalFont and
    // sync their UI - we don't touch any DOM here.
    if (data.terminalFont && typeof data.terminalFont === "object") {
      applyTerminalFont(data.terminalFont.family, data.terminalFont.size);
    }
    // Auto-continue toggle
    var acToggle = document.getElementById('us-auto-continue');
    if (acToggle) acToggle.checked = !!data.autoContinueOnRateLimit;
    // Theme picker self-syncs active selection via theme.js's applyTheme
    // change callbacks (updatePickerActive). Nothing to do here.
    // Layout switcher: sync from server response
    // Sync mate onboarding state from server
    if (data.mateOnboardingShown) {
      store.set({mateOnboardingShown:true});
    }
    // Keep project Mate DM shortcuts available for legacy profiles too.
    var matesOn = true;
    var matesToggle = document.getElementById('us-mates-enabled');
    if (matesToggle) matesToggle.checked = matesOn;
    store.set({ projectMateDmsEnabled: matesOn });
    applyProjectMateDmsClass(matesOn);
    syncCapsulePreference(data.capsulesEnabled === true);
    if (data.chatLayout) {
      setChatLayout(data.chatLayout); // update local cache + CSS
    }
    var lSwitcher = document.getElementById('us-layout-switcher');
    if (lSwitcher) {
      var currentLayout = getChatLayout();
      var lBtns = lSwitcher.querySelectorAll('.layout-option');
      for (var li = 0; li < lBtns.length; li++) {
        lBtns[li].classList.toggle('selected', lBtns[li].dataset.layout === currentLayout);
      }
    }
    store.set({userSettingsProfile:data});
  }).catch(function () {showToast('Could not load your settings. Close and reopen to retry.');});
}

function avatarInitials(value) {
  var text = (value || '').trim();
  if (!text) return '?';
  var parts = text.split(/\s+/);
  var first = parts[0].charAt(0);
  var second = parts.length > 1 ? parts[1].charAt(0) : parts[0].charAt(1);
  var out = first + (second || '');
  return out.toUpperCase();
}

function getCurrentUserAvatarSrc(data) {
  var islandAvatar = document.querySelector('.user-island-avatar img');
  if (islandAvatar && islandAvatar.src) return islandAvatar.src;
  if (data && data.avatarCustom) return data.avatarCustom;
  return userAvatarUrl(data, 96);
}

export function savePin(pin) {
  var pinInput = document.getElementById('us-pin-input');
  var pinConfirmInput = document.getElementById('us-pin-confirm-input');
  var pinCurrentInput = document.getElementById('us-pin-current-input');
  var pinSave = document.getElementById('us-pin-save');
  var pinMsg = document.getElementById('us-pin-msg');
  var currentPin = pinCurrentInput ? pinCurrentInput.value.trim() : '';
  var confirmPin = pinConfirmInput ? pinConfirmInput.value.trim() : '';
  var newPin = pinInput ? pinInput.value.trim() : '';

  if (!/^\d{6}$/.test(newPin)) {
    if (pinMsg) {
      pinMsg.textContent = 'PIN must be exactly 6 digits.';
      pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
    return;
  }
  if (confirmPin !== newPin) {
    if (pinMsg) {
      pinMsg.textContent = 'PINs do not match.';
      pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
    return;
  }
  if (store.get('userPinEnabled') && !/^\d{6}$/.test(currentPin)) {
    if (pinMsg) {
      pinMsg.textContent = 'Current PIN is required.';
      pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
    return;
  }

  pinSave.disabled = true;
  pinSave.textContent = 'Saving\u2026';

  fetch('/api/user/pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPin: currentPin, newPin: newPin }),
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.ok) {
      showToast('PIN changed');
      hidePinForm(true);
      store.set({userPinEnabled:true});
    } else {
      pinSave.disabled = false;
      pinSave.textContent = 'Save';
      if (pinMsg) {
        pinMsg.textContent = data.error || 'Could not change your PIN. Please try again.';
        pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
        pinMsg.classList.remove('hidden');
      }
    }
  }).catch(function () {
    pinSave.disabled = false;
    pinSave.textContent = 'Save';
    if (pinMsg) {
      pinMsg.textContent = 'Connection lost. Check your network and try again.';
      pinMsg.className = 'settings-hint settings-pin-error us-pin-msg-err';
      pinMsg.classList.remove('hidden');
    }
  });
}

// --- Email settings ---

export function renderEmailSettings() {
  var listEl = document.getElementById('us-email-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  var accounts = getEmailAccountListCache();
  if (!accounts || accounts.length === 0) {
    return;
  }

  for (var i = 0; i < accounts.length; i++) {
    var acc = accounts[i];
    var row = document.createElement('div');
    row.className = 'us-integration-email-row';
    row.dataset.emailAccountId = acc.id;
    row.innerHTML =
      '<div class="us-voice-row-controls"><div class="us-integration-brand">' + providerIcon(acc.provider) + '</div>' +
      '<div class="us-voice-provider-copy"><strong>' + escHtml(acc.email) + '</strong><small>Email · ' + escHtml(({gmail:'Gmail',outlook:'Outlook Mail',yahoo:'Yahoo Mail',custom:'Custom email'})[acc.provider] || 'Custom email') + (acc.label ? ' · ' + escHtml(acc.label) : '') + '</small></div>' +
      '<span class="us-integration-state">Account saved</span><button type="button" class="settings-btn-sm" aria-expanded="false">Manage</button></div>' +
      '<div class="us-email-manage" hidden><p class="settings-hint">This personal mailbox can be used to read, search and send email. Disconnecting keeps your mail at the provider.</p><button type="button" class="settings-btn-sm" data-account-id="' + escHtml(acc.id) + '">Disconnect</button></div>';
    var manageBtn = row.querySelector('[aria-expanded]');
    manageBtn.setAttribute('aria-label', 'Manage ' + acc.email);
    manageBtn.addEventListener('click', function () {
      var panel = this.closest('.us-integration-email-row').querySelector('.us-email-manage');
      var row = this.closest('.us-integration-email-row');
      selectIntegrationEditor('email-manage:' + row.dataset.emailAccountId, '[data-email-account-id="' + CSS.escape(row.dataset.emailAccountId) + '"] .us-email-manage', function () {
        panel.hidden = false; row.querySelector('[aria-expanded]').setAttribute('aria-expanded', 'true'); panel.querySelector('button').focus();
      });
    });
    var removeBtn = row.querySelector('[data-account-id]');
    removeBtn.addEventListener('click', function () {
      var accountId = this.getAttribute('data-account-id');
      showConfirmDialog('Disconnect this personal mailbox from Clay? Existing mail at the provider is kept.', 'Disconnect', function () {
        var ws=getWs();
        if(ws && ws.readyState===1)ws.send(JSON.stringify({type:'email_account_remove',accountId:accountId}));
        else showToast('Disconnected from Clay. Reconnect and retry.');
      });
    });

    listEl.appendChild(row);
    var active = store.get('personalIntegrationEditor');
    if (active && active.key === 'email-manage:' + acc.id) {
      row.querySelector('.us-email-manage').hidden = false; manageBtn.setAttribute('aria-expanded','true');
    }
  }
  refreshIcons();
}


var PROVIDER_ICON_PATHS = {
  gmail: '/icons/email/gmail.svg',
  outlook: '/icons/email/outlook.svg',
  yahoo: '/icons/email/yahoo.svg',
};

function providerIcon(provider) {
  var src = PROVIDER_ICON_PATHS[provider];
  if (src) {
    return '<img src="' + src + '" class="us-email-provider-icon" alt="' + provider + '">';
  }
  return '<i data-lucide="mail" class="us-email-provider-icon-fallback"></i>';
}

function escHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
