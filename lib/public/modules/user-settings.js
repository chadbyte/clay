import { initPersonalAppearance } from './user-settings-appearance.js';
import { initAccountSessions, resetAccountSessions } from './user-settings-sessions.js';
import { initPersonalVoice } from './user-settings-voice.js';
import { registerSettingsScope, openSettings, closeSettings, isSettingsShellOpen, activeSettingsScope } from './settings-shell.js';
import { initPersonalProfile } from './user-settings-profile.js';
import { initPersonalEditors } from './user-settings-editors.js';
import { initPersonalPreferences } from './user-settings-preferences.js';
import { showPinForm, hidePinForm, populateAccount, savePin, renderEmailSettings } from './user-settings-account.js';
import { buildUserSettingsLayout, resolveUserSettingsPage, loadUserSettingsExtras, finishUserSettingsExtras, leaveAgentBehaviorPage, personalLeavePrompt } from './user-settings-layout.js';
import { enhanceSettingsSelects } from './settings-select.js';
import { loadNotificationSettings } from './notification-settings.js';
// user-settings.js — Personal settings pane of the unified settings shell
// Account management and logout

import { refreshIcons } from './icons.js';
import { showEmailSetupModal } from './context-sources.js';
import { store } from './store.js';
import { initCapsulePreference } from './capsule-preference.js';

var settingsEl = null;
var sections = null;
var pinForm = null;
var pinSetBtn = null;
var pinCancelBtn = null;


export function initUserSettings() {
  buildUserSettingsLayout();
  initAccountSessions();
  settingsEl = document.getElementById('user-settings');
  if (!settingsEl) return;

  initCapsulePreference();

  sections = settingsEl.querySelectorAll('.us-section');
  registerSettingsScope('personal', {
    pane: settingsEl,
    enter: function () { populateAccount(); },
    activate: function (page) { switchSection(page); },
    leave: function () { currentPage = null; resetAccountSessions(); finishUserSettingsExtras(); },
    busy: function () { return store.get('speechPopup') ? 'Finish or close the open voice settings editor first.' : ''; },
    leavePrompt: function (kind, pageId) { return personalLeavePrompt(kind === 'page' ? pageId : undefined); }
  });
  pinForm = document.getElementById('us-pin-form');

  // PIN save button
  var pinInput = document.getElementById('us-pin-input');
  var pinConfirmInput = document.getElementById('us-pin-confirm-input');
  var pinCurrentInput = document.getElementById('us-pin-current-input');
  var pinSave = document.getElementById('us-pin-save');
  pinSetBtn = document.getElementById('us-pin-set-btn');
  pinCancelBtn = document.getElementById('us-pin-cancel');
  if (pinInput && pinConfirmInput && pinSave) {
    function validatePin() {
      var validNew = /^\d{6}$/.test(pinInput.value);
      var validConfirm = /^\d{6}$/.test(pinConfirmInput.value);
      var validCurrent = !store.get('userPinEnabled') || (pinCurrentInput && /^\d{6}$/.test(pinCurrentInput.value));
      pinSave.disabled = !(validNew && validConfirm && validCurrent && pinInput.value === pinConfirmInput.value);
    }
    pinInput.addEventListener('input', validatePin);
    pinConfirmInput.addEventListener('input', validatePin);
    if (pinCurrentInput) pinCurrentInput.addEventListener('input', validatePin);
    pinInput.addEventListener('keyup', function (e) { e.stopPropagation(); validatePin(); });
    pinConfirmInput.addEventListener('keyup', function (e) { e.stopPropagation(); validatePin(); });
    if (pinCurrentInput) pinCurrentInput.addEventListener('keyup', function (e) { e.stopPropagation(); validatePin(); });
    pinInput.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        savePin(pinInput.value);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hidePinForm();
      }
    });
    pinConfirmInput.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        savePin(pinInput.value);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hidePinForm();
      }
    });
    if (pinCurrentInput) {
      pinCurrentInput.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          savePin(pinInput.value);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          hidePinForm();
        }
      });
    }
    pinInput.addEventListener('keypress', stopProp);
    pinConfirmInput.addEventListener('keypress', stopProp);
    if (pinCurrentInput) pinCurrentInput.addEventListener('keypress', stopProp);
    pinSave.addEventListener('click', function () {
      savePin(pinInput.value);
    });
  }
  if (pinSetBtn) {
    pinSetBtn.addEventListener('click', function () {
      showPinForm();
    });
  }
  if (pinCancelBtn) {
    pinCancelBtn.addEventListener('click', function () {
      hidePinForm();
    });
  }

  initPersonalPreferences();
  initPersonalAppearance();
  initPersonalVoice();

  // Terminal font picker lives in the title bar (visible only while a
  // TUI session is active). See lib/public/modules/header-tui-font.js.
  // We still seed terminal-prefs from /api/profile below so the
  // controls populate correctly when they appear.

  // Logout button
  var logoutBtn = document.getElementById('us-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/auth/logout', { method: 'POST' }).then(function () {
        window.location.reload();
      }).catch(function () {
        window.location.reload();
      });
    });
  }

  initPersonalEditors();
  initPersonalProfile();

  document.querySelectorAll('[data-email-provider]').forEach(function (button) {
    button.addEventListener('click', function () { showEmailSetupModal(button.dataset.emailProvider, document.getElementById("us-integration-setup")); });
  });
}

// Optional `initialSection` deep-links into a personal page (e.g. the
// disabled-Mates picker passes 'us-mates'). Defaults to Account.
export function openUserSettings(initialSection) {
  return openSettings({ scope: 'personal', page: initialSection || 'us-account' });
}

export function closeUserSettings() {
  if (isUserSettingsOpen()) closeSettings();
}

export function isUserSettingsOpen() {
  return isSettingsShellOpen() && activeSettingsScope() === 'personal';
}

var currentPage = null;
function switchSection(sectionName) {
  sectionName = resolveUserSettingsPage(sectionName);
  if (currentPage === 'us-agent' && sectionName !== 'us-agent') leaveAgentBehaviorPage();
  currentPage = sectionName;
  loadUserSettingsExtras(sectionName);
  for (var j = 0; j < sections.length; j++) {
    sections[j].classList.toggle('active', sections[j].dataset.section === sectionName);
  }
  if (sectionName === 'us-notifications') loadNotificationSettings();
  if (sectionName === 'us-integrations') renderEmailSettings();
  enhanceSettingsSelects(settingsEl); refreshIcons(settingsEl);
}

function stopProp(e) {
  e.stopPropagation();
}

export function isProjectMateDmsEnabled() {
  // Default to true until the profile arrives so boot does not briefly hide
  // a project shortcut that the persisted preference enables.
  return true;
}


export function refreshEmailSettings() { if (isUserSettingsOpen()) renderEmailSettings(); }
