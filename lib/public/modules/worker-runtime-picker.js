import { iconHtml, refreshIcons } from './icons.js';

// Keep the existing select as the value source; desktop uses a compact listbox.
export function enhanceWorkerRuntimePicker(select, label, popupHost) {
  var wrapper = document.createElement('div');
  wrapper.className = 'worker-runtime-picker';
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  var trigger = document.createElement('button');
  trigger.type = 'button';
  if (select.id) trigger.id = select.id + '-trigger';
  trigger.className = 'worker-runtime-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  wrapper.appendChild(trigger);
  var popup = null;
  var observer = null;
  function close(restore) {
    if (!popup) return;
    if (observer) { observer.disconnect(); observer = null; }
    popup.remove();
    popup = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', dismiss);
    document.removeEventListener('scroll', scroll, true);
    if (restore && trigger.isConnected && !trigger.disabled) trigger.focus();
  }
  function outside(event) { if (!wrapper.contains(event.target) && popup && !popup.contains(event.target)) close(false); }
  function dismiss() { close(false); }
  function scroll(event) { if (popup && !popup.contains(event.target)) close(false); }
  function sync() {
    close(false);
    trigger.disabled = select.disabled;
    var option = select.options[select.selectedIndex];
    var text = option ? option.textContent : 'Automatic';
    trigger.replaceChildren();
    var value = document.createElement('span');
    value.textContent = text;
    trigger.appendChild(value);
    trigger.insertAdjacentHTML('beforeend', iconHtml('chevron-down'));
    trigger.setAttribute('aria-label', label + ': ' + text);
    refreshIcons();
  }
  function open() {
    if (trigger.disabled) return;
    if (popup) { close(false); return; }
    popup = document.createElement('div');
    popup.className = 'worker-runtime-options';
    popup.setAttribute('role', 'listbox');
    popup.setAttribute('aria-label', label);
    Array.from(select.options).forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option.selected));
      button.disabled = option.disabled;
      button.tabIndex = option.selected ? 0 : -1;
      button.textContent = option.textContent;
      button.addEventListener('click', function () {
        select.value = option.value;
        close(true);
        select.dispatchEvent(new Event('change', {bubbles: true}));
        sync();
      });
      popup.appendChild(button);
    });
    popup.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (event.key === 'Tab') {
        event.preventDefault();
        var targets = Array.from((popupHost || document).querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]')).filter(function (el) {
          return !popup.contains(el) && el.getClientRects().length && el.tabIndex >= 0;
        });
        var targetIndex = targets.indexOf(trigger) + (event.shiftKey ? -1 : 1);
        var target = targets[popupHost ? (targetIndex + targets.length) % targets.length : targetIndex];
        close(false);
        if (target) target.focus();
        else trigger.focus();
        return;
      }
      var choices = Array.from(popup.querySelectorAll('button:not(:disabled)'));
      var index = choices.indexOf(document.activeElement);
      var next = index;
      if (event.key === 'ArrowDown') next = (index + 1) % choices.length;
      else if (event.key === 'ArrowUp') next = (index + choices.length - 1) % choices.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = choices.length - 1;
      else if (event.key.length === 1) next = choices.findIndex(function (button, i) { return i > index && button.textContent.toLowerCase().startsWith(event.key.toLowerCase()); });
      else return;
      if (next >= 0 && choices[next]) { event.preventDefault(); choices.forEach(function (button) { button.tabIndex = -1; }); choices[next].tabIndex = 0; choices[next].focus(); }
    });
    (popupHost || document.body).appendChild(popup);
    observer = new MutationObserver(function () { if (!trigger.isConnected) close(false); });
    observer.observe(document.body, {childList: true, subtree: true});
    var rect = trigger.getBoundingClientRect();
    popup.style.width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16) + 'px';
    popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8)) + 'px';
    var height = Math.min(popup.scrollHeight, 240);
    popup.style.top = (rect.bottom + height + 12 <= innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)) + 'px';
    trigger.setAttribute('aria-expanded', 'true');
    var selected = popup.querySelector('[aria-selected="true"]:not(:disabled)') || popup.querySelector('button:not(:disabled)');
    if (selected) { selected.tabIndex = 0; selected.focus(); }
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', scroll, true);
  }
  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
  });
  select.addEventListener('change', sync);
  sync();
  return sync;
}
