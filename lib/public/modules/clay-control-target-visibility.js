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
