import { store } from './store.js';
import { initPersonalThemes } from './user-settings-themes.js';
import { TERMINAL_FONT_OPTIONS, getTerminalFontFamily, getTerminalFontSize, saveTerminalFont, onTerminalFontChange } from './terminal-prefs.js';
import { enhanceSettingsSelects } from './settings-select.js';

export function initPersonalAppearance() {
  var theme = document.getElementById('us-theme-picker').closest('.settings-card');
  initPersonalThemes(theme);

  var layout = document.getElementById('us-layout-switcher');
  layout.closest('.settings-card').classList.add('us-layout-group');
  layout.setAttribute('role', 'group'); layout.setAttribute('aria-label', 'Conversation layout');
  layout.querySelectorAll('button').forEach(function (button) {
    var bubble = button.dataset.layout === 'bubble';
    button.querySelector('.layout-option-desc').textContent = bubble ? 'Centered messages in separate bubbles.' : 'Full-width conversation with avatars.';
    var preview = document.createElement('span'); preview.className = 'us-layout-preview us-layout-preview-' + button.dataset.layout; preview.setAttribute('aria-hidden', 'true');
    preview.innerHTML = '<i></i><i></i><i></i>'; button.prepend(preview);
  });
  layout.querySelectorAll('button').forEach(function (button) { button.setAttribute('aria-pressed', button.classList.contains('selected')); });
  addTerminalTypography(theme.closest('.us-section'));
  enhanceSettingsSelects(theme);
}

function addTerminalTypography(section) {
  var content = document.createElement('section'); content.className = 'us-typography settings-card';
  content.innerHTML = '<h3>Terminal typography</h3><p class="settings-hint">Used by existing and new terminals. Also available from the terminal toolbar.</p><div class="us-font-controls"><div><label class="settings-label" for="us-terminal-family">Font</label><select id="us-terminal-family" class="settings-select"></select></div><div><label class="settings-label" for="us-terminal-size">Size</label><div class="us-font-size"><input id="us-terminal-size" class="us-text-input" type="number" min="9" max="32" step="1" aria-label="Terminal font size"><span>px</span></div></div></div><div class="us-font-preview" aria-hidden="true">Aa Bb 0123 · ~/projects/clay</div><p class="settings-status" role="status" id="us-terminal-status"></p><button type="button" class="settings-btn-sm" id="us-terminal-retry" hidden>Retry save</button>';
  section.appendChild(content);
  var family = content.querySelector('select'); var size = content.querySelector('input');
  var preview = content.querySelector('.us-font-preview'); var status = content.querySelector('[role=status]'); var retry = content.querySelector('#us-terminal-retry');
  TERMINAL_FONT_OPTIONS.forEach(function (font) {
    var option = document.createElement('option'); option.value = font.family; option.textContent = font.label; family.appendChild(option);
  });
  function sync() {
    if (store.get('userTerminalDirty')) return;
    var value = getTerminalFontFamily();
    if (!Array.from(family.options).some(function (option) { return option.value === value; })) {
      var option = document.createElement('option'); option.value = value; option.textContent = 'Custom font'; family.appendChild(option);
    }
    family.value = value; size.value = getTerminalFontSize();
    preview.style.fontFamily = value; preview.style.fontSize = size.value + 'px';
    family.dispatchEvent(new Event('settings-sync'));
  }
  async function save() {
    var value = Number(size.value); store.set({ userTerminalDirty: true });
    if (!Number.isInteger(value) || value < 9 || value > 32) { status.textContent = 'Choose a whole size from 9 to 32.'; status.dataset.state = 'error'; return; }
    family.disabled = true; size.disabled = true; retry.hidden = true; status.textContent = 'Saving…'; status.dataset.state = '';
    try {
      await saveTerminalFont(family.value, value); store.set({ userTerminalDirty: false }); sync(); status.textContent = 'Saved.';
    } catch (error) { status.textContent = error.message; status.dataset.state = 'error'; retry.hidden = false; }
    finally { family.disabled = false; size.disabled = false; family.dispatchEvent(new Event('settings-sync')); }
  }
  family.onchange = save; size.onchange = save; retry.onclick = save;
  size.oninput = function () { store.set({ userTerminalDirty: true }); };
  onTerminalFontChange(sync); sync(); enhanceSettingsSelects(content);
}
