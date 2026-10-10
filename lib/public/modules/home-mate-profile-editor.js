import { mateAvatarUrl } from './avatar.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
var timer = null;
var sequence = 0;
function state() { return store.get('mateProfileDraft'); }
function put(s) { store.set({mateProfileDraft:s}); }
function name(mate) { return (mate.profile || {}).displayName || mate.name || 'Mate'; }
export function resetMateProfile() { clearTimeout(timer); put(null); }
export function hasMateProfileDraft() { var s = state(); return !!s && (!!s.requestId || s.name !== s.savedName || s.bio !== s.savedBio); }
export function mateProfileSaving() { var s = state(); return !!s && !!s.requestId; }
export function applyMateProfile(msg) {
  var s = state();
  if (!s || !s.requestId || msg.requestId !== s.requestId || (msg.mate ? msg.mate.id : msg.mateId) !== s.mateId) return false;
  clearTimeout(timer);
  if (msg.mate) put(null);
  else put(Object.assign({},s,{requestId:null,error:msg.error || 'Could not save. Your changes are retained.'}));
  return true;
}
export function renderMateProfile(body, mate, render, editAvatar) {
  var section = document.createElement('section'); section.className = 'mate-settings-profile';
  var heading = document.createElement('div'); heading.className = 'mate-settings-profile-heading';
  var title = document.createElement('h4'); title.textContent = name(mate); heading.appendChild(title);
  var avatar = document.createElement('button'); avatar.type = 'button'; avatar.className = 'mate-settings-profile-avatar';
  avatar.id = 'mate-profile-avatar'; avatar.setAttribute('aria-label','Change Mate avatar'); avatar.title = 'Change avatar';
  avatar.disabled = !!(mate.profile || {}).avatarLocked;
  avatar.setAttribute('aria-expanded',String(!!store.get('mateSettingsAvatarOpen')));
  var image = document.createElement('img'); image.src = mateAvatarUrl(mate,72); image.alt = ''; avatar.appendChild(image);
  avatar.addEventListener('click',editAvatar); section.appendChild(avatar);
  section.appendChild(heading); body.appendChild(section);
  var s = state();
  function button(label, action, primary, parent) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.className = 'mate-settings-button' + (primary ? ' primary' : ''); b.disabled = !!s && !!s.requestId;
    b.addEventListener('click',action); (parent || section).appendChild(b); return b;
  }
  if (!s || s.mateId !== mate.id) {
    if (!mate.primary) {
      var edit = button('Edit',function () {
        put({mateId:mate.id,name:name(mate),bio:mate.bio || '',savedName:name(mate),savedBio:mate.bio || '',error:'',requestId:null});
        render(); document.getElementById('mate-profile-name').focus();
      },false,heading); edit.id = 'mate-profile-edit'; edit.setAttribute('aria-label','Edit Mate identity');
    }

    var bio = document.createElement('p'); bio.className = 'mate-settings-help'; bio.textContent = mate.bio || 'No introduction yet.'; section.appendChild(bio);
    if (mate.primary) { var note = document.createElement('p'); note.className = 'mate-settings-help'; note.textContent = 'Clay manages this built-in identity.'; section.appendChild(note); }
    return;
  }
  section.classList.add('is-editing');
  function field(title, key, multiline) {
    var label = document.createElement('label'); label.className = 'mate-settings-profile-field'; label.textContent = title;
    var input = document.createElement(multiline ? 'textarea' : 'input'); input.id = 'mate-profile-' + key; input.value = s[key]; input.disabled = !!s.requestId;
    input.addEventListener('input',function () { put(Object.assign({},state(),{[key]:input.value})); });
    label.appendChild(input); section.appendChild(label);
  }
  field('Name','name',false); field('Introduction','bio',true);
  var status = document.createElement('p'); status.className = 'mate-settings-status' + (s.error ? ' is-error' : ''); status.setAttribute('role',s.error ? 'alert' : 'status'); status.textContent = s.error || (s.requestId ? 'Saving identity…' : ''); section.appendChild(status);
  var bar = document.createElement('div'); bar.className = 'mate-settings-savebar'; section.appendChild(bar);
  button('Cancel',function () { resetMateProfile(); render(); document.getElementById('mate-profile-edit').focus(); },false,bar);
  button('Save identity',function () {
    var draft = state(); var ws = getWs();
    if (!draft.name.trim()) { put(Object.assign({},draft,{error:'Enter a name.'})); render(); return; }
    if (!ws || ws.readyState !== 1) { put(Object.assign({},draft,{error:'Clay is offline. Your changes are retained.'})); render(); return; }
    var requestId = 'mate-profile-' + Date.now() + '-' + (++sequence);
    put(Object.assign({},draft,{requestId:requestId,error:''})); render();
    try {
      var latest = (store.get('cachedMatesList') || []).find(function (m) { return m.id === mate.id; }) || mate;
      ws.send(JSON.stringify({type:'mate_update',mateId:mate.id,requestId:requestId,updates:{name:draft.name.trim(),bio:draft.bio.trim(),profile:Object.assign({},latest.profile,{displayName:draft.name.trim()})}}));
    } catch (error) { put(Object.assign({},draft,{requestId:null,error:'Could not send. Your changes are retained.'})); render(); return; }
    clearTimeout(timer); timer = setTimeout(function () { if (state() && state().requestId === requestId) { put(Object.assign({},state(),{requestId:null,error:'No response received. Your changes are retained; try again.'})); render(); } },15000);
  },true,bar);
}
