import { store } from './store.js';

// Stable product adapters only. Activity data never supplies a CSS selector.
export function controlTarget(target) {
  if (!target || target.projectSlug !== store.get('currentSlug')) return null;
  if (target.kind === 'session' && Number.isSafeInteger(target.sessionId) && typeof target.sessionOriginId === 'string' && target.sessionOriginId) {
    return Array.from(document.querySelectorAll('.session-item[data-session-id]')).find(function (row) {
      return Number(row.dataset.sessionId) === target.sessionId && row.dataset.controlSessionOrigin === target.sessionOriginId && visibleTarget(row);
    }) || null;
  }
  // Project icons do not yet expose an authoritative runtime identity stamp.
  // Project/record/file/schedule operations use compact status instead.
  return null;
}
export function visibleTarget(element) {
  if (!element || !element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  var rect = element.getBoundingClientRect(), style = getComputedStyle(element);
  if (style.visibility !== 'visible' || Number(style.opacity) === 0 || !rect.width || !rect.height || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
  for (var parent = element.parentElement; parent; parent = parent.parentElement) {
    if (Number(getComputedStyle(parent).opacity) === 0) return false;
  }
  return [rect.left + 2, rect.left + rect.width / 2, rect.right - 2].every(function (x) {
    var hit = document.elementFromPoint(x, rect.top + rect.height / 2);
    return hit && element.contains(hit);
  });
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
  return candidates.find(function (candidate) {
    var box = { left: candidate.left, right: candidate.left + width, top: candidate.top, bottom: candidate.top + height };
    if (box.left < margin || box.right > innerWidth - margin || box.top < margin || box.bottom > innerHeight - margin) return false;
    if (rect && overlaps(box, rect)) return false;
    return !obstacles.some(function (obstacle) { return overlaps(box, obstacle); });
  }) || null;
}
