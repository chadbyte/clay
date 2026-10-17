// github-star.js - Public star count beside the top-bar GitHub Star link.
//
// The link itself is static markup. This module only fills in the count read
// from the server's cached GET /api/github-stars. An unknown count leaves the
// count segment hidden; nothing is invented, and the module never writes to
// GitHub or sends anything about the user.

import { store } from './store.js';

var REFRESH_MS = 60 * 60 * 1000;
var MOBILE_QUERY = "(max-width: 768px)";

var timer = null;
var inflight = false;

// 999 -> "999", 1234 -> "1.2k", 12500 -> "12.5k", 1200000 -> "1.2m"
export function formatStarCount(n) {
  if (typeof n !== "number" || !isFinite(n) || n < 0) return "";
  n = Math.floor(n);
  if (n < 1000) return String(n);
  var units = [[1000000, "m"], [1000, "k"]];
  for (var i = 0; i < units.length; i++) {
    if (n >= units[i][0]) {
      var v = Math.floor(n / units[i][0] * 10) / 10;
      return (v % 1 === 0 ? String(v) : v.toFixed(1)) + units[i][1];
    }
  }
  return String(n);
}

function render() {
  var count = store.get("githubStarCount");
  var countEl = document.getElementById("github-star-count");
  var linkEl = document.getElementById("github-star-link");
  if (!countEl || !linkEl) return;
  var text = typeof count === "number" ? formatStarCount(count) : "";
  countEl.textContent = text;
  countEl.classList.toggle("hidden", !text);
  linkEl.setAttribute("aria-label", text ? "Star Clay on GitHub, " + count + " stars" : "Star Clay on GitHub");
}

function isMobile() {
  return !!(window.matchMedia && window.matchMedia(MOBILE_QUERY).matches);
}

function load() {
  if (inflight || isMobile()) return Promise.resolve();
  inflight = true;
  return fetch("/api/github-stars", { credentials: "same-origin" }).then(function (res) {
    return res.ok ? res.json() : null;
  }).then(function (data) {
    // Keep the last known count when the server has none or the call failed.
    if (data && typeof data.stars === "number") {
      store.set({ githubStarCount: data.stars });
      render();
    }
  }).catch(function () {}).then(function () { inflight = false; });
}

export function initGithubStar() {
  if (!document.getElementById("github-star")) return;
  render();
  load();
  if (timer) clearInterval(timer);
  timer = setInterval(load, REFRESH_MS);
}
