import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { MATE_WORKSPACE_COLORS, workspaceColor } from './mate-workspace-color.js';

var timer = null;
var sequence = 0;
function state() { return store.get('mateColorSave'); }
function put(value) { store.set({ mateColorSave: value }); }
export function resetMateColor() { clearTimeout(timer); put(null); }
export function mateColorSaving() { return !!(state() && state().requestId); }
export function applyMateColorResult(msg) {
  var s = state();
  if (!s || !s.requestId || msg.requestId !== s.requestId || (msg.mate ? msg.mate.id : msg.mateId) !== s.mateId) return false;
  clearTimeout(timer);
  put(Object.assign({}, s, { requestId: null, error: msg.mate ? '' : (msg.error || 'Could not save the color. Try again.'), saved: !!msg.mate }));
  return true;
}
export function renderMateColorPicker(body, mate, render) {
  if (!mate || mate.builtinKey === 'clay' || mate.primary) return;
  var color = workspaceColor(mate);
  var s = state();
  if (s && s.mateId !== mate.id) s = null;
  var section = document.createElement('section'); section.className = 'mate-color-picker';
  var title = document.createElement('h4'); title.textContent = 'Workspace color'; section.appendChild(title);
  var help = document.createElement('p'); help.className = 'mate-settings-help';
  help.textContent = 'Give this Mate its own color. Soft in daylight, muted after dark.';
  section.appendChild(help);
  var preview = document.createElement('div'); preview.className = 'mate-color-previews';
  ['light', 'dark'].forEach(function (theme) {
    var sample = document.createElement('div'); sample.className = 'mate-color-preview ' + theme;
    sample.style.backgroundColor = color[theme];
    sample.innerHTML = '<span class="mate-color-preview-label">' + (theme === 'light' ? 'Light' : 'Dark') + '</span><div class="mate-color-preview-canvas"><strong>Room to think</strong><span>A little color. A clear mind.</span></div>';
    preview.appendChild(sample);
  });
  section.appendChild(preview);
  var swatches = document.createElement('div'); swatches.className = 'mate-color-swatches';
  swatches.setAttribute('role', 'group'); swatches.setAttribute('aria-label', 'Workspace color');
  MATE_WORKSPACE_COLORS.forEach(function (choice) {
    var button = document.createElement('button'); button.type = 'button'; button.id = 'mate-color-' + choice.id;
    button.className = 'mate-color-swatch'; button.style.setProperty('--swatch', choice.pigment);
    button.title = choice.label; button.setAttribute('aria-label', choice.label);
    button.setAttribute('aria-pressed', String(color.id === choice.id));
    button.setAttribute('aria-disabled', String(!!(s && s.requestId)));
    if (color.id === choice.id) button.textContent = '✓';
    button.addEventListener('click', function () {
      if (mateColorSaving()) return;
      var ws = getWs();
      if (!ws || ws.readyState !== 1) { put({mateId:mate.id,error:'Clay is offline. Reconnect and try again.'}); render(); return; }
      var requestId = 'mate-color-' + Date.now() + '-' + (++sequence);
      put({mateId:mate.id,requestId:requestId,color:choice.id,error:''}); render();
      try { ws.send(JSON.stringify({type:'mate_update',mateId:mate.id,requestId:requestId,updates:{workspaceColor:choice.id}})); }
      catch (error) { put({mateId:mate.id,error:'Could not send the color. Try again.'}); render(); return; }
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (state() && state().requestId === requestId) {
          put({mateId:mate.id,error:'No response received. Reconnect to check the saved color before retrying.'}); render();
        }
      },15000);
    });
    swatches.appendChild(button);
  });
  section.appendChild(swatches);
  var status = document.createElement('p'); status.className = 'mate-settings-status'; status.setAttribute('role', s && s.error ? 'alert' : 'status');
  status.textContent = (s && s.error) || (s && s.requestId ? 'Saving color…' : color.label + (s && s.saved ? ' · Saved' : ''));
  section.appendChild(status); body.appendChild(section);
}
