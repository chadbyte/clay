// Progressive enhancement: native selects remain the source of values/events.
export function enhanceSettingsSelects(root) {
  if (!root) return;
  root.querySelectorAll('select:not(.settings-nav-dropdown)').forEach(function (select) {
    if (select.dataset.settingsPicker) return;
    select.dataset.settingsPicker = 'true';
    select.classList.add('settings-native-select');
    var wrap = document.createElement('span'); wrap.className = 'settings-picker';
    var button = document.createElement('button'); button.type = 'button'; button.className = 'settings-btn-sm settings-picker-trigger';
    button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    var menu = document.createElement('span'); menu.className = 'settings-picker-menu'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
    var name = select.getAttribute('aria-label') || (select.closest('label') && select.closest('label').querySelector('.settings-label') || {}).textContent || 'Choose a value';
    menu.setAttribute('aria-label', name); button.setAttribute('aria-label', name);
    select.insertAdjacentElement('afterend', wrap); wrap.append(button, menu);
    function close(focus) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); }
    function sync() {
      button.textContent = (select.selectedOptions[0] || {}).textContent || 'Choose…';
      button.disabled = select.disabled;
      menu.replaceChildren();
      Array.from(select.options).forEach(function (option) {
        var item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'option');
        item.textContent = option.textContent; item.setAttribute('aria-selected', String(option.selected)); item.disabled = option.disabled;
        item.onclick = function () { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); sync(); close(true); };
        menu.appendChild(item);
      });
    }
    button.onclick = function () { if (!menu.hidden) return close(false); sync(); menu.hidden = false; button.setAttribute('aria-expanded', 'true'); (menu.querySelector('[aria-selected="true"]') || menu.firstChild).focus(); };
    wrap.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === 'Tab') close(false);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) < 0) return;
      event.preventDefault();
      if (menu.hidden) { button.click(); return; }
      var items = Array.from(menu.querySelectorAll('button:not(:disabled)'));
      var index = items.indexOf(document.activeElement);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index].focus();
    });
    wrap.addEventListener('focusout', function (event) { if (!wrap.contains(event.relatedTarget)) close(false); });
    select.addEventListener('change', sync); select.addEventListener('settings-sync', sync); sync();
  });
}
