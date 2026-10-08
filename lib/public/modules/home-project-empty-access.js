// Accessibility boundary for the Home no-project overlay.

var coveredIds = ["home-conversation-region", "home-dock-backdrop", "home-dock-divider", "home-tool-workbench"];
var priorStates = new WeakMap();

function remember(element) {
  if (priorStates.has(element)) return;
  priorStates.set(element, {
    inert: element.inert === true,
    inertAttribute: element.hasAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  });
}

function restore(element) {
  var prior = priorStates.get(element);
  if (!prior) return;
  element.inert = prior.inert;
  if (prior.inertAttribute) element.setAttribute("inert", "");
  else element.removeAttribute("inert");
  if (prior.ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", prior.ariaHidden);
  priorStates.delete(element);
}

export function setHomeProjectEmptyCoverage(doc, covered) {
  for (var i = 0; i < coveredIds.length; i++) {
    var element = doc.getElementById(coveredIds[i]);
    if (!element) continue;
    if (!covered) { restore(element); continue; }
    remember(element);
    element.inert = true;
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  }
}

export function bindHomeProjectEmptyDismissal(sidebar, dismiss) {
  sidebar.addEventListener("click", function (event) {
    var control = event.target.closest("#home-sidebar-new, #home-sidebar-all, #home-sidebar-debate, #home-tools-btn, .home-mate-list-row, .home-sidebar-recent-list button");
    if (!control || control.disabled) return;
    dismiss();
  }, true);
}
