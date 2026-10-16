import { visibleTarget } from './clay-control-target-visibility.js';
export { visibleTarget };
import { objectControlTarget } from './clay-control-object-targets.js';
import { store } from './store.js';

// Stable product adapters only. Activity data never supplies a CSS selector.
export function controlTarget(target) {
  if (!target) return null;
  if (target.kind !== 'session') { var object = objectControlTarget(target); return visibleTarget(object) ? object : null; }
  if (target.projectSlug !== store.get('currentSlug')) return null;
  if (target.kind === 'session' && Number.isSafeInteger(target.sessionId) && typeof target.sessionOriginId === 'string' && target.sessionOriginId) {
    return Array.from(document.querySelectorAll('.session-item[data-session-id]')).find(function (row) {
      return Number(row.dataset.sessionId) === target.sessionId && row.dataset.controlSessionOrigin === target.sessionOriginId && visibleTarget(row);
    }) || null;
  }
  return null;
}

function overlaps(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
export function activityPlacement(row, width, height, obstacles) {
  var margin = 12, rect = row && row.getBoundingClientRect();
  var candidates = [];
  if (rect) {
    // Keep the cursor shaft seated in the identity pill in either vertical direction.
    candidates.push({ left: rect.right + 8, top: rect.top + rect.height / 2 + 20, tipX: rect.right - 2, tipY: rect.top + rect.height / 2 });
    candidates.push({ left: rect.right + 8, top: rect.top + rect.height / 2 - 34, tipX: rect.right - 2, tipY: rect.top + rect.height / 2, flip: true });
    candidates.push({ left: rect.left - width - 8, top: rect.top + rect.height / 2 + 20, tipX: rect.left + 2, tipY: rect.top + rect.height / 2, reverse: true });
  }
  candidates.push({ left: innerWidth - width - margin, top: 64 });
  candidates.push({ left: margin, top: 64 });
  candidates.push({ left: innerWidth - width - margin, top: innerHeight - height - 80 });
  candidates.push({ left: (innerWidth - width) / 2, top: 64 });
  obstacles.slice(0, 12).forEach(function (obstacle) {
    candidates.push({ left: innerWidth - width - margin, top: obstacle.bottom + 8 });
    candidates.push({ left: margin, top: obstacle.bottom + 8 });
    candidates.push({ left: (innerWidth - width) / 2, top: obstacle.bottom + 8 });
  });
  return candidates.find(function (candidate) {
    var box = { left: candidate.left, right: candidate.left + width, top: candidate.top, bottom: candidate.top + height };
    if (box.left < margin || box.right > innerWidth - margin || box.top < margin || box.bottom > innerHeight - margin) return false;
    if (rect && overlaps(box, rect)) return false;
    return !obstacles.some(function (obstacle) { return overlaps(box, obstacle); });
  }) || null;
}
