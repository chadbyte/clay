// Measured folder-body expand/collapse motion. Only direct user toggles create
// animation records; initial snapshots and ordinary rerenders settle instantly.

import { store } from './store.js';

var MIN_DURATION_MS = 180;
var MAX_DURATION_MS = 480;
var LONG_DISTANCE_START_PX = 120;
var MS_PER_EXTRA_PX = 0.32;
var EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

function keyFor(surface, folderId) {
  return surface + ":" + folderId;
}

function records() {
  return store.get('sessionFolderCollapseAnimations') || {};
}

function putRecord(key, record) {
  var next = Object.assign({}, records());
  if (record) next[key] = record;
  else delete next[key];
  store.set({ sessionFolderCollapseAnimations: next });
}

function currentRecord(key, token) {
  var record = records()[key];
  return record && (!token || record.token === token) ? record : null;
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cancelBodyAnimation(body) {
  var animations = body.getAnimations ? body.getAnimations() : [];
  for (var i = 0; i < animations.length; i++) animations[i].cancel();
}

function durationForDistance(distance) {
  var extra = Math.max(0, distance - LONG_DISTANCE_START_PX) * MS_PER_EXTRA_PX;
  return Math.round(Math.min(MAX_DURATION_MS, MIN_DURATION_MS + extra));
}

function scrollContainerFor(element) {
  var node = element && element.parentElement;
  while (node && node !== document.body) {
    var style = window.getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return document.scrollingElement;
}

function captureScrollPosition(element) {
  var scroller = scrollContainerFor(element);
  return scroller ? scroller.scrollTop : null;
}

function restoreScrollPosition(record, element) {
  if (typeof record.scrollTop !== "number") return;
  var scroller = scrollContainerFor(element);
  if (scroller) scroller.scrollTop = record.scrollTop;
}

function cleanBody(body) {
  cancelBodyAnimation(body);
  body.classList.remove("folder-collapse-animating");
  body.style.height = "";
  body.style.overflow = "";
}

function setAccessibleState(root, body, toggle, open) {
  toggle.setAttribute("aria-expanded", String(open));
  root.classList.toggle("collapsed", !open);
  if (open) {
    body.hidden = false;
    body.removeAttribute("aria-hidden");
    body.removeAttribute("inert");
    body.inert = false;
  } else {
    if (body.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    body.setAttribute("aria-hidden", "true");
    body.setAttribute("inert", "");
    body.inert = true;
  }
}

function finish(key, token, root, body, toggle, open) {
  if (currentRecord(key, token)) putRecord(key, null);
  cleanBody(body);
  setAccessibleState(root, body, toggle, open);
  body.hidden = !open;
}

function animateRecord(key, record, root, body, toggle) {
  if (!body.isConnected || !currentRecord(key, record.token)) return;
  cleanBody(body);
  body.hidden = false;
  var start = typeof record.height === "number" ? record.height : body.getBoundingClientRect().height;
  body.style.height = "";
  var end = record.open ? body.getBoundingClientRect().height : 0;
  body.style.height = start + "px";
  body.style.overflow = "hidden";
  body.classList.add("folder-collapse-animating");
  setAccessibleState(root, body, toggle, record.open);
  var distance = Math.abs(end - start);
  if (!record.endsAt) {
    record = Object.assign({}, record, { endsAt: Date.now() + durationForDistance(distance) });
    putRecord(key, record);
  }
  var remaining = Math.max(1, record.endsAt - Date.now());
  if (reducedMotion() || !body.animate || Math.abs(end - start) < 0.5) {
    finish(key, record.token, root, body, toggle, record.open);
    return;
  }
  var animation = body.animate(
    [{ height: start + "px" }, { height: end + "px" }],
    { duration: remaining, easing: EASING, fill: "forwards" }
  );
  animation.finished.then(function () {
    finish(key, record.token, root, body, toggle, record.open);
  }).catch(function () {});
}

export function toggleFolderCollapse(root, body, toggle, surface, folderId, commit) {
  var key = keyFor(surface, folderId);
  var open = toggle.getAttribute("aria-expanded") !== "true";
  var start = body.hidden ? 0 : body.getBoundingClientRect().height;
  cancelBodyAnimation(body);
  if (open) body.hidden = false;
  var record = {
    token: Date.now() + ":" + Math.random(),
    open: open,
    height: start,
    endsAt: 0,
    scrollTop: captureScrollPosition(toggle),
  };
  putRecord(key, record);
  commit(!open);
  animateRecord(key, record, root, body, toggle);
}

export function restoreFolderCollapse(root, body, toggle, surface, folderId, collapsed, forceOpen) {
  var key = keyFor(surface, folderId);
  var record = currentRecord(key);
  cleanBody(body);
  if (forceOpen) {
    if (record) putRecord(key, null);
    setAccessibleState(root, body, toggle, true);
    return;
  }
  if (!record) {
    setAccessibleState(root, body, toggle, !collapsed);
    body.hidden = collapsed;
    return;
  }
  setAccessibleState(root, body, toggle, record.open);
  body.style.height = record.height + "px";
  body.style.overflow = "hidden";
  body.classList.add("folder-collapse-animating");
  queueMicrotask(function () {
    var live = currentRecord(key, record.token);
    if (live) {
      restoreScrollPosition(live, toggle);
      animateRecord(key, live, root, body, toggle);
    }
  });
}

export function captureFolderCollapseAnimations(root) {
  if (!root || !root.querySelectorAll) return;
  var bodies = root.querySelectorAll(".session-folder-body.folder-collapse-animating");
  var next = Object.assign({}, records());
  var changed = false;
  for (var i = 0; i < bodies.length; i++) {
    var body = bodies[i];
    var folder = body.closest(".session-folder");
    if (!folder) continue;
    var surface = folder.classList.contains("is-mobile") ? "mobile" : "desktop";
    var key = keyFor(surface, folder.dataset.folderId);
    if (!next[key]) continue;
    next[key] = Object.assign({}, next[key], {
      height: body.getBoundingClientRect().height,
      scrollTop: captureScrollPosition(body),
    });
    changed = true;
  }
  if (changed) store.set({ sessionFolderCollapseAnimations: next });
}
