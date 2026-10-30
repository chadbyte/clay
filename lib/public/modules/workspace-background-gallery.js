import { store } from './store.js';
import { workspaceBackgrounds, selectAppearanceBackground } from './appearance-preferences.js';
import { createCustomColorEditor, openCustomColor, cancelCustomColor } from './workspace-custom-colors.js';
import { registerTooltip } from './tooltip.js';

function chevron(right) { return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="' + (right ? 'm8 5 5 5-5 5' : 'm12 5-5 5 5 5') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
export function createWorkspaceBackgroundGallery(root) {
  var gallery = document.createElement('div');
  gallery.id = 'us-workspace-background'; gallery.className = 'us-background-gallery';
  gallery.setAttribute('role', 'radiogroup'); gallery.setAttribute('aria-label', 'Workspace background');
  gallery.setAttribute('aria-describedby', 'us-background-help');
  gallery.innerHTML = '<h3>Workspace background</h3><p id="us-background-help" class="settings-hint">Choose a color or picture. Both follow your light or dark appearance.</p><div class="us-background-palette"><button type="button" class="us-palette-arrow" data-step="-1" aria-label="Previous colors" hidden>' + chevron(false) + '</button><div class="us-background-colors"></div><button type="button" class="us-palette-arrow" data-step="1" aria-label="Next colors" hidden>' + chevron(true) + '</button><button type="button" id="us-add-color" class="us-palette-add" aria-label="Add custom color" aria-haspopup="dialog" aria-expanded="false" aria-controls="us-custom-color-editor"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div><h4>Pictures</h4><div class="us-background-pictures"></div>';
  var strip = gallery.querySelector('.us-background-colors');
  var add = gallery.querySelector('#us-add-color'); registerTooltip(add, 'Add custom color');
  add.dataset.tipSuppressWhenOpen = '#us-custom-color-editor';
  function addChoice(color, container) {
    var button = document.createElement('button'); button.type = 'button'; button.className = 'us-background-choice';
    button.dataset.backgroundChoice = color ? color.id : 'workshop';
    button.setAttribute('role', 'radio'); button.setAttribute('aria-label', color ? color.name : 'Workshop');
    var preview = document.createElement('span'); preview.className = 'us-background-sample'; preview.setAttribute('aria-hidden', 'true');
    if (color) { preview.style.setProperty('--swatch-light', color.light); preview.style.setProperty('--swatch-dark', color.dark); registerTooltip(button, color.name); }
    else { preview.classList.add('us-background-workshop'); }
    button.appendChild(preview);
    if (!color) { var label = document.createElement('span'); label.textContent = 'Workshop'; button.appendChild(label); }
    container.appendChild(button);
    button.onclick = function () { selectAppearanceBackground(color ? 'plain' : 'workshop', color ? color.id : undefined); };
  }
  function overflow() {
    var overflowing = strip.scrollWidth > strip.clientWidth + 1;
    gallery.querySelectorAll('[data-step]').forEach(function (button) {
      button.hidden = !overflowing;
      button.disabled = button.dataset.step === '-1' ? strip.scrollLeft < 1 : strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
    });
  }
  gallery.querySelectorAll('[data-step]').forEach(function (button) {
    registerTooltip(button, button.getAttribute('aria-label'));
    button.onclick = function () { strip.scrollBy({ left: Number(button.dataset.step) * strip.clientWidth * 0.8 }); };
  });
  strip.onscroll = overflow;
  function reveal(button) {
    if (!button || !strip.contains(button) || !strip.clientWidth) return;
    var box = button.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
    if (box.left < bounds.left) strip.scrollLeft -= bounds.left - box.left;
    if (box.right > bounds.right) strip.scrollLeft += box.right - bounds.right;
  }
  function layout() {
    overflow();
    var visible = strip.clientWidth > 0;
    if (visible && (strip.dataset.visible !== 'true' || strip.dataset.revealPending === 'true')) {
      reveal(strip.querySelector('[aria-checked="true"]'));
      delete strip.dataset.revealPending;
    }
    strip.dataset.visible = String(visible);
  }
  strip.addEventListener('focusin', function (event) { reveal(event.target); });
  addChoice(null, gallery.querySelector('.us-background-pictures'));
  add.onclick = function () { if (store.get('appearanceColorEditor')) cancelCustomColor(); else openCustomColor(); };
  var syncEditor = createCustomColorEditor(gallery, add);
  var buttons = [], renderedColors = null;
  gallery.onkeydown = function (event) {
    var index = buttons.indexOf(event.target); if (index < 0) return;
    var target;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % buttons.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index + buttons.length - 1) % buttons.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = buttons.length - 1;
    if (target === undefined) return;
    event.preventDefault(); buttons[target].focus({ preventScroll: strip.contains(buttons[target]) }); buttons[target].click();
  };
  root.appendChild(gallery);
  new ResizeObserver(layout).observe(strip);
  return function () {
    var current = store.get('appearanceDraft') || store.get('appearancePreference') || {};
    var colors = workspaceBackgrounds.colors.concat(current.customBackgroundColors || []);
    if (renderedColors !== JSON.stringify(colors)) {
      var focused = document.activeElement && document.activeElement.dataset.backgroundChoice;
      renderedColors = JSON.stringify(colors); strip.replaceChildren();
      colors.forEach(function (color) { addChoice(color, strip); });
      if (focused) { var restored = Array.from(strip.children).find(function (button) { return button.dataset.backgroundChoice === focused; }); if (restored) restored.focus({ preventScroll: true }); }
    }
    buttons = Array.from(gallery.querySelectorAll('[role="radio"]'));
    var editor = store.get('appearanceColorEditor'); add.disabled = !!store.get('appearancePendingSaves');
    add.setAttribute('aria-expanded', String(!!editor)); syncEditor();
    var selected = current.background === 'workshop' ? 'workshop' : workspaceBackgrounds.getColor(current.backgroundColor, current.customBackgroundColors).id;
    if (strip.dataset.selection !== selected) { strip.dataset.selection = selected; strip.dataset.revealPending = 'true'; }
    buttons.forEach(function (button) {
      var checked = button.dataset.backgroundChoice === selected;
      button.setAttribute('aria-checked', String(checked)); button.tabIndex = checked ? 0 : -1; button.disabled = !!(editor && editor.saving);
    });
    layout();
  };
}
