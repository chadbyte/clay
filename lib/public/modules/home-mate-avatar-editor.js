// Explicit avatar drafts in the existing owner-scoped Mate settings surface.
import { mateAvatarUrl, mateCatalogAvatarUrl } from './avatar.js';
import { showAvatarPositioner } from './profile.js';
import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { MATE_AVATAR_COLLECTIONS } from './mate-avatar-catalog.js';

var timer = null;
function state() { return store.get('mateAvatarDraft'); }
function put(value) { store.set({ mateAvatarDraft: value }); }
function profile(mate) { return Object.assign({}, mate.profile || {}); }
function currentMate(mate) {
  return (store.get('cachedMatesList') || []).find(function (item) { return item.id === mate.id; }) || mate;
}
function ensure(mate) {
  var s = state();
  if (!s || s.mateId !== mate.id) {
    s = { mateId: mate.id, selected: (mate.profile || {}).avatarCatalogId || '', dirty: false, requestId: null, error: '', saved: false, uploading: false };
    put(s);
  } else if (!s.dirty && !s.requestId && !s.uploading && s.selected !== ((mate.profile || {}).avatarCatalogId || '')) {
    s = Object.assign({}, s, { selected: (mate.profile || {}).avatarCatalogId || '' }); put(s);
  }
  return s;
}
function button(label, id, action) {
  var b = document.createElement('button');
  b.type = 'button'; b.textContent = label; b.id = id;
  b.addEventListener('click', action);
  return b;
}
function closePicker(render) {
  clearHomeMateAvatarEditor();
  store.set({ mateSettingsAvatarOpen: false }); render();
  var opener = document.getElementById('mate-profile-avatar');
  if (opener) opener.focus();
}
function save(mate, render) {
  var s = state(); var ws = getWs();
  if (!s || s.requestId || !s.dirty) return;
  if (!ws || ws.readyState !== 1) { put(Object.assign({}, s, { error: 'Clay is offline. Your choice was not saved.' })); render(); return; }
  var requestId = 'mate-avatar-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  var p = profile(currentMate(mate)); p.avatarCatalogId = s.selected; p.avatarCustom = '';
  put(Object.assign({}, s, { requestId: requestId, error: '', saved: false })); render();
  try { ws.send(JSON.stringify({ type: 'mate_update', mateId: mate.id, requestId: requestId, updates: { profile: p } })); }
  catch (error) { failHomeMateAvatar(mate.id, 'Could not send your choice. Try again.', requestId); render(); return; }
  clearTimeout(timer);
  timer = setTimeout(function () { if (failHomeMateAvatar(mate.id, 'No response received. Your choice is retained; try again.', requestId)) render(); }, 15000);
}
function upload(mate, input, render) {
  var file = input.files && input.files[0]; if (!file) return;
  var image = new Image(); var url = URL.createObjectURL(file); var originalState = state();
  image.onerror = function () {
    URL.revokeObjectURL(url);
    if (state() === originalState) { put(Object.assign({}, originalState, { error: 'Could not read this image.' })); render(); }
  };
  image.onload = function () {
    if (state() !== originalState) { URL.revokeObjectURL(url); return; }
    showAvatarPositioner(image, url, function (blob) {
      URL.revokeObjectURL(url);
      if (state() !== originalState) return;
      var uploadingState = Object.assign({}, originalState, { uploading: true, error: '' }); put(uploadingState); render();
      blob.arrayBuffer().then(function (buffer) {
        return fetch('/api/mate-avatar/' + encodeURIComponent(mate.id), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(buffer) });
      }).then(function (response) {
        return response.json().then(function (data) { if (!response.ok || !data.ok || !data.avatar) throw new Error(data.error || 'Upload failed.'); return data.avatar; });
      }).then(function (avatar) {
        if (state() !== uploadingState) return;
        var p = profile(currentMate(mate)); p.avatarCustom = avatar;
        store.set({ cachedMatesList: (store.get('cachedMatesList') || []).map(function (item) { return item.id === mate.id ? Object.assign({}, item, { profile: p }) : item; }) });
        put(Object.assign({}, uploadingState, { uploading: false, dirty: false, saved: true }));
        // The HTTP upload is persisted; the update also refreshes other owner tabs.
        var ws = getWs();
        if (ws && ws.readyState === 1) {
          try { ws.send(JSON.stringify({ type: 'mate_update', mateId: mate.id, updates: { profile: p } })); }
          catch (error) { /* The acknowledged upload remains saved. */ }
        }
        render();
      }).catch(function (error) {
        if (state() !== uploadingState) return;
        put(Object.assign({}, uploadingState, { uploading: false, error: error.message || 'Could not upload this image.' })); render();
      });
    });
  };
  image.src = url;
}
export function renderHomeMateAvatarEditor(body, mate, render, onCancel) {
  if (!mate) return;
  var s = ensure(mate); var p = profile(mate); var busy = !!s.requestId || s.uploading;
  var section = document.createElement('section'); section.className = 'home-mate-avatar-editor';
  var preview = document.createElement('div'); preview.className = 'home-mate-avatar-selection';
  var image = document.createElement('img'); image.className = 'home-mate-avatar-preview';
  image.src = s.dirty ? mateCatalogAvatarUrl(s.selected) : mateAvatarUrl(mate, 52); image.alt = 'Avatar preview';
  var caption = document.createElement('p'); caption.textContent = s.dirty ? 'Preview' : 'Current avatar';
  preview.appendChild(image); preview.appendChild(caption); section.appendChild(preview);
  if (!p.avatarLocked) {
    MATE_AVATAR_COLLECTIONS.forEach(function (collection) {
      var family = collection.id;
      var heading = document.createElement('h4'); heading.textContent = collection.name;
      heading.id = 'mate-avatar-family-' + family; section.appendChild(heading);
      var grid = document.createElement('div'); grid.className = 'home-mate-avatar-choices';
      grid.setAttribute('role', 'group'); grid.setAttribute('aria-labelledby', heading.id);
      collection.avatars.forEach(function (entry) {
          var id = entry.id;
          var choice = button(id, 'mate-avatar-' + id, function () {
            put(Object.assign({}, state(), { selected: id, dirty: id !== (currentMate(mate).profile || {}).avatarCatalogId || !!(currentMate(mate).profile || {}).avatarCustom, error: '', saved: false }));
            render(); var target = document.getElementById('mate-avatar-' + id); if (target) target.focus({ preventScroll: true });
          });
          choice.textContent = ''; choice.className = 'home-mate-avatar-choice'; choice.disabled = busy;
          choice.setAttribute('aria-label', entry.name + ' avatar'); choice.title = entry.name; choice.setAttribute('aria-pressed', String(s.selected === id && (s.dirty || !p.avatarCustom)));
          var img = document.createElement('img'); img.src = mateCatalogAvatarUrl(id); img.alt = ''; img.draggable = false;
          choice.appendChild(img);
          choice.addEventListener('keydown', function (event) {
            var buttons = Array.from(grid.querySelectorAll('button')); var index = buttons.indexOf(choice);
            var columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
            var offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
            if (offset !== undefined || event.key === 'Home' || event.key === 'End') {
              event.preventDefault(); var next = event.key === 'Home' ? 0 : event.key === 'End' ? 47 : Math.max(0, Math.min(47, index + offset)); buttons[next].focus();
            }
          });
          grid.appendChild(choice);
      });
      section.appendChild(grid);
    });
    var actions = document.createElement('div'); actions.className = 'home-mate-avatar-actions';
    var cancel = button('Cancel', 'mate-avatar-cancel', function () { if (onCancel) onCancel(); else closePicker(render); }); cancel.disabled = busy;
    var saveButton = button('Save avatar', 'mate-avatar-save', function () { save(mate, render); }); saveButton.disabled = busy || !s.dirty;
    saveButton.className = 'primary';
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp'; input.hidden = true; input.tabIndex = -1;
    input.className = 'home-mate-avatar-file-input'; input.addEventListener('change', function () { upload(mate, input, render); });
    var uploadButton = button('Upload image', 'mate-avatar-upload', function () { input.click(); }); uploadButton.disabled = busy;
    actions.appendChild(cancel); actions.appendChild(saveButton); actions.appendChild(uploadButton); actions.appendChild(input); section.appendChild(actions);
  }
  var status = document.createElement('p'); status.className = 'home-mate-avatar-status' + (s.error ? ' is-error' : '');
  status.setAttribute('role', s.error ? 'alert' : 'status'); status.textContent = s.error || (s.requestId ? 'Saving avatar…' : s.uploading ? 'Uploading image…' : s.saved ? 'Avatar saved.' : 'Choose a face, then save.');
  (actions || section).appendChild(status); body.appendChild(section);
}
export function hasHomeMateAvatarDraft() { var s = state(); return !!s && s.dirty; }
export function homeMateAvatarSaving() { var s = state(); return !!s && (!!s.requestId || s.uploading); }
export function confirmHomeMateAvatar(mate, requestId) {
  var s = state(); if (!mate || !s || s.mateId !== mate.id || !s.requestId || s.requestId !== requestId || (mate.profile || {}).avatarCatalogId !== s.selected) return false;
  clearTimeout(timer); put(Object.assign({}, s, { requestId: null, dirty: false, saved: true, error: '' })); return true;
}
export function failHomeMateAvatar(mateId, message, requestId) {
  var s = state(); if (!s || !s.requestId || s.mateId !== mateId || s.requestId !== requestId) return false;
  clearTimeout(timer); put(Object.assign({}, s, { requestId: null, error: message || 'Could not save this avatar.' })); return true;
}
export function clearHomeMateAvatarEditor() { clearTimeout(timer); put(null); }
