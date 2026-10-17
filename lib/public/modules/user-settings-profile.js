import { store } from './store.js';
import { getProfile, saveProfileUpdates, uploadAvatarBlob, showAvatarPositioner } from './profile.js';
import { populateAccount } from './user-settings-account.js';
import { confirmSettingsAction } from './server-settings-state.js';
import { iconHtml, refreshIcons } from './icons.js';

export function initPersonalProfile() {
  var hero = document.querySelector('#user-settings .us-account-hero');
  var name = document.getElementById('us-account-name');
  var edit = document.createElement('button'); edit.id = 'us-profile-edit'; edit.type = 'button'; edit.className = 'settings-btn-sm'; edit.textContent = 'Edit name'; hero.appendChild(edit);
  var form = document.createElement('form'); form.hidden = true; form.className = 'us-profile-form';
  form.innerHTML = '<label class="settings-label" for="us-profile-name">Display name</label><input id="us-profile-name" class="us-text-input" maxlength="100" required autocomplete="name"><div class="settings-form-actions"><button type="submit" class="settings-btn-sm">Save</button><button type="button" class="settings-btn-sm" data-cancel>Cancel</button></div><p role="status" class="settings-status"></p>';
  name.after(form); var input = form.querySelector('input');
  function close() { form.hidden = true; name.hidden = false; edit.hidden = false; edit.focus(); }
  edit.onclick = function () {
    if (!store.get('userProfileDirty')) {
      input.value = name.textContent || getProfile().name;
      store.set({userProfileSavedName:input.value.trim()});
    }
    form.hidden = false; name.hidden = true; edit.hidden = true; input.focus(); input.select();
  };
  input.oninput = function () { store.set({ userProfileDirty: input.value.trim() !== store.get('userProfileSavedName') }); };
  store.subscribe(function (state, previous) {
    if (state.userSettingsProfile === previous.userSettingsProfile || !state.userSettingsProfile) return;
    var data = state.userSettingsProfile;
    var saved = data.name || data.displayName || data.username || 'Clay User';
    if (!state.userProfileDirty) input.value = saved;
    store.set({userProfileSavedName:saved.trim(), userProfileDirty:input.value.trim() !== saved.trim()});
  });
  form.onsubmit = async function (event) {
    event.preventDefault(); var save = form.querySelector('[type=submit]'); var status = form.querySelector('[role=status]');
    if (!input.value.trim()) { status.textContent = 'Enter a display name.'; return; }
    save.disabled = true; status.textContent = 'Saving…';
    try { await saveProfileUpdates({ name: input.value.trim() }); store.set({ userProfileDirty: false }); close(); populateAccount(); }
    catch (error) { status.textContent = error.message; status.dataset.state = 'error'; }
    finally { save.disabled = false; }
  };
  form.querySelector('[data-cancel]').onclick = function () {
    function discard() { store.set({ userProfileDirty: false }); close(); }
    if (store.get('userProfileDirty')) confirmSettingsAction('Discard your unsaved name?', 'Discard', discard); else discard();
  };
  var visual = hero.querySelector('.us-account-avatar');
  var avatar = document.createElement('button'); avatar.id = 'us-profile-avatar'; avatar.type = 'button'; avatar.className = 'us-avatar-edit'; avatar.setAttribute('aria-label', 'Change profile picture'); avatar.title = 'Change profile picture';
  visual.before(avatar); avatar.appendChild(visual);
  avatar.insertAdjacentHTML('beforeend', '<span class="us-avatar-edit-mark" aria-hidden="true">' + iconHtml('camera') + '</span>');
  refreshIcons();
  var file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; hero.after(file);
  var status = document.createElement('p'); status.className = 'settings-status'; status.setAttribute('role', 'status'); hero.after(status);
  avatar.onclick = function () { file.click(); };
  file.onchange = function () {
    var selected = file.files[0]; if (!selected) return;
    var url = URL.createObjectURL(selected); var image = new Image();
    image.onload = function () {
      showAvatarPositioner(image, url, function (blob) {
        URL.revokeObjectURL(url); status.textContent = 'Uploading picture…';
        uploadAvatarBlob(blob).then(function () { status.textContent = 'Picture updated.'; populateAccount(); avatar.focus(); })
          .catch(function (error) { status.textContent = error.message; status.dataset.state = 'error'; });
      }, document.querySelector('#user-settings .us-section[data-section="us-account"]'));
    };
    image.onerror = function () { URL.revokeObjectURL(url); status.textContent = 'Could not read that image. Choose another file.'; };
    image.src = url; file.value = '';
  };
}
