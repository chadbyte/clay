// Native selects own values and change events; this view adds desktop navigation.
export function enhanceSettingsSelects(root) {
  if (!root) return;
  root.querySelectorAll('select:not(.settings-nav-dropdown)').forEach(function (select) {
    if (select.dataset.settingsPicker) return;
    select.dataset.settingsPicker = 'true';
    select.classList.add('settings-native-select');
    var wrap = document.createElement('span');
    wrap.className = 'settings-picker';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-picker-trigger';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    var label = document.createElement('span');
    label.className = 'settings-picker-value';
    button.appendChild(label);
    button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>');
    var menu = document.createElement('span');
    menu.className = 'settings-picker-menu';
    menu.id = (select.id || 'settings-select-' + document.querySelectorAll('.settings-picker').length) + '-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    button.setAttribute('aria-controls', menu.id);
    var enclosingLabel = select.closest('label');
    var associatedLabel = select.labels && select.labels[0];
    var name = select.getAttribute('aria-label') || (enclosingLabel && enclosingLabel.querySelector('.settings-label') || {}).textContent || (associatedLabel && associatedLabel.textContent) || 'Choose a value';
    name = name.trim();
    menu.setAttribute('aria-label', name);
    select.insertAdjacentElement('afterend', wrap);
    wrap.append(button, menu);
    var search = '';
    var searchAt = 0;
    function outside(event) { if (!wrap.contains(event.target)) close(false); }
    function close(focus) {
      document.removeEventListener('pointerdown', outside);
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focus) button.focus();
    }
    function sync() {
      label.textContent = (select.selectedOptions[0] || {}).textContent || 'Choose…';
      button.setAttribute('aria-label', name + ': ' + label.textContent);
      button.disabled = select.disabled;
      if (button.disabled) close(false);
      menu.replaceChildren();
      Array.from(select.options).forEach(function (option) {
        var item = document.createElement('button');
        item.type = 'button';
        item.tabIndex = -1;
        item.setAttribute('role', 'option');
        item.textContent = option.textContent;
        item.setAttribute('aria-selected', String(option.selected));
        item.disabled = option.disabled || (option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled);
        item.hidden = option.hidden;
        item.onclick = function (event) {
          event.preventDefault();
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          sync();
          close(true);
        };
        menu.appendChild(item);
      });
    }
    function items() { return Array.from(menu.querySelectorAll('button:not(:disabled):not([hidden])')); }
    function open() {
      sync();
      var choices = items();
      if (!choices.length || button.disabled) return;
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside);
      var bounds = button.getBoundingClientRect();
      var boundary = wrap.closest('.server-settings-content, .us-modal-content, .us-content, .ps-content, .admin-modal');
      var bottom = Math.min(window.innerHeight - 8, boundary ? boundary.getBoundingClientRect().bottom - 8 : window.innerHeight - 8);
      var above = bounds.top - Math.max(8, boundary ? boundary.getBoundingClientRect().top + 8 : 8);
      var below = bottom - bounds.bottom - 4;
      var flip = below < 180 && above > below;
      menu.classList.toggle('settings-picker-menu-above', flip);
      menu.style.maxHeight = Math.max(64, Math.min(240, flip ? above : below)) + 'px';
      var selected = menu.querySelector('[aria-selected="true"]:not(:disabled):not([hidden])');
      (selected || choices[0]).focus();
    }
    button.onclick = function (event) {
      event.preventDefault();
      if (menu.hidden) open(); else close(false);
    };
    wrap.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault(); event.stopPropagation(); close(true); return;
      }
      // Return to the trigger before native Tab traversal leaves this control.
      if (event.key === 'Tab' && !menu.hidden) { close(true); return; }
      var navigation = ['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) >= 0;
      var typing = event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!navigation && !typing) return;
      event.preventDefault();
      var wasClosed = menu.hidden;
      if (wasClosed) open();
      var choices = items();
      if (!choices.length) return;
      var index = choices.indexOf(document.activeElement);
      if (typing) {
        search = Date.now() - searchAt > 700 ? event.key : search + event.key;
        searchAt = Date.now();
        var match = choices.find(function (item) { return item.textContent.trim().toLowerCase().indexOf(search.toLowerCase()) === 0; });
        if (match) match.focus();
      } else if (!wasClosed || event.key === 'Home' || event.key === 'End') {
        index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        choices[index].focus();
      }
    });
    wrap.addEventListener('focusout', function (event) { if (!wrap.contains(event.relatedTarget)) close(false); });
    select.addEventListener('change', sync);
    select.addEventListener('settings-sync', sync);
    // Async option loading and pending/failed saves retain native control behavior.
    new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ['disabled'], childList: true, subtree: true, characterData: true });
    sync();
  });
}
