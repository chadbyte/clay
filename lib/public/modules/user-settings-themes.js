import { createWorkspaceBackgroundGallery } from './workspace-background-gallery.js';
import { store } from './store.js';
import { getThemes, retryAppearanceSave, getAppearanceChoices, selectAppearanceMode, selectAppearanceTheme, onThemeChange, importLegacyAppearance } from './theme.js';
import { enhanceSettingsSelects } from './settings-select.js';

export function initPersonalThemes(root) {
  root.innerHTML = '<h3>Theme</h3><div class="us-preference-row"><label class="settings-label" for="us-theme-mode">Appearance</label><select id="us-theme-mode" class="settings-select"><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></div><p class="settings-hint">Choose a palette for each appearance. Switching light and dark keeps both choices.</p><div class="us-theme-pair"></div><p id="us-appearance-status" class="settings-status" role="status"></p>';
  var syncBackground = createWorkspaceBackgroundGallery(root);
  root.appendChild(root.querySelector('#us-appearance-status'));
  var mode = root.querySelector('select');
  mode.onchange = function () { selectAppearanceMode(mode.value); };
  ['light', 'dark'].forEach(function (variant) {
    var group = document.createElement('div'); group.className = 'us-theme-choice';
    group.innerHTML = '<label class="settings-label" for="us-theme-' + variant + '">' + (variant === 'light' ? 'Light palette' : 'Dark palette') + '</label><select class="settings-select" id="us-theme-' + variant + '"></select><div class="us-theme-preview" aria-hidden="true"><div class="us-theme-preview-nav"></div><div class="us-theme-preview-content"><strong>Aa</strong><div class="us-theme-swatches"></div></div></div>';
    group.querySelector('select').onchange = function () { selectAppearanceTheme(variant, this.value); };
    root.querySelector('.us-theme-pair').appendChild(group);
  });
  function sync() {
    syncBackground();
    var themes = getThemes(); var choices = getAppearanceChoices(); mode.value = choices.mode; mode.dispatchEvent(new Event('settings-sync'));
    ['light', 'dark'].forEach(function (variant) {
      var select = root.querySelector('#us-theme-' + variant); select.replaceChildren();
      Object.keys(themes).filter(function (id) { return themes[id].variant === variant; }).sort(function (a,b) { return themes[a].name.localeCompare(themes[b].name); }).forEach(function (id) {
        var option = document.createElement('option'); option.value = id; option.textContent = themes[id].name; select.appendChild(option);
      });
      select.value = choices[variant + 'Theme']; select.dispatchEvent(new Event('settings-sync'));
      var theme = themes[select.value]; if (!theme) return;
      var preview = select.parentElement.querySelector('.us-theme-preview');
      preview.style.background = '#' + theme.base00; preview.style.color = '#' + theme.base06;
      preview.querySelector('.us-theme-preview-nav').style.background = '#' + theme.base01;
      var swatches = preview.querySelector('.us-theme-swatches'); swatches.replaceChildren();
      ['base08','base09','base0A','base0B','base0D','base0E'].forEach(function (key) { var dot = document.createElement('span'); dot.style.background = '#' + theme[key]; swatches.appendChild(dot); });
    });
  }
  var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'settings-btn-sm'; retry.textContent = 'Retry save'; retry.hidden = !store.get('appearanceSaveError'); retry.onclick = retryAppearanceSave; root.appendChild(retry);
  var legacy = document.createElement('button'); legacy.type = 'button'; legacy.className = 'settings-btn-sm'; legacy.textContent = "Import this browser's previous theme"; legacy.onclick = importLegacyAppearance; root.appendChild(legacy);
  store.subscribe(function (state, previous) {
    legacy.hidden = !state.legacyAppearanceAvailable; retry.hidden = !state.appearanceSaveError || !!state.appearanceColorEditor;
    if (state.appearanceDraft !== previous.appearanceDraft || state.appearancePreference !== previous.appearancePreference || state.appearanceColorEditor !== previous.appearanceColorEditor || state.appearanceColorPreview !== previous.appearanceColorPreview || state.appearancePendingSaves !== previous.appearancePendingSaves) sync();
  });
  legacy.hidden = !store.get('legacyAppearanceAvailable'); onThemeChange(sync); sync(); enhanceSettingsSelects(root);
}
