(function () {
  var root = document.documentElement;
  var light = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  var seed = window.__clayAppearanceSeed;

  function applyMode(mode) {
    if (mode !== "light" && mode !== "dark") return;
    root.classList.toggle("light-theme", mode === "light");
    root.classList.toggle("dark-theme", mode !== "light");
  }

  var savedMode = seed && seed.configured && (seed.mode === "light" || seed.mode === "dark") ? seed.mode : null;
  applyMode(savedMode || (light ? "light" : "dark"));
}());
