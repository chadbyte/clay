import { store } from './store.js';
import { contextualMate, contextualTrigger } from './contextual-mate-identity.js';
import { getHomeMateName } from './home-mate-selection.js';

export function renderContextualMateHint() {
  var state = store.get('contextualClay') || {};
  var mate = contextualMate(state.mateId);
  var active = state.mode === 'popover' && mate;
  var narrow = window.matchMedia('(max-width: 768px)').matches;
  var moved = document.querySelector('.contextual-mate-mobile-trigger');
  if (moved && (!active || !narrow || moved.dataset.mateId !== mate.id)) {
    moved.classList.remove('contextual-mate-mobile-trigger');
    document.getElementById('icon-strip-projects').appendChild(moved);
  }
  var anchor = active && contextualTrigger(mate.id);
  if (anchor && narrow && mate.builtinKey !== 'clay') {
    anchor.classList.add('contextual-mate-mobile-trigger'); if (anchor.parentNode !== document.body) document.body.appendChild(anchor);
  }
  document.body.classList.toggle('contextual-mate-hint-mobile', !!active && narrow);
  document.body.classList.toggle('contextual-mate-ordinary-mobile', !!active && narrow && mate.builtinKey !== 'clay');
  document.querySelectorAll('[aria-describedby="contextual-mate-hint"]').forEach(function (item) { if (item !== anchor) item.removeAttribute('aria-describedby'); });
  var hint = document.getElementById('contextual-mate-hint');
  if (!hint || !active || !anchor || !anchor.getClientRects().length) { if (hint) hint.hidden = true; return null; }
  anchor.setAttribute('aria-describedby', hint.id);
  var name = getHomeMateName(mate);
  hint.textContent = (window.matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click') + ' again to open ' + name;
  hint.title = hint.textContent;
  hint.setAttribute('aria-label', 'Open ' + name + ' workspace');
  hint.hidden = false;
  var rect = anchor.getBoundingClientRect();
  hint.style.maxWidth = (narrow ? window.innerWidth - 64 : Math.min(260, window.innerWidth - rect.right - 24)) + 'px';
  hint.style.left = (narrow ? 50 : rect.right + 8) + 'px';
  hint.style.top = (narrow ? 8 : Math.max(8, Math.min(window.innerHeight - 38, rect.top + (rect.height - 28) / 2))) + 'px';
  return hint.getBoundingClientRect();
}
export function initContextualMateHint(activate) {
  var hint = document.createElement('button'); hint.type = 'button'; hint.id = 'contextual-mate-hint'; hint.hidden = true;
  hint.addEventListener('click', function () { activate((store.get('contextualClay') || {}).mateId); });
  document.body.appendChild(hint);
}
