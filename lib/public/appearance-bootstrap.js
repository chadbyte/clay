(function () {
  var root = document.documentElement;
  var params = new URLSearchParams(window.location.search);
  if (window.parent !== window && params.get('pane') === '1' && params.get('contextual') === '1') root.classList.add('contextual-pane-boot');
  var light = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  var seed = window.__clayAppearanceSeed;

  var color = globalThis.ClayWorkspaceBackgrounds.getColor(seed && seed.backgroundColor, seed && seed.customBackgroundColors);
  root.dataset.workspaceColor = color.id;
  root.style.setProperty('--workspace-solid-light', color.light);
  root.style.setProperty('--workspace-solid-dark', color.dark);
  globalThis.ClayWorkspaceBackgrounds.applyPicture(root.style, seed && seed.background);
  root.dataset.workspaceBackground = globalThis.ClayWorkspaceBackgrounds.normalizeBackground(seed && seed.background);

  function applyMode(mode) {
    if (mode !== "light" && mode !== "dark") return;
    root.classList.toggle("light-theme", mode === "light");
    root.classList.toggle("dark-theme", mode !== "light");
  }

  var savedMode = seed && seed.configured && (seed.mode === "light" || seed.mode === "dark") ? seed.mode : null;
  applyMode(savedMode || (light ? "light" : "dark"));
}());
