// This page never opens a project socket or loads project content modules.
var tabs = Array.from(document.querySelectorAll('[role="tab"]'));
function select(tab) {
  tabs.forEach(function (item) {
    var active = item === tab;
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden = !active;
  });
}
tabs.forEach(function (tab, index) {
  tab.addEventListener("click", function () { select(tab); });
  tab.addEventListener("keydown", function (event) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) === -1) return;
    event.preventDefault();
    var target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    select(target);
    target.focus();
  });
});
select(tabs[0]);
