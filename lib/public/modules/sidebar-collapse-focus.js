// Keep desktop focus on the navigation controls when one side disappears.
export function restoreSidebarCollapseFocus(collapsed, previous) {
  if (!previous || document.body.classList.contains('pane-mode') || !window.matchMedia('(min-width: 769px)').matches) return;
  var leaving = collapsed ? previous.closest('#sidebar-column, #mate-sidebar-column') :
    previous.closest('#sidebar-shell-expand-btn, #sidebar-expand-btn, .split-pane-sidebar');
  if (!leaving) return;
  function restore(attempt) {
    var layout = document.getElementById('layout');
    if (!layout || layout.classList.contains('sidebar-collapsed') !== collapsed ||
        !window.matchMedia('(min-width: 769px)').matches ||
        document.activeElement !== previous && document.activeElement !== document.body) return;
    var mate = document.getElementById('mate-sidebar-column');
    var sidebar = mate && !mate.classList.contains('hidden') ? mate : document.getElementById('sidebar-column');
    var target = collapsed ? document.getElementById('sidebar-shell-expand-btn') :
      sidebar && sidebar.querySelector('.sidebar-collapse-btn');
    var region = collapsed ? document.getElementById('navigation-island') : sidebar;
    if (target && !target.hidden && region && region.getBoundingClientRect().width > 0 && target.getClientRects().length) {
      target.focus({ preventScroll: true });
    } else if (attempt < 3) requestAnimationFrame(function () { restore(attempt + 1); });
  }
  restore(0);
}
