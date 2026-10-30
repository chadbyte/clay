import { store } from './store.js';
import { workspaceBackgrounds, queueAppearanceSave, appearanceStatus } from './appearance-preferences.js';
import { registerTooltip, dismissTooltip } from './tooltip.js';

function preference() { return store.get('appearanceDraft') || store.get('appearancePreference') || {}; }
function clamp(value, max) { return Math.max(0, Math.min(max, value)); }
function hsv(hex) {
  var rgb = hex.slice(1).match(/../g).map(function (part) { return parseInt(part, 16) / 255; });
  var max = Math.max.apply(null, rgb), min = Math.min.apply(null, rgb), delta = max - min, hue = 0;
  if (delta) {
    if (max === rgb[0]) hue = ((rgb[1] - rgb[2]) / delta) % 6;
    else if (max === rgb[1]) hue = (rgb[2] - rgb[0]) / delta + 2;
    else hue = (rgb[0] - rgb[1]) / delta + 4;
  }
  return { hue: (hue * 60 + 360) % 360, saturation: max ? delta / max * 100 : 0, value: max * 100 };
}
function hex(color) {
  var chroma = color.value / 100 * color.saturation / 100;
  var x = chroma * (1 - Math.abs((color.hue / 60) % 2 - 1)), m = color.value / 100 - chroma;
  var rgb = color.hue < 60 ? [chroma,x,0] : color.hue < 120 ? [x,chroma,0] : color.hue < 180 ? [0,chroma,x] : color.hue < 240 ? [0,x,chroma] : color.hue < 300 ? [x,0,chroma] : [chroma,0,x];
  return '#' + rgb.map(function (value) { return Math.round((value + m) * 255).toString(16).padStart(2, '0'); }).join('').toUpperCase();
}
export function openCustomColor() {
  if (store.get('appearancePendingSaves') || store.get('appearanceColorEditor')) return;
  var current = preference(), source = workspaceBackgrounds.getColor(current.backgroundColor, current.customBackgroundColors);
  var variant = document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
  var draft = Object.assign({ id: 'custom-' + crypto.randomUUID(), light: source.light.toUpperCase(), dark: source.dark.toUpperCase(), variant: variant, saving: false, error: '', previousStatus: store.get('appearanceSaveStatus') || '', previousError: !!store.get('appearanceSaveError') }, hsv(source[variant]));
  store.set({ appearanceColorEditor: draft }); dismissTooltip();
  document.getElementById((current.customBackgroundColors || []).length >= workspaceBackgrounds.maxCustom ? 'us-color-cancel' : 'us-color-area').focus();
}
export function cancelCustomColor(restoreFocus) {
  var editor = store.get('appearanceColorEditor'); if (!editor || editor.saving) return;
  store.set({ appearanceColorEditor: null, appearanceColorPreview: null });
  appearanceStatus(editor.previousStatus, editor.previousError);
  if (restoreFocus !== false) document.getElementById('us-add-color').focus();
}
function updateEditor(change, visual) {
  var editor = store.get('appearanceColorEditor'); if (!editor || editor.saving) return;
  var next = Object.assign({}, editor, change, { error: '' });
  if (visual) next[next.variant] = hex(next);
  var custom = workspaceBackgrounds.normalizeCustom([{ id: next.id, name: next.light + ' / ' + next.dark, light: next.light, dark: next.dark }]);
  store.set({ appearanceColorEditor: next, appearanceColorPreview: custom ? custom[0] : store.get('appearanceColorPreview') });
}
async function saveEditor() {
  var editor = store.get('appearanceColorEditor'); if (!editor || editor.saving) return;
  var custom = workspaceBackgrounds.normalizeCustom([{ id: editor.id, name: editor.light + ' / ' + editor.dark, light: editor.light, dark: editor.dark }]);
  if (!custom) { store.set({ appearanceColorEditor: Object.assign({}, editor, { error: 'Use six-digit HEX colors, such as #E9CBD4.' }) }); document.getElementById('us-color-hex').focus(); return; }
  var current = preference(), colors = (current.customBackgroundColors || []).concat(custom);
  if (!workspaceBackgrounds.normalizeCustom(colors)) return;
  var values = Object.assign({}, current, { customBackgroundColors: colors, background: 'plain', backgroundColor: editor.id });
  store.set({ appearanceColorEditor: Object.assign({}, editor, { saving: true, error: '' }) });
  var saved = await queueAppearanceSave(values), active = store.get('appearanceColorEditor');
  if (!active || active.id !== editor.id) return;
  if (saved) {
    store.set({ appearanceColorEditor: null, appearanceColorPreview: null });
    var button = Array.from(document.querySelectorAll('[data-background-choice]')).find(function (node) { return node.dataset.backgroundChoice === editor.id; });
    if (button) button.focus({ preventScroll: true });
  } else {
    if (store.get('appearanceDraft') === values) {
      var acknowledged = store.get('appearancePreference') || {};
      var unchanged = ['theme','mode','lightTheme','darkTheme','background','backgroundColor','customBackgroundColors'].every(function (key) { return JSON.stringify(current[key] || null) === JSON.stringify(acknowledged[key] || null); });
      store.set({ appearanceDraft: unchanged ? null : current });
    }
    store.set({ appearanceColorEditor: Object.assign({}, active, { saving: false, error: 'Could not save. Your preview remains. Try Add again.' }) });
    document.getElementById('us-color-save').focus();
  }
}
export function createCustomColorEditor(host, anchor) {
  var form = document.createElement('form'); form.id = 'us-custom-color-editor'; form.className = 'us-color-popover'; form.hidden = true;
  form.setAttribute('role', 'dialog'); form.setAttribute('aria-label', 'Add color');
  form.innerHTML = '<div class="us-color-top"><div class="us-color-modes" role="group" aria-label="Color appearance"><button type="button" data-variant="light" aria-label="Light color"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="3"/><path d="M10 1v2m0 14v2M1 10h2m14 0h2M4 4l1.5 1.5m9 9L16 16M4 16l1.5-1.5m9-9L16 4"/></svg></button><button type="button" data-variant="dark" aria-label="Dark color"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16.7 12A7 7 0 0 1 8 3.3 7 7 0 1 0 16.7 12Z"/></svg></button></div><span class="us-color-preview" aria-hidden="true"></span></div><div class="us-color-controls"><div id="us-color-area" class="us-color-area" role="slider" tabindex="0" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100" aria-describedby="us-color-help"><span></span></div><span id="us-color-help" class="sr-only">Left and right adjust saturation. Up and down adjust brightness.</span><input id="us-color-hue" type="range" min="0" max="359" step="1" aria-label="Hue"><label for="us-color-hex" class="sr-only">HEX color</label><input id="us-color-hex" class="us-text-input" maxlength="7" spellcheck="false" autocomplete="off" aria-describedby="us-color-error"></div><p id="us-color-error" class="settings-status" role="status"></p><div class="settings-form-actions"><button id="us-color-save" class="us-btn" type="submit">Add</button><button id="us-color-cancel" class="settings-btn-sm" type="button">Cancel</button></div>';
  var area = form.querySelector('#us-color-area'), hue = form.querySelector('#us-color-hue'), input = form.querySelector('#us-color-hex');
  function position() {
    if (form.hidden) return;
    var box = anchor.getBoundingClientRect();
    var left = clamp(box.right - form.offsetWidth, window.innerWidth - form.offsetWidth - 8);
    var top = box.bottom + 6;
    if (top + form.offsetHeight > window.innerHeight - 8) top = box.top - form.offsetHeight - 6;
    form.style.left = Math.max(8, left) + 'px'; form.style.top = Math.max(8, top) + 'px';
  }
  form.querySelectorAll('[data-variant]').forEach(function (button) {
    registerTooltip(button, button.getAttribute('aria-label'));
    button.onclick = function () { var editor = store.get('appearanceColorEditor'); if (editor && !editor.saving) updateEditor(Object.assign({ variant: button.dataset.variant }, hsv(workspaceBackgrounds.normalizeHex(editor[button.dataset.variant]) || '#808080'))); };
  });
  input.oninput = function () {
    var editor = store.get('appearanceColorEditor'), change = {}; if (!editor) return;
    change[editor.variant] = input.value; var valid = workspaceBackgrounds.normalizeHex(input.value);
    if (valid) Object.assign(change, hsv(valid)); updateEditor(change);
  };
  hue.oninput = function () { updateEditor({ hue: Number(hue.value) }, true); };
  function point(event) {
    var editor = store.get('appearanceColorEditor'); if (!editor || editor.saving) return;
    var box = area.getBoundingClientRect();
    updateEditor({ saturation: clamp((event.clientX - box.left) / box.width * 100, 100), value: clamp(100 - (event.clientY - box.top) / box.height * 100, 100) }, true);
  }
  area.onpointerdown = function (event) { if (event.button !== 0) return; event.preventDefault(); area.focus(); area.setPointerCapture(event.pointerId); point(event); };
  area.onpointermove = function (event) { if (area.hasPointerCapture(event.pointerId)) point(event); };
  area.onkeydown = function (event) {
    var editor = store.get('appearanceColorEditor'); if (!editor) return;
    var change = {}, amount = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') change.saturation = clamp(editor.saturation - amount, 100);
    if (event.key === 'ArrowRight') change.saturation = clamp(editor.saturation + amount, 100);
    if (event.key === 'ArrowUp') change.value = clamp(editor.value + amount, 100);
    if (event.key === 'ArrowDown') change.value = clamp(editor.value - amount, 100);
    if (!Object.keys(change).length) return;
    event.preventDefault(); updateEditor(change, true);
  };
  form.querySelector('#us-color-cancel').onclick = function () { cancelCustomColor(); };
  form.onsubmit = function (event) { event.preventDefault(); saveEditor(); };
  form.onkeydown = function (event) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelCustomColor(); } };
  document.addEventListener('pointerdown', function (event) { if (!form.hidden && !form.contains(event.target) && !anchor.contains(event.target)) cancelCustomColor(false); }, true);
  form.addEventListener('focusout', function () { setTimeout(function () { if (!form.hidden && !form.contains(document.activeElement) && document.activeElement !== anchor) cancelCustomColor(false); }, 0); });
  window.addEventListener('resize', position); document.addEventListener('scroll', position, true);
  host.appendChild(form);
  return function () {
    var editor = store.get('appearanceColorEditor'); form.hidden = !editor; if (!editor) return;
    var limit = (preference().customBackgroundColors || []).length >= workspaceBackgrounds.maxCustom && !editor.saving;
    form.querySelector('.us-color-controls').hidden = limit; form.querySelector('.us-color-top').hidden = limit;
    form.querySelectorAll('[data-variant]').forEach(function (button) { button.setAttribute('aria-pressed', String(editor.variant === button.dataset.variant)); });
    input.value = editor[editor.variant]; input.setAttribute('aria-label', (editor.variant === 'light' ? 'Light' : 'Dark') + ' HEX'); input.setAttribute('aria-invalid', String(!workspaceBackgrounds.normalizeHex(input.value)));
    form.querySelector('.us-color-preview').style.backgroundColor = workspaceBackgrounds.normalizeHex(input.value) || 'transparent';
    area.style.setProperty('--picker-hue', String(editor.hue));
    area.querySelector('span').style.left = editor.saturation + '%'; area.querySelector('span').style.top = (100 - editor.value) + '%';
    area.setAttribute('aria-valuenow', String(Math.round(editor.saturation)));
    area.setAttribute('aria-valuetext', 'Saturation ' + Math.round(editor.saturation) + '%, brightness ' + Math.round(editor.value) + '%');
    hue.value = Math.round(editor.hue); hue.setAttribute('aria-valuetext', hue.value + ' degrees');
    form.querySelector('#us-color-error').textContent = limit ? '12 custom colors saved.' : editor.error || (editor.saving ? 'Saving…' : '');
    form.querySelectorAll('input,button').forEach(function (control) { control.disabled = editor.saving; });
    form.querySelector('#us-color-save').hidden = limit;
    position();
  };
}
