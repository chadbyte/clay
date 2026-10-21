import { toggleSidebarCollapse } from './sidebar.js';

export function syncSidebarReopenButton(button, active) {
  if (!button) return;
  var layout = document.getElementById("layout");
  var desktop = !window.matchMedia || window.matchMedia("(min-width: 769px)").matches;
  button.hidden = !layout || !desktop || !active || !layout.classList.contains("sidebar-collapsed");
}

export function createSidebarReopenButton() {
  var target = document.querySelector("#top-bar .top-bar-left-pills");
  if (!target) return null;
  var button = document.createElement("button");
  button.id = "sidebar-shell-expand-btn";
  button.type = "button";
  button.title = "Open sidebar";
  button.setAttribute("aria-label", "Open sidebar");
  button.setAttribute("aria-controls", "sidebar-column");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = '<i data-lucide="panel-left-open"></i>';
  button.hidden = true;
  button.addEventListener("click", function () {
    if (button.hidden) return;
    toggleSidebarCollapse();
  });
  target.prepend(button);
  return button;
}
