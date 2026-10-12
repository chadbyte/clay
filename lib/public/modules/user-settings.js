import { initPersonalAppearance } from './user-settings-appearance.js';
import { initAccountSessions, resetAccountSessions } from './user-settings-sessions.js';
import { initPersonalVoice } from './user-settings-voice.js';
import { isolateSettingsDialog } from './server-settings-state.js';
import { initPersonalProfile } from './user-settings-profile.js';
import { initPersonalEditors } from './user-settings-editors.js';
import { initPersonalPreferences } from './user-settings-preferences.js';
import { showPinForm, hidePinForm, populateAccount, savePin, renderEmailSettings } from './user-settings-account.js';
import { buildUserSettingsLayout, resolveUserSettingsPage, loadUserSettingsExtras, finishUserSettingsExtras, guardUserSettingsLeave } from './user-settings-layout.js';
import { enhanceSettingsSelects } from './settings-select.js';
import { loadNotificationSettings } from './notification-settings.js';
// user-settings.js — Modal dialog for user settings
// Account management and logout

import { refreshIcons } from './icons.js';
import { showEmailSetupModal } from './context-sources.js';
import { store } from './store.js';
import { initCapsulePreference } from './capsule-preference.js';

var settingsEl = null;
var openBtn = null;
var closeBtn = null;
var backdrop = null;
var navItems = null;
var sections = null;
var pinForm = null;
var pinSetBtn = null;
var pinCancelBtn = null;


export function initUserSettings() {
  buildUserSettingsLayout();
  initAccountSessions();
  settingsEl = document.getElementById('user-settings');
  openBtn = document.getElementById('user-settings-btn');
  closeBtn = document.getElementById('user-settings-close');
  backdrop = document.getElementById('user-settings-backdrop');

  if (!settingsEl || !openBtn) return;

  initCapsulePreference();


  navItems = settingsEl.querySelectorAll('.us-nav-item');
  sections = settingsEl.querySelectorAll('.us-section');
  pinForm = document.getElementById('us-pin-form');

  openBtn.addEventListener('click', function () {
    openUserSettings();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      closeUserSettings();
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', function () {
      closeUserSettings();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab' && isUserSettingsOpen() && settingsEl.contains(document.activeElement)) {
      var items = Array.from(settingsEl.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')).filter(function (el) {return el.getClientRects().length && el.tabIndex !== -1;});
      var first=items[0],last=items[items.length-1];
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
    if (e.key === 'Escape' && isUserSettingsOpen() && !e.defaultPrevented && !store.get('speechPopup') && !document.querySelector('.admin-modal-overlay, #settings-confirm, .avatar-positioner-overlay, #email-setup-modal')) {
      e.preventDefault();closeUserSettings();
    }
  });

  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener('click', function () {
      var section = this.dataset.section;
      guardUserSettingsLeave(function () { switchSection(section); });
    });
  }

  // Mobile nav dropdown
  var navDropdown = document.getElementById('user-settings-nav-dropdown');
  if (navDropdown) {
    navDropdown.addEventListener('change', function () {
      var value = this.value; guardUserSettingsLeave(function () {switchSection(value);});
    });
  }

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

// Optional `initialSection` lets callers deep-link directly into a specific
// settings tab (e.g. the disabled-Mates picker button passing 'us-mates').
// Falls back to Account so existing callers and the icon click are unchanged.
export function openUserSettings(initialSection) {
  if(!isUserSettingsOpen())store.set({ userSettingsReturnFocus: document.activeElement, userSettingsRestore: isolateSettingsDialog(settingsEl) });

  settingsEl.classList.remove('hidden');
  openBtn.classList.add('active');
  refreshIcons(settingsEl);
  populateAccount();
  switchSection(initialSection || 'us-account');
  enhanceSettingsSelects(settingsEl);
  var title=settingsEl.querySelector(".us-section.active h2"); if(title){title.tabIndex=-1;title.focus();}
}

export function closeUserSettings() {
  guardUserSettingsLeave(function () {
    resetAccountSessions();
    finishUserSettingsExtras();
    settingsEl.classList.add('hidden');
    var restore=store.get('userSettingsRestore');if(restore)restore();store.set({userSettingsRestore:null});
    openBtn.classList.remove('active');
    var focus = store.get('userSettingsReturnFocus'); if (focus && focus.isConnected) focus.focus();
  });
}

export function isUserSettingsOpen() {
  return settingsEl && !settingsEl.classList.contains('hidden');
}

function switchSection(sectionName) {
  sectionName = resolveUserSettingsPage(sectionName);
  loadUserSettingsExtras(sectionName);
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].classList.toggle('active', navItems[i].dataset.section === sectionName);
    if(navItems[i].dataset.section===sectionName)navItems[i].setAttribute('aria-current','page');else navItems[i].removeAttribute('aria-current');
  }
  for (var j = 0; j < sections.length; j++) {
    sections[j].classList.toggle('active', sections[j].dataset.section === sectionName);
  }
  var navDropdown = document.getElementById('user-settings-nav-dropdown');
  if (navDropdown) navDropdown.value = sectionName;
  if (sectionName === 'us-notifications') loadNotificationSettings();
  if (sectionName === 'us-integrations') renderEmailSettings();
  var heading=settingsEl.querySelector('.us-section.active h2');if(heading){heading.tabIndex=-1;heading.focus();}
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
