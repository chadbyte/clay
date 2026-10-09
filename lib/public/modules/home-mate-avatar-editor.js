// Mate avatar choices hosted inside the current settings dialog.

import { avatarUrl, mateAvatarUrl, MATE_AVATAR_STYLES } from './avatar.js';
import { showAvatarPositioner } from './profile.js';
import { getWs } from './ws-ref.js';
import { store } from './store.js';

var activeToken = 0;
var activeMateId = null;
var pending = null;
var statusByMate = Object.create(null);
var draftByMate = Object.create(null);

function mateName(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.displayName || (mate && (mate.displayName || mate.name)) || 'Mate';
}

function mateProfile(mate) {
  return Object.assign({}, mate && mate.profile ? mate.profile : {});
}

function sendProfile(mate, profile, rerender, message) {
  draftByMate[mate.id] = profile;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    statusByMate[mate.id] = { kind: 'error', text: 'Clay is offline. Your choice was not saved.' };
    rerender();
    return false;
  }
  pending = { mateId: mate.id, style: profile.avatarStyle || 'imprint', seed: profile.avatarSeed || '', custom: profile.avatarCustom || '' };
  statusByMate[mate.id] = { kind: 'pending', text: message || 'Saving avatar…' };
  ws.send(JSON.stringify({ type: 'mate_update', mateId: mate.id, updates: { profile: profile } }));
  rerender();
  return true;
}

function appendStatus(body, mate) {
  var state = statusByMate[mate.id];
  var status = document.createElement('div');
  status.className = 'home-mate-avatar-status' + (state ? ' is-' + state.kind : '');
  status.setAttribute('aria-live', 'polite');
  status.textContent = state ? state.text : '';
  body.appendChild(status);
}

function createChoice(label, src, selected) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'home-mate-avatar-choice';
  button.setAttribute('aria-label', label + ' avatar');
  button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  button.title = label;
  var image = document.createElement('img');
  image.src = src;
  image.alt = '';
  image.draggable = false;
  var text = document.createElement('span');
  text.textContent = label;
  button.appendChild(image);
  button.appendChild(text);
  return button;
}

function selectStyle(mate, style, seed, rerender) {
  var profile = mateProfile(mate);
  profile.avatarStyle = style;
  profile.avatarSeed = seed;
  profile.avatarCustom = '';
  sendProfile(mate, profile, rerender);
}

function uploadBlob(mate, blob, token, rerender) {
  pending = null;
  statusByMate[mate.id] = { kind: 'pending', text: 'Uploading image…' };
  rerender();
  blob.arrayBuffer().then(function (buffer) {
    return fetch('/api/mate-avatar/' + encodeURIComponent(mate.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(buffer),
    });
  }).then(function (response) {
    return response.json().then(function (data) {
      if (!response.ok || !data.ok || !data.avatar) throw new Error(data.error || 'Upload failed');
      return data.avatar;
    });
  }).then(function (avatar) {
    if (token !== activeToken) return;
    var profile = mateProfile(mate);
    profile.avatarCustom = avatar;
    draftByMate[mate.id] = profile;
    statusByMate[mate.id] = { kind: 'saved', text: 'Image saved.' };
    var mates = store.get('cachedMatesList') || [];
    store.set({ cachedMatesList: mates.map(function (item) {
      return item && item.id === mate.id ? Object.assign({}, item, { profile: profile }) : item;
    }) });
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'mate_update', mateId: mate.id, updates: { profile: profile } }));
    }
    rerender();
  }).catch(function (error) {
    if (token !== activeToken) return;
    statusByMate[mate.id] = { kind: 'error', text: error && error.message ? error.message : 'Could not upload this image.' };
    rerender();
  });
}

function openUpload(mate, input, rerender) {
  var file = input.files && input.files[0];
  if (!file) return;
  var token = ++activeToken;
  var image = new Image();
  var objectUrl = URL.createObjectURL(file);
  image.onload = function () {
    if (token !== activeToken) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    showAvatarPositioner(image, objectUrl, function (blob) {
      URL.revokeObjectURL(objectUrl);
      if (token === activeToken) uploadBlob(mate, blob, token, rerender);
    });
  };
  image.onerror = function () {
    URL.revokeObjectURL(objectUrl);
    if (token !== activeToken) return;
    statusByMate[mate.id] = { kind: 'error', text: 'Could not read this image.' };
    rerender();
  };
  image.src = objectUrl;
}

export function renderHomeMateAvatarEditor(body, mate, rerender) {
  if (!mate) return;
  if (activeMateId !== mate.id) {
    activeMateId = mate.id;
    activeToken++;
  }
  var profile = draftByMate[mate.id] || mateProfile(mate);
  var name = mateName(mate);
  var style = profile.avatarStyle || 'imprint';
  var seed = profile.avatarSeed || mate.id || name;
  var locked = profile.avatarLocked === true;
  var section = document.createElement('section');
  section.className = 'home-mate-avatar-editor';
  var heading = document.createElement('div');
  heading.className = 'home-mate-avatar-heading';
  var preview = document.createElement('img');
  preview.className = 'home-mate-avatar-preview';
  preview.src = mateAvatarUrl(Object.assign({}, mate, { profile: profile }), 72);
  preview.alt = name + ' avatar';
  var copy = document.createElement('div');
  var title = document.createElement('h3');
  title.textContent = 'Avatar';
  var note = document.createElement('p');
  note.textContent = locked ? 'This built-in avatar is managed by Clay.' : 'Choose a locally generated style or upload your own image.';
  copy.appendChild(title);
  copy.appendChild(note);
  heading.appendChild(preview);
  heading.appendChild(copy);
  section.appendChild(heading);
  if (!locked) {
    var choices = document.createElement('div');
    choices.className = 'home-mate-avatar-choices';
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', 'Avatar for ' + name);
    for (var i = 0; i < MATE_AVATAR_STYLES.length; i++) {
      (function (entry) {
        var choice = createChoice(entry.name, avatarUrl(entry.id, seed, 48), !profile.avatarCustom && style === entry.id);
        choice.addEventListener('click', function () { selectStyle(mate, entry.id, seed, rerender); });
        choices.appendChild(choice);
      })(MATE_AVATAR_STYLES[i]);
    }
    section.appendChild(choices);
    var actions = document.createElement('div');
    actions.className = 'home-mate-avatar-actions';
    var shuffle = document.createElement('button');
    shuffle.type = 'button';
    shuffle.textContent = 'Shuffle selected style';
    shuffle.disabled = style === 'imprint' || style === 'initial' || !!profile.avatarCustom;
    shuffle.addEventListener('click', function () {
      selectStyle(mate, style, Math.random().toString(36).substring(2, 10), rerender);
    });
    var upload = document.createElement('button');
    upload.type = 'button';
    upload.textContent = profile.avatarCustom ? 'Replace image' : 'Upload image';
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.className = 'home-mate-avatar-file-input';
    input.hidden = true;
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.addEventListener('change', function () { openUpload(mate, input, rerender); });
    upload.addEventListener('click', function () { input.click(); });
    actions.appendChild(shuffle);
    actions.appendChild(upload);
    actions.appendChild(input);
    section.appendChild(actions);
  }
  appendStatus(section, mate);
  body.appendChild(section);
}

export function confirmHomeMateAvatar(mate) {
  if (!mate || !pending || pending.mateId !== mate.id) return false;
  var profile = mateProfile(mate);
  if ((profile.avatarStyle || 'imprint') !== pending.style || (profile.avatarSeed || '') !== pending.seed || (profile.avatarCustom || '') !== pending.custom) return false;
  pending = null;
  delete draftByMate[mate.id];
  statusByMate[mate.id] = { kind: 'saved', text: 'Avatar saved.' };
  return true;
}

export function failHomeMateAvatar(mateId, message) {
  if (!pending || !mateId || pending.mateId !== mateId) return false;
  statusByMate[pending.mateId] = { kind: 'error', text: message || 'Could not save this avatar.' };
  pending = null;
  return true;
}

export function clearHomeMateAvatarEditor() {
  activeToken++;
  activeMateId = null;
  pending = null;
}
