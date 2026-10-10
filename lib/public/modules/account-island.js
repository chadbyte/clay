import { store } from './store.js';
import { mountDefaultAi, unmountDefaultAi } from './default-ai.js';
import { openUserSettings } from './user-settings.js';
import { getProfile, updateProfileName, regenerateProfileAvatar, showAvatarPositioner, uploadAvatarBlob } from './profile.js';
import { requestCursorSharingState, setCursorSharing } from './app-cursors.js';
import { registerTooltip } from './tooltip.js';

var popover = null;
var trigger = null;
var lastFocus = null;

function accountName() { return document.body.dataset.myDisplayName || 'Clay user'; }

function close(returnFocus) {
  if (!popover) return;
  var aiSection = popover.querySelector('#account-ai-section');
  if (aiSection) unmountDefaultAi(aiSection);
  popover.remove();
  popover = null;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Open account menu for ' + accountName());
  document.removeEventListener('pointerdown', onOutside);
  document.removeEventListener('focusin', onFocusOutside);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', position);
  store.set({ defaultAiInlineEditing: false });
  if (returnFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
}

function isAvatarPositionerTarget(target) { return target && target.closest && target.closest('.avatar-positioner-overlay'); }
function onOutside(event) { if (!popover || popover.contains(event.target) || trigger.contains(event.target) || isAvatarPositionerTarget(event.target)) return; close(false); }
function onFocusOutside(event) { if (!popover || popover.contains(event.target) || trigger.contains(event.target) || isAvatarPositionerTarget(event.target)) return; close(false); }
function onKeydown(event) {
  if (event.key !== 'Escape') return;
  if (isAvatarPositionerTarget(event.target) || document.querySelector('.avatar-positioner-overlay')) return;
  event.preventDefault();
  event.stopPropagation();
  close(true);
}

function position() {
  if (!popover || !trigger) return;
  var rect = trigger.getBoundingClientRect();
  var width = Math.min(280, window.innerWidth - 24);
  var left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
  popover.style.width = width + 'px';
  popover.style.left = left + 'px';
  popover.style.top = Math.max(12, rect.top - popover.offsetHeight - 8) + 'px';
}

function renderNameResting(restoreFocus) {
  var section = popover && popover.querySelector('.account-identity-copy');
  if (!section) return;
  section.innerHTML = '<button type="button" id="account-name-edit" class="account-name-display"><span></span><i data-lucide="pencil" aria-hidden="true"></i></button><small>Personal account</small>';
  section.querySelector('span').textContent = accountName();
  section.querySelector('#account-name-edit').addEventListener('click', startNameEdit);
  if (window.lucide) window.lucide.createIcons({ nodes: [section] });
  if (restoreFocus) section.querySelector('#account-name-edit').focus();
}

function startNameEdit() {
  var section = popover && popover.querySelector('.account-identity-copy');
  if (!section) return;
  var input = document.createElement('input');
  input.id = 'account-profile-name';
  input.setAttribute('aria-label', 'Display name');
  input.className = 'account-name-input';
  input.type = 'text';
  input.maxLength = 50;
  input.autocomplete = 'name';
  input.value = getProfile().name || '';
  section.innerHTML = '';
  section.appendChild(input);
  var hint = document.createElement('small');
  hint.textContent = 'Enter to save · Escape to cancel';
  section.appendChild(hint);
  input.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      updateProfileName(input.value);
      renderNameResting(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      renderNameResting(true);
    }
    event.stopPropagation();
  });
  input.focus();
  input.select();
}

function toggleAvatarEditor() {
  var editor = popover && popover.querySelector('#account-avatar-editor');
  if (!editor) return;
  editor.hidden = !editor.hidden;
  if (!editor.hidden) editor.querySelector('#account-avatar-upload').focus();
  position();
}

function bindAvatarEditor() {
  var avatar = popover.querySelector('#account-avatar-edit');
  var editor = popover.querySelector('#account-avatar-editor');
  var upload = editor.querySelector('#account-avatar-upload');
  var file = editor.querySelector('#account-avatar-file');
  var generate = editor.querySelector('#account-avatar-generate');
  avatar.addEventListener('click', function(event) { event.stopPropagation(); toggleAvatarEditor(); });
  editor.addEventListener('click', function(event) { event.stopPropagation(); });
  upload.addEventListener('click', function() { file.click(); });
  file.addEventListener('change', function() {
    var selected = file.files && file.files[0];
    if (!selected) return;
    var image = new Image();
    var objectUrl = URL.createObjectURL(selected);
    image.onload = function() {
      showAvatarPositioner(image, objectUrl, function(blob) {
        URL.revokeObjectURL(objectUrl);
        uploadAvatarBlob(blob).then(function() { editor.hidden = true; }).catch(function() { editor.dataset.error = 'true'; });
      });
    };
    image.src = objectUrl;
  });
  generate.addEventListener('click', function() { regenerateProfileAvatar(); editor.hidden = true; });
}

function render() {
  popover = document.createElement('div');
  popover.id = 'account-popover';
  popover.className = 'account-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Account');
  var profile = getProfile();
  var identity = document.createElement('div');
  identity.className = 'account-menu-identity';
  identity.innerHTML = '<button type="button" id="account-avatar-edit" class="account-avatar-edit" aria-label="Edit avatar"><img src="' + (document.body.dataset.myAvatarUrl || '') + '" alt=""></button><div class="account-identity-copy"></div><button type="button" class="account-settings-button" aria-label="User Settings" title="User Settings"><i data-lucide="settings" aria-hidden="true"></i></button>';
  identity.querySelector('#account-avatar-edit img').alt = profile.name || 'Clay user';
  var editor = document.createElement('div');
  editor.id = 'account-avatar-editor';
  editor.className = 'account-avatar-editor';
  editor.hidden = true;
  editor.innerHTML = '<button type="button" id="account-avatar-upload">Upload photo</button><button type="button" id="account-avatar-generate">Generate avatar</button><input id="account-avatar-file" type="file" accept="image/*">';
  popover.appendChild(identity);
  popover.appendChild(editor);
  var aiSection = document.createElement('section');
  aiSection.id = 'account-ai-section';
  aiSection.className = 'account-inline-section account-ai-section';
  aiSection.setAttribute('aria-label', 'Default AI');
  popover.appendChild(aiSection);
  mountDefaultAi(aiSection);
  identity.querySelector('.account-settings-button').addEventListener('click', onSettings);
  document.body.appendChild(popover);
  renderNameResting();
  bindAvatarEditor();
  updateCursorAction();
  if (window.lucide) window.lucide.createIcons({ nodes: [popover] });
  position();
}

function updateCursorAction() {
  var button = document.getElementById('cursor-share-toggle');
  if (!button) return;
  var hydrated = store.get('cursorSharingHydrated') === true;
  var enabled = hydrated && store.get('cursorSharingEnabled') === true;
  var pending = store.get('cursorSharingPending') !== null && store.get('cursorSharingPending') !== undefined;
  var connected = store.get('connected') !== false;
  var error = store.get('cursorSharingError');
  var canRetry = !!error && !hydrated && connected;
  var showOff = hydrated && !enabled && !pending && !error && connected;
  button.hidden = store.get('isMultiUserMode') !== true;
  button.removeAttribute('role');
  button.removeAttribute('aria-checked');
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  button.classList.toggle('on', enabled);
  button.classList.toggle('off', showOff);
  button.classList.toggle('pending', pending);
  button.disabled = pending || !connected || (!hydrated && !canRetry);
  var stateLabel = pending ? 'waiting' : !connected ? 'offline' : error ? (canRetry ? 'error; activate to retry' : 'error') : !hydrated ? 'unavailable' : enabled ? 'on' : 'off';
  button.setAttribute('aria-label', 'Cursor sharing ' + stateLabel);
  var tooltipText = pending ? 'Cursor sharing is waiting for confirmation.' : !connected ? 'Cursor sharing is offline.' : error ? (canRetry ? 'Cursor sharing is unavailable. Click to retry.' : 'Cursor sharing is unavailable.') : !hydrated ? 'Cursor sharing is unavailable.' : enabled ? 'Your cursor is visible to others. Click to stop sharing.' : 'Cursor sharing is off. Click to share your cursor.';
  registerTooltip(button, tooltipText);
}

function onSettings(event) { event.stopPropagation(); close(false); openUserSettings(); }
function onCursorAction(event) {
  event.stopPropagation();
  if (event.currentTarget.disabled) return;
  if (store.get('cursorSharingError') && store.get('cursorSharingHydrated') !== true) {
    requestCursorSharingState();
    return;
  }
  setCursorSharing(!(store.get('cursorSharingEnabled') === true));
}
function focusAi() { var control = popover && popover.querySelector('#account-ai-section select'); if (control) control.focus({ preventScroll: true }); }
function onOpenDefaultAi() { if (!popover) open(); store.set({ defaultAiInlineEditing: true }); focusAi(); }

function open() {
  if (popover) { close(true); return; }
  lastFocus = document.activeElement;
  render();
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-label', 'Close account menu for ' + accountName());
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('focusin', onFocusOutside);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', position);
}

export function initAccountIsland() {
  trigger = document.getElementById('user-account-trigger');
  if (!trigger) return;
  trigger.addEventListener('click', open);
  document.addEventListener('clay:open-account-default-ai', onOpenDefaultAi);
  var cursorToggle = document.getElementById('cursor-share-toggle');
  if (cursorToggle) cursorToggle.addEventListener('click', onCursorAction);
  updateCursorAction();
  trigger.setAttribute('aria-label', 'Open account menu for ' + accountName());
  store.subscribe(function(state, previous) {
    if (state.myUserId !== previous.myUserId || state.connected === false) close(false);
    updateCursorAction();
    if (popover) position();
  });
  document.addEventListener('clay:profile-updated', function() {
    if (!popover) return;
    var identityName = popover.querySelector('.account-name-display span');
    if (identityName) identityName.textContent = accountName();
    var avatar = popover.querySelector('#account-avatar-edit img');
    if (avatar) avatar.src = document.body.dataset.myAvatarUrl || avatar.src;
  });
  window.addEventListener('resize', position);
}
