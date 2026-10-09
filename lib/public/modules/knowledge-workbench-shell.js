var inertEntries = [];

export function setKnowledgeNarrowBackground(panel, active) {
  if (!panel) return;
  var narrow = active && window.matchMedia('(max-width: 1023px)').matches;
  if (narrow && !inertEntries.length) {
    var branch = panel;
    while (branch.parentElement && branch.parentElement !== document.body) {
      Array.prototype.forEach.call(branch.parentElement.children, function (child) {
        if (child === branch) return;
        inertEntries.push({ element: child, inert: child.inert, ariaHidden: child.getAttribute('aria-hidden') });
        child.inert = true; child.setAttribute('aria-hidden', 'true');
      });
      branch = branch.parentElement;
    }
  }
  if (!narrow && inertEntries.length) {
    inertEntries.forEach(function (item) { item.element.inert = item.inert; if (item.ariaHidden == null) item.element.removeAttribute('aria-hidden'); else item.element.setAttribute('aria-hidden', item.ariaHidden); });
    inertEntries = [];
  }
}
