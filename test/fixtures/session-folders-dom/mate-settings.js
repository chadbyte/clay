import { createStore, store } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { initMisc } from '/modules/app-misc.js';
import { openHomeMateSettings, handleMateInstructionsResult, handleHomeMateModelsState, handleHomeMateModelResult, syncHomeMateSettingsTarget, handleHomeMateAvatarError } from '/modules/home-mate-settings.js';
import { createHomeMateSettingsTrigger } from '/modules/home-mate-settings-menu.js';
var source = await fetch('/index.html').then(function (r) { return r.text(); });
var shell = new DOMParser().parseFromString(source, 'text/html'); shell.querySelectorAll('script').forEach(function (el) { el.remove(); });
document.body.replaceChildren.apply(document.body, Array.from(shell.body.children));
document.documentElement.classList.toggle('light-theme', new URLSearchParams(location.search).get('theme') !== 'dark');
document.getElementById('connect-overlay').classList.add('hidden');
var mate = {id:'mate_preview', name:'Ari', vendor:'codex', model:'luna', bio:'A thoughtful partner for product design.', profile:{avatarStyle:'bottts'}};
createStore({cachedMatesList:[mate], connected:true, activeSessionId:1, currentSlug:'mate-mate_preview'});
window.__sent = []; window.__fail = ''; window.__hold = false;
var prompt = '# Ari\n\nI am a thoughtful design partner. I ask precise questions and explain my decisions.\n\n## Working together\nKeep responses concise, practical, and grounded in the project.';
var revision = 'v1';
var ws = {readyState:1, send:function (raw) {
  var msg = JSON.parse(raw); window.__sent.push(msg); if (window.__hold) return;
  setTimeout(function () {
    if (msg.type === 'mate_instructions_get' || msg.type === 'mate_instructions_set') {
      var saving = msg.type === 'mate_instructions_set';
      if (saving && !window.__fail) { prompt = msg.content; revision += '1'; }
      handleMateInstructionsResult({mateId:msg.mateId, requestId:msg.requestId, ok:!window.__fail, operation:saving ? 'save' : 'read', content:prompt, revision:revision, error:window.__fail, conflict:window.__fail === 'Changed elsewhere.'});
    }
    if (msg.type === 'home_mate_models_get') handleHomeMateModelsState({mateId:msg.mateId, requestId:msg.requestId, status:window.__fail ? 'error' : 'ready', vendor:msg.vendor, mateVendor:mate.vendor, mateModel:mate.model, vendors:[{id:'codex', displayName:'Codex'}, {id:'claude', displayName:'Claude Code'}], models:[{value:'luna', displayName:'Luna'}, {value:'sol', displayName:'Sol'}], error:window.__fail});
    if (msg.type === 'home_mate_model_set') {
      if (!window.__fail) { mate.vendor = msg.vendor; mate.model = msg.model; }
      handleHomeMateModelResult({mateId:msg.mateId, requestId:msg.requestId, ok:!window.__fail, vendor:msg.vendor, model:msg.model, error:window.__fail});
    }
    if (msg.type === 'mate_update') {
      if (window.__fail) handleHomeMateAvatarError({mateId:msg.mateId, requestId:msg.requestId, error:window.__fail});
      else { Object.assign(mate, msg.updates); store.set({cachedMatesList:[mate]}); syncHomeMateSettingsTarget({mate:mate,requestId:msg.requestId}); }
    }
  }, 80);
}};
setWs(ws); initMisc();
var opener = createHomeMateSettingsTrigger(mate); document.getElementById('header-title').replaceChildren(opener);
window.__open = function () { openHomeMateSettings(mate.id, opener, {sessionId:1}); };
window.__offline = function (offline) { ws.readyState = offline ? 0 : 1; };
window.__instructions = handleMateInstructionsResult;
window.__open(); window.__ready = true;
